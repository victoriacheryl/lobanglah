import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatSGD } from "@/lib/format";
import { CreditCard, QrCode, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FeeCharge } from "@shared/schema";

export function PaymentMethodDialog({
  open,
  onOpenChange,
  feeCharge,
  listingId,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feeCharge: FeeCharge;
  listingId: number;
  onPaid: () => void;
}) {
  const [method, setMethod] = useState<"paynow" | "card">("paynow");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const { toast } = useToast();

  const payMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/fees/${feeCharge.id}/pay`, { method });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/fees`] });
      toast({
        title: "Payment confirmed",
        description: `Platform fee of ${formatSGD(feeCharge.feeAmount)} paid via ${method === "paynow" ? "PayNow" : "card"}. Contact details are now visible.`,
      });
      onPaid();
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Payment failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-payment-method">
        <DialogHeader>
          <DialogTitle>Settle the platform fee</DialogTitle>
          <DialogDescription>
            Pay {formatSGD(feeCharge.feeAmount)} now to confirm this bid. Contact details will be shared with the
            provider right after payment.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={method} onValueChange={(v) => setMethod(v as "paynow" | "card")} className="space-y-2">
          <label
            htmlFor="method-paynow"
            className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              method === "paynow" ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <RadioGroupItem value="paynow" id="method-paynow" data-testid="radio-paynow" />
            <QrCode className="h-5 w-5 text-accent shrink-0" />
            <div>
              <p className="text-sm font-medium">PayNow</p>
              <p className="text-xs text-muted-foreground">Scan the QR with your banking app</p>
            </div>
          </label>
          <label
            htmlFor="method-card"
            className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              method === "card" ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <RadioGroupItem value="card" id="method-card" data-testid="radio-card" />
            <CreditCard className="h-5 w-5 text-accent shrink-0" />
            <div>
              <p className="text-sm font-medium">Credit / debit card</p>
              <p className="text-xs text-muted-foreground">Visa, Mastercard, Amex</p>
            </div>
          </label>
        </RadioGroup>

        {method === "paynow" ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <div
              data-testid="img-paynow-qr"
              className="h-36 w-36 rounded-lg border border-dashed border-border flex items-center justify-center bg-secondary/40"
            >
              <QrCode className="h-16 w-16 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">Demo QR — click confirm to simulate a completed PayNow payment.</p>
          </div>
        ) : (
          <div className="space-y-2 py-1">
            <Label htmlFor="input-card-number" className="text-xs">
              Card number (demo)
            </Label>
            <Input
              id="input-card-number"
              data-testid="input-card-number"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="4242 4242 4242 4242"
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> This is a demo checkout — no real money moves.
        </p>

        <DialogFooter>
          <Button
            className="w-full"
            data-testid="button-confirm-payment"
            disabled={payMutation.isPending}
            onClick={() => payMutation.mutate()}
          >
            {payMutation.isPending ? "Confirming..." : `Pay ${formatSGD(feeCharge.feeAmount)} via ${method === "paynow" ? "PayNow" : "card"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
