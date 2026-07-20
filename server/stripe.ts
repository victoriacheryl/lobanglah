import Stripe from "stripe";

/**
 * Real-payments layer for LobangLah!.
 *
 * There is no escrow and no Stripe Connect. The poster and provider settle
 * the job amount directly with each other outside the app (cash, PayNow,
 * bank transfer). The only thing LobangLah! ever charges is a small platform
 * fee — whichever is greater of S$5 or 10% of the bid — taken from the
 * poster's card the instant they accept a bid. It's a normal one-time
 * charge: automatic capture, no holds, no transfers, no split payouts.
 *
 * This module is inert (all exported functions throw/no-op safely) until
 * STRIPE_SECRET_KEY is set, so the app's existing simulated fee-charge demo
 * flow keeps working unchanged for anyone who hasn't connected a Stripe
 * account yet.
 */

export const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

export const stripe = stripeEnabled
  ? new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2026-06-24.dahlia" })
  : null;

const PLATFORM_FEE_RATE = 0.1;
const MIN_FEE_SGD = 5;
const CURRENCY = "sgd";

function toCents(sgd: number): number {
  return Math.round(sgd * 100);
}

/** The platform fee for a given bid: whichever is greater of S$5 or 10% of the bid. */
export function calculateFeeSgd(bidAmountSgd: number): number {
  const pctFee = Math.round(bidAmountSgd * PLATFORM_FEE_RATE * 100) / 100;
  return Math.max(MIN_FEE_SGD, pctFee);
}

export function requireStripe(): Stripe {
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing)");
  return stripe;
}

/** Creates a Stripe Customer for a poster the first time they need to pay a platform fee. */
export async function ensureCustomer(user: { id: number; email: string; name: string; stripeCustomerId: string | null }): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await requireStripe().customers.create({
    email: user.email,
    name: user.name,
    metadata: { lobangUserId: String(user.id) },
  });
  return customer.id;
}

/**
 * Creates the platform-fee PaymentIntent charged to the poster the moment
 * they accept a bid. Automatic capture — the card is charged as soon as the
 * poster confirms via Stripe Elements. No hold, no manual capture step.
 */
export async function createFeeChargePaymentIntent(params: {
  bidAmountSgd: number;
  customerId: string;
  listingId: number;
  bidId: number;
}): Promise<{ paymentIntentId: string; clientSecret: string; feeAmount: number }> {
  const feeSgd = calculateFeeSgd(params.bidAmountSgd);
  const intent = await requireStripe().paymentIntents.create({
    amount: toCents(feeSgd),
    currency: CURRENCY,
    customer: params.customerId,
    // Pinned explicitly instead of automatic_payment_methods: Stripe's
    // dynamic eligibility engine can silently omit PayNow even when it's
    // enabled in the Dashboard (it factors in session/device signals beyond
    // just currency + Dashboard config), so listing both methods by name
    // guarantees Card and PayNow always both appear in the Payment Element.
    payment_method_types: ["card", "paynow"],
    metadata: {
      lobangListingId: String(params.listingId),
      lobangBidId: String(params.bidId),
      lobangKind: "platform_fee",
    },
  });
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret as string,
    feeAmount: feeSgd,
  };
}

/** Cancels a fee-charge PaymentIntent that hasn't succeeded yet (e.g. the poster backs out). */
export async function cancelFeeCharge(paymentIntentId: string): Promise<void> {
  await requireStripe().paymentIntents.cancel(paymentIntentId);
}

/**
 * Direct-lookup fallback for environments where the webhook endpoint isn't
 * (yet) publicly reachable/registered in the Stripe dashboard, e.g. local dev
 * or before the first production deploy. The frontend calls this right after
 * `stripe.confirmPayment` resolves so the fee charge can finalize immediately
 * instead of waiting on a webhook that may never arrive during testing.
 */
export async function getPaymentIntentStatus(paymentIntentId: string): Promise<Stripe.PaymentIntent.Status> {
  const intent = await requireStripe().paymentIntents.retrieve(paymentIntentId);
  return intent.status;
}

/**
 * Re-fetches the client secret for an existing PaymentIntent that hasn't
 * succeeded yet — used when the poster reopens the checkout after not
 * completing it the first time (closed the modal, connection dropped,
 * etc.). Does not create a new charge or a new PaymentIntent.
 */
export async function retrieveClientSecret(paymentIntentId: string): Promise<string> {
  let intent = await requireStripe().paymentIntents.retrieve(paymentIntentId);
  if (intent.status === "succeeded") throw new Error("This fee has already been paid");
  if (intent.status === "canceled") throw new Error("This payment was canceled — accept the bid again to retry");
  if (!intent.client_secret) throw new Error("This payment can no longer be retried — accept the bid again");
  // Older PaymentIntents (created before payment_method_types was pinned
  // explicitly) may still be on automatic_payment_methods and missing
  // PayNow — try to patch them on the way out so reopening checkout shows
  // both methods, without needing to cancel and recreate the intent. Stripe
  // doesn't guarantee this switch is allowed post-creation, so this is a
  // best-effort upgrade: if it fails, fall back to the original secret
  // rather than blocking the payment entirely.
  if (!intent.payment_method_types?.includes("paynow")) {
    try {
      intent = await requireStripe().paymentIntents.update(paymentIntentId, {
        payment_method_types: ["card", "paynow"],
      });
    } catch {
      // Ignore — this PaymentIntent will just show whatever methods it was
      // originally created with (e.g. Card only via automatic_payment_methods).
    }
  }
  return intent.client_secret as string;
}

export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return requireStripe().webhooks.constructEvent(rawBody, signature, secret);
}
