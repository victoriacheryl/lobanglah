import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";

/**
 * Data Protection Policy — references Singapore's Personal Data Protection
 * Act (PDPA) and the Personal Data Protection Commission (PDPC), the
 * regulator that administers it. Content is grounded in what this app
 * actually collects and does (see server/whatsapp.ts, server/email.ts,
 * server/stripe.ts, shared/schema.ts) rather than generic boilerplate.
 *
 * This is a drafted starting point, not legal advice — see the notice at
 * the top of the page itself. Before publishing, it should be reviewed by
 * a qualified lawyer or data protection professional to confirm it
 * accurately reflects LobangLah!'s practices and satisfies its PDPA
 * obligations (e.g. registering a Data Protection Officer with the PDPC,
 * a formal data breach response plan, etc. — none of which this page can
 * substitute for).
 */
export default function DataProtectionPolicy() {
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1 flex items-center gap-2" data-testid="text-page-title">
          <ShieldCheck className="h-5 w-5 text-accent" /> Data Protection Policy
        </h1>
        <p className="text-sm text-muted-foreground">Last updated 22 Jul 2026.</p>
      </div>

      <div className="space-y-5 text-sm text-foreground/90">
        <p>
          LobangLah! ("we", "us", "our") connects Singapore residents to seek or offer local services and goods. This
          policy explains what personal data we collect through the app, why, how it's used and shared, and the
          rights you have over it under the PDPA. By creating an account or using LobangLah!, you acknowledge this
          policy.
        </p>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">1. What we collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Account details:</strong> name, email address, mobile number, and a password (stored only as a
              salted, one-way hash — we never see or store your actual password).
            </li>
            <li>
              <strong>Listings and bids:</strong> the title, description, category, location, and price of anything
              you post or bid on.
            </li>
            <li>
              <strong>Messages:</strong> the content of messages you send other users through the app.
            </li>
            <li>
              <strong>Payment information:</strong> when a platform fee is charged, card or PayNow payment details
              are collected and processed directly by Stripe, our payment processor — we never receive or store your
              full card number.
            </li>
            <li>
              <strong>Communications with us:</strong> anything you send via the Contact Us form or by emailing us
              directly.
            </li>
            <li>
              <strong>Session data:</strong> a session token stored on your device so you stay signed in, and basic
              request metadata (e.g. timestamps) generated as part of normal operation.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">2. Why we collect it</h2>
          <p>We collect and use personal data only for purposes you'd reasonably expect from using a services marketplace:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Creating and verifying your account (phone number via a WhatsApp one-time code, email via a confirmation link).</li>
            <li>Letting you post listings and bids, and matching posters with providers.</li>
            <li>Enabling in-app messaging between a poster and a bidder without exposing contact details upfront.</li>
            <li>Processing the platform fee once a bid is accepted, and releasing contact details between the poster and the accepted provider only at that point.</li>
            <li>Content moderation — an admin reviews new listings before they go live, and can access messages on a listing for trust & safety purposes.</li>
            <li>Sending you service notifications (bid updates, messages, payment confirmations, admin announcements).</li>
            <li>Responding to support enquiries sent via Contact Us or email.</li>
            <li>Detecting fraud, abuse of the platform's rules (e.g. exchanging contact details before a bid is accepted), and enforcing account suspensions or bans where necessary.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">3. Who we share it with</h2>
          <p>We don't sell your personal data. It's shared only as needed to run the service:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Other users:</strong> your name is visible on listings/bids you post; your phone number is only revealed to the specific other party in an accepted, fee-paid bid.</li>
            <li><strong>Twilio</strong> (WhatsApp Business API), to deliver your sign-up verification code.</li>
            <li><strong>Resend</strong>, to deliver email verification links and account-related emails.</li>
            <li><strong>Stripe</strong>, to process platform fee payments — subject to Stripe's own privacy policy.</li>
            <li><strong>LobangLah! admins</strong>, for listing approval and moderation of reported issues.</li>
            <li>Where required by law, regulation, or a valid legal process.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">4. How long we keep it</h2>
          <p>
            We retain account and transaction data for as long as your account is active, and for a reasonable period
            afterward where needed for record-keeping, dispute resolution, or legal/accounting obligations. If you
            delete your account (or an admin does so on your request), your listings, bids, and messages are removed;
            some transaction records may be retained where we're legally required to.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">5. Your rights</h2>
          <p>Under the PDPA, you can:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Ask what personal data we hold about you and how it's been used or disclosed.</li>
            <li>Ask us to correct inaccurate or outdated personal data.</li>
            <li>Withdraw consent for us to continue collecting, using, or disclosing your personal data (which may mean we can no longer provide some or all of the service to you).</li>
          </ul>
          <p>
            To exercise any of these, email{" "}
            <a href="mailto:hello@lobanglah.sg" className="text-primary font-medium">hello@lobanglah.sg</a>. We'll
            respond within a reasonable time.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">6. Security</h2>
          <p>
            We use industry-standard measures to protect personal data — passwords are never stored in plain text,
            connections to the app are encrypted in transit, and access to user data is restricted to what's needed
            for the service to function (e.g. admin moderation tools). No method of storage or transmission is 100%
            secure, and we can't guarantee absolute security.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">7. Local storage</h2>
          <p>
            We use your browser's local storage to keep a session token and basic profile info so you stay signed
            in between visits. We don't use third-party advertising trackers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">8. Changes to this policy</h2>
          <p>
            We may update this policy from time to time as the service changes. Material changes will be announced
            in-app (see the Announcement Board on the home page) or by email where appropriate.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">9. Contact us / complaints</h2>
          <p>
            Questions, requests, or concerns about how we handle your personal data can be sent to{" "}
            <a href="mailto:hello@lobanglah.sg" className="text-primary font-medium">hello@lobanglah.sg</a>. If
            you're not satisfied with our response, you may lodge a complaint with the{" "}
            <a
              href="https://www.pdpc.gov.sg"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium"
            >
              Personal Data Protection Commission (PDPC)
            </a>
            , Singapore's data protection regulator.
          </p>
        </section>
      </div>

      <p className="text-xs text-muted-foreground pt-2 border-t border-border">
        <Link href="/register" className="text-primary font-medium">Back to sign up</Link>
      </p>
    </div>
  );
}
