import {
  users,
  listings,
  bids,
  messages,
  feeCharges,
  notifications,
  announcements,
} from "@shared/schema";
import type {
  User,
  InsertUser,
  Listing,
  InsertListing,
  Bid,
  InsertBid,
  Message,
  FeeCharge,
  Notification,
  Announcement,
  CreateAdminInput,
  AdminUpdateUserInput,
  BidUpdateInput,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq, and, or, desc, lte, isNotNull, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { stripeEnabled, calculateFeeSgd, retrieveOrUpgradeClientSecrets, ensureCustomer } from "./stripe";
import * as stripeStorage from "./stripe-storage";
import { sendWhatsappOtp, normalizeSgPhone, generateOtpCode, whatsappEnabled } from "./whatsapp";
import { sendVerificationEmail, emailEnabled } from "./email";

// DB_PATH lets a production deploy point this at a mounted persistent volume
// (e.g. "/data/data.db" on a platform whose filesystem is otherwise ephemeral)
// instead of the cwd-relative default used in local dev.
const sqlite = new Database(process.env.DB_PATH || "data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Versioned schema migrations (replaces the old hand-rolled "CREATE TABLE IF
// NOT EXISTS" + ad hoc ALTER TABLE patching). Migration files live in
// ./migrations and are generated from shared/schema.ts via `npm run
// db:generate` whenever the schema changes; drizzle tracks which ones have
// already been applied in a `__drizzle_migrations` table, so this is safe to
// run on every boot.
const migrationsFolder = path.resolve(process.cwd(), "migrations");
if (!fs.existsSync(migrationsFolder)) {
  throw new Error(
    `Missing migrations folder at ${migrationsFolder}. Run "npm run db:generate" once to create the initial migration before starting the server.`
  );
}
migrate(db, { migrationsFolder });

// SECURITY: passwords are hashed with salted PBKDF2 (100k iterations, SHA-256),
// stored as "salt:hash" (both hex). This replaced a prior unsalted single-pass
// SHA-256 scheme. verifyPassword() below still accepts the old 64-hex-char
// format for any pre-existing accounts so nobody is locked out; those accounts
// are transparently re-hashed into the new format on next successful login.
const PBKDF2_ITERATIONS = 100_000;

// How long a "live" listing stays open before auto-closing if it hasn't
// reached its target headcount of accepted bids — used both to set a fresh
// listing's expiresAt on creation and as closeExpiredListings' fallback
// cutoff for any pre-expiresAt-column rows. Previously this was declared
// further down the file but never actually reachable from createListing
// (and, for a stretch, wasn't declared at all — closeExpiredListings was
// silently throwing "SEVEN_DAYS_MS is not defined" on every sweep, so the
// listing auto-close feature was effectively dead until this fix).
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Seed an admin account for demo purposes if none exists yet.
//
// SECURITY: the admin password is never hardcoded. It is read from the
// ADMIN_SEED_PASSWORD env var if set; otherwise a random one-time password is
// generated and printed to the server log ONCE so whoever deploys the app can
// retrieve it. This avoids shipping a guessable well-known default admin
// credential (e.g. "admin123") in source that would otherwise let anyone who
// reads this file log into the live admin account.
const ADMIN_EMAIL = "admin@lobanglah.sg";
const existingAdmin = sqlite
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(ADMIN_EMAIL);
if (!existingAdmin) {
  const seedPassword = process.env.ADMIN_SEED_PASSWORD || crypto.randomBytes(12).toString("base64url");
  sqlite
    .prepare(
      "INSERT INTO users (name, email, phone, password, is_admin, created_at) VALUES (?, ?, ?, ?, 1, ?)"
    )
    .run("LobangLah! Admin", ADMIN_EMAIL, "+6591234567", hashPassword(seedPassword), Date.now());
  if (!process.env.ADMIN_SEED_PASSWORD) {
    console.log(
      `[storage] Generated one-time admin password for ${ADMIN_EMAIL}: ${seedPassword}\n` +
        `[storage] Save this now — it will not be shown again. Set ADMIN_SEED_PASSWORD to control it explicitly next time.`
    );
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function isLegacyHash(stored: string): boolean {
  return !stored.includes(":") && stored.length === 64;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  if (isLegacyHash(stored)) {
    // Old unsalted SHA-256 scheme — constant-time compare.
    const candidate = crypto.createHash("sha256").update(password).digest();
    const existing = Buffer.from(stored, "hex");
    return candidate.length === existing.length && crypto.timingSafeEqual(candidate, existing);
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  const existing = Buffer.from(hash, "hex");
  return candidate.length === existing.length && crypto.timingSafeEqual(candidate, existing);
}

// ---------- In-memory session tokens (demo auth; see spec doc for production auth plan) ----------
const tokenToUserId = new Map<string, number>();
// Reverse index so we can invalidate every session belonging to a user (e.g.
// after a password change/reset) without scanning the whole token map.
const userIdToTokens = new Map<number, Set<string>>();

export function createSessionToken(userId: number): string {
  const token = crypto.randomBytes(24).toString("hex");
  tokenToUserId.set(token, userId);
  if (!userIdToTokens.has(userId)) userIdToTokens.set(userId, new Set());
  userIdToTokens.get(userId)!.add(token);
  return token;
}

export function getUserIdFromToken(token: string | undefined): number | undefined {
  if (!token) return undefined;
  return tokenToUserId.get(token);
}

/** Invalidates every session token for a user except the one passed in
 *  (used after a self-service password change so other logged-in devices are
 *  signed out, while the device making the change stays signed in). */
export function invalidateOtherSessions(userId: number, exceptToken: string): void {
  const tokens = userIdToTokens.get(userId);
  if (!tokens) return;
  for (const t of Array.from(tokens)) {
    if (t === exceptToken) continue;
    tokenToUserId.delete(t);
    tokens.delete(t);
  }
}

/** Invalidates every session token for a user, including the current one
 *  (used after a forgot-password reset, since the requester isn't
 *  necessarily signed in on the device completing the reset). */
export function invalidateAllSessions(userId: number): void {
  const tokens = userIdToTokens.get(userId);
  if (!tokens) return;
  for (const t of Array.from(tokens)) tokenToUserId.delete(t);
  userIdToTokens.delete(userId);
}

// ---------- Pending registrations (WhatsApp phone OTP + email link) ----------
// No user account is created until BOTH the phone number and email address
// are verified. Step 1 sends a 6-digit code to the phone over WhatsApp; once
// that's verified, step 2 emails a clickable confirmation link; only once
// that link is opened does the real account get created. Held in-memory
// (demo scope, matches the session-token pattern above) keyed by a random
// pending token handed to the frontend after step 1.
interface PendingRegistration {
  name: string;
  email: string;
  phone: string; // normalized E.164, e.g. +6591234567
  passwordHash: string;
  phoneCode: string;
  phoneExpiresAt: number;
  phoneAttempts: number;
  phoneVerified: boolean;
  // Only populated once the phone step is verified and the email link has
  // actually been sent (step 2).
  emailVerifyToken?: string;
  emailVerifyExpiresAt?: number;
}
const pendingRegistrations = new Map<string, PendingRegistration>(); // keyed by pendingToken
// Reverse lookup: the page the user lands on after clicking the emailed link
// only has the link's token, not the original pendingToken from step 1 (it's
// commonly opened in a different tab, or even a different device, than the
// one sign-up was started on) — this map is how that page finds its way back
// to the right pending registration.
const emailTokenToPendingToken = new Map<string, string>();

const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_LINK_TTL_MS = 30 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const lastSentAt = new Map<string, number>();

export interface StartRegistrationResult {
  pendingToken: string;
  phone: string;
  expiresInSeconds: number;
  /** Only populated when WhatsApp isn't configured, so the demo flow still works end-to-end. */
  devCode?: string;
}

/** Result of successfully verifying the phone step — the confirmation email
 *  has just been sent, and the frontend should show a "check your email"
 *  screen (there's no code to enter; the link itself finishes sign-up). */
export interface VerifyPhoneResult {
  pendingToken: string;
  email: string;
  expiresInSeconds: number;
  /** Only populated when Resend isn't configured — the full verification URL, so the demo flow still works end-to-end. */
  devVerifyUrl?: string;
}

export async function startRegistration(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<StartRegistrationResult> {
  const normalizedPhone = normalizeSgPhone(input.phone);
  if (!normalizedPhone) throw new Error("Enter a valid Singapore mobile number, e.g. 9123 4567");

  const existingEmail = await storage.getUserByEmail(input.email);
  if (existingEmail) throw new Error("An account with this email already exists");

  const existingPhone = await storage.getUserByPhone(normalizedPhone);
  if (existingPhone) throw new Error("An account with this mobile number already exists");

  const code = generateOtpCode();
  const pendingToken = crypto.randomBytes(24).toString("hex");
  pendingRegistrations.set(pendingToken, {
    name: input.name,
    email: input.email,
    phone: normalizedPhone,
    passwordHash: hashPassword(input.password),
    phoneCode: code,
    phoneExpiresAt: Date.now() + OTP_TTL_MS,
    phoneAttempts: 0,
    phoneVerified: false,
  });
  lastSentAt.set(pendingToken, Date.now());

  await sendWhatsappOtp(normalizedPhone, code);

  return {
    pendingToken,
    phone: normalizedPhone,
    expiresInSeconds: OTP_TTL_MS / 1000,
    devCode: whatsappEnabled ? undefined : code,
  };
}

export async function resendRegistrationOtp(pendingToken: string): Promise<StartRegistrationResult> {
  const pending = pendingRegistrations.get(pendingToken);
  if (!pending) throw new Error("This sign-up session has expired. Please start again.");
  if (pending.phoneVerified) throw new Error("Your phone number is already verified.");
  const last = lastSentAt.get(pendingToken) ?? 0;
  if (Date.now() - last < RESEND_COOLDOWN_MS) {
    throw new Error("Please wait a moment before requesting another code");
  }
  pending.phoneCode = generateOtpCode();
  pending.phoneExpiresAt = Date.now() + OTP_TTL_MS;
  pending.phoneAttempts = 0;
  lastSentAt.set(pendingToken, Date.now());

  await sendWhatsappOtp(pending.phone, pending.phoneCode);

  return {
    pendingToken,
    phone: pending.phone,
    expiresInSeconds: OTP_TTL_MS / 1000,
    devCode: whatsappEnabled ? undefined : pending.phoneCode,
  };
}

/** (Re)generates the email verification link/token for a phone-verified
 *  pending registration and sends it. `baseUrl` (e.g.
 *  "https://lobanglah.example.com") is prepended to build the actual link,
 *  since it points at a hash route in the SPA and the server has no fixed
 *  notion of its own public origin. */
async function sendPendingEmailLink(
  pendingToken: string,
  pending: PendingRegistration,
  baseUrl: string
): Promise<VerifyPhoneResult> {
  // Invalidate any previously issued link for this registration first, so
  // only the most recently sent link ever works.
  if (pending.emailVerifyToken) emailTokenToPendingToken.delete(pending.emailVerifyToken);

  const token = crypto.randomBytes(32).toString("hex");
  pending.emailVerifyToken = token;
  pending.emailVerifyExpiresAt = Date.now() + EMAIL_LINK_TTL_MS;
  emailTokenToPendingToken.set(token, pendingToken);
  lastSentAt.set(pendingToken, Date.now());

  const verifyUrl = `${baseUrl}/#/verify-email/${token}`;
  await sendVerificationEmail(pending.email, verifyUrl);

  return {
    pendingToken,
    email: pending.email,
    expiresInSeconds: EMAIL_LINK_TTL_MS / 1000,
    devVerifyUrl: emailEnabled ? undefined : verifyUrl,
  };
}

/** Step 2a: verifies the WhatsApp code, then immediately emails a
 *  confirmation link — the account still doesn't exist yet at this point. */
export async function verifyRegistration(pendingToken: string, code: string, baseUrl: string): Promise<VerifyPhoneResult> {
  const pending = pendingRegistrations.get(pendingToken);
  if (!pending) throw new Error("This sign-up session has expired. Please start again.");
  if (pending.phoneVerified) throw new Error("Your phone number is already verified.");
  if (Date.now() > pending.phoneExpiresAt) {
    pendingRegistrations.delete(pendingToken);
    throw new Error("That code has expired. Please request a new one.");
  }
  if (pending.phoneAttempts >= MAX_OTP_ATTEMPTS) {
    pendingRegistrations.delete(pendingToken);
    throw new Error("Too many incorrect attempts. Please start sign-up again.");
  }
  if (pending.phoneCode !== code) {
    pending.phoneAttempts += 1;
    throw new Error("Incorrect code. Please check your WhatsApp and try again.");
  }

  // Re-check email and phone uniqueness in case either was taken by someone
  // else's completed sign-up while this OTP was pending.
  const existingEmail = await storage.getUserByEmail(pending.email);
  if (existingEmail) {
    pendingRegistrations.delete(pendingToken);
    throw new Error("An account with this email already exists");
  }
  const existingPhone = await storage.getUserByPhone(pending.phone);
  if (existingPhone) {
    pendingRegistrations.delete(pendingToken);
    throw new Error("An account with this mobile number already exists");
  }

  pending.phoneVerified = true;
  return sendPendingEmailLink(pendingToken, pending, baseUrl);
}

export async function resendRegistrationEmailLink(pendingToken: string, baseUrl: string): Promise<VerifyPhoneResult> {
  const pending = pendingRegistrations.get(pendingToken);
  if (!pending) throw new Error("This sign-up session has expired. Please start again.");
  if (!pending.phoneVerified) throw new Error("Verify your phone number first.");
  const last = lastSentAt.get(pendingToken) ?? 0;
  if (Date.now() - last < RESEND_COOLDOWN_MS) {
    throw new Error("Please wait a moment before requesting another email");
  }
  return sendPendingEmailLink(pendingToken, pending, baseUrl);
}

/** Step 2b: called when the user clicks the link in their email — verifies
 *  the link token and, only now that both phone and email are confirmed,
 *  actually creates the account. Takes just the link token: this runs on a
 *  standalone page that may be opened in a different tab/device than the one
 *  sign-up was started on, so it can't rely on any other client-side state. */
export async function verifyRegistrationEmailLink(token: string): Promise<User> {
  const pendingToken = emailTokenToPendingToken.get(token);
  const pending = pendingToken ? pendingRegistrations.get(pendingToken) : undefined;
  if (!pendingToken || !pending || pending.emailVerifyToken !== token) {
    throw new Error("This verification link is invalid or has already been used.");
  }
  if (!pending.emailVerifyExpiresAt || Date.now() > pending.emailVerifyExpiresAt) {
    emailTokenToPendingToken.delete(token);
    pendingRegistrations.delete(pendingToken);
    throw new Error("This verification link has expired. Please sign up again.");
  }

  // Re-check email and phone uniqueness one more time in case either was
  // taken while this link was pending.
  const existingEmail = await storage.getUserByEmail(pending.email);
  if (existingEmail) {
    emailTokenToPendingToken.delete(token);
    pendingRegistrations.delete(pendingToken);
    throw new Error("An account with this email already exists");
  }
  const existingPhone = await storage.getUserByPhone(pending.phone);
  if (existingPhone) {
    emailTokenToPendingToken.delete(token);
    pendingRegistrations.delete(pendingToken);
    throw new Error("An account with this mobile number already exists");
  }

  const user = db
    .insert(users)
    .values({
      name: pending.name,
      email: pending.email,
      phone: pending.phone,
      password: pending.passwordHash,
      isAdmin: false,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  emailTokenToPendingToken.delete(token);
  pendingRegistrations.delete(pendingToken);
  return user;
}

// ---------- Forgot password (WhatsApp OTP to phone on file) ----------
// Mirrors the registration OTP flow above: step 1 looks up the account by
// email and sends a 6-digit code to the phone already on file, step 2 checks
// the code and sets the new password. Kept in-memory like the other pending
// flows (demo scope).
interface PendingPasswordReset {
  userId: number;
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
}
const pendingPasswordResets = new Map<string, PendingPasswordReset>();
const resetLastSentAt = new Map<string, number>();

export interface StartPasswordResetResult {
  pendingToken: string;
  /** Partially masked, e.g. "+65 9•••• 4567" — enough for the requester to recognize their own number. */
  phone: string;
  expiresInSeconds: number;
  devCode?: string;
}

function maskPhone(phone: string): string {
  const match = phone.match(/^(\+65)(\d{4})(\d{4})$/);
  if (!match) return phone;
  const [, prefix, first, last] = match;
  return `${prefix} ${first[0]}\u2022\u2022\u2022${last}`;
}

export async function startPasswordReset(email: string): Promise<StartPasswordResetResult> {
  const user = await storage.getUserByEmail(email);
  if (!user) throw new Error("No account found with this email");

  const code = generateOtpCode();
  const pendingToken = crypto.randomBytes(24).toString("hex");
  pendingPasswordResets.set(pendingToken, {
    userId: user.id,
    phone: user.phone,
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });
  resetLastSentAt.set(pendingToken, Date.now());

  await sendWhatsappOtp(user.phone, code);

  return {
    pendingToken,
    phone: maskPhone(user.phone),
    expiresInSeconds: OTP_TTL_MS / 1000,
    devCode: whatsappEnabled ? undefined : code,
  };
}

export async function resendPasswordResetOtp(pendingToken: string): Promise<StartPasswordResetResult> {
  const pending = pendingPasswordResets.get(pendingToken);
  if (!pending) throw new Error("This password reset session has expired. Please start again.");
  const last = resetLastSentAt.get(pendingToken) ?? 0;
  if (Date.now() - last < RESEND_COOLDOWN_MS) {
    throw new Error("Please wait a moment before requesting another code");
  }
  pending.code = generateOtpCode();
  pending.expiresAt = Date.now() + OTP_TTL_MS;
  pending.attempts = 0;
  resetLastSentAt.set(pendingToken, Date.now());

  await sendWhatsappOtp(pending.phone, pending.code);

  return {
    pendingToken,
    phone: maskPhone(pending.phone),
    expiresInSeconds: OTP_TTL_MS / 1000,
    devCode: whatsappEnabled ? undefined : pending.code,
  };
}

export async function completePasswordReset(pendingToken: string, code: string, newPassword: string): Promise<void> {
  const pending = pendingPasswordResets.get(pendingToken);
  if (!pending) throw new Error("This password reset session has expired. Please start again.");
  if (Date.now() > pending.expiresAt) {
    pendingPasswordResets.delete(pendingToken);
    throw new Error("That code has expired. Please request a new one.");
  }
  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    pendingPasswordResets.delete(pendingToken);
    throw new Error("Too many incorrect attempts. Please start again.");
  }
  if (pending.code !== code) {
    pending.attempts += 1;
    throw new Error("Incorrect code. Please check your WhatsApp and try again.");
  }

  db.update(users).set({ password: hashPassword(newPassword) }).where(eq(users.id, pending.userId)).run();
  pendingPasswordResets.delete(pendingToken);
  invalidateAllSessions(pending.userId);
}

// ---------- Contact masking ----------
const PHONE_REGEX = /(\+?\d[\d\s-]{6,}\d)/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function maskContact(content: string): string {
  return content.replace(EMAIL_REGEX, "[email hidden]").replace(PHONE_REGEX, "[phone hidden]");
}

export interface IStorage {
  // users
  createUser(user: InsertUser): Promise<User>;
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  verifyPassword(email: string, password: string): Promise<User | undefined>;
  changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getAdmins(): Promise<User[]>;
  suspendUser(id: number, untilMs: number, reason?: string): Promise<User>;
  banUser(id: number, reason?: string): Promise<User>;
  reactivateUser(id: number): Promise<User>;
  deleteUser(id: number): Promise<void>;
  /** Admin-only: there is no "current password" to show — passwords are
   *  salted/hashed one-way and never stored in reversible form — so this is a
   *  reset, not a view. Generates a random one-time password, stores its
   *  hash, signs the user out everywhere, and returns the plaintext password
   *  exactly once so the admin can relay it. */
  resetUserPassword(id: number): Promise<string>;
  /** Admin-only: create another admin account directly, with a server-
   *  generated one-time password (never chosen by the caller) returned
   *  exactly once — same pattern as the seed-admin bootstrap above. */
  createAdminUser(input: CreateAdminInput): Promise<{ user: User; temporaryPassword: string }>;
  /** Admin-only: correct a user's name/email/phone. Doesn't touch password or
   *  status. Refuses to change the email to one already in use by someone
   *  else (the column has a DB-level unique constraint either way, but this
   *  gives a clean error message instead of a raw constraint failure). */
  adminUpdateUser(id: number, patch: AdminUpdateUserInput): Promise<User | undefined>;

  // listings
  createListing(userId: number, listing: InsertListing): Promise<Listing>;
  getListing(id: number): Promise<Listing | undefined>;
  getLiveListings(filters: { type?: string; category?: string; location?: string; q?: string }): Promise<Listing[]>;
  getListingsByUser(userId: number): Promise<Listing[]>;
  getAllListings(): Promise<Listing[]>;
  getPendingListings(): Promise<Listing[]>;
  updateListing(
    id: number,
    userId: number,
    patch: Partial<InsertListing>,
    opts?: { isAdmin?: boolean }
  ): Promise<Listing | undefined>;
  approveListing(id: number): Promise<Listing | undefined>;
  rejectListing(id: number, reason: string): Promise<Listing | undefined>;
  adminRemoveListing(id: number): Promise<void>;
  adminCloseListing(id: number): Promise<Listing>;
  extendListing(id: number, days: number): Promise<Listing>;

  // bids
  createBid(listingId: number, bidderId: number, bid: InsertBid): Promise<Bid>;
  getBidsForListing(listingId: number): Promise<Bid[]>;
  getBidsByBidder(bidderId: number): Promise<Bid[]>;
  getBid(id: number): Promise<Bid | undefined>;
  acceptBid(bidId: number, posterId: number): Promise<{ listing: Listing; feeCharge: FeeCharge; clientSecret?: string; paynowClientSecret?: string }>;
  rejectBid(bidId: number, posterId: number): Promise<Bid>;
  updateBid(id: number, bidderId: number, patch: BidUpdateInput): Promise<Bid>;
  cancelBid(id: number, bidderId: number): Promise<Bid>;
  requestReopenBid(id: number, bidderId: number): Promise<Bid>;
  adminUpdateBid(id: number, patch: { amount?: number; message?: string }): Promise<Bid | undefined>;
  adminCancelBid(id: number): Promise<Bid>;
  adminReopenBid(id: number): Promise<Bid>;
  adminDeleteBid(id: number): Promise<void>;

  // stripe fee-charge finalization (real-payments flow)
  finalizeFeeCharge(paymentIntentId: string): Promise<void>;
  failFeeCharge(paymentIntentId: string, reason: string): Promise<void>;
  syncFeeCharge(paymentIntentId: string): Promise<void>;

  // messages
  getConversation(listingId: number, userId: number, otherUserId: number): Promise<Message[]>;
  getListingParticipants(listingId: number, userId: number): Promise<{ id: number; name: string }[]>;
  sendMessage(listingId: number, senderId: number, recipientId: number, content: string): Promise<Message>;
  sendThreadMessage(listingId: number, senderId: number, threadBidderId: number, content: string): Promise<Message>;
  getAllMessagesForListing(listingId: number): Promise<Message[]>;

  // fee charges
  getFeeChargesForListing(listingId: number): Promise<FeeCharge[]>;
  getFeeChargesForUser(userId: number): Promise<FeeCharge[]>;
  getAllFeeCharges(): Promise<FeeCharge[]>;
  payFeeCharge(feeChargeId: number, posterId: number, method: "card" | "paynow"): Promise<FeeCharge>;
  getFeeChargeStripeClientSecret(
    feeChargeId: number,
    posterId: number
  ): Promise<{ clientSecret: string; paynowClientSecret: string; feeAmount: number; listingId: number }>;
  getBidContact(bidId: number, requestingUserId: number): Promise<{ posterName: string; posterPhone: string; providerName: string; providerPhone: string } | undefined>;

  // notifications
  createNotification(userId: number, type: Notification["type"], title: string, body: string, relatedListingId?: number, relatedUserId?: number): Promise<Notification>;
  getNotificationsForUser(userId: number): Promise<Notification[]>;
  markNotificationRead(id: number, userId: number): Promise<void>;
  markAllNotificationsRead(userId: number): Promise<void>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  createAnnouncement(title: string, body: string, scheduledFor?: number): Promise<Announcement>;
  getAnnouncements(): Promise<Announcement[]>;
  getAllAnnouncementsForAdmin(): Promise<Announcement[]>;
  updateAnnouncement(id: number, patch: { title?: string; body?: string; scheduledFor?: number | null }): Promise<Announcement>;
  deleteAnnouncement(id: number): Promise<void>;
  getRestrictedUsers(): Promise<Pick<User, "id" | "name" | "status" | "restrictionReason" | "suspendedUntil">[]>;
}

export { stripeEnabled };

/** Number of bids counted toward a listing's quantityNeeded target: those
 *  already accepted, plus any Stripe fee charge still awaiting confirmation
 *  (so we don't let a poster accept more bids than they asked for while a
 *  card charge is in flight). Shared by both the simulated path (this file)
 *  and the real-Stripe path (stripe-storage.ts). */
export function countCommittedBids(listingId: number): number {
  const acceptedBids = db
    .select()
    .from(bids)
    .where(and(eq(bids.listingId, listingId), eq(bids.status, "accepted")))
    .all();
  const pendingCharges = db
    .select()
    .from(feeCharges)
    .where(and(eq(feeCharges.listingId, listingId), eq(feeCharges.status, "pending")))
    .all();
  return acceptedBids.length + pendingCharges.length;
}

/** Rejects every other still-pending bid on a listing once it has closed
 *  (i.e. once the poster's target headcount has been reached). Shared by
 *  both the simulated path (this file) and the real-Stripe path
 *  (stripe-storage.ts). */
export function rejectOtherPendingBids(listingId: number, exceptBidId?: number): void {
  const otherBids = db
    .select()
    .from(bids)
    .where(and(eq(bids.listingId, listingId), eq(bids.status, "pending")))
    .all();
  for (const ob of otherBids) {
    if (ob.id === exceptBidId) continue;
    db.update(bids).set({ status: "rejected" }).where(eq(bids.id, ob.id)).run();
  }
}

export class DatabaseStorage implements IStorage {
  async createUser(user: InsertUser): Promise<User> {
    return db
      .insert(users)
      .values({ ...user, password: hashPassword(user.password), isAdmin: false, createdAt: Date.now() })
      .returning()
      .get();
  }

  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.email, email)).get();
  }

  /** Phone is stored normalized to E.164 (+65XXXXXXXX, see normalizeSgPhone),
   *  so callers should normalize before looking up — this does an exact
   *  match, not a fuzzy one. */
  async getUserByPhone(phone: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.phone, phone)).get();
  }

  async verifyPassword(email: string, password: string): Promise<User | undefined> {
    const user = await this.getUserByEmail(email);
    if (!user) return undefined;
    if (!verifyPasswordHash(password, user.password)) return undefined;
    // Transparently upgrade legacy unsalted SHA-256 hashes to salted PBKDF2
    // the next time the user successfully logs in, without requiring a
    // separate migration step or forcing a password reset.
    if (isLegacyHash(user.password)) {
      db.update(users).set({ password: hashPassword(password) }).where(eq(users.id, user.id)).run();
    }
    return user;
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    if (!verifyPasswordHash(currentPassword, user.password)) {
      throw new Error("Current password is incorrect");
    }
    db.update(users).set({ password: hashPassword(newPassword) }).where(eq(users.id, userId)).run();
  }

  /** Admin-only password reset. There's no "current password" to retrieve —
   *  passwords are salted PBKDF2 hashes, one-way by design — so this issues a
   *  fresh random password instead, signs the account out everywhere (same as
   *  a forgot-password reset), and hands the plaintext back exactly once. */
  async resetUserPassword(id: number): Promise<string> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    const temporaryPassword = crypto.randomBytes(9).toString("base64url");
    db.update(users).set({ password: hashPassword(temporaryPassword) }).where(eq(users.id, id)).run();
    invalidateAllSessions(id);
    return temporaryPassword;
  }

  async createAdminUser(input: CreateAdminInput): Promise<{ user: User; temporaryPassword: string }> {
    const existing = await this.getUserByEmail(input.email);
    if (existing) throw new Error("A user with this email already exists");
    const temporaryPassword = crypto.randomBytes(9).toString("base64url");
    const user = db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        password: hashPassword(temporaryPassword),
        isAdmin: true,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    return { user, temporaryPassword };
  }

  async adminUpdateUser(id: number, patch: AdminUpdateUserInput): Promise<User | undefined> {
    const existing = await this.getUser(id);
    if (!existing) return undefined;
    if (patch.email && patch.email !== existing.email) {
      const emailOwner = await this.getUserByEmail(patch.email);
      if (emailOwner && emailOwner.id !== id) {
        throw new Error("A user with this email already exists");
      }
    }
    if (patch.phone && patch.phone !== existing.phone) {
      const phoneOwner = await this.getUserByPhone(patch.phone);
      if (phoneOwner && phoneOwner.id !== id) {
        throw new Error("A user with this mobile number already exists");
      }
    }
    return db.update(users).set(patch).where(eq(users.id, id)).returning().get();
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt)).all();
  }

  async getAdmins(): Promise<User[]> {
    return db.select().from(users).where(eq(users.isAdmin, true)).all();
  }

  async suspendUser(id: number, untilMs: number, reason?: string): Promise<User> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    if (user.isAdmin) throw new Error("Admins can't be suspended");
    return db
      .update(users)
      .set({ status: "suspended", suspendedUntil: untilMs, restrictionReason: reason || null })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  async banUser(id: number, reason?: string): Promise<User> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    if (user.isAdmin) throw new Error("Admins can't be banned");
    return db
      .update(users)
      .set({ status: "banned", suspendedUntil: null, restrictionReason: reason || null })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  async reactivateUser(id: number): Promise<User> {
    return db
      .update(users)
      .set({ status: "active", suspendedUntil: null, restrictionReason: null })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  /** Deletes the account and cascades through everything it's tied to: its
   *  own postings (and those postings' bids/messages), its bids on other
   *  people's postings, every message and notification involving it, and
   *  every fee charge it was party to (as poster or provider). */
  async deleteUser(id: number): Promise<void> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    if (user.isAdmin) throw new Error("Admins can't be deleted");

    const ownListings = db.select().from(listings).where(eq(listings.userId, id)).all();
    for (const l of ownListings) {
      db.delete(bids).where(eq(bids.listingId, l.id)).run();
      db.delete(messages).where(eq(messages.listingId, l.id)).run();
      db.delete(listings).where(eq(listings.id, l.id)).run();
    }
    db.delete(bids).where(eq(bids.bidderId, id)).run();
    db.delete(messages).where(or(eq(messages.senderId, id), eq(messages.recipientId, id))).run();
    db.delete(notifications).where(eq(notifications.userId, id)).run();
    db.delete(feeCharges).where(or(eq(feeCharges.posterId, id), eq(feeCharges.providerId, id))).run();
    db.delete(users).where(eq(users.id, id)).run();
  }

  async createListing(userId: number, listing: InsertListing): Promise<Listing> {
    const now = Date.now();
    const created = db
      .insert(listings)
      .values({ ...listing, userId, status: "pending", createdAt: now, expiresAt: now + SEVEN_DAYS_MS })
      .returning()
      .get();
    // Notify every admin so postings for review show up in their notification bell.
    const admins = await this.getAdmins();
    for (const admin of admins) {
      await this.createNotification(
        admin.id,
        "new_posting_review",
        "New posting for review",
        `"${created.title}" needs your approval before it goes live.`,
        created.id
      );
    }
    return created;
  }

  async getListing(id: number): Promise<Listing | undefined> {
    return db.select().from(listings).where(eq(listings.id, id)).get();
  }

  async getLiveListings(filters: { type?: string; category?: string; location?: string; q?: string }): Promise<Listing[]> {
    let rows = db.select().from(listings).where(eq(listings.status, "live")).orderBy(desc(listings.createdAt)).all();
    if (filters.type) rows = rows.filter((l) => l.type === filters.type);
    if (filters.category) rows = rows.filter((l) => l.category === filters.category);
    if (filters.location) rows = rows.filter((l) => l.location === filters.location);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter(
        (l) => l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
      );
    }
    return rows;
  }

  async getListingsByUser(userId: number): Promise<Listing[]> {
    return db.select().from(listings).where(eq(listings.userId, userId)).orderBy(desc(listings.createdAt)).all();
  }

  /** Every listing from every user, regardless of status — used for the admin
   *  "My Lobangs" view so admins can see and edit any posting on the platform. */
  async getAllListings(): Promise<Listing[]> {
    return db.select().from(listings).orderBy(desc(listings.createdAt)).all();
  }

  async getPendingListings(): Promise<Listing[]> {
    return db.select().from(listings).where(eq(listings.status, "pending")).orderBy(desc(listings.createdAt)).all();
  }

  async updateListing(
    id: number,
    userId: number,
    patch: Partial<InsertListing>,
    opts?: { isAdmin?: boolean }
  ): Promise<Listing | undefined> {
    const isAdmin = opts?.isAdmin ?? false;
    const existing = await this.getListing(id);
    if (!existing) return undefined;
    // Admins can edit any listing regardless of who posted it. Everyone else
    // may only edit their own.
    if (!isAdmin && existing.userId !== userId) return undefined;
    // Regular posters can't edit a closed listing, or one that already has a
    // bid — changing the terms after providers have committed to them isn't
    // fair to bidders. Admins are exempt from both restrictions: closed
    // listings are moderation targets too (e.g. fixing an inappropriate
    // title/description after the fact), and by definition already have bids.
    if (!isAdmin) {
      if (existing.status === "closed") return undefined;
      const existingBids = await this.getBidsForListing(id);
      if (existingBids.length > 0) {
        throw new Error("This listing already has bids and can no longer be edited");
      }
    }
    if (isAdmin) {
      // Admin edits are moderation actions, not new submissions — don't
      // disturb the listing's current lifecycle status (would otherwise hide
      // a live listing or reopen a closed one for re-review as a side effect).
      return db.update(listings).set(patch).where(eq(listings.id, id)).returning().get();
    }
    // A regular poster's edit (live, pending, or rejected) sends the listing back
    // for admin re-review to preserve trust & safety, and gives rejected listings
    // a path back to approval.
    return db
      .update(listings)
      .set({ ...patch, status: "pending", rejectionReason: null })
      .where(eq(listings.id, id))
      .returning()
      .get();
  }

  async approveListing(id: number): Promise<Listing | undefined> {
    const updated = db.update(listings).set({ status: "live", rejectionReason: null }).where(eq(listings.id, id)).returning().get();
    if (updated) {
      await this.createNotification(
        updated.userId,
        "listing_approved",
        "Your listing is live",
        `"${updated.title}" was approved and is now visible to everyone.`,
        updated.id
      );
    }
    return updated;
  }

  async rejectListing(id: number, reason: string): Promise<Listing | undefined> {
    const updated = db.update(listings).set({ status: "rejected", rejectionReason: reason }).where(eq(listings.id, id)).returning().get();
    if (updated) {
      await this.createNotification(
        updated.userId,
        "listing_rejected",
        "Your listing was rejected",
        `"${updated.title}" was rejected: ${reason}`,
        updated.id
      );
    }
    return updated;
  }

  async adminRemoveListing(id: number): Promise<void> {
    db.delete(bids).where(eq(bids.listingId, id)).run();
    db.delete(messages).where(eq(messages.listingId, id)).run();
    db.delete(listings).where(eq(listings.id, id)).run();
  }

  /** Admin can force a listing closed regardless of its current status (live,
   *  pending review, or even rejected) — e.g. to take down something that
   *  violates guidelines without waiting for the poster's quota of accepted
   *  bids. Unlike adminRemoveListing this keeps the listing and its history
   *  around; it just takes it off the market. Any bids still pending are no
   *  longer actionable, so they're rejected and the bidders are notified.
   *  Already-accepted bids (and their fee charges) are untouched — the poster
   *  and provider can still complete that arrangement. */
  async adminCloseListing(id: number): Promise<Listing> {
    const listing = await this.getListing(id);
    if (!listing) throw new Error("Listing not found");
    if (listing.status === "closed") throw new Error("This listing is already closed");

    const updated = db.update(listings).set({ status: "closed" }).where(eq(listings.id, id)).returning().get();

    const pendingBids = (await this.getBidsForListing(id)).filter((b) => b.status === "pending");
    for (const b of pendingBids) {
      db.update(bids).set({ status: "rejected" }).where(eq(bids.id, b.id)).run();
      await this.createNotification(
        b.bidderId,
        "bid_rejected",
        "Your bid wasn't selected",
        `"${listing.title}" was closed before your bid could be reviewed.`,
        id
      );
    }

    await this.createNotification(
      listing.userId,
      "listing_rejected",
      "Your listing was closed",
      `An admin closed "${listing.title}". Reach out if you have questions.`,
      id
    );

    return updated;
  }

  /** Admin-only: pushes a still-live listing's auto-close date further out by
   *  the given number of days, added to its current expiresAt (or, for a
   *  legacy row with no expiresAt yet, to createdAt + 7 days) — so repeated
   *  extensions stack from wherever it currently stands rather than always
   *  resetting from "now". Only meaningful on a "live" listing; closed/
   *  rejected/pending listings aren't counting down. */
  async extendListing(id: number, days: number): Promise<Listing> {
    const listing = await this.getListing(id);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "live") throw new Error("Only a live listing's closing date can be extended");

    const base = listing.expiresAt ?? listing.createdAt + SEVEN_DAYS_MS;
    const expiresAt = base + days * 24 * 60 * 60 * 1000;
    const updated = db.update(listings).set({ expiresAt }).where(eq(listings.id, id)).returning().get();

    await this.createNotification(
      listing.userId,
      "listing_extended",
      "Your posting's closing date was extended",
      `An admin extended "${listing.title}" by ${days} day${days === 1 ? "" : "s"} — it now closes on ${new Date(expiresAt).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}.`,
      id
    );

    return updated;
  }

  async createBid(listingId: number, bidderId: number, bid: InsertBid): Promise<Bid> {
    const created = db
      .insert(bids)
      .values({ ...bid, listingId, bidderId, status: "pending", createdAt: Date.now() })
      .returning()
      .get();
    const listing = await this.getListing(listingId);
    if (listing) {
      await this.createNotification(
        listing.userId,
        "new_bid",
        "New bid to review",
        `You received a new bid on "${listing.title}". Review it to accept.`,
        listing.id
      );
    }
    return created;
  }

  async getBidsForListing(listingId: number): Promise<Bid[]> {
    return db.select().from(bids).where(eq(bids.listingId, listingId)).orderBy(desc(bids.createdAt)).all();
  }

  /** Every bid a user has placed as a provider, across any listing —
   *  regardless of who posted it. Powers "My Lobangs" showing postings the
   *  user offered their services on, not just ones they posted themselves. */
  async getBidsByBidder(bidderId: number): Promise<Bid[]> {
    return db.select().from(bids).where(eq(bids.bidderId, bidderId)).orderBy(desc(bids.createdAt)).all();
  }

  async getBid(id: number): Promise<Bid | undefined> {
    return db.select().from(bids).where(eq(bids.id, id)).get();
  }

  async acceptBid(bidId: number, posterId: number): Promise<{ listing: Listing; feeCharge: FeeCharge; clientSecret?: string; paynowClientSecret?: string }> {
    const bid = await this.getBid(bidId);
    if (!bid) throw new Error("Bid not found");
    const listing = await this.getListing(bid.listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.userId !== posterId) throw new Error("Only the listing owner can accept a bid");
    if (listing.status !== "live") throw new Error("Listing is not open for bidding");
    if (bid.status !== "pending") throw new Error("This bid is no longer pending");

    // A poster can accept up to `quantityNeeded` bids before the listing
    // auto-closes. Guard against over-accepting by counting bids already
    // accepted plus any fee charge that's still in flight (Stripe path).
    const committed = this.countCommittedBids(listing.id);
    if (committed >= listing.quantityNeeded) {
      throw new Error("This listing has already reached the number of bids it needs");
    }

    if (stripeEnabled) {
      return stripeStorage.acceptBidWithStripe(bid, listing, posterId);
    }

    const now = Date.now();
    const feeAmount = calculateFeeSgd(bid.amount);

    db.update(bids).set({ status: "accepted" }).where(eq(bids.id, bid.id)).run();

    // The bid is accepted, but the platform fee is NOT charged yet — the
    // poster must explicitly choose PayNow or Card and confirm payment via
    // payFeeCharge() before the fee is marked "paid" and contact details are
    // released. No escrow, no hold, no payout split — the poster and
    // provider settle the job amount directly between themselves.
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
        createdAt: now,
      })
      .returning()
      .get();

    await this.createNotification(
      bid.bidderId,
      "bid_accepted",
      "Your bid was accepted",
      `"${listing.title}" — the poster accepted your bid and needs to settle the platform fee before your contact details are shared.`,
      listing.id
    );

    // Only close the listing (and reject remaining pending bids) once the
    // poster's target headcount has actually been reached; otherwise leave it
    // "live" so more bids can still be accepted.
    const acceptedCount = this.countCommittedBids(listing.id);
    let updatedListing = listing;
    if (acceptedCount >= listing.quantityNeeded) {
      updatedListing = db.update(listings).set({ status: "closed" }).where(eq(listings.id, listing.id)).returning().get();
      this.rejectOtherPendingBids(listing.id, bid.id);
    }

    return { listing: updatedListing, feeCharge };
  }

  /** Poster explicitly declines a single pending bid — the listing stays live and
   *  other bids are unaffected, unlike the bulk auto-reject that happens once a
   *  listing closes. Only the listing owner may reject, and only while the bid
   *  is still pending (an accepted bid must go through its own lifecycle instead). */
  async rejectBid(bidId: number, posterId: number): Promise<Bid> {
    const bid = await this.getBid(bidId);
    if (!bid) throw new Error("Bid not found");
    const listing = await this.getListing(bid.listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.userId !== posterId) throw new Error("Only the listing owner can reject a bid");
    if (bid.status !== "pending") throw new Error("This bid is no longer pending");

    const updated = db.update(bids).set({ status: "rejected" }).where(eq(bids.id, bid.id)).returning().get();

    await this.createNotification(
      bid.bidderId,
      "bid_rejected",
      "Your bid wasn't selected",
      `The poster went with another bid for "${listing.title}". You can still bid on other listings.`,
      listing.id
    );

    return updated;
  }

  /** Bidder self-service: correct their own bid's amount and/or message
   *  while it's still pending — e.g. fixing a typo before the poster
   *  reviews it. Once a bid has moved past pending (accepted, rejected, or
   *  cancelled) it can no longer be self-edited; the bidder would need an
   *  admin's help instead. */
  async updateBid(id: number, bidderId: number, patch: BidUpdateInput): Promise<Bid> {
    const bid = await this.getBid(id);
    if (!bid) throw new Error("Bid not found");
    if (bid.bidderId !== bidderId) throw new Error("You can only edit your own bid");
    if (bid.status !== "pending") throw new Error("Only a pending bid can be edited");
    return db.update(bids).set(patch).where(eq(bids.id, id)).returning().get();
  }

  /** Bidder self-service: withdraw their own still-pending bid. Unlike
   *  adminDeleteBid this keeps the bid on record (status "cancelled")
   *  instead of erasing it, so there's a trail and the bidder can ask an
   *  admin to reopen it later if they change their mind. */
  async cancelBid(id: number, bidderId: number): Promise<Bid> {
    const bid = await this.getBid(id);
    if (!bid) throw new Error("Bid not found");
    if (bid.bidderId !== bidderId) throw new Error("You can only cancel your own bid");
    if (bid.status !== "pending") throw new Error("Only a pending bid can be cancelled");
    return db
      .update(bids)
      .set({ status: "cancelled", reopenRequested: false })
      .where(eq(bids.id, id))
      .returning()
      .get();
  }

  /** Bidder self-service: flag their own cancelled bid for admin attention —
   *  only an admin can actually put it back to pending (adminReopenBid), so
   *  this just raises a hand and notifies every admin, mirroring how a new
   *  listing needing review notifies every admin. */
  async requestReopenBid(id: number, bidderId: number): Promise<Bid> {
    const bid = await this.getBid(id);
    if (!bid) throw new Error("Bid not found");
    if (bid.bidderId !== bidderId) throw new Error("You can only request this for your own bid");
    if (bid.status !== "cancelled") throw new Error("Only a cancelled bid can be requested to reopen");
    if (bid.reopenRequested) throw new Error("You've already asked an admin to reopen this bid");

    const updated = db.update(bids).set({ reopenRequested: true }).where(eq(bids.id, id)).returning().get();

    const listing = await this.getListing(bid.listingId);
    const admins = await this.getAdmins();
    for (const admin of admins) {
      await this.createNotification(
        admin.id,
        "bid_reopen_requested",
        "Bid reopen requested",
        `A bidder asked to reopen their cancelled bid${listing ? ` on "${listing.title}"` : ""}.`,
        bid.listingId
      );
    }

    return updated;
  }

  /** Admin moderation: correct a bid's amount and/or message on the bidder's
   *  behalf (e.g. fixing a typo reported over the phone). Deliberately doesn't
   *  touch status — accept/reject remain the only way a bid's lifecycle
   *  advances. Refuses once the bid's fee has been paid, since the accepted
   *  amount is now a real financial record. */
  async adminUpdateBid(id: number, patch: { amount?: number; message?: string }): Promise<Bid | undefined> {
    const bid = await this.getBid(id);
    if (!bid) return undefined;
    if (patch.amount !== undefined) {
      const charges = db.select().from(feeCharges).where(eq(feeCharges.bidId, id)).all();
      if (charges.some((f) => f.status === "paid")) {
        throw new Error("This bid's platform fee has already been paid — its amount can no longer be changed");
      }
    }
    return db.update(bids).set(patch).where(eq(bids.id, id)).returning().get();
  }

  /** Admin moderation: cancel a bid without erasing it — status becomes
   *  "cancelled", kept on record (unlike adminDeleteBid) so it can be
   *  reopened later. Distinct from rejectBid, which is the poster's own
   *  choice to decline a bid they reviewed. Refuses once the fee's already
   *  been paid, same guard as adminUpdateBid/adminDeleteBid. */
  async adminCancelBid(id: number): Promise<Bid> {
    const bid = await this.getBid(id);
    if (!bid) throw new Error("Bid not found");
    if (bid.status === "cancelled") throw new Error("This bid is already cancelled");
    const charges = db.select().from(feeCharges).where(eq(feeCharges.bidId, id)).all();
    if (charges.some((f) => f.status === "paid")) {
      throw new Error("This bid's platform fee has already been paid and can't be cancelled");
    }

    const updated = db
      .update(bids)
      .set({ status: "cancelled", reopenRequested: false })
      .where(eq(bids.id, id))
      .returning()
      .get();

    const listing = await this.getListing(bid.listingId);
    await this.createNotification(
      bid.bidderId,
      "bid_cancelled",
      "Your bid was cancelled",
      `An admin cancelled your bid${listing ? ` on "${listing.title}"` : ""}. Reach out via Contact Us if you have questions.`,
      bid.listingId
    );

    return updated;
  }

  /** Admin moderation: put a cancelled bid back to pending so the poster can
   *  consider it again — the only way a cancelled bid's lifecycle can move
   *  forward again, whether the bidder asked for it (reopenRequested) or the
   *  admin is acting on their own. */
  async adminReopenBid(id: number): Promise<Bid> {
    const bid = await this.getBid(id);
    if (!bid) throw new Error("Bid not found");
    if (bid.status !== "cancelled") throw new Error("Only a cancelled bid can be reopened");

    const updated = db
      .update(bids)
      .set({ status: "pending", reopenRequested: false })
      .where(eq(bids.id, id))
      .returning()
      .get();

    const listing = await this.getListing(bid.listingId);
    await this.createNotification(
      bid.bidderId,
      "bid_reopened",
      "Your bid was reopened",
      `An admin reopened your bid${listing ? ` on "${listing.title}"` : ""} — it's pending again.`,
      bid.listingId
    );

    return updated;
  }

  /** Admin moderation: remove a single bid (e.g. spam, a mistaken bid, or one
   *  a bidder asked to withdraw) without touching the rest of the listing.
   *  Cleans up the bidder's private thread on this listing and any unpaid fee
   *  charge tied to the bid; refuses if the fee has already been paid, since
   *  that's a real settled transaction. */
  async adminDeleteBid(id: number): Promise<void> {
    const bid = await this.getBid(id);
    if (!bid) throw new Error("Bid not found");
    const listing = await this.getListing(bid.listingId);

    const charges = db.select().from(feeCharges).where(eq(feeCharges.bidId, id)).all();
    if (charges.some((f) => f.status === "paid")) {
      throw new Error("This bid's platform fee has already been paid and can't be removed");
    }
    for (const f of charges) {
      db.delete(feeCharges).where(eq(feeCharges.id, f.id)).run();
    }

    db.delete(messages)
      .where(
        and(
          eq(messages.listingId, bid.listingId),
          or(
            eq(messages.threadBidderId, bid.bidderId),
            eq(messages.senderId, bid.bidderId),
            eq(messages.recipientId, bid.bidderId)
          )
        )
      )
      .run();
    db.delete(bids).where(eq(bids.id, id)).run();

    if (listing) {
      await this.createNotification(
        bid.bidderId,
        "bid_removed",
        "Your bid was removed",
        `An admin removed your bid on "${listing.title}". Reach out via Contact Us if you have questions.`,
        listing.id
      );
    }
  }

  /** Poster settles the platform fee via PayNow or Card right after accepting a bid.
   *  Simulated payment confirmation (no real gateway wired up yet) — marks the fee
   *  "paid" immediately so contact details can be released to both parties. */
  async payFeeCharge(feeChargeId: number, posterId: number, method: "card" | "paynow"): Promise<FeeCharge> {
    // Guard against the simulated flow ever being used to "pay" a fee once
    // Stripe is live — without this, a poster who closes the real Stripe
    // checkout partway through could hit this route directly and get
    // contact details released without any money actually changing hands.
    if (stripeEnabled) {
      throw new Error("Stripe is live for this listing — pay via the card/PayNow checkout, not this simulated confirmation.");
    }
    const feeCharge = db.select().from(feeCharges).where(eq(feeCharges.id, feeChargeId)).get();
    if (!feeCharge) throw new Error("Fee charge not found");
    if (feeCharge.posterId !== posterId) throw new Error("Only the poster can pay this platform fee");
    if (feeCharge.status === "paid") return feeCharge;
    if (feeCharge.status === "failed") throw new Error("This fee charge failed and can no longer be paid");

    const now = Date.now();
    const updated = db
      .update(feeCharges)
      .set({ status: "paid", paidAt: now, paymentMethod: method })
      .where(eq(feeCharges.id, feeChargeId))
      .returning()
      .get();

    const listing = await this.getListing(feeCharge.listingId);
    await this.createNotification(
      feeCharge.providerId,
      "fee_paid",
      "Platform fee paid — contact details released",
      `The poster paid the platform fee for "${listing?.title ?? "your accepted bid"}". You can now see each other's contact details.`,
      feeCharge.listingId
    );
    await this.createNotification(
      feeCharge.posterId,
      "fee_paid",
      "Payment confirmed — contact details released",
      `Your ${method === "paynow" ? "PayNow" : "card"} payment of S$${feeCharge.feeAmount.toFixed(2)} was confirmed. You can now see the provider's contact details.`,
      feeCharge.listingId
    );

    return updated;
  }

  /** Retry entry point for the real-payments flow: if the poster closed the
   *  Stripe modal before confirming right after accepting a bid (or it
   *  errored), "Pay now" calls this to fetch that same PaymentIntent's client
   *  secret again so the Stripe checkout can be reopened — it never creates a
   *  new charge, and it never falls through to the simulated confirmation. */
  async getFeeChargeStripeClientSecret(
    feeChargeId: number,
    posterId: number
  ): Promise<{ clientSecret: string; paynowClientSecret: string; feeAmount: number; listingId: number }> {
    const feeCharge = db.select().from(feeCharges).where(eq(feeCharges.id, feeChargeId)).get();
    if (!feeCharge) throw new Error("Fee charge not found");
    if (feeCharge.posterId !== posterId) throw new Error("Only the poster can pay this platform fee");
    if (feeCharge.status === "paid") throw new Error("This fee has already been paid");
    if (feeCharge.status === "failed") throw new Error("This fee charge failed — accept the bid again to retry");
    if (!feeCharge.stripePaymentIntentId && !feeCharge.stripePaynowIntentId) {
      throw new Error("No Stripe payment is associated with this fee charge");
    }

    const poster = db.select().from(users).where(eq(users.id, posterId)).get();
    if (!poster) throw new Error("Poster account not found");
    const customerId = await ensureCustomer({
      id: poster.id,
      email: poster.email,
      name: poster.name,
      stripeCustomerId: poster.stripeCustomerId,
    });
    if (!poster.stripeCustomerId) {
      db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, poster.id)).run();
    }

    const result = await retrieveOrUpgradeClientSecrets({
      existingCardId: feeCharge.stripePaymentIntentId,
      existingPaynowId: feeCharge.stripePaynowIntentId,
      customerId,
      listingId: feeCharge.listingId,
      bidId: feeCharge.bidId,
      feeAmountSgd: feeCharge.feeAmount,
    });
    if (result.cardRecreated || result.paynowRecreated) {
      db.update(feeCharges)
        .set({
          stripePaymentIntentId: result.cardPaymentIntentId,
          stripePaynowIntentId: result.paynowPaymentIntentId,
        })
        .where(eq(feeCharges.id, feeChargeId))
        .run();
    }
    return {
      clientSecret: result.cardClientSecret,
      paynowClientSecret: result.paynowClientSecret,
      feeAmount: feeCharge.feeAmount,
      listingId: feeCharge.listingId,
    };
  }

  /** Returns both parties' names/phone numbers for an accepted bid, but only once
   *  the associated platform fee has actually been paid, and only to the poster
   *  or the accepted provider themselves. */
  async getBidContact(
    bidId: number,
    requestingUserId: number
  ): Promise<{ posterName: string; posterPhone: string; providerName: string; providerPhone: string } | undefined> {
    const bid = await this.getBid(bidId);
    if (!bid) return undefined;
    const feeCharge = db.select().from(feeCharges).where(eq(feeCharges.bidId, bidId)).get();
    if (!feeCharge || feeCharge.status !== "paid") return undefined;
    if (requestingUserId !== feeCharge.posterId && requestingUserId !== feeCharge.providerId) return undefined;

    const poster = await this.getUser(feeCharge.posterId);
    const provider = await this.getUser(feeCharge.providerId);
    if (!poster || !provider) return undefined;

    return {
      posterName: poster.name,
      posterPhone: poster.phone,
      providerName: provider.name,
      providerPhone: provider.phone,
    };
  }

  private countCommittedBids(listingId: number): number {
    return countCommittedBids(listingId);
  }

  private rejectOtherPendingBids(listingId: number, acceptedBidId: number): void {
    rejectOtherPendingBids(listingId, acceptedBidId);
  }

  async getListingParticipants(listingId: number, userId: number): Promise<{ id: number; name: string }[]> {
    const listing = await this.getListing(listingId);
    if (!listing) return [];
    const listingBids = await this.getBidsForListing(listingId);
    const participantIds = new Set<number>([listing.userId, ...listingBids.map((b) => b.bidderId)]);
    // Also include anyone who has actually exchanged messages with this user
    // on this listing. This covers admins reaching out directly — an admin
    // is never the poster or a bidder, so without this the recipient would
    // have no way to see or reply to that conversation at all.
    const listingMessages = db.select().from(messages).where(eq(messages.listingId, listingId)).all();
    for (const m of listingMessages) {
      if (m.senderId === userId) participantIds.add(m.recipientId);
      if (m.recipientId === userId) participantIds.add(m.senderId);
    }
    participantIds.delete(userId);
    const result: { id: number; name: string }[] = [];
    for (const id of Array.from(participantIds)) {
      const u = await this.getUser(id);
      if (u) result.push({ id: u.id, name: u.name });
    }
    return result;
  }

  async getConversation(listingId: number, userId: number, otherUserId: number): Promise<Message[]> {
    const rows = db.select().from(messages).where(eq(messages.listingId, listingId)).orderBy(messages.createdAt).all();
    // If one of the two parties here is the poster, the other is (or stands in
    // for) the bidder whose thread this is — so also pull in any admin message
    // tagged onto that same thread, even though its literal sender/recipient
    // pair wasn't this exact (userId, otherUserId) pair.
    const listing = await this.getListing(listingId);
    const posterId = listing?.userId;
    const threadBidderId =
      posterId != null ? (userId === posterId ? otherUserId : otherUserId === posterId ? userId : undefined) : undefined;
    return rows.filter(
      (m) =>
        (m.senderId === userId && m.recipientId === otherUserId) ||
        (m.senderId === otherUserId && m.recipientId === userId) ||
        (threadBidderId !== undefined && m.threadBidderId === threadBidderId)
    );
  }

  /** Every message on a listing, across all conversation pairs — admin-only,
   *  for moderation. Regular participants use getConversation instead, which
   *  is scoped to threads they're actually part of. */
  async getAllMessagesForListing(listingId: number): Promise<Message[]> {
    return db.select().from(messages).where(eq(messages.listingId, listingId)).orderBy(messages.createdAt).all();
  }

  async sendMessage(listingId: number, senderId: number, recipientId: number, content: string): Promise<Message> {
    const masked = maskContact(content);
    const created = db
      .insert(messages)
      .values({
        listingId,
        senderId,
        recipientId,
        content,
        maskedContent: masked,
        createdAt: Date.now(),
      })
      .returning()
      .get();

    // Without this, a message only ever surfaces if the recipient happens to
    // reopen this exact listing's Messages tab themselves — there was no
    // signal that anything had arrived. Notify them the same way every other
    // listing event does.
    const [listing, sender] = await Promise.all([this.getListing(listingId), this.getUser(senderId)]);
    const preview = masked.length > 120 ? `${masked.slice(0, 117)}...` : masked;
    await this.createNotification(
      recipientId,
      "new_message",
      `New message from ${sender?.name ?? "someone"}`,
      listing ? `On "${listing.title}": ${preview}` : preview,
      listingId,
      senderId
    );

    return created;
  }

  /** Admin-only: post a message directly into an existing poster<->bidder
   *  thread (identified by the bidder's user id) rather than a private 1:1
   *  with a single recipient. Both the poster and the bidder see it in their
   *  shared conversation, and both get notified (whichever of them isn't the
   *  sender — the sender here is always the admin). */
  async sendThreadMessage(listingId: number, senderId: number, threadBidderId: number, content: string): Promise<Message> {
    const listing = await this.getListing(listingId);
    if (!listing) throw new Error("Listing not found");
    const masked = maskContact(content);
    const created = db
      .insert(messages)
      .values({
        listingId,
        senderId,
        recipientId: threadBidderId,
        content,
        maskedContent: masked,
        threadBidderId,
        createdAt: Date.now(),
      })
      .returning()
      .get();

    const sender = await this.getUser(senderId);
    const preview = masked.length > 120 ? `${masked.slice(0, 117)}...` : masked;
    const notifyIds = new Set<number>([listing.userId, threadBidderId]);
    notifyIds.delete(senderId);
    for (const uid of Array.from(notifyIds)) {
      // From each recipient's point of view, the "other party" in this thread
      // is whichever of {poster, bidder} they aren't — that's who tapping the
      // notification should open a reply box to, not the admin who relayed it.
      const otherPartyId = uid === listing.userId ? threadBidderId : listing.userId;
      await this.createNotification(
        uid,
        "new_message",
        `New message from ${sender?.name ?? "someone"}`,
        `On "${listing.title}": ${preview}`,
        listingId,
        otherPartyId
      );
    }

    return created;
  }

  async getFeeChargesForListing(listingId: number): Promise<FeeCharge[]> {
    return db.select().from(feeCharges).where(eq(feeCharges.listingId, listingId)).orderBy(desc(feeCharges.createdAt)).all();
  }

  /** Every fee charge platform-wide, regardless of who's involved — used by
   *  the admin wallet's "closed postings" transaction history. Each fee
   *  charge corresponds 1:1 to a bid that was accepted, so this is also the
   *  full list of "closed bids transacted" on the platform. */
  async getAllFeeCharges(): Promise<FeeCharge[]> {
    return db.select().from(feeCharges).orderBy(desc(feeCharges.createdAt)).all();
  }

  async getFeeChargesForUser(userId: number): Promise<FeeCharge[]> {
    const rows = db.select().from(feeCharges).all();
    return rows.filter((f) => f.posterId === userId || f.providerId === userId);
  }

  // ---------- Stripe fee-charge finalization (real-payments flow) ----------
  async finalizeFeeCharge(paymentIntentId: string): Promise<void> {
    stripeStorage.finalizeFeeCharge(paymentIntentId);
  }

  async failFeeCharge(paymentIntentId: string, _reason: string): Promise<void> {
    stripeStorage.failFeeCharge(paymentIntentId);
  }

  async syncFeeCharge(paymentIntentId: string): Promise<void> {
    await stripeStorage.syncFeeCharge(paymentIntentId);
  }

  // ---------- Notifications ----------
  async createNotification(
    userId: number,
    type: Notification["type"],
    title: string,
    body: string,
    relatedListingId?: number,
    relatedUserId?: number
  ): Promise<Notification> {
    return db
      .insert(notifications)
      .values({
        userId,
        type,
        title,
        body,
        relatedListingId: relatedListingId ?? null,
        relatedUserId: relatedUserId ?? null,
        read: false,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }

  async getNotificationsForUser(userId: number): Promise<Notification[]> {
    return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).all();
  }

  async markNotificationRead(id: number, userId: number): Promise<void> {
    db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).run();
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId)).run();
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const rows = db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.read, false))).all();
    return rows.length;
  }

  /** Admin broadcast: persists a durable record (for the public announcement
   *  board) and, if it's not scheduled for later, immediately posts the same
   *  notification to every registered user's inbox so it isn't missed even
   *  if they never visit the main page. A future `scheduledFor` instead
   *  leaves it unpublished — hidden from the public board and un-notified —
   *  until publishScheduledAnnouncements' sweep releases it. */
  async createAnnouncement(title: string, body: string, scheduledFor?: number): Promise<Announcement> {
    const now = Date.now();
    const isFuture = typeof scheduledFor === "number" && scheduledFor > now;
    const row = db
      .insert(announcements)
      .values({
        title,
        body,
        createdAt: now,
        scheduledFor: isFuture ? scheduledFor : null,
        publishedAt: isFuture ? null : now,
      })
      .returning()
      .get();

    if (!isFuture) {
      const allUsers = await this.getAllUsers();
      for (const u of allUsers) {
        await this.createNotification(u.id, "announcement", title, body);
      }
    }
    return row;
  }

  /** Public board feed — only announcements that have actually gone out,
   *  newest-published first. Excludes anything still waiting on its
   *  scheduledFor time. */
  async getAnnouncements(): Promise<Announcement[]> {
    return db
      .select()
      .from(announcements)
      .where(isNotNull(announcements.publishedAt))
      .orderBy(desc(announcements.publishedAt))
      .all();
  }

  /** Admin management list — every announcement regardless of publish state,
   *  newest-created first, so pending/scheduled ones are visible too. */
  async getAllAnnouncementsForAdmin(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(desc(announcements.createdAt)).all();
  }

  /** Edits an announcement's text and/or (while still pending) its schedule.
   *  Once an announcement has actually been published, its schedule is
   *  locked — only the title/body can still be corrected, and doing so does
   *  not re-notify anyone. Clearing/backdating scheduledFor on a still-pending
   *  announcement publishes it immediately rather than waiting for the next
   *  sweep. */
  async updateAnnouncement(
    id: number,
    patch: { title?: string; body?: string; scheduledFor?: number | null }
  ): Promise<Announcement> {
    const existing = db.select().from(announcements).where(eq(announcements.id, id)).get();
    if (!existing) throw new Error("Announcement not found");

    if (patch.scheduledFor !== undefined && existing.publishedAt) {
      throw new Error("This announcement has already been published — its schedule can't be changed");
    }

    const nextTitle = patch.title ?? existing.title;
    const nextBody = patch.body ?? existing.body;

    if (existing.publishedAt) {
      // Already out — only the text can still be corrected.
      db.update(announcements).set({ title: nextTitle, body: nextBody }).where(eq(announcements.id, id)).run();
      return db.select().from(announcements).where(eq(announcements.id, id)).get()!;
    }

    const nextScheduledFor = patch.scheduledFor === undefined ? existing.scheduledFor : patch.scheduledFor;
    const now = Date.now();
    const isFuture = typeof nextScheduledFor === "number" && nextScheduledFor > now;
    db.update(announcements)
      .set({ title: nextTitle, body: nextBody, scheduledFor: isFuture ? nextScheduledFor : null })
      .where(eq(announcements.id, id))
      .run();

    if (!isFuture) {
      // No schedule, or one that's already due — publish right now instead
      // of waiting for the next sweep.
      db.update(announcements).set({ publishedAt: now }).where(eq(announcements.id, id)).run();
      const allUsers = await this.getAllUsers();
      for (const u of allUsers) {
        await this.createNotification(u.id, "announcement", nextTitle, nextBody);
      }
    }

    return db.select().from(announcements).where(eq(announcements.id, id)).get()!;
  }

  /** Removes an announcement from the durable board/admin list. Any
   *  per-user notification rows already sent for it are left alone — those
   *  are independent inbox entries, not a live view of this row. */
  async deleteAnnouncement(id: number): Promise<void> {
    db.delete(announcements).where(eq(announcements.id, id)).run();
  }

  /** Public (non-admin) view of moderation status, for the main-page
   *  announcement board — deliberately excludes email/phone/password, only
   *  the name, current status, and reason are surfaced. */
  async getRestrictedUsers(): Promise<Pick<User, "id" | "name" | "status" | "restrictionReason" | "suspendedUntil">[]> {
    const rows = db
      .select()
      .from(users)
      .where(or(eq(users.status, "suspended"), eq(users.status, "banned")))
      .orderBy(desc(users.createdAt))
      .all();
    const now = Date.now();
    return rows
      // A suspension that's already past its end time hasn't necessarily been
      // lazily flipped back to "active" in the DB yet (that only happens the
      // next time the affected user logs in or makes a request) — don't show
      // it as still-restricted on the public board in the meantime.
      .filter((u) => u.status === "banned" || u.suspendedUntil == null || u.suspendedUntil > now)
      .map((u) => ({
        id: u.id,
        name: u.name,
        status: u.status,
        restrictionReason: u.restrictionReason,
        suspendedUntil: u.suspendedUntil,
      }));
  }
}

export const storage = new DatabaseStorage();

/** Auto-closes any "live" listing whose expiresAt has passed without
 *  reaching its target headcount of accepted bids — this is what backs the
 *  copy on the "Post a Lobang" form ("the posting stays open for 7 days, or
 *  until you've accepted that many bids, whichever earlier"). expiresAt
 *  defaults to createdAt + 7 days but an admin can push it out further via
 *  extendListing below. Rows that predate the expiresAt column (null) fall
 *  back to the old createdAt + 7 days cutoff. Rejects any bids still pending
 *  on it, same as when a listing closes normally by reaching quota (see
 *  rejectOtherPendingBids above), and lets the poster know why it closed.
 *  Safe to call repeatedly — only touches listings that are still "live"
 *  and past their cutoff. */
export async function closeExpiredListings(): Promise<void> {
  const now = Date.now();
  const legacyCutoff = now - SEVEN_DAYS_MS;
  const stale = db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.status, "live"),
        or(lte(listings.expiresAt, now), and(isNull(listings.expiresAt), lte(listings.createdAt, legacyCutoff)))
      )
    )
    .all();

  for (const listing of stale) {
    db.update(listings).set({ status: "closed" }).where(eq(listings.id, listing.id)).run();
    rejectOtherPendingBids(listing.id);
    await storage.createNotification(
      listing.userId,
      "listing_expired",
      "Your posting closed after 7 days",
      `"${listing.title}" reached its 7-day open window without enough bids accepted, so it's now closed. Post again if you still need this.`,
      listing.id
    );
  }
}

/** Runs closeExpiredListings() once immediately on boot (in case the server
 *  was down when a listing crossed the 7-day mark) and then on a recurring
 *  hourly timer for the rest of the process's life. Errors are caught and
 *  logged rather than thrown — a missed sweep just means the next one an
 *  hour later catches it instead, rather than crashing the whole server. */
export function startListingExpiryScheduler(): void {
  const sweep = () => {
    closeExpiredListings().catch((err) => console.error("closeExpiredListings failed:", err));
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000);
}

/** Releases any announcement whose scheduledFor time has arrived but that
 *  hasn't been published yet: marks it published and fans the notification
 *  out to every user, exactly like an immediate announcement would've gotten
 *  on creation. Safe to call repeatedly — only touches still-pending rows
 *  past their release time. */
export async function publishScheduledAnnouncements(): Promise<void> {
  const now = Date.now();
  const due = db
    .select()
    .from(announcements)
    .where(and(isNull(announcements.publishedAt), lte(announcements.scheduledFor, now)))
    .all();

  for (const a of due) {
    db.update(announcements).set({ publishedAt: now }).where(eq(announcements.id, a.id)).run();
    const allUsers = await storage.getAllUsers();
    for (const u of allUsers) {
      await storage.createNotification(u.id, "announcement", a.title, a.body);
    }
  }
}

/** Runs publishScheduledAnnouncements() once immediately on boot (in case the
 *  server was down when a scheduled announcement's release time passed) and
 *  then every minute for the rest of the process's life — announcements are
 *  scheduled to specific times, so this needs finer granularity than the
 *  hourly listing-expiry sweep above. */
export function startAnnouncementScheduler(): void {
  const sweep = () => {
    publishScheduledAnnouncements().catch((err) => console.error("publishScheduledAnnouncements failed:", err));
  };
  sweep();
  setInterval(sweep, 60 * 1000);
}
