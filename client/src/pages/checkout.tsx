import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Loader2, CheckCircle2, XCircle } from "lucide-react";
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
            <CheckoutForm listingId={intent.listingId} />
          </Elements>
        </CardContent>
      </Card>
    </div>
  );
}

function CheckoutForm({ listingId }: { listingId: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  // Fallback finalizer in case the Stripe webhook hasn't (yet) caught this —
  // mirrors the same call the old inline dialog used to make. This tab isn't
  // the one showing the listing, so there's no local listing-fee queries to
  // invalidate here; the listing tab picks up the change via its own poll.
  const syncMutation = useMutation({
    mutationFn: async (paymentIntentId: string) => {
      await apiRequest("POST", `/api/stripe/sync/${paymentIntentId}`, {});
    },
  });

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      // Card confirms inline and never needs this, but redirect-based methods
      // (PayNow, bank redirects, etc.) require a return_url even when
      // redirect is "if_required" — without one Stripe can't hand control
      // back to this tab after the out-of-band confirmation step.
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    setSubmitting(false);
    if (confirmError) {
      setError(confirmError.message || "Could not charge your card. Please try again.");
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      syncMutation.mutate(paymentIntent.id);
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/fees`] });
      setSucceeded(true);
    } else {
      setError("Payment is still processing — this can take a moment.");
    }
  };

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
      <PaymentElement />
      {error && (
        <p className="text-sm text-destructive" data-testid="text-checkout-error">
          {error}
        </p>
      )}
      <Button
        className="w-full"
        onClick={handleConfirm}
        disabled={!stripe || !elements || submitting}
        data-testid="button-confirm-checkout"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
        {submitting ? "Charging..." : "Pay platform fee"}
      </Button>
    </div>
  );
}
