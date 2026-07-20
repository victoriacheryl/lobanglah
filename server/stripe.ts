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
 * Creates the two PaymentIntents behind the platform-fee charge — a
 * card-only one that drives Stripe's <PaymentElement/>, and a paynow-only
 * one that drives our own inline QR flow via confirmPayNowPayment. Only one
 * of the two ever actually gets paid; whichever the poster completes first
 * "wins", and the caller is responsible for cancelling the other.
 *
 * These used to be a single PaymentIntent with
 * payment_method_types: ["card", "paynow"], on the theory that pinning both
 * explicitly (rather than relying on automatic_payment_methods, whose
 * dynamic eligibility engine can silently omit PayNow) guarantees both show
 * up. That worked, but "both show up" turned out to include PayNow showing
 * up a second time as a selectable tab inside the Payment Element itself —
 * Stripe's PaymentElement has no client-side option to hide a payment
 * method type that's allowed on its underlying PaymentIntent. Splitting into
 * two intents, one per method, is the only way to keep our custom PayNow
 * panel while restricting the Payment Element to card only.
 */
export async function createFeeChargePaymentIntents(params: {
  bidAmountSgd: number;
  customerId: string;
  listingId: number;
  bidId: number;
}): Promise<{
  cardPaymentIntentId: string;
  cardClientSecret: string;
  paynowPaymentIntentId: string;
  paynowClientSecret: string;
  feeAmount: number;
}> {
  const feeSgd = calculateFeeSgd(params.bidAmountSgd);
  const metadata = {
    lobangListingId: String(params.listingId),
    lobangBidId: String(params.bidId),
    lobangKind: "platform_fee",
  };
  const [cardIntent, paynowIntent] = await Promise.all([
    requireStripe().paymentIntents.create({
      amount: toCents(feeSgd),
      currency: CURRENCY,
      customer: params.customerId,
      payment_method_types: ["card"],
      metadata,
    }),
    requireStripe().paymentIntents.create({
      amount: toCents(feeSgd),
      currency: CURRENCY,
      customer: params.customerId,
      payment_method_types: ["paynow"],
      metadata,
    }),
  ]);
  return {
    cardPaymentIntentId: cardIntent.id,
    cardClientSecret: cardIntent.client_secret as string,
    paynowPaymentIntentId: paynowIntent.id,
    paynowClientSecret: paynowIntent.client_secret as string,
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

/** One half of {@link retrieveOrUpgradeClientSecrets} — re-fetches or
 *  recreates a single method-scoped PaymentIntent. `existingId` is null for
 *  fee charges created before the paynow intent column existed. */
async function retrieveOrCreateScopedIntent(params: {
  existingId: string | null;
  method: "card" | "paynow";
  customerId: string;
  listingId: number;
  bidId: number;
  feeAmountSgd: number;
}): Promise<{ paymentIntentId: string; clientSecret: string; recreated: boolean }> {
  if (params.existingId) {
    const intent = await requireStripe().paymentIntents.retrieve(params.existingId);
    if (intent.status === "succeeded") throw new Error("This fee has already been paid");
    if (intent.status !== "canceled" && intent.client_secret && intent.payment_method_types?.includes(params.method)) {
      return { paymentIntentId: intent.id, clientSecret: intent.client_secret, recreated: false };
    }
    // Canceled, missing its client secret, or (for legacy rows) scoped to the
    // wrong method type — cancel it best-effort and issue a fresh one below.
    try {
      await requireStripe().paymentIntents.cancel(params.existingId);
    } catch {
      // Already canceled/processing — ignore.
    }
  }
  const fresh = await requireStripe().paymentIntents.create({
    amount: toCents(params.feeAmountSgd),
    currency: CURRENCY,
    customer: params.customerId,
    payment_method_types: [params.method],
    metadata: {
      lobangListingId: String(params.listingId),
      lobangBidId: String(params.bidId),
      lobangKind: "platform_fee",
    },
  });
  return { paymentIntentId: fresh.id, clientSecret: fresh.client_secret as string, recreated: true };
}

/**
 * Re-fetches (or, if needed, recreates) the client secrets for both of a fee
 * charge's PaymentIntents — used when the poster reopens the checkout tab
 * after not completing payment the first time. `existingPaynowId` may be
 * null for fee charges created before the two-intent split existed.
 */
export async function retrieveOrUpgradeClientSecrets(params: {
  existingCardId: string | null;
  existingPaynowId: string | null;
  customerId: string;
  listingId: number;
  bidId: number;
  feeAmountSgd: number;
}): Promise<{
  cardPaymentIntentId: string;
  cardClientSecret: string;
  cardRecreated: boolean;
  paynowPaymentIntentId: string;
  paynowClientSecret: string;
  paynowRecreated: boolean;
}> {
  const [card, paynow] = await Promise.all([
    retrieveOrCreateScopedIntent({
      existingId: params.existingCardId,
      method: "card",
      customerId: params.customerId,
      listingId: params.listingId,
      bidId: params.bidId,
      feeAmountSgd: params.feeAmountSgd,
    }),
    retrieveOrCreateScopedIntent({
      existingId: params.existingPaynowId,
      method: "paynow",
      customerId: params.customerId,
      listingId: params.listingId,
      bidId: params.bidId,
      feeAmountSgd: params.feeAmountSgd,
    }),
  ]);
  return {
    cardPaymentIntentId: card.paymentIntentId,
    cardClientSecret: card.clientSecret,
    cardRecreated: card.recreated,
    paynowPaymentIntentId: paynow.paymentIntentId,
    paynowClientSecret: paynow.clientSecret,
    paynowRecreated: paynow.recreated,
  };
}

export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return requireStripe().webhooks.constructEvent(rawBody, signature, secret);
}
