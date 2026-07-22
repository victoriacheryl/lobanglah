import { Link } from "wouter";
import { FileText } from "lucide-react";

/**
 * Terms of Use — grounded in how LobangLah! actually operates: a listings/
 * bidding marketplace with no escrow (server/stripe.ts docblock), a platform
 * fee charged to the poster on bid acceptance, contact details withheld
 * until then (see the "no exchanging contact details" announcement copy and
 * server/storage.ts's maskContact), admin listing review + moderation, and
 * the 7-day auto-close rule (server/storage.ts closeExpiredListings).
 *
 * Like data-protection-policy.tsx, this is a drafted starting point, not
 * legal advice — see the notice at the top of the page.
 */
export default function TermsOfUse() {
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1 flex items-center gap-2" data-testid="text-page-title">
          <FileText className="h-5 w-5 text-accent" /> Terms of Use
        </h1>
        <p className="text-sm text-muted-foreground">Last updated 22 Jul 2026.</p>
      </div>

      <div className="space-y-5 text-sm text-foreground/90">
        <p>
          These Terms of Use ("Terms") govern your access to and use of LobangLah! ("we", "us", "our"), a platform
          connecting Singapore residents to seek or offer local services and goods. By creating an account or using
          LobangLah!, you agree to these Terms. If you don't agree, please don't use the platform. See also our{" "}
          <Link href="/data-protection-policy" className="text-primary font-medium">Data Protection Policy</Link>,
          which explains how we handle your personal data.
        </p>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">1. What LobangLah! is (and isn't)</h2>
          <p>
            LobangLah! is a matching platform: it lets posters describe a service or good they need or are offering,
            and lets other users bid on that posting. We are not a party to any arrangement between a poster and a
            provider, and we don't guarantee the quality, safety, legality, or outcome of any job or transaction
            arranged through the platform. There is no escrow — the poster and provider settle payment for the job
            itself directly between themselves, outside the app (cash, PayNow, bank transfer, etc.). The only
            payment LobangLah! ever collects is its own platform fee, described below.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">2. Accounts</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>You must provide accurate name, email, and mobile number details, and verify both before your account is created.</li>
            <li>You're responsible for keeping your password confidential and for all activity under your account.</li>
            <li>One account per person. Accounts are for genuine, personal or small-business use of the marketplace, not for spam, scraping, or automated posting.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">3. Listings and bids</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Every listing is reviewed by an admin before it goes live, and may be rejected if it doesn't meet our guidelines.</li>
            <li>A live listing stays open for 7 days, or until the poster has accepted as many bids as they specified, whichever happens first — after which it auto-closes. An admin may extend a listing's closing date at their discretion.</li>
            <li>Listing and bid content must be accurate and lawful. Don't post anything false, misleading, illegal, infringing, or for a prohibited good or service.</li>
            <li>Accepting a bid is a decision made solely by the poster; LobangLah! doesn't select bids on anyone's behalf.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">4. Platform fee and payments</h2>
          <p>
            When a poster accepts a bid, LobangLah! charges a platform fee — the greater of S$5 or 10% of the bid
            amount — to the poster. This fee is processed by Stripe (card or PayNow) and is separate from, and does
            not cover, the cost of the job itself. Once the fee is paid, each party's contact details (name and
            mobile number) are released so they can arrange the job directly. The fee is for use of the matching
            service and, except where required by law or at our discretion, is non-refundable once paid.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">5. Contact details and platform conduct</h2>
          <p>
            To keep the matching process fair and safe, don't exchange phone numbers, email addresses, or other
            contact details with another user before a bid has been accepted and the platform fee paid — messages
            are automatically screened for this. Users found repeatedly flouting this rule, or otherwise abusing,
            harassing, defrauding, or attempting to circumvent the platform, may have their account suspended or
            banned at our discretion, with or without notice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">6. Moderation</h2>
          <p>
            Admins may review, approve, reject, close, or remove listings and bids, and may access messages on a
            listing for trust & safety purposes, in order to enforce these Terms and keep the platform usable and
            safe. We may suspend or terminate an account that violates these Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">7. Disclaimers and limitation of liability</h2>
          <p>
            LobangLah! is provided "as is". We don't vet users' qualifications, licenses, or the quality of work
            performed off-platform, and we're not responsible for disputes, losses, or damages arising from an
            arrangement between a poster and a provider. To the fullest extent permitted by law, LobangLah! and its
            operators aren't liable for any indirect, incidental, or consequential loss arising from your use of the
            platform, and our total liability for any claim is limited to the platform fees you've paid in the 3
            months before the claim arose.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">8. Termination</h2>
          <p>
            You may stop using LobangLah! and request deletion of your account at any time by emailing us. We may
            suspend or terminate access to the platform for any account that violates these Terms, engages in fraud
            or abuse, or where we're required to do so by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">9. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time as the service changes. Material changes will be announced
            in-app (see the Announcement Board on the home page) or by email where appropriate. Continued use of
            LobangLah! after a change takes effect means you accept the updated Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">10. Governing law</h2>
          <p>These Terms are governed by the laws of Singapore, and any dispute arising from them is subject to the exclusive jurisdiction of the Singapore courts.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">11. Contact us</h2>
          <p>
            Questions about these Terms can be sent to{" "}
            <a href="mailto:hello@lobanglah.sg" className="text-primary font-medium">hello@lobanglah.sg</a>.
          </p>
        </section>
      </div>

      <p className="text-xs text-muted-foreground pt-2 border-t border-border">
        <Link href="/register" className="text-primary font-medium">Back to sign up</Link>
      </p>
    </div>
  );
}
