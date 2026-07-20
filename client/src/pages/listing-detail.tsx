import { useParams, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShieldCheck,
  CheckCircle2,
  Send,
  HandCoins,
  MapPin,
  Phone,
  User as UserIcon,
  Pencil,
  Ban,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Listing, Bid, FeeCharge, Message } from "@shared/schema";
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

  // Only needed for the admin's "message a participant privately" tool below
  // — everyone else's conversations are just each bid's own embedded thread.
  const { data: participants } = useQuery<{ id: number; name: string }[]>({
    queryKey: [`/api/listings/${listingId}/participants`],
    enabled: !!user?.isAdmin && !!listing && user.id !== listing.userId,
    refetchOnMount: "always",
  });

  // Clicking a "new message" notification links here with
  // ?participant=<bidderId> so the page scrolls straight to that bidder's
  // bid-and-conversation card instead of leaving the reader to find it.
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const scrollToParticipant = Number(searchParams.get("participant")) || null;
  const bidRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!scrollToParticipant) return;
    bidRefs.current[scrollToParticipant]?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToParticipant, bids]);

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
  const [payDialogFee, setPayDialogFee] = useState<FeeCharge | null>(null);

  // Opens a blank tab synchronously (must happen directly inside a click
  // handler / onMutate, never after an `await`, or browsers will treat it as
  // a pop-up and block it) and later points it at the real checkout URL once
  // we know it. Only called when Stripe is actually configured — the
  // simulated flow never needs a second tab.
  function openBlankCheckoutTab(): Window | null {
    return config?.stripePublishableKey ? window.open("", "_blank") : null;
  }

  function sendTabToCheckout(popup: Window | null, feeChargeId: number) {
    if (popup) {
      popup.location.href = `${window.location.origin}/#/checkout/${feeChargeId}`;
    } else {
      toast({
        title: "Pop-up blocked",
        description: "Allow pop-ups for this site, then use \"Pay now\" to complete the platform fee payment.",
        variant: "destructive",
      });
    }
  }

  const acceptMutation = useMutation({
    mutationFn: async (bidId: number) => {
      const res = await apiRequest("POST", `/api/bids/${bidId}/accept`, {});
      return res.json();
    },
    // Runs synchronously as soon as .mutate() is called (before the network
    // request resolves), which is what lets window.open() below still count
    // as a direct response to the user's click instead of getting blocked.
    onMutate: (): { popup: Window | null } => ({ popup: openBlankCheckoutTab() }),
    onSuccess: (result: { clientSecret?: string; feeCharge: FeeCharge }, _bidId, context) => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/fees`] });
      if (result.clientSecret) {
        // Real Stripe checkout: pop the payment form out into its own tab.
        sendTabToCheckout(context?.popup ?? null, result.feeCharge.id);
      } else {
        context?.popup?.close();
        // Simulated flow: open the PayNow / Card payment-method dialog so the
        // poster settles the platform fee immediately, releasing contact details.
        setPayDialogFee(result.feeCharge);
      }
    },
    onError: (err: any, _bidId, context) => {
      context?.popup?.close();
      toast({ title: "Could not accept bid", description: err.message, variant: "destructive" });
    },
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

  const [editingBid, setEditingBid] = useState<BidWithBidder | null>(null);
  const [deletingBid, setDeletingBid] = useState<BidWithBidder | null>(null);

  const invalidateBids = () => queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/bids`] });

  // Self-service edit (own pending bid) and admin edit (any bid) share one
  // dialog and mutation — which endpoint gets hit depends on whose bid it is.
  const updateBidMutation = useMutation({
    mutationFn: async ({ id, isSelf, amount, message }: { id: number; isSelf: boolean; amount: number; message: string }) => {
      const url = isSelf ? `/api/bids/${id}` : `/api/admin/bids/${id}`;
      const res = await apiRequest("PATCH", url, { amount, message });
      return res.json();
    },
    onSuccess: () => {
      invalidateBids();
      toast({ title: "Bid updated" });
      setEditingBid(null);
    },
    onError: (err: any) => toast({ title: "Could not update bid", description: err.message, variant: "destructive" }),
  });

  // Withdraw (self) or cancel (admin) a pending bid — kept on record with
  // status "cancelled" rather than erased.
  const cancelBidMutation = useMutation({
    mutationFn: async ({ id, isSelf }: { id: number; isSelf: boolean }) => {
      const url = isSelf ? `/api/bids/${id}/cancel` : `/api/admin/bids/${id}/cancel`;
      const res = await apiRequest("POST", url, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateBids();
      toast({ title: "Bid cancelled" });
    },
    onError: (err: any) => toast({ title: "Could not cancel bid", description: err.message, variant: "destructive" }),
  });

  // Admin-only: put a cancelled bid back to pending.
  const reopenBidMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/bids/${id}/reopen`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateBids();
      toast({ title: "Bid reopened", description: "It's pending again." });
    },
    onError: (err: any) => toast({ title: "Could not reopen bid", description: err.message, variant: "destructive" }),
  });

  // Self-only: flag a cancelled bid for admin attention — only an admin can
  // actually put it back to pending.
  const requestReopenMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bids/${id}/request-reopen`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateBids();
      toast({ title: "Request sent", description: "An admin will review your request to reopen this bid." });
    },
    onError: (err: any) => toast({ title: "Could not send request", description: err.message, variant: "destructive" }),
  });

  // Admin-only: permanently remove a bid — unlike cancel, this erases it.
  const deleteBidMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/bids/${id}`),
    onSuccess: () => {
      invalidateBids();
      toast({ title: "Bid deleted" });
      setDeletingBid(null);
    },
    onError: (err: any) => toast({ title: "Could not delete bid", description: err.message, variant: "destructive" }),
  });

  // "Pay now" retry: when Stripe is live, this must always reopen the real
  // Stripe checkout (now in its own tab) on the same PaymentIntent — never
  // the simulated PayNow/Card dialog, which would release contact details
  // without ever charging the card.
  function handlePayNow(feeCharge: FeeCharge) {
    if (config?.stripePublishableKey) {
      const popup = openBlankCheckoutTab();
      sendTabToCheckout(popup, feeCharge.id);
    } else {
      setPayDialogFee(feeCharge);
    }
  }

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
              onPayNow={() => handlePayNow(fc)}
            />
          ))}
        </div>
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
        <div className="space-y-4">
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

          {/* Lets someone ask the poster a question before committing to a bid
              — the same conversation continues seamlessly in their own bid's
              embedded thread below once they do bid, since both read/write
              the exact same listingId+poster conversation. Hidden once they've
              bid so it doesn't duplicate that bid's own thread. */}
          {!isOwner && !isAdmin && !hasBid && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div>
                  <h3 className="font-medium text-sm">Message the poster</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ask a question before you bid — contact details stay hidden until a bid is accepted and the fee
                    is paid.
                  </p>
                </div>
                <BidThread
                  listingId={listingId}
                  isAdmin={false}
                  threadBidderId={user.id}
                  posterId={listing.userId}
                  otherUserId={listing.userId}
                  otherName={listing.ownerName}
                  currentUserId={user.id}
                />
              </CardContent>
            </Card>
          )}

          {isAdmin && !isOwner && participants && participants.length > 0 && (
            <AdminPrivateMessageCard listingId={listingId} participants={participants} currentUserId={user?.id} />
          )}

          <div className="space-y-3">
            <h2 className="font-medium text-sm text-muted-foreground">Bids &amp; messages</h2>
            {bids?.length === 0 && <p className="text-sm text-muted-foreground">No bids yet.</p>}
            {bids?.map((b) => {
              // The other real party in this bid's conversation — from the
              // poster's or the bidder's own point of view, never the admin's
              // (who isn't a real party, and gets the thread-tag mechanism
              // inside BidThread instead).
              const otherUserId = isOwner ? b.bidderId : listing.userId;
              const otherName = isOwner ? b.bidderName : listing.ownerName;
              return (
                <Card key={b.id} data-testid={`card-bid-${b.id}`} ref={(el) => (bidRefs.current[b.bidderId] = el)}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
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
                        <div className="flex items-center gap-2 flex-wrap justify-end">
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
                          {/* Bidder self-service on their own bid — only shown to the
                              bidder themselves, never the poster or an admin (who get
                              their own, broader controls below instead). */}
                          {!isAdmin && !isOwner && user && b.bidderId === user.id && (
                            <>
                              {b.status === "pending" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => setEditingBid(b)}
                                    data-testid={`button-edit-own-bid-${b.id}`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" /> Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => cancelBidMutation.mutate({ id: b.id, isSelf: true })}
                                    disabled={cancelBidMutation.isPending}
                                    data-testid={`button-cancel-own-bid-${b.id}`}
                                  >
                                    <Ban className="h-3.5 w-3.5" /> Cancel
                                  </Button>
                                </>
                              )}
                              {b.status === "cancelled" &&
                                (b.reopenRequested ? (
                                  <span className="text-xs text-muted-foreground">Reopen requested</span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => requestReopenMutation.mutate(b.id)}
                                    disabled={requestReopenMutation.isPending}
                                    data-testid={`button-request-reopen-bid-${b.id}`}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" /> Ask to reopen
                                  </Button>
                                ))}
                            </>
                          )}
                          {/* Admin moderation — full control over every bid on this
                              listing, independent of the poster's accept/reject. */}
                          {isAdmin && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => setEditingBid(b)}
                                data-testid={`button-admin-edit-bid-${b.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </Button>
                              {b.status === "cancelled" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => reopenBidMutation.mutate(b.id)}
                                  disabled={reopenBidMutation.isPending}
                                  data-testid={`button-admin-reopen-bid-${b.id}`}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" /> Reopen
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => cancelBidMutation.mutate({ id: b.id, isSelf: false })}
                                  disabled={cancelBidMutation.isPending}
                                  data-testid={`button-admin-cancel-bid-${b.id}`}
                                >
                                  <Ban className="h-3.5 w-3.5" /> Cancel
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-destructive hover:text-destructive"
                                onClick={() => setDeletingBid(b)}
                                data-testid={`button-admin-delete-bid-${b.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <BidThread
                      listingId={listingId}
                      isAdmin={isAdmin && !isOwner}
                      threadBidderId={b.bidderId}
                      posterId={listing.userId}
                      otherUserId={otherUserId}
                      otherName={otherName}
                      currentUserId={user?.id}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <EditBidDialog
        bid={editingBid}
        isSelf={!!user && !!editingBid && editingBid.bidderId === user.id && !isAdmin}
        onOpenChange={(open) => !open && setEditingBid(null)}
        onSave={(data) => editingBid && updateBidMutation.mutate({ id: editingBid.id, ...data })}
        saving={updateBidMutation.isPending}
      />

      <AlertDialog open={!!deletingBid} onOpenChange={(open) => !open && setDeletingBid(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bid?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingBid && (
                <>
                  This permanently removes {deletingBid.bidderName}'s {formatSGD(deletingBid.amount)} bid, along with
                  any messages tied to it. Unlike cancelling, this can't be undone — use Cancel instead if they might
                  want it reopened later.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBidMutation.isPending}
              onClick={() => deletingBid && deleteBidMutation.mutate(deletingBid.id)}
              data-testid="button-confirm-delete-bid"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditBidDialog({
  bid,
  isSelf,
  onOpenChange,
  onSave,
  saving,
}: {
  bid: BidWithBidder | null;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { isSelf: boolean; amount: number; message: string }) => void;
  saving: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!bid) return;
    setAmount(String(bid.amount));
    setMessage(bid.message);
  }, [bid?.id]);

  return (
    <Dialog open={!!bid} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit bid</DialogTitle>
        </DialogHeader>
        {bid && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Amount (SGD)</label>
              <Input
                type="number"
                min={1}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-edit-bid-amount"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Message</label>
              <Textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                data-testid="input-edit-bid-message"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={saving || !amount || Number(amount) <= 0}
                onClick={() => onSave({ isSelf, amount: parseFloat(amount), message })}
                data-testid="button-save-bid"
              >
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

type AdminMessage = Message & { senderName: string; recipientName: string };

/**
 * The conversation for one specific bid, embedded directly under it instead
 * of behind a separate "Messages" tab — so the poster, bidder, or an admin
 * can see and reply to that bidder's thread right where the bid itself
 * lives, without switching views.
 *
 * For the poster and the bidder themselves, this is a real conversation —
 * they're both actual participants, so it's read/sent via the ordinary
 * messaging endpoints. An admin isn't a real party to the thread, so they
 * read it via the moderation endpoint (filtered down to just this bidder's
 * shared thread with the poster) and reply through the thread-tagging
 * endpoint instead.
 */
function BidThread({
  listingId,
  isAdmin,
  threadBidderId,
  posterId,
  otherUserId,
  otherName,
  currentUserId,
}: {
  listingId: number;
  isAdmin: boolean;
  threadBidderId: number;
  posterId: number;
  otherUserId: number;
  otherName: string;
  currentUserId?: number;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");

  const { data: messages } = useQuery<(Message & { senderName?: string })[]>({
    queryKey: [`/api/listings/${listingId}/messages/${otherUserId}`],
    enabled: !isAdmin,
    refetchInterval: 4000,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/listings/${listingId}/messages`, {
        content: text,
        recipientId: otherUserId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/messages/${otherUserId}`] });
      setText("");
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  const { data: adminMessages } = useQuery<AdminMessage[]>({
    queryKey: [`/api/admin/listings/${listingId}/messages`],
    enabled: isAdmin,
    refetchInterval: 4000,
  });

  const adminReplyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/listings/${listingId}/messages/thread`, {
        content: text,
        bidderId: threadBidderId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/listings/${listingId}/messages`] });
      setText("");
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  // Only messages genuinely part of THIS shared poster<->bidder thread — not
  // any separate private DM an admin may have sent this same bidder (those
  // stay in the "message a participant privately" tool instead).
  const threadMessages: (Message & { senderName?: string })[] = isAdmin
    ? (adminMessages ?? []).filter(
        (m) =>
          m.threadBidderId === threadBidderId ||
          (m.senderId === posterId && m.recipientId === threadBidderId) ||
          (m.senderId === threadBidderId && m.recipientId === posterId)
      )
    : messages ?? [];

  const sending = isAdmin ? adminReplyMutation.isPending : sendMutation.isPending;
  function handleSend() {
    if (!text.trim()) return;
    if (isAdmin) adminReplyMutation.mutate();
    else sendMutation.mutate();
  }

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Messages</p>
      <div className="max-h-56 overflow-y-auto space-y-2 flex flex-col-reverse">
        <div />
        {[...threadMessages].reverse().map((m) => {
          const isSelf = m.senderId === currentUserId;
          const label = isSelf ? "You" : m.senderName ?? otherName;
          return (
            <div key={m.id} className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`}>
              <span className="text-[10px] text-muted-foreground mb-0.5 px-0.5">{label}</span>
              <div
                data-testid={`text-message-${m.id}`}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  isSelf ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                }`}
              >
                {m.content}
              </div>
            </div>
          );
        })}
        {threadMessages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No messages yet. Contact details are automatically hidden — arrange details here in-app.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) handleSend();
          }}
          data-testid={`input-message-${threadBidderId}`}
        />
        <Button size="icon" disabled={!text.trim() || sending} onClick={handleSend} data-testid={`button-send-message-${threadBidderId}`}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Admin-only: a private, 1:1 message to any participant (the poster or any
 * bidder) — separate from the per-bid threads above, which are the only
 * place a reply lands inside the actual shared poster<->bidder conversation.
 */
function AdminPrivateMessageCard({
  listingId,
  participants,
  currentUserId,
}: {
  listingId: number;
  participants: { id: number; name: string }[];
  currentUserId?: number;
}) {
  const { toast } = useToast();
  const [recipient, setRecipient] = useState<number | null>(participants[0]?.id ?? null);
  const [text, setText] = useState("");

  const { data: messages } = useQuery<(Message & { senderName?: string })[]>({
    queryKey: [`/api/listings/${listingId}/messages/${recipient}`],
    enabled: !!recipient,
    refetchInterval: 4000,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/listings/${listingId}/messages`, {
        content: text,
        recipientId: recipient,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}/messages/${recipient}`] });
      setText("");
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  const recipientName = participants.find((p) => p.id === recipient)?.name ?? "them";

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <h3 className="font-medium text-sm">Message a participant privately</h3>
        <p className="text-xs text-muted-foreground -mt-2">
          Only you and they will see this. To speak into a bid's own thread instead, reply under that bid below.
        </p>
        <Select value={recipient ? String(recipient) : undefined} onValueChange={(v) => setRecipient(Number(v))}>
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
        <div className="max-h-56 overflow-y-auto space-y-2 flex flex-col-reverse">
          <div />
          {[...(messages ?? [])].reverse().map((m) => {
            const isSelf = m.senderId === currentUserId;
            return (
              <div key={m.id} className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`}>
                <span className="text-[10px] text-muted-foreground mb-0.5 px-0.5">{isSelf ? "You" : recipientName}</span>
                <div
                  data-testid={`text-admin-dm-${m.id}`}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    isSelf ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
          {(!messages || messages.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-2">No messages yet.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            data-testid="input-admin-message"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && recipient) sendMutation.mutate();
            }}
          />
          <Button
            size="icon"
            disabled={!text.trim() || !recipient || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
            data-testid="button-send-admin-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
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
