// Real-payments extension of DatabaseStorage's bid-acceptance / fee-charge
// finalization logic. Split into its own file to keep server/storage.ts's
// simulated-mode code path (used whenever STRIPE_SECRET_KEY isn't set)
// untouched and easy to diff.
import { db, countCommittedBids, rejectOtherPendingBids } from "./storage";
import { users, listings, bids, feeCharges } from "@shared/schema";
import type { Bid, Listing, FeeCharge } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ensureCustomer, createFeeChargePaymentIntent, getPaymentIntentStatus } from "./stripe";

export async function acceptBidWithStripe(
  bid: Bid,
  listing: Listing,
  posterId: number
): Promise<{ listing: Listing; feeCharge: FeeCharge; clientSecret?: string }> {
  // Guard against a double-click / duplicate accept creating two in-flight
  // PaymentIntents for the same bid.
  const existingPending = db
    .select()
    .from(feeCharges)
    .where(and(eq(feeCharges.bidId, bid.id), eq(feeCharges.status, "pending")))
    .get();
  if (existingPending) throw new Error("A card charge is already in progress for this bid");

  const poster = db.select().from(users).where(eq(users.id, posterId)).get();
  const provider = db.select().from(users).where(eq(users.id, bid.bidderId)).get();
  if (!poster) throw new Error("Poster account not found");
  if (!provider) throw new Error("Provider account not found");

  const customerId = await ensureCustomer({
    id: poster.id,
    email: poster.email,
    name: poster.name,
    stripeCustomerId: poster.stripeCustomerId,
  });
  if (!poster.stripeCustomerId) {
    db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, poster.id)).run();
  }

  const { paymentIntentId, clientSecret, feeAmount } = await createFeeChargePaymentIntent({
    bidAmountSgd: bid.amount,
    customerId,
    listingId: listing.id,
    bidId: bid.id,
  });

  // The listing stays "live" while this charge is in flight — it only
  // closes once enough bids have actually been accepted (paid) to reach the
  // poster's target headcount. See finalizeFeeCharge below.
  const feeCharge = db
    .insert(feeCharges)
    .values({
      listingId: listing.id,
      bidId: bid.id,
      posterId,
      providerId: bid.bidderId,
      bidAmount: bid.amount,
      feeAmount,
      status: "pending",
      createdAt: Date.now(),
      stripePaymentIntentId: paymentIntentId,
    })
    .returning()
    .get();

  return { listing, feeCharge, clientSecret };
}

/** Called from the Stripe webhook (or sync fallback) once the fee charge succeeds. */
export function finalizeFeeCharge(paymentIntentId: string): void {
  const charge = db.select().from(feeCharges).where(eq(feeCharges.stripePaymentIntentId, paymentIntentId)).get();
  if (!charge || charge.status !== "pending") return;

  db.update(feeCharges).set({ status: "paid", paidAt: Date.now() }).where(eq(feeCharges.id, charge.id)).run();
  db.update(bids).set({ status: "accepted" }).where(eq(bids.id, charge.bidId)).run();

  // Only close the listing (and reject remaining pending bids) once the
  // poster's target headcount has actually been reached.
  const listing = db.select().from(listings).where(eq(listings.id, charge.listingId)).get();
  if (!listing) return;
  const acceptedCount = countCommittedBids(listing.id);
  if (acceptedCount >= listing.quantityNeeded) {
    db.update(listings).set({ status: "closed" }).where(eq(listings.id, listing.id)).run();
    rejectOtherPendingBids(listing.id, charge.bidId);
  }
}

/** Called from the Stripe webhook if the fee charge fails, or if we cancel it ourselves. */
export function failFeeCharge(paymentIntentId: string): void {
  const charge = db.select().from(feeCharges).where(eq(feeCharges.stripePaymentIntentId, paymentIntentId)).get();
  if (!charge) return;
  db.update(feeCharges).set({ status: "failed" }).where(eq(feeCharges.id, charge.id)).run();
  // The listing/bid were never changed away from "live"/"pending" while the
  // charge was in flight, so there's nothing to revert on them — the bid
  // simply remains open for the poster to accept again (or accept a different bid).
}

/**
 * Directly checks a PaymentIntent's status with Stripe and finalizes/fails
 * the fee charge accordingly. Used as a fallback right after client-side
 * confirmation for setups where the webhook hasn't been registered yet.
 */
export async function syncFeeCharge(paymentIntentId: string): Promise<void> {
  const status = await getPaymentIntentStatus(paymentIntentId);
  if (status === "succeeded") {
    finalizeFeeCharge(paymentIntentId);
  } else if (status === "canceled" || status === "requires_payment_method") {
    failFeeCharge(paymentIntentId);
  }
  // Other statuses (requires_action, processing, etc.) are left alone — the
  // frontend will keep polling or the webhook will catch up.
}
