import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { formatSGD, formatDate, formatDateTime, formatListingNumber } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, CheckCircle2, Send, HandCoins, MapPin, Phone, User as UserIcon, MessageSquare } from "lucide-react";
import type { Listing, Bid, FeeCharge, Message } from "@shared/schema";
import { StripeCheckoutDialog } from "@/components/stripe-checkout-dialog";
import { PaymentMethodDialog } from "@/components/payment-method-dialog";

type ListingWithOwner = Listing & { ownerName: string };
type BidWithBidder = Bid & { bidderName: string };

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>();
  const listingId = Number(id);
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: listing, isLoading } = useQuery<ListingWithOwner>({
    queryKey: [`/api/listings/${listingId}`],
    refetchOnMount: "always",
  });

  const isOwner = !!user && !!listing && user.id === listing.userId;
  const isAdmin = !!user?.isAdmin;

  const { data: bids } = useQuery<BidWithBidder[]>({
    queryKey: [`/api/listings/${listingId}/bids`],
    enabled: !!user,
    refetchOnMount: "always",
  });

  const { data: feeCharges } = useQuery<FeeCharge[]>({
    queryKey: [`/api/listings/${listingId}/fees`],
    enabled: !!user,
    refetchOnMount: "always",
    // While a card charge is pending confirmation (e.g. waiting on the Stripe
    // webhook), poll briefly so the UI updates without a manual refresh.
    refetchInterval: (query) => (query.state.data?.some((f) => f.status === "pending") ? 3000 : false),
  });

  const [activeTab, setActiveTab] = useState<"bids" | "messages">("bids");
  const [messageTarget, setMessageTarget] = useState<number | null>(null);

  const [bidAmount, setBidAmount] = useState("");
  const [bidMessage, setBidMessage] = useState("");

  const bidMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/listings/${listingId}/bids`, {
        amount: parseFloat(bidAmount),
        message: bidMessage,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });
      setBidAmount("");
      setBidMessage("");
      toast({ title: "Bid submitted", description: "The poster will be notified." });
    },
    onError: (err: any) => toast({ title: "Could not submit bid", description: err.message, variant: "destructive" }),
  });

  const { data: config } = useQuery<{ stripePublishableKey: string | null }>({
    queryKey: ["/api/config"],
  });
  const [checkout, setCheckout] = useState<{ clientSecret: string; amount: number } | null>(null);
  const [payDialogFee, setPayDialogFee] = useState<FeeCharge | null>(null);

  const acceptMutation = useMutation({
    mutationFn: async (bidId: number) => {
      const res = await apiRequest("POST", `/api/bids/${bidId}/accept`, {});
      return res.json();
    },
    onSuccess: (result: { clientSecret?: string; feeCharge: FeeCharge }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/fees`] });
      if (result.clientSecret) {
        // Real Stripe checkout: open the PaymentElement to charge the platform fee.
        setCheckout({ clientSecret: result.clientSecret, amount: result.feeCharge.feeAmount });
      } else {
        // Simulated flow: open the PayNow / Card payment-method dialog so the
        // poster settles the platform fee immediately, releasing contact details.
        setPayDialogFee(result.feeCharge);
      }
    },
    onError: (err: any) => toast({ title: "Could not accept bid", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (bidId: number) => {
      const res = await apiRequest("POST", `/api/bids/${bidId}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });
      toast({ title: "Bid rejected", description: "The bidder has been notified." });
    },
    onError: (err: any) => toast({ title: "Could not reject bid", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async (paymentIntentId: string) => {
      await apiRequest("POST", `/api/stripe/sync/${paymentIntentId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/fees`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });
      toast({ title: "Platform fee charged", description: "Arrange payment for the job directly with the provider." });
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!listing) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted-foreground">Listing not found.</div>;
  }

  const hasBid = !!user && bids?.some((b) => b.bidderId === user.id);
  const canBid = !!user && listing.status === "live" && !isOwner && !hasBid;
  const acceptedCount = bids?.filter((b) => b.status === "accepted").length ?? 0;
  // Only the poster and admins see every bidder's name (a plain bidder only
  // ever sees their own bid, labeled "You") — so only they get a way to jump
  // straight from a bid to messaging that bidder.
  const canSeeBidderNames = isOwner || isAdmin;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      <Card>
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground" data-testid="text-listing-number">
                #{formatListingNumber(listing.id)}
              </span>
              <StatusBadge status={listing.status} />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                {listing.type === "seek" ? "Seeking" : "Offering"} · {listing.category}
              </span>
              {listing.quantityNeeded > 1 && bids && (
                <span className="text-xs text-muted-foreground uppercase tracking-wide" data-testid="text-accept-progress">
                  · {acceptedCount} of {listing.quantityNeeded} accepted
                </span>
              )}
            </div>
            <span className="font-display text-lg font-semibold text-primary" data-testid="text-price">
              {listing.price}
            </span>
          </div>
          <h1 className="font-display text-xl font-semibold" data-testid="text-listing-title">{listing.title}</h1>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="text-location">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> {listing.location}
          </div>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap" data-testid="text-listing-description">{listing.description}</p>
          <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
            <span>Posted by {listing.ownerName}</span>
            <span>{formatDate(listing.createdAt)}</span>
          </div>
        </CardContent>
      </Card>

      {!user && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 text-sm">Log in to place a bid or message the poster.</CardContent>
        </Card>
      )}

      {feeCharges && feeCharges.length > 0 && (
        <div className="space-y-3">
          {feeCharges.map((fc) => (
            <FeeChargePanel
              key={fc.id}
              feeCharge={fc}
              isPoster={isOwner}
              onPayNow={() => setPayDialogFee(fc)}
            />
          ))}
        </div>
      )}

      {config?.stripePublishableKey && checkout && (
        <StripeCheckoutDialog
          open={!!checkout}
          onOpenChange={(open) => !open && setCheckout(null)}
          clientSecret={checkout.clientSecret}
          publishableKey={config.stripePublishableKey}
          amount={checkout.amount}
          onAuthorized={(paymentIntentId) => {
            setCheckout(null);
            syncMutation.mutate(paymentIntentId);
          }}
        />
      )}

      {payDialogFee && (
        <PaymentMethodDialog
          open={!!payDialogFee}
          onOpenChange={(open) => !open && setPayDialogFee(null)}
          feeCharge={payDialogFee}
          listingId={listingId}
          onPaid={() => setPayDialogFee(null)}
        />
      )}

      {user && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "bids" | "messages")}>
          <TabsList>
            <TabsTrigger value="bids" data-testid="tab-bids">Bids</TabsTrigger>
            <TabsTrigger value="messages" data-testid="tab-messages">Messages</TabsTrigger>
          </TabsList>
          <TabsContent value="bids" className="space-y-4 pt-4">
            {canBid && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-medium text-sm">Place a bid</h3>
                  <Input
                    data-testid="input-bid-amount"
                    type="number"
                    min={1}
                    step="0.01"
                    placeholder="Your fee (SGD)"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                  />
                  <Textarea
                    data-testid="input-bid-message"
                    placeholder="A short note about your bid (optional)"
                    rows={2}
                    value={bidMessage}
                    onChange={(e) => setBidMessage(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    disabled={!bidAmount || bidMutation.isPending}
                    onClick={() => bidMutation.mutate()}
                    data-testid="button-submit-bid"
                  >
                    {bidMutation.isPending ? "Submitting..." : "Submit bid"}
                  </Button>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" /> If the poster accepts your bid, they pay a small platform fee — you'll then arrange the job payment with them directly.
                  </p>
                </CardContent>
              </Card>
            )}
            {hasBid && listing.status === "live" && (
              <p className="text-sm text-muted-foreground">You've already placed a bid on this listing.</p>
            )}
            <div className="space-y-2">
              {bids?.length === 0 && <p className="text-sm text-muted-foreground">No bids yet.</p>}
              {bids?.map((b) => (
                <Card key={b.id} data-testid={`card-bid-${b.id}`}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{canSeeBidderNames ? b.bidderName : "You"}</span>
                        <StatusBadge status={b.status} context="bid" />
                      </div>
                      {b.message && <p className="text-xs text-muted-foreground mt-1">{b.message}</p>}
                      <p className="text-[11px] text-muted-foreground mt-1">{formatDate(b.createdAt)}</p>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-2">
                      <span className="font-display font-semibold text-primary">{formatSGD(b.amount)}</span>
                      <div className="flex items-center gap-2">
                        {canSeeBidderNames && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => {
                              setMessageTarget(b.bidderId);
                              setActiveTab("messages");
                            }}
                            data-testid={`button-message-bidder-${b.id}`}
                          >
                            <MessageSquare className="h-3.5 w-3.5" /> Message
                          </Button>
                        )}
                        {isOwner && listing.status === "live" && b.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => rejectMutation.mutate(b.id)}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                              data-testid={`button-reject-bid-${b.id}`}
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => acceptMutation.mutate(b.id)}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                              data-testid={`button-accept-bid-${b.id}`}
                            >
                              Accept
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="messages" className="pt-4">
            {isAdmin && !isOwner ? (
              // Admins viewing someone else's listing aren't a party to any
              // thread here, so the regular per-participant view (which is
              // scoped to "my conversation with X") would show nothing. Give
              // them a moderation view of every thread instead.
              <AdminMessagesPanel
                listingId={listingId}
                posterId={listing.userId}
                bids={bids}
                selectedParticipant={messageTarget}
                onSelectParticipant={setMessageTarget}
              />
            ) : (
              <MessagesPanel
                listingId={listingId}
                isOwner={isOwner}
                bids={bids}
                feeCharges={feeCharges}
                selectedParticipant={messageTarget}
                onSelectParticipant={setMessageTarget}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function FeeChargePanel({ feeCharge, isPoster, onPayNow }: { feeCharge: FeeCharge; isPoster: boolean; onPayNow: () => void }) {
  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm flex items-center gap-1.5">
            <HandCoins className="h-4 w-4 text-accent" /> Platform fee
          </h3>
          <StatusBadge status={feeCharge.status} context="fee" />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Accepted bid</p>
            <p className="font-display font-semibold">{formatSGD(feeCharge.bidAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Platform fee</p>
            <p className="font-display font-semibold">{formatSGD(feeCharge.feeAmount)}</p>
          </div>
        </div>
        {feeCharge.status === "pending" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Waiting for the platform fee to be paid...</span>
            {isPoster && (
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-pay-now-${feeCharge.id}`} onClick={onPayNow}>
                Pay now
              </Button>
            )}
          </div>
        )}
        {feeCharge.status === "failed" && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            The card charge failed, so this listing is open for bids again.
          </div>
        )}
        {feeCharge.status === "paid" && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs text-accent">
              <CheckCircle2 className="h-3.5 w-3.5" /> Fee paid{feeCharge.paidAt ? ` on ${formatDateTime(feeCharge.paidAt)}` : ""}
              {feeCharge.paymentMethod ? ` via ${feeCharge.paymentMethod === "paynow" ? "PayNow" : "card"}` : ""}. Contact details are unlocked below.
            </div>
            <ContactReveal bidId={feeCharge.bidId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessagesPanel({
  listingId,
  isOwner,
  bids,
  feeCharges,
  selectedParticipant,
  onSelectParticipant,
}: {
  listingId: number;
  isOwner: boolean;
  bids?: BidWithBidder[];
  feeCharges?: FeeCharge[];
  selectedParticipant: number | null;
  onSelectParticipant: (id: number) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: participants } = useQuery<{ id: number; name: string }[]>({
    queryKey: [`/api/listings/${listingId}/participants`],
    refetchOnMount: "always",
  });
  const activeParticipant = selectedParticipant ?? participants?.[0]?.id ?? null;

  const { data: messages } = useQuery<(Message & { senderName?: string })[]>({
    queryKey: [`/api/listings/${listingId}/messages/${activeParticipant}`],
    enabled: !!activeParticipant,
    refetchInterval: 4000,
  });

  const [text, setText] = useState("");
  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/listings/${listingId}/messages`, {
        content: text,
        recipientId: activeParticipant,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/messages/${activeParticipant}`] });
      setText("");
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  if (!participants || participants.length === 0) {
    return <p className="text-sm text-muted-foreground">No conversations yet — bid or wait for bids to start messaging.</p>;
  }

  const otherName = participants.find((p) => p.id === activeParticipant)?.name ?? "them";

  // The bid tied to this conversation: if you're the poster, it's the bid the
  // other participant (the bidder) placed; if you're the bidder, it's your
  // own bid on this listing. Every non-owner participant has exactly one bid
  // here — that's what makes them a participant in the first place.
  const conversationBid = bids?.find((b) => (isOwner ? b.bidderId === activeParticipant : b.bidderId === user?.id));
  const conversationFee = conversationBid ? feeCharges?.find((f) => f.bidId === conversationBid.id) : undefined;

  return (
    <div className="space-y-3">
      {conversationBid && (
        <Card className="border-accent/20 bg-accent/5">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <HandCoins className="h-4 w-4 text-accent shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">
                  Bid {formatSGD(conversationBid.amount)}
                  {conversationFee ? ` · Fee ${formatSGD(conversationFee.feeAmount)}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {conversationFee
                    ? conversationFee.status === "paid"
                      ? `Platform fee paid${conversationFee.paidAt ? ` on ${formatDateTime(conversationFee.paidAt)}` : ""} — contact details unlocked below`
                      : conversationFee.status === "failed"
                        ? "Platform fee payment failed — the listing reopened for bids"
                        : "Bid accepted — platform fee not yet paid"
                    : conversationBid.status === "pending"
                      ? "Bid pending — not yet accepted"
                      : conversationBid.status === "rejected"
                        ? "This bid was not selected"
                        : "Bid accepted"}
                </p>
              </div>
            </div>
            <StatusBadge status={conversationFee ? conversationFee.status : conversationBid.status} context={conversationFee ? "fee" : "bid"} />
          </CardContent>
        </Card>
      )}

      {participants.length > 1 && (
        <Select value={activeParticipant ? String(activeParticipant) : undefined} onValueChange={(v) => onSelectParticipant(Number(v))}>
          <SelectTrigger className="w-56" data-testid="select-conversation">
            <SelectValue placeholder="Choose conversation" />
          </SelectTrigger>
          <SelectContent>
            {participants.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="max-h-80 overflow-y-auto space-y-2 flex flex-col-reverse">
            <div />
            {[...(messages ?? [])].reverse().map((m) => {
              const isSelf = m.senderId === user?.id;
              // Ordinarily the other party is whoever this conversation is
              // with, but an admin message intercepted into this thread comes
              // from a third party — so trust the message's own sender name
              // rather than assuming it's always otherName.
              const label = isSelf ? "You" : m.senderName ?? otherName;
              return (
                <div key={m.id} className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`}>
                  <span className="text-[10px] text-muted-foreground mb-0.5 px-0.5">{label}</span>
                  <div
                    data-testid={`text-message-${m.id}`}
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      isSelf ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}
            {(!messages || messages.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No messages yet. Contact details are automatically hidden — arrange details here in-app.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              data-testid="input-message"
              placeholder="Type a message..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text.trim()) sendMutation.mutate();
              }}
            />
            <Button size="icon" disabled={!text.trim() || sendMutation.isPending} onClick={() => sendMutation.mutate()} data-testid="button-send-message">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type AdminMessage = Message & { senderName: string; recipientName: string };

function AdminMessagesPanel({
  listingId,
  posterId,
  bids,
  selectedParticipant,
  onSelectParticipant,
}: {
  listingId: number;
  posterId: number;
  bids?: BidWithBidder[];
  selectedParticipant: number | null;
  onSelectParticipant: (id: number) => void;
}) {
  const { toast } = useToast();
  const { data: messages } = useQuery<AdminMessage[]>({
    queryKey: [`/api/admin/listings/${listingId}/messages`],
    refetchOnMount: "always",
    refetchInterval: 4000,
  });

  // Admins aren't a party to any existing thread here, but they can still
  // reach out directly to the poster or any bidder — same underlying
  // messaging endpoint everyone else uses, just reachable from the
  // moderation view instead of a personal conversation.
  const { data: participants } = useQuery<{ id: number; name: string }[]>({
    queryKey: [`/api/listings/${listingId}/participants`],
    refetchOnMount: "always",
  });
  const nameOf = (id: number) => participants?.find((p) => p.id === id)?.name ?? "Unknown";
  const bidderIds = new Set((bids ?? []).map((b) => b.bidderId));

  const [text, setText] = useState("");
  const activeRecipient = selectedParticipant ?? participants?.[0]?.id ?? null;

  // This composer is always a private, 1:1 message to whoever is picked —
  // separate and only visible to the admin and that one person. It's
  // deliberately distinct from "reply in thread" below, which is the only
  // way to post into a shared poster<->bidder chat. Keeping the two apart
  // means admins get both a private channel to every participant and a way
  // to speak into an existing conversation, rather than one replacing the
  // other.
  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/listings/${listingId}/messages`, {
        content: text,
        recipientId: activeRecipient,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/listings/${listingId}/messages`] });
      setText("");
      toast({ title: "Message sent" });
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  // Reply text is kept per-thread (keyed by the bidder's id) so switching
  // between thread cards doesn't clobber a half-typed reply in another one.
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const replyMutation = useMutation({
    mutationFn: async ({ bidderId, content }: { bidderId: number; content: string }) => {
      const res = await apiRequest("POST", `/api/admin/listings/${listingId}/messages/thread`, {
        content,
        bidderId,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/listings/${listingId}/messages`] });
      setReplyText((prev) => ({ ...prev, [vars.bidderId]: "" }));
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  // Group messages by the real poster<->bidder thread they belong to, not by
  // literal sender/recipient — a thread-tagged admin message has recipientId
  // set to the bidder (or wherever), which would otherwise land in its own
  // separate card instead of merging into the poster & bidder's shared chat.
  // Only genuinely private messages (neither party a bidder, e.g. admin
  // talking to the poster one-on-one about something unrelated to a bid) keep
  // their own literal-pair card.
  const threads = new Map<
    string,
    { key: string; bidderId: number | null; aId: number; bId: number; a: string; b: string; messages: AdminMessage[] }
  >();
  for (const m of messages ?? []) {
    let bidderId: number | null = null;
    if (m.threadBidderId != null) {
      bidderId = m.threadBidderId;
    } else {
      const other = m.senderId === posterId ? m.recipientId : m.recipientId === posterId ? m.senderId : null;
      if (other != null && bidderIds.has(other)) bidderId = other;
    }
    const key = bidderId != null ? `bidder-${bidderId}` : `pair-${[m.senderId, m.recipientId].sort((x, y) => x - y).join("-")}`;
    if (!threads.has(key)) {
      const [aId, bId] = bidderId != null ? [posterId, bidderId] : [m.senderId, m.recipientId].sort((x, y) => x - y);
      const a = bidderId != null ? nameOf(aId) : m.senderId === aId ? m.senderName : m.recipientName;
      const b = bidderId != null ? nameOf(bId) : m.senderId === bId ? m.senderName : m.recipientName;
      threads.set(key, { key, bidderId, aId, bId, a, b, messages: [] });
    }
    threads.get(key)!.messages.push(m);
  }

  return (
    <div className="space-y-4">
      {participants && participants.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <h3 className="font-medium text-sm">Message a participant privately</h3>
            <p className="text-xs text-muted-foreground -mt-2">Only you and they will see this. To speak into an existing chat instead, reply under that thread below.</p>
            <Select
              value={activeRecipient ? String(activeRecipient) : undefined}
              onValueChange={(v) => onSelectParticipant(Number(v))}
            >
              <SelectTrigger className="w-56" data-testid="select-admin-recipient">
                <SelectValue placeholder="Choose recipient" />
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                data-testid="input-admin-message"
                placeholder="Type a message..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim() && activeRecipient) sendMutation.mutate();
                }}
              />
              <Button
                size="icon"
                disabled={!text.trim() || !activeRecipient || sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
                data-testid="button-send-admin-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(!messages || messages.length === 0) ? (
        <p className="text-sm text-muted-foreground">No messages have been exchanged on this listing yet.</p>
      ) : (
        Array.from(threads.values()).map((thread) => (
          <Card key={thread.key} data-testid={`card-admin-thread-${thread.key}`}>
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                {thread.a} & {thread.b} · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
              </p>
              <div className="space-y-2.5 max-h-80 overflow-y-auto">
                {thread.messages.map((m) => (
                  <div key={m.id} data-testid={`text-admin-message-${m.id}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{m.senderName}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{m.content}</p>
                  </div>
                ))}
              </div>
              {thread.bidderId != null && (
                <div className="flex gap-2 border-t border-border pt-3">
                  <Input
                    data-testid={`input-admin-reply-thread-${thread.bidderId}`}
                    placeholder={`Reply in ${thread.a} & ${thread.b}'s chat...`}
                    value={replyText[thread.bidderId] ?? ""}
                    onChange={(e) => setReplyText((prev) => ({ ...prev, [thread.bidderId as number]: e.target.value }))}
                    onKeyDown={(e) => {
                      const val = replyText[thread.bidderId as number]?.trim();
                      if (e.key === "Enter" && val) replyMutation.mutate({ bidderId: thread.bidderId as number, content: val });
                    }}
                  />
                  <Button
                    size="icon"
                    disabled={!replyText[thread.bidderId]?.trim() || replyMutation.isPending}
                    onClick={() => {
                      const val = replyText[thread.bidderId as number]?.trim();
                      if (val) replyMutation.mutate({ bidderId: thread.bidderId as number, content: val });
                    }}
                    data-testid={`button-admin-reply-thread-${thread.bidderId}`}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ContactReveal({ bidId }: { bidId: number }) {
  const { data: contact, isLoading } = useQuery<{
    posterName: string;
    posterPhone: string;
    providerName: string;
    providerPhone: string;
  }>({
    queryKey: [`/api/bids/${bidId}/contact`],
  });

  if (isLoading) return <Skeleton className="h-16 w-full rounded-lg" />;
  if (!contact) return null;

  return (
    <div className="rounded-lg border border-accent/30 bg-background/60 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="flex items-start gap-2">
        <UserIcon className="h-4 w-4 mt-0.5 text-accent shrink-0" />
        <div>
          <p className="text-xs text-muted-foreground">Poster</p>
          <p className="text-sm font-medium" data-testid="text-poster-name">{contact.posterName}</p>
          <p className="text-sm flex items-center gap-1 text-accent" data-testid="text-poster-phone">
            <Phone className="h-3.5 w-3.5" /> {contact.posterPhone}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <UserIcon className="h-4 w-4 mt-0.5 text-accent shrink-0" />
        <div>
          <p className="text-xs text-muted-foreground">Provider</p>
          <p className="text-sm font-medium" data-testid="text-provider-name">{contact.providerName}</p>
          <p className="text-sm flex items-center gap-1 text-accent" data-testid="text-provider-phone">
            <Phone className="h-3.5 w-3.5" /> {contact.providerPhone}
          </p>
        </div>
      </div>
    </div>
  );
}
