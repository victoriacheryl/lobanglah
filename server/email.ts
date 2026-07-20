/**
 * Email verification layer for LobangLah! sign-up.
 *
 * Uses Resend's HTTP API (https://resend.com) to deliver a clickable
 * confirmation link — plain fetch() against their REST endpoint, no SDK
 * dependency, mirroring how server/whatsapp.ts talks to Twilio directly.
 * This module is inert (falls back to a simulated/dev mode) until both env
 * vars are set:
 *   - RESEND_API_KEY
 *   - EMAIL_FROM        (a sender address on a domain verified in your Resend
 *                         account, e.g. "LobangLah! <noreply@lobanglah.sg>")
 *
 * In simulated/dev mode no real email is sent — the verification URL is
 * logged server-side and also returned to the frontend (clearly labelled
 * "dev mode") so sign-up can still be tested end-to-end before real
 * credentials are connected.
 */

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;

export const emailEnabled = Boolean(resendApiKey && emailFrom);

/** Sends the "confirm your email" link. Resolves silently in simulated mode. */
export async function sendVerificationEmail(toEmail: string, verifyUrl: string): Promise<void> {
  if (!emailEnabled) {
    console.log(`[email:simulated] Would send verification link ${verifyUrl} to ${toEmail}.`);
    return;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom,
      to: toEmail,
      subject: "Confirm your email for LobangLah!",
      text: `Confirm your email to finish creating your LobangLah! account: ${verifyUrl}\n\nThis link expires in 30 minutes. If you didn't sign up for LobangLah!, you can ignore this email.`,
      html: `
        <p>Confirm your email to finish creating your LobangLah! account.</p>
        <p>
          <a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">
            Verify my email
          </a>
        </p>
        <p style="color:#666;font-size:13px;">This link expires in 30 minutes. If you didn't sign up for LobangLah!, you can ignore this email.</p>
        <p style="color:#666;font-size:13px;">Or paste this link into your browser: ${verifyUrl}</p>
      `,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Could not send verification email (Resend ${resp.status}): ${text || "unknown error"}`);
  }
}
