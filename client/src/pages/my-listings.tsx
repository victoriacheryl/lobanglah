import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatListingNumber } from "@/lib/format";
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
import { ListingForm } from "@/components/listing-form";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Lock, Trash2, Ban } from "lucide-react";
import type { Listing, InsertListing } from "@shared/schema";

type BidSummary = { id: number; bidderId: number; bidderName: string; amount: number; status: string };
type MyListing = Listing & { hasBids: boolean; ownerName?: string; bids?: BidSummary[] };
type OfferingFee = { status: string; feeAmount: number; paidAt: number | null };
type OfferingListing = Listing & {
  ownerName: string;
  myBid: { id: number; amount: number; status: string; message: string | null; createdAt: number };
  fee?: OfferingFee;
};
type MyListingsResponse = { own: MyListing[]; offering: OfferingListing[] };

export default function MyListings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState<MyListing | null>(null);
  const [deleting, setDeleting] = useState<MyListing | null>(null);
  const [closing, setClosing] = useState<MyListing | null>(null);
  const isAdmin = !!user?.isAdmin;

  const { data: response, isLoading } = useQuery<MyListingsResponse>({
    queryKey: ["/api/listings/mine"],
    refetchOnMount: "always",
  });

  const data = response?.own;
  const offering = response?.offering ?? [];

  // Closed postings are done business — keep them out of the way at the
  // bottom instead of mixed in with the ones that still need attention.
  // Each group keeps the backend's newest-first ordering.
  const openListings = data?.filter((l) => l.status !== "closed") ?? [];
  const closedListings = data?.filter((l) => l.status === "closed") ?? [];

  const editMutation = useMutation({
    mutationFn: async (data: InsertListing) => {
      const res = await apiRequest("PATCH", `/api/listings/${editing!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/mine"] });
      toast({
        title: "Listing updated",
        description: isAdmin
          ? "Your changes are saved. The listing's status was left as-is."
          : "Changes to live listings are re-reviewed before going live again.",
      });
      setEditing(null);
    },
    onError: (err: any) => toast({ title: "Could not update", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/listings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/mine"] });
      toast({ title: "Listing deleted", description: "The listing, its bids, and its messages were removed." });
      setDeleting(null);
    },
    onError: (err: any) => toast({ title: "Could not delete", description: err.message, variant: "destructive" }),
  });

  const closeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/listings/${id}/close`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/mine"] });
      toast({
        title: "Listing closed",
        description: "It's off the market. Pending bids were rejected; accepted bids are unaffected.",
      });
      setClosing(null);
    },
    onError: (err: any) => toast({ title: "Could not close listing", description: err.message, variant: "destructive" }),
  });

  const renderCard = (l: MyListing) => (
            <Card key={l.id} data-testid={`card-my-listing-${l.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <Link href={`/listings/${l.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground" data-testid={`text-listing-number-${l.id}`}>
                        #{formatListingNumber(l.id)}
                      </span>
                      <StatusBadge status={l.status} />
                      <span className="text-xs text-muted-foreground">
                        {l.type === "seek" ? "Seeking" : "Offering"} · {l.category} · {l.location}
                        {isAdmin && l.ownerName ? ` · by ${l.ownerName}` : ""}
                      </span>
                    </div>
                    <h3 className="font-medium mt-1 truncate">{l.title}</h3>
                    {l.status === "rejected" && l.rejectionReason && (
                      <p className="text-xs text-destructive mt-1">Reason: {l.rejectionReason}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(l.createdAt)}</p>
                  </Link>
                  <div className="text-right shrink-0 flex flex-col items-end gap-2">
                    <span className="font-display font-semibold text-primary">{l.price}</span>
                    {isAdmin ? (
                      // Admins can edit or delete any listing — open or closed,
                      // with or without bids — for moderation purposes.
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(l)} data-testid={`button-edit-${l.id}`}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        {l.status !== "closed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => setClosing(l)}
                            data-testid={`button-force-close-${l.id}`}
                          >
                            <Ban className="h-3.5 w-3.5" /> Force close
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(l)}
                          data-testid={`button-delete-${l.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    ) : (
                      l.status !== "closed" && (
                        l.hasBids ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                            data-testid={`text-edit-locked-${l.id}`}
                            title="Editing is locked once a listing has received a bid"
                          >
                            <Lock className="h-3.5 w-3.5" /> Locked (has bids)
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(l)} data-testid={`button-edit-${l.id}`}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                        )
                      )
                    )}
                  </div>
                </div>

                {isAdmin && l.bids && l.bids.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Bids ({l.bids.length})
                    </p>
                    <div className="space-y-1.5">
                      {l.bids.map((b) => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between gap-3 text-sm"
                          data-testid={`row-bid-${b.id}`}
                        >
                          <span className="truncate flex items-center gap-1.5">
                            {b.bidderName}
                            {b.status === "accepted" && (
                              <span className="text-[10px] font-medium text-accent uppercase tracking-wide">
                                Successful bidder
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-medium" data-testid={`text-bid-amount-${b.id}`}>
                              ${b.amount.toFixed(2)}
                            </span>
                            <StatusBadge status={b.status} context="bid" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
  );

  const renderOfferingCard = (l: OfferingListing) => (
    <Card key={`offering-${l.id}`} data-testid={`card-offering-${l.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Link href={`/listings/${l.id}`} className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground" data-testid={`text-offering-listing-number-${l.id}`}>
                #{formatListingNumber(l.id)}
              </span>
              <StatusBadge status={l.status} />
              <span className="text-xs text-muted-foreground">
                {l.type === "seek" ? "Seeking" : "Offering"} · {l.category} · {l.location} · by {l.ownerName}
              </span>
            </div>
            <h3 className="font-medium mt-1 truncate">{l.title}</h3>
            <p className="text-xs text-muted-foreground mt-1">{formatDate(l.createdAt)}</p>
          </Link>
          <div className="text-right shrink-0">
            <span className="font-display font-semibold text-primary">{l.price}</span>
          </div>
        </div>

        <div className="border-t border-border pt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Your bid: <span className="font-medium text-foreground" data-testid={`text-my-bid-amount-${l.id}`}>${l.myBid.amount.toFixed(2)}</span>
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge status={l.myBid.status} context="bid" />
            {l.fee && <StatusBadge status={l.fee.status} context="fee" />}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const openOffering = offering.filter((l) => l.status !== "closed");
  const closedOffering = offering.filter((l) => l.status === "closed");
  const hasOwn = !!data && data.length > 0;
  const hasOffering = offering.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <h1 className="font-display text-xl font-semibold mb-1" data-testid="text-page-title">My Lobangs</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {isAdmin
          ? "Every user's postings. Track status, edit both open and closed listings, and jump into bids and messages."
          : "Track review status, edit open listings, and jump into bids and messages — plus postings where you offered your services."}
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : !hasOwn && !hasOffering ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-empty-state">
          {isAdmin ? (
            "No listings have been posted yet."
          ) : (
            <>
              You haven't posted anything yet.{" "}
              <Link href="/post" className="text-primary font-medium">Post your first listing</Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {(hasOwn || isAdmin) && (
            <div className="space-y-6">
              {!isAdmin && hasOffering && (
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="text-own-heading">
                  Your postings
                </p>
              )}
              {openListings.length > 0 ? (
                <div className="space-y-3">{openListings.map(renderCard)}</div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-open-listings">
                  {isAdmin ? "No open postings right now." : "You have no open postings right now."}
                </p>
              )}

              {closedListings.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="text-archived-heading">
                      Archived ({closedListings.length})
                    </p>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-3 opacity-75">{closedListings.map(renderCard)}</div>
                </div>
              )}
            </div>
          )}

          {!isAdmin && hasOffering && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="text-offering-heading">
                Postings you're helping with
              </p>
              {openOffering.length > 0 && <div className="space-y-3">{openOffering.map(renderOfferingCard)}</div>}

              {closedOffering.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="text-offering-archived-heading">
                      Archived ({closedOffering.length})
                    </p>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-3 opacity-75">{closedOffering.map(renderOfferingCard)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit listing</DialogTitle>
          </DialogHeader>
          {editing && (
            <ListingForm
              defaultValues={editing}
              submitting={editMutation.isPending}
              submitLabel="Save changes"
              onSubmit={(data) => editMutation.mutate(data)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this listing?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  This permanently removes "{deleting.title}" (#{formatListingNumber(deleting.id)}), along with all of
                  its bids and messages. This can't be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!closing} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force close this listing?</AlertDialogTitle>
            <AlertDialogDescription>
              {closing && (
                <>
                  This takes "{closing.title}" (#{formatListingNumber(closing.id)}) off the market immediately. Any
                  pending bids will be rejected and their bidders notified; already-accepted bids are left as-is. The
                  listing and its history are kept — this doesn't delete anything.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={closeMutation.isPending}
              onClick={() => closing && closeMutation.mutate(closing.id)}
              data-testid="button-confirm-close"
            >
              Force close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
