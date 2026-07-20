import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { formatSGD } from "@/lib/format";

interface StripeIntentResult {
  // Card-only PaymentIntent's client secret — drives <Elements>/<PaymentElement>.
  clientSecret: string;
  // Separate paynow-only PaymentIntent's client secret — passed directly to
  // stripe.confirmPayNowPayment, never rendered through <PaymentElement>. Two
  // distinct PaymentIntents (rather than one intent allowing both methods)
  // is what keeps PayNow from also showing up as a selectable tab inside the
  // card form below.
  paynowClientSecret: string;
  feeAmount: number;
  listingId: number;
}

/**
 * Standalone, full-page checkout — opened in a brand new browser tab (via
 * window.open) whenever the poster needs to pay the platform fee, instead of
 * showing the Stripe payment form inline in a modal on the listing page.
 * This tab is entirely self-sufficient: given just a fee charge id in the
 * URL, it fetches its own client secret and renders the real Stripe form.
 * There's deliberately no direct messaging back to the tab that opened this
 * one — the listing page already polls /api/listings/:id/fees every 3s while
 * a charge is pending, so it picks up the "paid" status on its own shortly
 * after this tab reports success.
 *
 * Layout: PayNow QR code rendered inline, right on the page, the moment it
 * loads — no button press, and no Stripe-hosted popup/modal — with the
 * original <PaymentElement /> card form (Stripe's standard, fully-styled
 * checkout UI) below as the alternative.
 *
 * PayNow is confirmed via stripe.confirmPayNowPayment with
 * `handleActions: false` rather than letting Stripe.js manage it — by
 * default that call pops its own modal dialog with the QR code, which is
 * the "window" this was built to avoid. With handleActions disabled, the
 * call instead returns the PaymentIntent's `next_action.paynow_display_qr_code`
 * object (image_url_png/svg + the raw QR data), which is rendered directly
 * as an <img> in the page layout, then polled via
 * stripe.retrievePaymentIntent until the customer's bank confirms.
 *
 * PayNow and Card are backed by two entirely separate PaymentIntents (see
 * server/stripe.ts's createFeeChargePaymentIntents), not one intent that
 * allows both methods. Stripe's <PaymentElement/> has no client-side option
 * to hide a payment method type that's allowed on its underlying
 * PaymentIntent — so a single shared intent listing both "card" and
 * "paynow" made PayNow render twice: once in this page's own QR panel, and
 * again as a selectable tab inside the Payment Element below. Scoping the
 * Payment Element to a card-only PaymentIntent, and driving the QR panel
 * from a separate paynow-only PaymentIntent via stripe.confirmPayNowPayment,
 * keeps each method appearing exactly once. Whichever one the poster
 * actually completes "wins" — the backend cancels the other PaymentIntent
 * once either succeeds, so the same fee can't be paid twice.
 *
 * Card goes through <PaymentElement /> + stripe.confirmPayment (Stripe's own
 * default styling, no custom fields) — Stripe's own polished, theme-aware UI
 * is "the original Stripe checkout format" being asked for here.
 */
export default function Checkout() {
  const { feeChargeId } = useParams<{ feeChargeId: string }>();
  const { user } = useAuth();
  const { theme } = useTheme();

  const { data: config, isLoading: configLoading } = useQuery<{ stripePublishableKey: string | null }>({
    queryKey: ["/api/config"],
  });

  const {
    data: intent,
    isLoading: intentLoading,
    error,
  } = useQuery<StripeIntentResult>({
    queryKey: [`/api/fees/${feeChargeId}/stripe-intent`],
    enabled: !!user && !!feeChargeId,
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        Log in to complete this payment.
      </div>
    );
  }

  if (configLoading || intentLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 space-y-4">
        <Skeleton className="h-8 w-2/3 mx-auto" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !intent) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="font-display text-lg flex items-center justify-center gap-1.5 text-destructive">
              <XCircle className="h-4 w-4" /> Could not load payment
            </CardTitle>
            <CardDescription data-testid="text-checkout-load-error">
              {(error as any)?.message || "This payment link is invalid or no longer available."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className="text-primary text-sm font-medium">
              Back to LobangLah!
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!config?.stripePublishableKey) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        Stripe isn't configured on this deployment.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="font-display text-lg">Charge {formatSGD(intent.feeAmount)} platform fee</CardTitle>
          <CardDescription>
            This is LobangLah!'s platform fee for accepting this bid — charged once, right now. Pay the provider for
            the job itself directly (cash, PayNow, or bank transfer).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Elements
            stripe={getStripe(config.stripePublishableKey)}
            options={{
              clientSecret: intent.clientSecret,
              // Stripe's built-in dark/light theming for PaymentElement,
              // rather than hand-styling individual card fields ourselves.
              appearance: { theme: theme === "dark" ? "night" : "stripe" },
            }}
          >
            <CheckoutForm listingId={intent.listingId} paynowClientSecret={intent.paynowClientSecret} />
          </Elements>
        </CardContent>
      </Card>
    </div>
  );
}

interface PayNowQrCode {
  imageUrl: string;
  hostedInstructionsUrl?: string;
}

/**
 * The real PayNow wordmark (bold "PAYNOW" with the O replaced by a
 * check-in-a-circle), same as what Stripe itself shows next to its PayNow
 * QR code — see the "PayNow" tab/badge in Stripe's own Payment Element and
 * on stripe.com/payment-method/paynow.
 *
 * Built from ordinary HTML text plus one small inline-SVG checkmark icon,
 * rather than a single SVG with hand-placed <text> elements — SVG <text>
 * doesn't reflow to its actual rendered glyph widths, so if a viewer's
 * browser substituted a different font than the one assumed when the x
 * coordinates were chosen, the "W" and the circle overlapped/misaligned
 * ("looks distorted"). Plain text laid out by the browser's own font
 * engine, with the circle as a fixed-size icon next to it, can't drift out
 * of alignment the same way.
 */
function PayNowLogo({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center font-extrabold tracking-tight ${className ?? ""}`}
      style={{ color: "#9B1B7E" }}
      role="img"
      aria-label="PayNow"
    >
      <span className="leading-none">PAYN</span>
      <svg viewBox="0 0 28 28" className="mx-[1px] h-[0.85em] w-[0.85em] shrink-0" aria-hidden="true">
        <circle cx="14" cy="14" r="12" fill="none" stroke="#9B1B7E" strokeWidth="3" />
        <path
          d="M8 14.5l4 4 8-9"
          fill="none"
          stroke="#9B1B7E"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="leading-none">W</span>
    </span>
  );
}

function CheckoutForm({
  listingId,
  paynowClientSecret,
}: {
  listingId: number;
  paynowClientSecret: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const [payNowLoading, setPayNowLoading] = useState(false);
  const [payNowQr, setPayNowQr] = useState<PayNowQrCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const payNowFiredRef = useRef(false);

  // Fallback finalizer in case the Stripe webhook hasn't (yet) caught this —
  // mirrors the same call the old inline dialog used to make. This tab isn't
  // the one showing the listing, so there's no local listing-fee queries to
  // invalidate here; the listing tab picks up the change via its own poll.
  const syncMutation = useMutation({
    mutationFn: async (paymentIntentId: string) => {
      await apiRequest("POST", `/api/stripe/sync/${paymentIntentId}`, {});
    },
  });

  function finalize(paymentIntentId: string) {
    syncMutation.mutate(paymentIntentId);
    queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/fees`] });
    setSucceeded(true);
  }

  async function handlePayCard() {
    if (!stripe || !elements) return;
    setCardSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      // Card confirms inline and never needs this, but it's required by the
      // confirmPayment call signature regardless.
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    setCardSubmitting(false);
    if (confirmError) {
      setError(confirmError.message || "Could not charge your card. Please try again.");
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      finalize(paymentIntent.id);
    } else {
      setError("Payment is still processing — this can take a moment.");
    }
  }

  async function loadPayNowQr() {
    if (!stripe) return;
    setPayNowLoading(true);
    setError(null);
    // handleActions: false stops Stripe.js from popping its own modal dialog
    // for the QR code — instead it hands back the PaymentIntent with the QR
    // image URL in next_action, which we render inline ourselves below.
    // Unlike confirmCardPayment, this call doesn't auto-create a payment
    // method from nothing — it needs an explicit (even empty) payment_method
    // object, or Stripe rejects it with "none was provided".
    const { error: confirmError, paymentIntent } = await stripe.confirmPayNowPayment(
      paynowClientSecret,
      { payment_method: {} },
      { handleActions: false }
    );
    setPayNowLoading(false);
    if (confirmError) {
      setError(confirmError.message || "Could not load the PayNow QR code. Please try again.");
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      finalize(paymentIntent.id);
      return;
    }
    // paynow_display_qr_code isn't in this SDK version's TS types yet, even
    // though it's a documented, stable field on the PaymentIntent's
    // next_action — see server/stripe.ts docblock reasoning for PayNow.
    const qrCode = (paymentIntent as any)?.next_action?.paynow_display_qr_code;
    if (qrCode?.image_url_png) {
      setPayNowQr({ imageUrl: qrCode.image_url_png, hostedInstructionsUrl: qrCode.hosted_instructions_url });
    } else {
      setError("Could not load the PayNow QR code. Please try again.");
    }
  }

  // Load the PayNow QR code immediately on page load — no button press
  // needed — the moment Stripe.js is ready. The guard ref keeps this from
  // firing twice (e.g. React re-renders).
  useEffect(() => {
    if (!stripe || payNowFiredRef.current) return;
    payNowFiredRef.current = true;
    loadPayNowQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe]);

  // While a QR code is showing, poll Stripe directly (not our own backend)
  // every 3s to notice as soon as the customer's bank confirms the payment —
  // this tab never gets a redirect back, so nothing else would tell it.
  useEffect(() => {
    if (!payNowQr || !stripe || succeeded) return;
    const interval = setInterval(async () => {
      const { paymentIntent } = await stripe.retrievePaymentIntent(paynowClientSecret);
      if (paymentIntent?.status === "succeeded") {
        finalize(paymentIntent.id);
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNowQr, stripe, succeeded, paynowClientSecret]);

  if (succeeded) {
    return (
      <div className="text-center space-y-3 py-4">
        <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
        <p className="font-medium" data-testid="text-checkout-success">Payment successful</p>
        <p className="text-sm text-muted-foreground">
          You can close this tab now — the listing will update on its own in a few seconds.
        </p>
        <Link href={`/listings/${listingId}`} className="text-primary text-sm font-medium inline-block">
          Back to listing
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-center border-b border-border bg-white px-4 py-3">
            <PayNowLogo className="text-2xl" />
          </div>

          <div className="flex flex-col items-center gap-2 bg-white p-4">
            {payNowLoading && !payNowQr && (
              <div className="flex flex-col items-center gap-2 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading QR code...</p>
              </div>
            )}

            {payNowQr && (
              <>
                <img
                  src={payNowQr.imageUrl}
                  alt="PayNow QR code"
                  className="h-48 w-48 rounded-md border border-border p-2"
                  data-testid="img-paynow-qr"
                />
                <p className="text-sm text-muted-foreground text-center">
                  Scan this with your banking or payment app to complete this payment.
                </p>
              </>
            )}

            {!payNowLoading && !payNowQr && (
              <Button
                className="w-full"
                variant="outline"
                onClick={loadPayNowQr}
                disabled={!stripe}
                data-testid="button-confirm-paynow"
              >
                Show PayNow QR code
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div className="text-sm font-medium">Pay with card</div>
        <PaymentElement />
        <Button
          className="w-full"
          onClick={handlePayCard}
          disabled={!stripe || !elements || cardSubmitting}
          data-testid="button-confirm-card"
        >
          {cardSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
          {cardSubmitting ? "Charging..." : "Pay with Card"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="text-checkout-error">
          {error}
        </p>
      )}
    </div>
  );
}
