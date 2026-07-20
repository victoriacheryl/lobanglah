import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Loader2, CheckCircle2, XCircle, CreditCard, QrCode } from "lucide-react";
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
 * Deliberately NOT using <PaymentElement /> here: that component decides
 * which payment methods to surface using its own IP-derived customer-country
 * check, on top of (and separate from) whatever's allowed on the
 * PaymentIntent itself. That check has been unreliable for PayNow even from
 * genuinely Singapore-based connections. Since the PaymentIntent is already
 * pinned server-side to allow exactly Card + PayNow (see server/stripe.ts),
 * this instead renders two explicit buttons and confirms each one directly
 * via stripe.confirmCardPayment / stripe.confirmPayNowPayment — the lower-
 * level "Direct API" integration Stripe documents for exactly this case —
 * so both methods are always shown regardless of what Stripe's Element
 * thinks the customer's location is.
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

type Method = "card" | "paynow";

// CardElement renders inside its own cross-origin iframe, so it can't read
// this page's CSS custom properties — colors have to be literal values that
// roughly match --foreground / --muted-foreground for each theme (see
// index.css), otherwise the text is unreadable (e.g. dark-on-dark).
const CARD_ELEMENT_COLORS: Record<"light" | "dark", { text: string; placeholder: string }> = {
  light: { text: "#242a3d", placeholder: "#8890a3" },
  dark: { text: "#e8eaf3", placeholder: "#a3a8b8" },
};

function CheckoutForm({ listingId, clientSecret }: { listingId: number; clientSecret: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const { theme } = useTheme();
  const [method, setMethod] = useState<Method>("card");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [awaitingPayNowScan, setAwaitingPayNowScan] = useState(false);

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
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;
    setSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement },
    });
    setSubmitting(false);
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

  async function handlePayNow() {
    if (!stripe) return;
    setSubmitting(true);
    setError(null);
    setAwaitingPayNowScan(true);
    // Shows Stripe's own modal with the PayNow QR code and resolves once the
    // customer scans it and their bank confirms (or they close the modal).
    const { error: confirmError, paymentIntent } = await stripe.confirmPayNowPayment(clientSecret);
    setSubmitting(false);
    setAwaitingPayNowScan(false);
    if (confirmError) {
      setError(confirmError.message || "PayNow payment wasn't completed. Please try again.");
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      finalize(paymentIntent.id);
    } else {
      setError("Payment wasn't completed — try again when you're ready to scan the QR code.");
    }
  }

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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setMethod("card");
            setError(null);
          }}
          className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
            method === "card" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
          }`}
          data-testid="button-method-card"
        >
          <CreditCard className="h-4 w-4" /> Card
        </button>
        <button
          type="button"
          onClick={() => {
            setMethod("paynow");
            setError(null);
          }}
          className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
            method === "paynow" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
          }`}
          data-testid="button-method-paynow"
        >
          <QrCode className="h-4 w-4" /> PayNow
        </button>
      </div>

      {method === "card" && (
        <div className="rounded-lg border border-border p-3">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: CARD_ELEMENT_COLORS[theme].text,
                  "::placeholder": { color: CARD_ELEMENT_COLORS[theme].placeholder },
                },
              },
            }}
          />
        </div>
      )}

      {method === "paynow" && (
        <p className="text-sm text-muted-foreground" data-testid="text-paynow-hint">
          {awaitingPayNowScan
            ? "Scan the QR code with your banking or payment app to complete this payment."
            : "You'll be shown a QR code to scan with your banking or payment app."}
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" data-testid="text-checkout-error">
          {error}
        </p>
      )}

      <Button
        className="w-full"
        onClick={method === "card" ? handlePayCard : handlePayNow}
        disabled={!stripe || submitting || (method === "card" && !elements)}
        data-testid="button-confirm-checkout"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
        {submitting ? "Processing..." : method === "card" ? "Pay with Card" : "Pay with PayNow"}
      </Button>
    </div>
  );
}
