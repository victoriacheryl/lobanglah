import { useEffect, useRef, useState } from "react";
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
 * Layout: PayNow QR code up top (fired automatically on load, no button
 * press needed to see it), plain Stripe card fields below as the
 * alternative. PayNow is confirmed directly via stripe.confirmPayNowPayment
 * rather than <PaymentElement /> — Payment Element decides which methods to
 * surface using its own IP-derived customer-country check, separate from
 * whatever's allowed on the PaymentIntent itself, and that check has been
 * unreliable for PayNow even from genuinely Singapore-based connections.
 * Calling stripe.confirmPayNowPayment directly (Stripe's "Direct API"
 * integration) always shows the QR code regardless of that check. Card
 * still goes through the plain CardElement + stripe.confirmCardPayment,
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
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const [payNowSubmitting, setPayNowSubmitting] = useState(false);
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
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;
    setCardSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement },
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

  async function handlePayNow() {
    if (!stripe) return;
    setPayNowSubmitting(true);
    setError(null);
    // Shows Stripe's own modal with the PayNow QR code and resolves once the
    // customer scans it and their bank confirms (or they close the modal).
    // Unlike confirmCardPayment, this call doesn't auto-create a payment
    // method from nothing — it needs an explicit (even empty) payment_method
    // object, or Stripe rejects it with "none was provided".
    const { error: confirmError, paymentIntent } = await stripe.confirmPayNowPayment(clientSecret, {
      payment_method: {},
    });
    setPayNowSubmitting(false);
    if (confirmError) {
      setError(confirmError.message || "PayNow payment wasn't completed. Please try again.");
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      finalize(paymentIntent.id);
    }
    // If neither succeeded nor errored, the customer just closed the QR
    // modal without paying — leave the "Show PayNow QR code" button so they
    // can bring it back up whenever they're ready, no error shown.
  }

  // Show the PayNow QR code immediately on load — no button press needed —
  // the moment Stripe.js is ready. The guard ref keeps this from firing
  // twice (e.g. React re-renders) since each call opens a new QR modal.
  useEffect(() => {
    if (!stripe || payNowFiredRef.current) return;
    payNowFiredRef.current = true;
    handlePayNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe]);

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
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <QrCode className="h-4 w-4" /> Pay with PayNow
        </div>
        <p className="text-sm text-muted-foreground" data-testid="text-paynow-hint">
          Scan the QR code with your banking or payment app to complete this payment.
        </p>
        <Button
          className="w-full"
          variant="outline"
          onClick={handlePayNow}
          disabled={!stripe || payNowSubmitting}
          data-testid="button-confirm-paynow"
        >
          {payNowSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
          {payNowSubmitting ? "Opening QR code..." : "Show PayNow QR code"}
        </Button>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div className="text-sm font-medium">Pay with card</div>
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
