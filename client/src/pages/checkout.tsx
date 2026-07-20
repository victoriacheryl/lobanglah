import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Loader2, CheckCircle2, XCircle, QrCode } from "lucide-react";
import { formatSGD } from "@/lib/format";

interface StripeIntentResult {
  clientSecret: string;
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
 * loads — no button press, and no Stripe-hosted popup/modal. Split
 * card-number/expiry/CVC fields (Stripe's classic Checkout-style layout)
 * below as the alternative.
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
 * PayNow is also NOT shown via <PaymentElement /> — that component decides
 * which payment methods to surface using its own IP-derived customer-country
 * check, separate from whatever's allowed on the PaymentIntent itself, and
 * that check has been unreliable for PayNow even from genuinely
 * Singapore-based connections. Calling stripe.confirmPayNowPayment directly
 * always renders the QR code regardless of that check.
 *
 * Card still goes through split Card elements + stripe.confirmCardPayment,
 * which never had this problem — Card is never geo-filtered.
 */
export default function Checkout() {
  const { feeChargeId } = useParams<{ feeChargeId: string }>();
  const { user } = useAuth();

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
          <Elements stripe={getStripe(config.stripePublishableKey)} options={{ clientSecret: intent.clientSecret }}>
            <CheckoutForm listingId={intent.listingId} clientSecret={intent.clientSecret} />
          </Elements>
        </CardContent>
      </Card>
    </div>
  );
}

// Split Card elements render inside their own cross-origin iframes, so they
// can't read this page's CSS custom properties — colors have to be literal
// values that roughly match --foreground / --muted-foreground for each
// theme (see index.css), otherwise the text is unreadable (e.g. dark-on-dark).
const CARD_ELEMENT_COLORS: Record<"light" | "dark", { text: string; placeholder: string; icon: string }> = {
  light: { text: "#242a3d", placeholder: "#8890a3", icon: "#6b7280" },
  dark: { text: "#e8eaf3", placeholder: "#a3a8b8", icon: "#a3a8b8" },
};

interface PayNowQrCode {
  imageUrl: string;
  hostedInstructionsUrl?: string;
}

function CheckoutForm({ listingId, clientSecret }: { listingId: number; clientSecret: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const { theme } = useTheme();
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
    const cardNumberElement = elements.getElement(CardNumberElement);
    if (!cardNumberElement) return;
    setCardSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardNumberElement },
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
      clientSecret,
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
      const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
      if (paymentIntent?.status === "succeeded") {
        finalize(paymentIntent.id);
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNowQr, stripe, succeeded, clientSecret]);

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

  const elementStyle = {
    base: {
      fontSize: "16px",
      color: CARD_ELEMENT_COLORS[theme].text,
      iconColor: CARD_ELEMENT_COLORS[theme].icon,
      "::placeholder": { color: CARD_ELEMENT_COLORS[theme].placeholder },
    },
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <QrCode className="h-4 w-4" /> Pay with PayNow
        </div>

        {payNowLoading && !payNowQr && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading QR code...</p>
          </div>
        )}

        {payNowQr && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-4">
            <img
              src={payNowQr.imageUrl}
              alt="PayNow QR code"
              className="h-48 w-48 rounded-md bg-white p-2"
              data-testid="img-paynow-qr"
            />
            <p className="text-sm text-muted-foreground text-center">
              Scan this with your banking or payment app to complete this payment.
            </p>
          </div>
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

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div className="text-sm font-medium">Pay with card</div>
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Card number</label>
            <div className="rounded-md border border-border px-3 py-2">
              <CardNumberElement options={{ style: elementStyle }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Expiry</label>
              <div className="rounded-md border border-border px-3 py-2">
                <CardExpiryElement options={{ style: elementStyle }} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">CVC</label>
              <div className="rounded-md border border-border px-3 py-2">
                <CardCvcElement options={{ style: elementStyle }} />
              </div>
            </div>
          </div>
        </div>
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
