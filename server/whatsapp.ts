/**
 * WhatsApp OTP layer for LobangLah! sign-up phone verification.
 *
 * Uses Twilio's WhatsApp Business API to deliver a 6-digit code. This module
 * is inert (falls back to a simulated/dev mode) until all three env vars are
 * set:
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_WHATSAPP_FROM   (e.g. "whatsapp:+14155238886" — a WhatsApp-enabled
 *                             Twilio sender, either the sandbox number or a
 *                             production number approved by Meta)
 *
 * In simulated/dev mode no real WhatsApp message is sent — the OTP is logged
 * server-side and also returned to the frontend (clearly labelled "dev mode")
 * so registration can still be tested end-to-end before real credentials are
 * connected. This mirrors how server/stripe.ts falls back to a simulated fee
 * charge until STRIPE_SECRET_KEY is set.
 */

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

export const whatsappEnabled = Boolean(accountSid && authToken && whatsappFrom);

/** Sends a WhatsApp OTP message. Resolves silently in simulated mode. */
export async function sendWhatsappOtp(toE164Phone: string, code: string): Promise<void> {
  if (!whatsappEnabled) {
    console.log(`[whatsapp:simulated] Would send OTP ${code} to ${toE164Phone} via WhatsApp.`);
    return;
  }

  const body = new URLSearchParams({
    From: whatsappFrom as string,
    To: `whatsapp:${toE164Phone}`,
    Body: `Your LobangLah! verification code is ${code}. It expires in 10 minutes. Don't share this code with anyone.`,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Could not send WhatsApp OTP (Twilio ${resp.status}): ${text || "unknown error"}`);
  }
}

/**
 * Normalizes a Singapore mobile/landline number to E.164 (+65XXXXXXXX).
 * Accepts input with or without "+65", spaces, or dashes. Returns null if the
 * number isn't a plausible 8-digit SG number (mobiles start with 8/9,
 * landlines with 6).
 */
export function normalizeSgPhone(raw: string): string | null {
  let digits = raw.replace(/[\s-]/g, "");
  if (digits.startsWith("+65")) digits = digits.slice(3);
  else if (digits.startsWith("65") && digits.length === 10) digits = digits.slice(2);
  else if (digits.startsWith("+")) return null;

  if (!/^[689]\d{7}$/.test(digits)) return null;
  return `+65${digits}`;
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
