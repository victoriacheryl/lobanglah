import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------- Users ----------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  password: text("password").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  // Stripe Customer id (only populated once real payments are enabled; see server/stripe.ts).
  // Set for users who have paid a platform fee as a poster.
  stripeCustomerId: text("stripe_customer_id"),
  // Account moderation. "suspended" is temporary (see suspendedUntil, a Unix
  // ms timestamp); once that passes the account is lazily reactivated back to
  // "active" the next time it's touched (login or an authenticated request).
  // "banned" is indefinite and only lifts via an explicit admin reactivation.
  // Either state blocks all authenticated access, including to the user's
  // own postings.
  status: text("status", { enum: ["active", "suspended", "banned"] }).notNull().default("active"),
  suspendedUntil: integer("suspended_until"),
  restrictionReason: text("restriction_reason"),
  createdAt: integer("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users)
  .pick({ name: true, email: true, phone: true, password: true })
  .extend({
    email: z.string().email(),
    password: z.string().min(6),
    phone: z.string().min(8),
  });

// Admin-only: create another admin account directly. No password field here —
// the server always generates a random one-time password (never one typed by
// or supplied to the caller) and returns it exactly once, same pattern as the
// original seed-admin bootstrap in server/storage.ts.
export const createAdminSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(8, "Enter a valid contact number"),
});

export type CreateAdminInput = z.infer<typeof createAdminSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PublicUser = Omit<User, "password">;

// ---------- Registration (two-step: start -> WhatsApp OTP -> verify) ----------
// Step 1: collect details, send a 6-digit code to the phone number over
// WhatsApp. Step 2: the code is checked against the pending registration
// before the real user account is created — so no account ever exists
// without a verified phone number.
export const registerStartSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Enter a valid email"),
    phone: z.string().min(8, "Enter a valid Singapore mobile number"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(6, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterStartInput = z.infer<typeof registerStartSchema>;

export const registerVerifySchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().length(6, "Enter the 6-digit code"),
});

export type RegisterVerifyInput = z.infer<typeof registerVerifySchema>;

// Step 3: the user clicks the confirmation link emailed to them, which opens
// a standalone page carrying just the link's token — no pendingToken needed,
// since this page may be opened in a different tab/device than sign-up
// itself was started on.
export const verifyEmailLinkSchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailLinkInput = z.infer<typeof verifyEmailLinkSchema>;

// ---------- Change password (logged-in user) ----------
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
    confirmNewPassword: z.string().min(6, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------- Contact Us ----------
export const contactMessageSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(8, "Enter a valid contact number"),
  message: z.string().min(10, "Tell us a bit more (at least 10 characters)").max(2000),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

// ---------- Forgot password (two-step: email -> WhatsApp OTP -> reset) ----------
// Mirrors the registration OTP flow: step 1 looks up the account by email and
// sends a 6-digit code to the phone number already on file; step 2 checks the
// code and sets the new password. No email/SMS provider is required.
export const forgotPasswordStartSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

export type ForgotPasswordStartInput = z.infer<typeof forgotPasswordStartSchema>;

export const forgotPasswordResetSchema = z
  .object({
    pendingToken: z.string().min(1),
    code: z.string().length(6, "Enter the 6-digit code"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
    confirmNewPassword: z.string().min(6, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export type ForgotPasswordResetInput = z.infer<typeof forgotPasswordResetSchema>;

// ---------- Listings ----------
// Standard list of Singapore HDB towns / planning areas, used for the
// listing location dropdown so posters can say roughly where the job or
// item is, without exposing an exact address.
export const SG_TOWNS = [
  // "No preference" option — lets a poster skip picking a specific town when
  // location genuinely doesn't matter for the job/item. Listed first so it's
  // easy to find and doubles as the form's default selection.
  "Islandwide",
  "Ang Mo Kio",
  "Bedok",
  "Bishan",
  "Bukit Batok",
  "Bukit Merah",
  "Bukit Panjang",
  "Bukit Timah",
  "Central Area",
  "Choa Chu Kang",
  "Clementi",
  "Geylang",
  "Hougang",
  "Jurong East",
  "Jurong West",
  "Kallang/Whampoa",
  "Marine Parade",
  "Pasir Ris",
  "Punggol",
  "Queenstown",
  "Sembawang",
  "Sengkang",
  "Serangoon",
  "Tampines",
  "Toa Payoh",
  "Woodlands",
  "Yishun",
] as const;

export type SgTown = (typeof SG_TOWNS)[number];

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: text("type", { enum: ["seek", "offer"] }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  location: text("location", { enum: SG_TOWNS }).notNull(),
  // Free-text fee field so posters can enter an exact amount ("$50"), a
  // range ("$80-100"), or a note ("Negotiable", "Free") instead of being
  // forced into a strict number.
  price: text("price").notNull(),
  // Number of bids the poster wants to accept for this listing (e.g. "need 3
  // helpers"). Defaults to 1 for the ordinary single-hire case. The listing
  // stays "live" — accepting more bids — until this many bids have been
  // accepted, then it auto-closes and any remaining pending bids are rejected.
  quantityNeeded: integer("quantity_needed").notNull().default(1),
  status: text("status", {
    enum: ["pending", "live", "rejected", "closed"],
  })
    .notNull()
    .default("pending"),
  rejectionReason: text("rejection_reason"),
  createdAt: integer("created_at").notNull(),
});

export const insertListingSchema = createInsertSchema(listings)
  .pick({ type: true, title: true, description: true, category: true, location: true, price: true, quantityNeeded: true })
  .extend({
    title: z.string().min(4).max(80),
    description: z.string().min(10).max(1000),
    location: z.enum(SG_TOWNS, { errorMap: () => ({ message: "Choose a town" }) }),
    price: z.string().min(1, "Enter a fee amount or note, e.g. $50, $80-100, Negotiable").max(50),
    quantityNeeded: z.number().int().min(1).max(20).optional().default(1),
  });

export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

// ---------- Bids ----------
export const bids = sqliteTable("bids", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull(),
  bidderId: integer("bidder_id").notNull(),
  amount: real("amount").notNull(),
  message: text("message").notNull().default(""),
  status: text("status", { enum: ["pending", "accepted", "rejected"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const insertBidSchema = createInsertSchema(bids)
  .pick({ amount: true, message: true })
  .extend({ amount: z.number().positive() });

export type InsertBid = z.infer<typeof insertBidSchema>;
export type Bid = typeof bids.$inferSelect;

// Admin moderation: correcting a bid's amount/message on a bidder's behalf
// (e.g. a typo reported over the phone). Status changes still only happen
// through accept/reject, not this.
export const adminUpdateBidSchema = z.object({
  amount: z.number().positive().optional(),
  message: z.string().max(1000).optional(),
});

export type AdminUpdateBidInput = z.infer<typeof adminUpdateBidSchema>;

// ---------- Messages ----------
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull(),
  senderId: integer("sender_id").notNull(),
  recipientId: integer("recipient_id").notNull(),
  content: text("content").notNull(),
  maskedContent: text("masked_content").notNull(),
  // Tags a message as belonging to a specific poster<->bidder thread (keyed by
  // the bidder's user id), independent of the literal sender/recipient pair.
  // Only ever set on admin-authored messages that intercept into an existing
  // poster<->bidder conversation — it's what lets both sides of that chat see
  // the same admin message, even though a message otherwise only has one
  // recipient. Left null for ordinary 1:1 messages.
  threadBidderId: integer("thread_bidder_id"),
  createdAt: integer("created_at").notNull(),
});

export const insertMessageSchema = createInsertSchema(messages)
  .pick({ content: true, recipientId: true })
  .extend({ content: z.string().min(1).max(2000) });

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ---------- Fee Charges ----------
// No escrow: providers are paid directly by posters outside the app (cash,
// PayNow, bank transfer). The only thing LobangLah! ever charges is a small
// one-time platform fee — whichever is greater of S$5 or 10% of the bid —
// taken from the poster's card the instant they accept a bid.
export const feeCharges = sqliteTable("fee_charges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull(),
  bidId: integer("bid_id").notNull(),
  posterId: integer("poster_id").notNull(),
  providerId: integer("provider_id").notNull(),
  bidAmount: real("bid_amount").notNull(),
  feeAmount: real("fee_amount").notNull(),
  status: text("status", {
    // "pending" = PaymentIntent created, awaiting card confirmation (real-payments flow only)
    // "failed" = the charge was declined or canceled before it succeeded
    enum: ["pending", "paid", "failed"],
  })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at").notNull(),
  paidAt: integer("paid_at"),
  // Stripe fields (only populated once real payments are enabled).
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  // How the poster paid the platform fee: "card" or "paynow" (simulated flow),
  // or "stripe" once real Stripe payments are enabled. Null while pending.
  paymentMethod: text("payment_method", { enum: ["card", "paynow", "stripe"] }),
});

export type FeeCharge = typeof feeCharges.$inferSelect;

// ---------- Notifications ----------
// In-app notifications: new postings for admin review, new bids for posters,
// bid-acceptance updates for providers, fee-paid/contact-reveal updates, and
// admin broadcast announcements to every user.
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: text("type", {
    enum: [
      "new_posting_review",
      "new_bid",
      "bid_accepted",
      "bid_rejected",
      "bid_removed",
      "new_message",
      "fee_paid",
      "listing_approved",
      "listing_rejected",
      "announcement",
    ],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  relatedListingId: integer("related_listing_id"),
  // For "new_message" notifications: the id of the other party in that
  // conversation (from the recipient's point of view) — lets the client jump
  // straight to that thread and start typing a reply, instead of dropping the
  // user on the listing's Bids tab and making them hunt for Messages.
  relatedUserId: integer("related_user_id"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export type Notification = typeof notifications.$inferSelect;

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

// A standalone, permanent record of every admin broadcast — separate from the
// per-user notification rows created alongside it (those live in a user's
// bell/inbox and get marked read/cleared; this is the public, durable list
// shown on the main page's announcement board).
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Announcement = typeof announcements.$inferSelect;

export const payFeeChargeSchema = z.object({
  method: z.enum(["card", "paynow"]),
});

export type PayFeeChargeInput = z.infer<typeof payFeeChargeSchema>;
