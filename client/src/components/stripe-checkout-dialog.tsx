import { useState } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";
import { getStripe } from "@/lib/stripe";
import { formatSGD } from "@/lib/format";

/**
 * Opens right after a poster accepts a bid when Stripe is configured. Collects
 * card details via Stripe's PaymentElement and confirms the automatic-capture
 * PaymentIntent created by the backend — this charges the small platform fee
 * immediately. The job payment itself is arranged directly with the provider.
 */
export function StripeCheckoutDialog({
  open,
  onOpenChange,
  clientSecret,
  publishableKey,
  amount,
  onAuthorized,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientSecret: string;
  publishableKey: string;
  amount: number;
  onAuthorized: (paymentIntentId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-stripe-checkout">
        <DialogHeader>
          <DialogTitle>Charge {formatSGD(amount)} platform fee</DialogTitle>
          <DialogDescription>
            This is LobangLah!'s platform fee for accepting this bid — charged once, right now. Pay the provider for
            the job itself directly (cash, PayNow, or bank transfer).
          </DialogDescription>
        </DialogHeader>
        <Elements stripe={getStripe(publishableKey)} options={{ clientSecret }}>
          <CheckoutForm clientSecret={clientSecret} onAuthorized={onAuthorized} onCancel={() => onOpenChange(false)} />
        </Elements>
      </DialogContent>
    </Dialog>
  );
}

function CheckoutForm({
  clientSecret,
  onAuthorized,
  onCancel,
}: {
  clientSecret: string;
  onAuthorized: (paymentIntentId: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    setSubmitting(false);
    if (confirmError) {
      setError(confirmError.message || "Could not charge your card. Please try again.");
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      onAuthorized(paymentIntent.id);
    } else {
      setError("Payment is still processing — this can take a moment.");
    }
  };

  return (
    <div className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive" data-testid="text-checkout-error">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={submitting} data-testid="button-cancel-checkout">
          Cancel
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={!stripe || !elements || submitting}
          data-testid="button-confirm-checkout"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
          {submitting ? "Charging..." : "Pay platform fee"}
        </Button>
      </div>
    </div>
  );
}
