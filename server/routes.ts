import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import rateLimit from "express-rate-limit";
import {
  storage,
  createSessionToken,
  getUserIdFromToken,
  startRegistration,
  resendRegistrationOtp,
  verifyRegistration,
  resendRegistrationEmailLink,
  verifyRegistrationEmailLink,
  invalidateOtherSessions,
  startPasswordReset,
  resendPasswordResetOtp,
  completePasswordReset,
  startListingExpiryScheduler,
  startAnnouncementScheduler,
} from "./storage";
import {
  registerStartSchema,
  registerVerifySchema,
  verifyEmailLinkSchema,
  insertListingSchema,
  insertBidSchema,
  bidUpdateSchema,
  adminUpdateBidSchema,
  payFeeChargeSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  changePasswordSchema,
  forgotPasswordStartSchema,
  forgotPasswordResetSchema,
  contactMessageSchema,
  createAdminSchema,
  adminUpdateUserSchema,
} from "@shared/schema";
import type { User } from "@shared/schema";
import { stripeEnabled, constructWebhookEvent } from "./stripe";
import type Stripe from "stripe";
import { sendContactMessage } from "./email";

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
      currentToken?: string;
    }
  }
}

function toPublicUser(user: User) {
  const { password, ...rest } = user;
  return rest;
}

/** Extracts a clean, user-facing message from a ZodError (or any error). */
function friendlyError(err: any, fallback: string): string {
  if (err?.issues?.length) return err.issues[0].message;
  return err?.message || fallback;
}

/** Returns a user-facing message if the account is currently suspended or
 *  banned, or null if it's clear to proceed. A suspension whose window has
 *  already passed is treated as expired here — callers that hold a fresh
 *  DB row (post lazy-reactivation) will simply not see status "suspended"
 *  anymore, so this only ever fires for a still-active restriction. */
function restrictionMessage(user: User): string | null {
  if (user.status === "banned") {
    return `Your account has been banned.${user.restrictionReason ? ` Reason: ${user.restrictionReason}` : ""}`;
  }
  if (user.status === "suspended" && user.suspendedUntil && user.suspendedUntil > Date.now()) {
    const until = new Date(user.suspendedUntil).toLocaleString("en-SG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `Your account is suspended until ${until}.${user.restrictionReason ? ` Reason: ${user.restrictionReason}` : ""}`;
  }
  return null;
}

/** A suspension whose window has passed is lazily lifted back to "active"
 *  the next time the account is touched, rather than requiring an admin (or
 *  a background job) to do it. Mutates the passed-in user object in place so
 *  callers immediately see the reactivated state. */
async function liftExpiredSuspension(user: User): Promise<void> {
  if (user.status === "suspended" && user.suspendedUntil && user.suspendedUntil <= Date.now()) {
    const updated = await storage.reactivateUser(user.id);
    user.status = updated.status;
    user.suspendedUntil = updated.suspendedUntil;
    user.restrictionReason = updated.restrictionReason;
  }
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const userId = getUserIdFromToken(token);
  if (!userId) return res.status(401).json({ message: "Not signed in" });
  const user = await storage.getUser(userId);
  if (!user) return res.status(401).json({ message: "Not signed in" });

  await liftExpiredSuspension(user);
  const restriction = restrictionMessage(user);
  if (restriction) {
    // accountRestricted lets the client distinguish "your account was
    // restricted mid-session" from an ordinary 403 (e.g. non-admin hitting
    // an admin route) and react by forcing a clean logout instead of just
    // showing a toast on whichever request happened to fail first.
    return res.status(403).json({ message: restriction, accountRestricted: true });
  }

  req.currentUser = user;
  req.currentToken = token;
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
  next();
}

// Brute-force protection on login: 10 attempts per 15 minutes per IP. Keyed
// by IP rather than email so an attacker can't just rotate target emails to
// dodge the limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please wait a few minutes and try again." },
});

// Abuse protection on endpoints that trigger a WhatsApp OTP send (register
// start/resend, forgot-password start/resend) — these have a real per-message
// cost and could otherwise be used to spam a phone number or run up a bill.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please wait a few minutes and try again." },
});

// Contact Us sends a real outbound email per submission — cap it so the form
// can't be used to spam the support inbox.
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many enquiries sent. Please wait a few minutes and try again." },
});

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- API docs (interactive Swagger UI, for testing against this
  // running server — hits the real endpoints, so "Try it out" actually works) ----------
  app.get("/openapi.yaml", (_req, res) => {
    res.type("text/yaml").sendFile(path.resolve(process.cwd(), "openapi.yaml"));
  });

  app.get("/api/docs", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
  <head>
    <title>LobangLah! API docs</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/openapi.yaml",
          dom_id: "#swagger-ui",
          presets: [SwaggerUIBundle.presets.apis],
          persistAuthorization: true,
        });
      };
    </script>
  </body>
</html>`);
  });

  // ---------- Public config ----------
  // Tells the frontend whether real Stripe checkout is configured. When it isn't,
  // the frontend falls back to the original simulated one-click escrow flow so
  // nothing breaks for anyone who hasn't connected a Stripe account yet.
  app.get("/api/config", (_req, res) => {
    res.json({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null });
  });

  // ---------- Stripe webhook ----------
  // Registered with access to req.rawBody (captured by the global express.json()
  // verify hook in server/index.ts) so we can validate Stripe's signature against
  // the exact raw bytes without needing a separate raw-body-parser route.
  app.post("/api/stripe/webhook", async (req, res) => {
    if (!stripeEnabled) return res.status(400).json({ message: "Stripe is not configured" });
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature || !req.rawBody) return res.status(400).json({ message: "Missing signature" });
    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(req.rawBody as Buffer, signature);
    } catch (err: any) {
      return res.status(400).json({ message: `Webhook signature verification failed: ${err.message}` });
    }

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const pi = event.data.object as Stripe.PaymentIntent;
          await storage.finalizeFeeCharge(pi.id);
          break;
        }
        case "payment_intent.payment_failed": {
          const pi = event.data.object as Stripe.PaymentIntent;
          await storage.failFeeCharge(pi.id, pi.last_payment_error?.message || "Card was declined");
          break;
        }
      }
      res.json({ received: true });
    } catch (err: any) {
      console.error("Stripe webhook handler error:", err);
      res.status(500).json({ message: "Webhook handler failed" });
    }
  });

  // ---------- Auth ----------
  // Three-step sign-up: step 1 collects details and sends a 6-digit code to
  // the phone number over WhatsApp; step 2 verifies that code and — instead
  // of creating the account yet — emails a clickable confirmation link to
  // the address given; step 3 happens when that link is opened (a separate,
  // standalone request) and only then creates the real account. See
  // server/whatsapp.ts and server/email.ts for the real/simulated send logic
  // for each channel.
  function requestBaseUrl(req: Request): string {
    return `${req.protocol}://${req.get("host")}`;
  }

  app.post("/api/auth/register/start", otpLimiter, async (req, res) => {
    try {
      const data = registerStartSchema.parse(req.body);
      const result = await startRegistration(data);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Invalid registration details") });
    }
  });

  app.post("/api/auth/register/resend", otpLimiter, async (req, res) => {
    try {
      const { pendingToken } = req.body ?? {};
      if (!pendingToken) return res.status(400).json({ message: "Missing pending token" });
      const result = await resendRegistrationOtp(String(pendingToken));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not resend code" });
    }
  });

  // Verifies the phone OTP (step 2) and emails the confirmation link — the
  // account still doesn't exist yet, so this intentionally does NOT return a
  // session token/user the way it used to before email verification was
  // added.
  app.post("/api/auth/register/verify", async (req, res) => {
    try {
      const data = registerVerifySchema.parse(req.body);
      const result = await verifyRegistration(data.pendingToken, data.code, requestBaseUrl(req));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not verify code") });
    }
  });

  app.post("/api/auth/register/resend-email", otpLimiter, async (req, res) => {
    try {
      const { pendingToken } = req.body ?? {};
      if (!pendingToken) return res.status(400).json({ message: "Missing pending token" });
      const result = await resendRegistrationEmailLink(String(pendingToken), requestBaseUrl(req));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not resend email" });
    }
  });

  // Verifies the emailed confirmation link (step 3) and creates the real
  // account. Called from the standalone /verify-email/:token page — carries
  // only the link token, not a pendingToken, since the link may be opened in
  // a different tab/device than sign-up was started on.
  app.post("/api/auth/register/verify-email-link", async (req, res) => {
    try {
      const data = verifyEmailLinkSchema.parse(req.body);
      const user = await verifyRegistrationEmailLink(data.token);
      const token = createSessionToken(user.id);
      res.json({ token, user: toPublicUser(user) });
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not verify email") });
    }
  });

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    const user = await storage.verifyPassword(email, password);
    if (!user) return res.status(401).json({ message: "Incorrect email or password" });

    await liftExpiredSuspension(user);
    const restriction = restrictionMessage(user);
    if (restriction) return res.status(403).json({ message: restriction });

    const token = createSessionToken(user.id);
    res.json({ token, user: toPublicUser(user) });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    res.json({ user: toPublicUser(req.currentUser!) });
  });

  // Change password (signed in). Requires the current password, then signs
  // out any other devices/sessions for this account (the device making the
  // change stays signed in).
  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const data = changePasswordSchema.parse(req.body);
      await storage.changePassword(req.currentUser!.id, data.currentPassword, data.newPassword);
      if (req.currentToken) invalidateOtherSessions(req.currentUser!.id, req.currentToken);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not change password") });
    }
  });

  // Forgot password: two-step flow mirroring registration. Step 1 looks up
  // the account by email and sends a 6-digit code to the phone already on
  // file; step 2 checks the code and sets the new password.
  app.post("/api/auth/forgot-password/start", otpLimiter, async (req, res) => {
    try {
      const data = forgotPasswordStartSchema.parse(req.body);
      const result = await startPasswordReset(data.email);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not start password reset") });
    }
  });

  app.post("/api/auth/forgot-password/resend", otpLimiter, async (req, res) => {
    try {
      const { pendingToken } = req.body ?? {};
      if (!pendingToken) return res.status(400).json({ message: "Missing pending token" });
      const result = await resendPasswordResetOtp(String(pendingToken));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not resend code" });
    }
  });

  app.post("/api/auth/forgot-password/reset", async (req, res) => {
    try {
      const data = forgotPasswordResetSchema.parse(req.body);
      await completePasswordReset(data.pendingToken, data.code, data.newPassword);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not reset password") });
    }
  });

  // ---------- Listings ----------
  app.get("/api/listings", async (req, res) => {
    const { type, category, location, q } = req.query as Record<string, string | undefined>;
    const rows = await storage.getLiveListings({ type, category, location, q });
    const withOwners = await Promise.all(
      rows.map(async (l) => {
        const owner = await storage.getUser(l.userId);
        return { ...l, ownerName: owner?.name ?? "Unknown" };
      })
    );
    res.json(withOwners);
  });

  app.get("/api/listings/mine", requireAuth, async (req, res) => {
    // Admins see and can manage every user's postings here, not just their
    // own — this is also the admin's listing-moderation surface, in addition
    // to the pending-review queue at /api/admin/listings/pending.
    const isAdmin = !!req.currentUser!.isAdmin;
    const rows = isAdmin ? await storage.getAllListings() : await storage.getListingsByUser(req.currentUser!.id);
    // hasBids drives the frontend edit-lock: once a listing has received any
    // bid, the poster can no longer change its terms (see storage.updateListing).
    // Admins aren't subject to that lock, but we still compute it for display.
    const withDetails = await Promise.all(
      rows.map(async (l) => {
        const bidsForListing = await storage.getBidsForListing(l.id);
        const ownerName = isAdmin ? (await storage.getUser(l.userId))?.name ?? "Unknown" : undefined;
        // Admins get the full bid roster inline (bidder, amount, status) so
        // they can see who bid and who won without opening each listing.
        const bidDetails = isAdmin
          ? await Promise.all(
              bidsForListing.map(async (b) => ({
                id: b.id,
                bidderId: b.bidderId,
                bidderName: (await storage.getUser(b.bidderId))?.name ?? "Unknown",
                amount: b.amount,
                message: b.message,
                status: b.status,
              }))
            )
          : undefined;
        return {
          ...l,
          hasBids: bidsForListing.length > 0,
          ...(ownerName ? { ownerName } : {}),
          ...(bidDetails ? { bids: bidDetails } : {}),
        };
      })
    );

    if (isAdmin) {
      // Admin's "own" already covers every listing platform-wide (that's what
      // getAllListings() is for) — there's no separate "offering" side to add.
      return res.json({ own: withDetails, offering: [] });
    }

    // Regular users also see postings they've offered their services on (bid
    // on as a provider) even though they didn't post it, so "My Lobangs"
    // reflects both sides of the marketplace they've participated in — along
    // with their own bid's status and the platform fee tied to it.
    const myBids = await storage.getBidsByBidder(req.currentUser!.id);
    const offeringRows = await Promise.all(
      myBids.map(async (b) => {
        const listing = await storage.getListing(b.listingId);
        if (!listing) return null;
        const ownerName = (await storage.getUser(listing.userId))?.name ?? "Unknown";
        let fee: { status: string; feeAmount: number; paidAt: number | null } | undefined;
        if (b.status === "accepted") {
          const listingFees = await storage.getFeeChargesForListing(listing.id);
          const match = listingFees.find((f) => f.bidId === b.id);
          if (match) fee = { status: match.status, feeAmount: match.feeAmount, paidAt: match.paidAt };
        }
        return {
          ...listing,
          ownerName,
          myBid: { id: b.id, amount: b.amount, status: b.status, message: b.message, createdAt: b.createdAt },
          fee,
        };
      })
    );
    const offering = offeringRows.filter((x): x is NonNullable<typeof x> => x !== null);

    res.json({ own: withDetails, offering });
  });

  app.get("/api/listings/:id", async (req, res) => {
    const listing = await storage.getListing(Number(req.params.id));
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    const owner = await storage.getUser(listing.userId);
    res.json({ ...listing, ownerName: owner?.name ?? "Unknown" });
  });

  app.post("/api/listings", requireAuth, async (req, res) => {
    try {
      const data = insertListingSchema.parse(req.body);
      const listing = await storage.createListing(req.currentUser!.id, data);
      res.status(201).json(listing);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Invalid listing details") });
    }
  });

  app.patch("/api/listings/:id", requireAuth, async (req, res) => {
    try {
      const data = insertListingSchema.partial().parse(req.body);
      const updated = await storage.updateListing(Number(req.params.id), req.currentUser!.id, data, {
        isAdmin: req.currentUser!.isAdmin,
      });
      if (!updated) return res.status(404).json({ message: "Listing not found, not yours, or already closed" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Invalid update") });
    }
  });

  app.get("/api/listings/:id/bids", requireAuth, async (req, res) => {
    const listing = await storage.getListing(Number(req.params.id));
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    const allBids = await storage.getBidsForListing(listing.id);
    const isOwner = listing.userId === req.currentUser!.id;
    const isAdmin = !!req.currentUser!.isAdmin;
    // Admins get the full bid roster for moderation purposes, same as the
    // poster — everyone else only ever sees their own bid on this listing.
    const visible = isOwner || isAdmin ? allBids : allBids.filter((b) => b.bidderId === req.currentUser!.id);
    const withBidders = await Promise.all(
      visible.map(async (b) => {
        const bidder = await storage.getUser(b.bidderId);
        return { ...b, bidderName: bidder?.name ?? "Unknown" };
      })
    );
    res.json(withBidders);
  });

  app.post("/api/listings/:id/bids", requireAuth, async (req, res) => {
    try {
      const listing = await storage.getListing(Number(req.params.id));
      if (!listing) return res.status(404).json({ message: "Listing not found" });
      if (listing.status !== "live") return res.status(400).json({ message: "This listing isn't open for bids" });
      if (listing.userId === req.currentUser!.id)
        return res.status(400).json({ message: "You cannot bid on your own listing" });
      const data = insertBidSchema.parse(req.body);
      const bid = await storage.createBid(listing.id, req.currentUser!.id, data);
      res.status(201).json(bid);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid bid" });
    }
  });

  app.post("/api/bids/:id/accept", requireAuth, async (req, res) => {
    try {
      const result = await storage.acceptBid(Number(req.params.id), req.currentUser!.id);
      // When Stripe is enabled, result.clientSecret lets the frontend open the
      // PaymentElement immediately to collect/charge the card for the platform
      // fee. Without Stripe, clientSecret is undefined and the frontend opens
      // the PayNow/Card payment-method dialog, which calls /api/fees/:id/pay.
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not accept bid" });
    }
  });

  // Poster explicitly declines a single pending bid. The listing stays live
  // and every other bid is untouched — this is separate from the bulk
  // auto-reject that fires once a listing closes after enough bids are accepted.
  app.post("/api/bids/:id/reject", requireAuth, async (req, res) => {
    try {
      const bid = await storage.rejectBid(Number(req.params.id), req.currentUser!.id);
      res.json(bid);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not reject bid" });
    }
  });

  // Bidder self-service: edit their own bid's amount/message while it's
  // still pending.
  app.patch("/api/bids/:id", requireAuth, async (req, res) => {
    try {
      const patch = bidUpdateSchema.parse(req.body);
      const updated = await storage.updateBid(Number(req.params.id), req.currentUser!.id, patch);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not update bid") });
    }
  });

  // Bidder self-service: withdraw their own pending bid — kept on record
  // (status "cancelled") rather than erased, unlike an admin delete.
  app.post("/api/bids/:id/cancel", requireAuth, async (req, res) => {
    try {
      const updated = await storage.cancelBid(Number(req.params.id), req.currentUser!.id);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not cancel bid") });
    }
  });

  // Bidder self-service: ask an admin to reopen their own cancelled bid —
  // only an admin can actually reopen it (see /api/admin/bids/:id/reopen).
  app.post("/api/bids/:id/request-reopen", requireAuth, async (req, res) => {
    try {
      const updated = await storage.requestReopenBid(Number(req.params.id), req.currentUser!.id);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not send request") });
    }
  });

  // Admin moderation: correct a bid's amount/message on the bidder's behalf.
  // Doesn't touch status — accept/reject/cancel/reopen remain the only way a
  // bid's lifecycle advances.
  app.patch("/api/admin/bids/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const patch = adminUpdateBidSchema.parse(req.body);
      const updated = await storage.adminUpdateBid(Number(req.params.id), patch);
      if (!updated) return res.status(404).json({ message: "Bid not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not update bid") });
    }
  });

  // Admin moderation: cancel a bid — kept on record (status "cancelled") so
  // it can be reopened later, unlike a hard delete.
  app.post("/api/admin/bids/:id/cancel", requireAuth, requireAdmin, async (req, res) => {
    try {
      const updated = await storage.adminCancelBid(Number(req.params.id));
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not cancel bid") });
    }
  });

  // Admin moderation: put a cancelled bid back to pending.
  app.post("/api/admin/bids/:id/reopen", requireAuth, requireAdmin, async (req, res) => {
    try {
      const updated = await storage.adminReopenBid(Number(req.params.id));
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not reopen bid") });
    }
  });

  // Admin moderation: remove a single bid (spam, a mistaken bid, or one the
  // bidder asked to withdraw) without touching the rest of the listing.
  app.delete("/api/admin/bids/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.adminDeleteBid(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not delete bid" });
    }
  });

  // Poster settles the platform fee via PayNow or Card immediately after accepting
  // a bid (simulated payment confirmation). Marks the fee "paid" and releases
  // contact details to both parties.
  app.post("/api/fees/:id/pay", requireAuth, async (req, res) => {
    try {
      const { method } = payFeeChargeSchema.parse(req.body);
      const feeCharge = await storage.payFeeCharge(Number(req.params.id), req.currentUser!.id, method);
      res.json(feeCharge);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not confirm payment") });
    }
  });

  // Retry entry point for the real-payments flow. If the poster closed the
  // Stripe checkout before confirming right after accepting a bid, the
  // frontend's "Pay now" button calls this (instead of /api/fees/:id/pay) to
  // get that same PaymentIntent's client secret again and reopen the real
  // Stripe checkout — so a stalled payment can never be waved through by the
  // simulated confirmation route above once Stripe is live.
  app.get("/api/fees/:id/stripe-intent", requireAuth, async (req, res) => {
    try {
      if (!stripeEnabled) return res.status(400).json({ message: "Stripe is not configured" });
      const result = await storage.getFeeChargeStripeClientSecret(Number(req.params.id), req.currentUser!.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not retrieve payment details") });
    }
  });

  // Contact details (phone numbers) for an accepted bid — only returned once the
  // platform fee has been paid, and only to the poster or the accepted provider.
  app.get("/api/bids/:id/contact", requireAuth, async (req, res) => {
    const contact = await storage.getBidContact(Number(req.params.id), req.currentUser!.id);
    if (!contact) return res.status(404).json({ message: "Contact details are not available yet" });
    res.json(contact);
  });

  // Fallback finalizer the frontend calls right after stripe.confirmPayment resolves,
  // so the fee charge status updates immediately even if the Stripe webhook isn't
  // (yet) registered/reachable — e.g. during local testing before the app has a public URL.
  app.post("/api/stripe/sync/:paymentIntentId", requireAuth, async (req, res) => {
    try {
      await storage.syncFeeCharge(String(req.params.paymentIntentId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not sync payment status" });
    }
  });

  // ---------- Messages ----------
  app.get("/api/listings/:id/participants", requireAuth, async (req, res) => {
    const rows = await storage.getListingParticipants(Number(req.params.id), req.currentUser!.id);
    res.json(rows);
  });

  app.get("/api/listings/:id/messages/:otherUserId", requireAuth, async (req, res) => {
    const rows = await storage.getConversation(
      Number(req.params.id),
      req.currentUser!.id,
      Number(req.params.otherUserId)
    );
    // Normally every message here is from either the caller or the one other
    // participant they're chatting with, so the frontend can label them with
    // just "You" / the other party's name. But an admin message tagged onto
    // this thread breaks that assumption — it's from a third party — so the
    // sender's actual name is included for every message rather than assumed.
    const senderIds = Array.from(new Set(rows.map((m) => m.senderId)));
    const senderNames = new Map<number, string>();
    for (const id of senderIds) {
      const u = await storage.getUser(id);
      senderNames.set(id, u?.name ?? "Unknown");
    }
    res.json(rows.map((m) => ({ ...m, content: m.maskedContent, senderName: senderNames.get(m.senderId) ?? "Unknown" })));
  });

  app.post("/api/listings/:id/messages", requireAuth, async (req, res) => {
    const { content, recipientId } = req.body ?? {};
    if (!content || !recipientId) return res.status(400).json({ message: "Message and recipient are required" });
    const listingId = Number(req.params.id);
    // Only allow messaging an actual participant of this listing (the poster,
    // or someone who has bid on it) — otherwise any signed-in user could send
    // a message to an arbitrary user id under any listing id.
    const participants = await storage.getListingParticipants(listingId, req.currentUser!.id);
    const recipientIdNum = Number(recipientId);
    if (!participants.some((p) => p.id === recipientIdNum)) {
      return res.status(403).json({ message: "You can only message participants of this listing" });
    }
    const msg = await storage.sendMessage(listingId, req.currentUser!.id, recipientIdNum, content);
    res.status(201).json({ ...msg, content: msg.maskedContent });
  });

  // Admin-only: every message on a listing, across every bidder's thread with
  // the poster, labeled with each side's name — for moderation. Regular
  // participants only ever see their own thread via the routes above.
  app.get("/api/admin/listings/:id/messages", requireAuth, requireAdmin, async (req, res) => {
    const listingId = Number(req.params.id);
    const listing = await storage.getListing(listingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    const rows = await storage.getAllMessagesForListing(listingId);
    const userIds = Array.from(new Set(rows.flatMap((m) => [m.senderId, m.recipientId])));
    const names = new Map<number, string>();
    for (const id of userIds) {
      const u = await storage.getUser(id);
      names.set(id, u?.name ?? "Unknown");
    }
    res.json(
      rows.map((m) => ({
        ...m,
        content: m.maskedContent,
        senderName: names.get(m.senderId) ?? "Unknown",
        recipientName: names.get(m.recipientId) ?? "Unknown",
      }))
    );
  });

  // Admin-only: post a message directly into an existing poster<->bidder
  // thread (identified by which bidder it's about) so both sides see it in
  // their shared conversation — distinct from the private 1:1 admin<->user
  // messaging above, which only the two of them can see.
  app.post("/api/admin/listings/:id/messages/thread", requireAuth, requireAdmin, async (req, res) => {
    const { content, bidderId } = req.body ?? {};
    if (!content || !bidderId) return res.status(400).json({ message: "Message and bidderId are required" });
    const listingId = Number(req.params.id);
    const listing = await storage.getListing(listingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    const bidderIdNum = Number(bidderId);
    const listingBids = await storage.getBidsForListing(listingId);
    if (!listingBids.some((b) => b.bidderId === bidderIdNum)) {
      return res.status(400).json({ message: "That user hasn't bid on this listing" });
    }
    const msg = await storage.sendThreadMessage(listingId, req.currentUser!.id, bidderIdNum, content);
    res.status(201).json({ ...msg, content: msg.maskedContent });
  });

  // ---------- Fee charges / Wallet ----------
  app.get("/api/fees/mine", requireAuth, async (req, res) => {
    const rows = await storage.getFeeChargesForUser(req.currentUser!.id);
    res.json(rows);
  });

  // Admin wallet: every *paid* fee charge platform-wide (i.e. every bid
  // that's actually closed — accepting a bid alone only starts a fee charge,
  // it isn't "closed" until the platform fee is paid), enriched with
  // listing/poster/provider names, so the admin wallet can group
  // transactions by week and month without extra round-trips.
  app.get("/api/admin/wallet/transactions", requireAuth, requireAdmin, async (req, res) => {
    const rows = (await storage.getAllFeeCharges()).filter((f) => f.status === "paid");
    const listingIds = Array.from(new Set(rows.map((f) => f.listingId)));
    const userIds = Array.from(new Set(rows.flatMap((f) => [f.posterId, f.providerId])));
    const listingTitles = new Map<number, string>();
    for (const id of listingIds) {
      const l = await storage.getListing(id);
      listingTitles.set(id, l?.title ?? "Untitled listing");
    }
    const names = new Map<number, string>();
    for (const id of userIds) {
      const u = await storage.getUser(id);
      names.set(id, u?.name ?? "Unknown");
    }
    res.json(
      rows.map((f) => ({
        ...f,
        listingTitle: listingTitles.get(f.listingId) ?? "Untitled listing",
        posterName: names.get(f.posterId) ?? "Unknown",
        providerName: names.get(f.providerId) ?? "Unknown",
      }))
    );
  });

  app.get("/api/listings/:id/fees", requireAuth, async (req, res) => {
    const listing = await storage.getListing(Number(req.params.id));
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    const fees = await storage.getFeeChargesForListing(Number(req.params.id));
    // Only the listing owner (poster) or a provider involved in one of these
    // fee charges may see them — fee/payment amounts are financial data and
    // shouldn't be visible to unrelated authenticated users.
    const isOwner = listing.userId === req.currentUser!.id;
    const visible = isOwner
      ? fees
      : fees.filter((f) => f.providerId === req.currentUser!.id || f.posterId === req.currentUser!.id);
    res.json(visible);
  });

  // ---------- Admin ----------
  app.get("/api/admin/listings/pending", requireAuth, requireAdmin, async (_req, res) => {
    const rows = await storage.getPendingListings();
    const withOwners = await Promise.all(
      rows.map(async (l) => {
        const owner = await storage.getUser(l.userId);
        return { ...l, ownerName: owner?.name ?? "Unknown" };
      })
    );
    res.json(withOwners);
  });

  app.post("/api/admin/listings/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    const listing = await storage.approveListing(Number(req.params.id));
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    res.json(listing);
  });

  app.post("/api/admin/listings/:id/reject", requireAuth, requireAdmin, async (req, res) => {
    const { reason } = req.body ?? {};
    const listing = await storage.rejectListing(Number(req.params.id), reason || "Did not meet guidelines");
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    res.json(listing);
  });

  app.delete("/api/admin/listings/:id", requireAuth, requireAdmin, async (req, res) => {
    await storage.adminRemoveListing(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/admin/listings/:id/close", requireAuth, requireAdmin, async (req, res) => {
    try {
      const listing = await storage.adminCloseListing(Number(req.params.id));
      res.json(listing);
    } catch (err: any) {
      const status = err.message === "Listing not found" ? 404 : 400;
      res.status(status).json({ message: err.message || "Could not close listing" });
    }
  });

  // ---------- Admin: users ----------
  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    const rows = await storage.getAllUsers();
    res.json(rows.map(toPublicUser));
  });

  // Create a second (or third, etc.) admin account directly. There's no
  // password field in the request — the server always generates a random
  // one-time password and returns it exactly once, same pattern as the
  // seed-admin bootstrap in storage.ts, so nobody (including this endpoint's
  // caller) ever gets to pick a guessable admin password.
  app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const data = createAdminSchema.parse(req.body);
      const { user, temporaryPassword } = await storage.createAdminUser(data);
      res.status(201).json({ user: toPublicUser(user), temporaryPassword });
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not create admin account") });
    }
  });

  // Admin-only password reset — not a "view", since passwords are hashed
  // one-way and there's nothing to display. Issues a fresh one-time password,
  // signs the account out everywhere, and returns the plaintext exactly once.
  app.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.currentUser!.id) {
      return res.status(400).json({ message: "Use Change Password on your own Profile page instead" });
    }
    try {
      const temporaryPassword = await storage.resetUserPassword(targetId);
      res.json({ temporaryPassword });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not reset password" });
    }
  });

  // Admin moderation: correct a user's name/email/phone. Doesn't touch
  // password or account status — those go through their own dedicated
  // endpoints (reset-password, suspend/ban, etc).
  app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const data = adminUpdateUserSchema.parse(req.body);
      const updated = await storage.adminUpdateUser(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(toPublicUser(updated));
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not update user") });
    }
  });

  app.post("/api/admin/users/:id/suspend", requireAuth, requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.currentUser!.id) {
      return res.status(400).json({ message: "You can't suspend your own account" });
    }
    const { untilMs, reason } = req.body ?? {};
    const until = Number(untilMs);
    if (!until || until <= Date.now()) {
      return res.status(400).json({ message: "Suspension end time must be in the future" });
    }
    try {
      const user = await storage.suspendUser(targetId, until, reason);
      res.json(toPublicUser(user));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not suspend user" });
    }
  });

  app.post("/api/admin/users/:id/ban", requireAuth, requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.currentUser!.id) {
      return res.status(400).json({ message: "You can't ban your own account" });
    }
    const { reason } = req.body ?? {};
    try {
      const user = await storage.banUser(targetId, reason);
      res.json(toPublicUser(user));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not ban user" });
    }
  });

  app.post("/api/admin/users/:id/reactivate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = await storage.reactivateUser(Number(req.params.id));
      res.json(toPublicUser(user));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not reactivate user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.currentUser!.id) {
      return res.status(400).json({ message: "You can't delete your own account" });
    }
    try {
      await storage.deleteUser(targetId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Could not delete user" });
    }
  });

  // Admin broadcast announcement — posts the same notification to every user
  // immediately, unless scheduledFor is a future timestamp, in which case
  // it's held back (unpublished, un-notified) until that time.
  app.post("/api/admin/announcements", requireAuth, requireAdmin, async (req, res) => {
    try {
      const data = createAnnouncementSchema.parse(req.body);
      const row = await storage.createAnnouncement(data.title, data.body, data.scheduledFor);
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Invalid announcement") });
    }
  });

  // Admin: every announcement regardless of publish state (published,
  // still-pending/scheduled) — feeds the management list on the Admin page.
  app.get("/api/admin/announcements", requireAuth, requireAdmin, async (_req, res) => {
    const rows = await storage.getAllAnnouncementsForAdmin();
    res.json(rows);
  });

  // Admin: edit an announcement's title/body, or (while still pending) its
  // scheduled release time.
  app.patch("/api/admin/announcements/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const data = updateAnnouncementSchema.parse(req.body);
      const row = await storage.updateAnnouncement(Number(req.params.id), data);
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not update announcement") });
    }
  });

  // Admin: remove an announcement from the board/management list.
  app.delete("/api/admin/announcements/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteAnnouncement(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: friendlyError(err, "Could not delete announcement") });
    }
  });

  // Public: every published admin announcement, newest first — feeds the
  // announcement board on the main page. No auth required, same as browsing
  // listings. Anything still awaiting its scheduled release time is excluded.
  app.get("/api/announcements", async (_req, res) => {
    const rows = await storage.getAnnouncements();
    res.json(rows);
  });

  // Public: everyone currently suspended or banned, with the reason —
  // deliberately excludes email/phone (see storage.getRestrictedUsers).
  app.get("/api/restricted-users", async (_req, res) => {
    const rows = await storage.getRestrictedUsers();
    res.json(rows);
  });

  // ---------- Notifications ----------
  app.get("/api/notifications", requireAuth, async (req, res) => {
    const rows = await storage.getNotificationsForUser(req.currentUser!.id);
    res.json(rows);
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    const count = await storage.getUnreadNotificationCount(req.currentUser!.id);
    res.json({ count });
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
    await storage.markNotificationRead(Number(req.params.id), req.currentUser!.id);
    res.json({ ok: true });
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    await storage.markAllNotificationsRead(req.currentUser!.id);
    res.json({ ok: true });
  });

  // ---------- Contact Us ----------
  app.post("/api/contact", requireAuth, contactLimiter, async (req, res) => {
    try {
      const data = contactMessageSchema.parse(req.body);
      await sendContactMessage(data);
      res.json({ ok: true });
    } catch (err: any) {
      if (err?.issues?.length) {
        return res.status(400).json({ message: friendlyError(err, "Please check your details and try again.") });
      }
      res.status(502).json({ message: err.message || "Could not send your enquiry. Please try again." });
    }
  });

  // Auto-close listings that have been live for 7+ days without reaching
  // their target headcount — see storage.closeExpiredListings for details.
  startListingExpiryScheduler();

  // Releases scheduled announcements once their release time arrives — see
  // storage.publishScheduledAnnouncements for details.
  startAnnouncementScheduler();

  return httpServer;
}
