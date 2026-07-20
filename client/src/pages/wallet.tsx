import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { formatSGD, formatDate, formatDateTime, formatListingNumber } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, AlertTriangle } from "lucide-react";
import type { FeeCharge, Listing } from "@shared/schema";

type AdminTransaction = FeeCharge & { listingTitle: string; posterName: string; providerName: string };
type MyListing = Listing & { hasBids: boolean; ownerName?: string };

export default function Wallet() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1" data-testid="text-page-title">Wallet</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Platform-wide transaction history and posting follow-ups. LobangLah! charges a small one-time fee — whichever is greater of S$5 or 10% of the bid — the moment a poster accepts a bid."
            : "LobangLah! charges a small one-time platform fee — whichever is greater of S$5 or 10% of the bid — the moment you accept a bid. There's no escrow: you and the provider settle the job amount directly (cash, PayNow, or bank transfer)."}
        </p>
      </div>

      {isAdmin ? <AdminWallet /> : <UserWallet />}
    </div>
  );
}

// ---------- Regular user wallet ----------

function UserWallet() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<FeeCharge[]>({ queryKey: ["/api/fees/mine"], refetchOnMount: "always" });

  const paid = data?.filter((f) => f.posterId === user?.id) ?? [];
  const received = data?.filter((f) => f.providerId === user?.id) ?? [];
  const monthly = buildMonthlySummary(paid, received);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  return (
    <>
      <MonthlySummarySection rows={monthly} />
      <WalletSection title="Platform fees you've paid" rows={paid} amountLabel={(f) => formatSGD(f.feeAmount)} />
      <WalletSection
        title="Bids of yours that were accepted"
        rows={received}
        amountLabel={(f) => formatSGD(f.bidAmount)}
        note="Collect payment for the job directly from the poster."
      />
    </>
  );
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

type MonthlyRow = { key: string; spendCount: number; spendTotal: number; earnCount: number; earnTotal: number };

function buildMonthlySummary(paid: FeeCharge[], received: FeeCharge[]): MonthlyRow[] {
  const map = new Map<string, MonthlyRow>();
  const ensure = (key: string) => {
    if (!map.has(key)) map.set(key, { key, spendCount: 0, spendTotal: 0, earnCount: 0, earnTotal: 0 });
    return map.get(key)!;
  };
  // Spends: platform fees actually paid, grouped by when they were paid.
  for (const f of paid) {
    if (f.status !== "paid") continue;
    const row = ensure(monthKey(f.paidAt ?? f.createdAt));
    row.spendCount += 1;
    row.spendTotal += f.feeAmount;
  }
  // Earnings: bids of yours that were accepted (i.e. closed), grouped by
  // acceptance date — the job amount is settled directly with the poster,
  // so this is the closest on-platform record of what you've earned.
  for (const f of received) {
    const row = ensure(monthKey(f.createdAt));
    row.earnCount += 1;
    row.earnTotal += f.bidAmount;
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

function MonthlySummarySection({ rows }: { rows: MonthlyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="font-medium text-sm text-muted-foreground mb-3">Earnings &amp; spends by month</h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.key} data-testid={`card-month-summary-${r.key}`}>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{monthLabel(r.key)}</span>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Earned</p>
                  <p className="font-display font-semibold text-accent" data-testid={`text-earned-${r.key}`}>
                    {formatSGD(r.earnTotal)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {r.earnCount} bid{r.earnCount === 1 ? "" : "s"} closed
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Spent</p>
                  <p className="font-display font-semibold" data-testid={`text-spent-${r.key}`}>
                    {formatSGD(r.spendTotal)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {r.spendCount} bid{r.spendCount === 1 ? "" : "s"} closed
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WalletSection({
  title,
  rows,
  amountLabel,
  note,
}: {
  title: string;
  rows: FeeCharge[];
  amountLabel: (f: FeeCharge) => string;
  note?: string;
}) {
  return (
    <div>
      <h2 className="font-medium text-sm text-muted-foreground mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((f) => (
            <Link key={f.id} href={`/listings/${f.listingId}`}>
              <a>
                <Card data-testid={`card-fee-${f.id}`}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div>
                      <StatusBadge status={f.status} context="fee" />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {f.status === "paid" && f.paidAt ? `Charged on ${formatDateTime(f.paidAt)}` : formatDateTime(f.createdAt)}
                      </p>
                      {note && f.status === "paid" && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
                    </div>
                    <span className="font-display font-semibold text-primary">{amountLabel(f)}</span>
                  </CardContent>
                </Card>
              </a>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Admin wallet ----------

function AdminWallet() {
  const { user } = useAuth();
  const { data: transactions, isLoading: loadingTx } = useQuery<AdminTransaction[]>({
    queryKey: ["/api/admin/wallet/transactions"],
    refetchOnMount: "always",
  });
  // Shares its cache with the "My Lobangs" admin view — same endpoint, same
  // shape — so this doesn't cost an extra request if that page was visited.
  const { data: mine, isLoading: loadingListings } = useQuery<{ own: MyListing[]; offering: unknown[] }>({
    queryKey: ["/api/listings/mine"],
    refetchOnMount: "always",
  });

  const [reminding, setReminding] = useState<MyListing | null>(null);

  const openListings = (mine?.own ?? [])
    .filter((l) => l.status === "live")
    .sort((a, b) => a.createdAt - b.createdAt); // oldest posting first — most overdue on top

  const byWeek = groupTransactions(transactions ?? [], "week");
  const byMonth = groupTransactions(transactions ?? [], "month");

  return (
    <>
      <div>
        <h2 className="font-medium text-sm text-muted-foreground mb-3">Closed postings — by week</h2>
        {loadingTx ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <TransactionPeriodList rows={byWeek} granularity="week" />
        )}
      </div>

      <div>
        <h2 className="font-medium text-sm text-muted-foreground mb-3">Closed postings — by month</h2>
        {loadingTx ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <TransactionPeriodList rows={byMonth} granularity="month" />
        )}
      </div>

      <div>
        <h2 className="font-medium text-sm text-muted-foreground mb-3">
          Open postings — by posting date
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Oldest first. Postings open 7 days or more are flagged — send a reminder to nudge the poster toward a decision.
        </p>
        {loadingListings ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <OpenPostingsList listings={openListings} currentUserId={user?.id} onRemind={setReminding} />
        )}
      </div>

      <ReminderDialog listing={reminding} onOpenChange={(open) => !open && setReminding(null)} />
    </>
  );
}

type PostingBreakdown = { listingId: number; listingTitle: string; count: number; totalFees: number; totalBidValue: number };
type PeriodRow = { key: string; count: number; totalFees: number; totalBidValue: number; postings: PostingBreakdown[] };

function periodKey(ms: number, granularity: "week" | "month"): string {
  const d = new Date(ms);
  if (granularity === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function periodLabel(key: string, granularity: "week" | "month"): string {
  if (granularity === "month") return monthLabel(key);
  const monday = new Date(key);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
}

function groupTransactions(rows: AdminTransaction[], granularity: "week" | "month"): PeriodRow[] {
  const map = new Map<string, PeriodRow>();
  const postingMaps = new Map<string, Map<number, PostingBreakdown>>();

  for (const f of rows) {
    const key = periodKey(f.createdAt, granularity);
    if (!map.has(key)) {
      map.set(key, { key, count: 0, totalFees: 0, totalBidValue: 0, postings: [] });
      postingMaps.set(key, new Map());
    }
    const row = map.get(key)!;
    row.count += 1;
    row.totalFees += f.feeAmount;
    row.totalBidValue += f.bidAmount;

    // Break each period down by the individual posting(s) it came from — a
    // listing with quantityNeeded > 1 can contribute more than one closed
    // bid to the same period.
    const postings = postingMaps.get(key)!;
    if (!postings.has(f.listingId)) {
      postings.set(f.listingId, { listingId: f.listingId, listingTitle: f.listingTitle, count: 0, totalFees: 0, totalBidValue: 0 });
    }
    const posting = postings.get(f.listingId)!;
    posting.count += 1;
    posting.totalFees += f.feeAmount;
    posting.totalBidValue += f.bidAmount;
  }

  map.forEach((row, key) => {
    row.postings = Array.from(postingMaps.get(key)!.values()).sort((a, b) => b.count - a.count || a.listingTitle.localeCompare(b.listingTitle));
  });

  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

function TransactionPeriodList({ rows, granularity }: { rows: PeriodRow[]; granularity: "week" | "month" }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No closed bids yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.key} data-testid={`card-period-${granularity}-${r.key}`}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{periodLabel(r.key, granularity)}</span>
              <div className="text-right">
                <p className="font-display font-semibold text-primary" data-testid={`text-count-${granularity}-${r.key}`}>
                  {r.count} bid{r.count === 1 ? "" : "s"} closed
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSGD(r.totalFees)} in platform fees · {formatSGD(r.totalBidValue)} in job value
                </p>
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                By posting ({r.postings.length})
              </p>
              {r.postings.map((p) => (
                <Link
                  key={p.listingId}
                  href={`/listings/${p.listingId}`}
                  className="flex items-center justify-between gap-3 text-sm hover-elevate rounded-md px-1.5 py-1 -mx-1.5"
                  data-testid={`row-posting-${granularity}-${r.key}-${p.listingId}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="text-xs font-mono text-muted-foreground mr-1.5">#{formatListingNumber(p.listingId)}</span>
                    {p.listingTitle}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {p.count} bid{p.count === 1 ? "" : "s"} · {formatSGD(p.totalFees)} fees
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function OpenPostingsList({
  listings,
  currentUserId,
  onRemind,
}: {
  listings: MyListing[];
  currentUserId?: number;
  onRemind: (l: MyListing) => void;
}) {
  if (listings.length === 0) return <p className="text-sm text-muted-foreground">No open postings right now.</p>;
  return (
    <div className="space-y-2">
      {listings.map((l) => {
        const daysOpen = Math.floor((Date.now() - l.createdAt) / (24 * 60 * 60 * 1000));
        const overdue = daysOpen >= 7;
        const isOwnPosting = l.userId === currentUserId;
        return (
          <Card key={l.id} data-testid={`card-open-posting-${l.id}`} className={overdue ? "border-destructive/40" : undefined}>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <Link href={`/listings/${l.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">#{formatListingNumber(l.id)}</span>
                  <span className="text-xs text-muted-foreground">by {l.ownerName ?? "Unknown"}</span>
                  {overdue && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive uppercase tracking-wide" data-testid={`badge-overdue-${l.id}`}>
                      <AlertTriangle className="h-3 w-3" /> Open {daysOpen} days
                    </span>
                  )}
                </div>
                <h3 className="font-medium mt-1 truncate">{l.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Posted {formatDate(l.createdAt)} · {daysOpen} day{daysOpen === 1 ? "" : "s"} open
                </p>
              </Link>
              {isOwnPosting ? (
                <span className="text-xs text-muted-foreground shrink-0">Your posting</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  onClick={() => onRemind(l)}
                  data-testid={`button-remind-${l.id}`}
                >
                  <Send className="h-3.5 w-3.5" /> Send reminder
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ReminderDialog({ listing, onOpenChange }: { listing: MyListing | null; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");

  useEffect(() => {
    if (!listing) return;
    const daysOpen = Math.floor((Date.now() - listing.createdAt) / (24 * 60 * 60 * 1000));
    setText(
      daysOpen >= 7
        ? `Hi! Your posting "${listing.title}" has been open for ${daysOpen} days. If you've settled on a bid, remember to accept it so the listing can close — if it's no longer needed, let your bidders know. Let us know if you need a hand!`
        : `Hi! Just checking in on your posting "${listing.title}" — let us know if you need any help reviewing bids or closing it out.`
    );
  }, [listing?.id]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!listing) throw new Error("No listing selected");
      const res = await apiRequest("POST", `/api/listings/${listing.id}/messages`, {
        content: text,
        recipientId: listing.userId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reminder sent", description: `${listing?.ownerName ?? "The poster"} will see it in their messages.` });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listing?.id}/participants`] });
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!listing} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a reminder</DialogTitle>
        </DialogHeader>
        {listing && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              To {listing.ownerName ?? "the poster"} about "{listing.title}" (#{formatListingNumber(listing.id)})
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              data-testid="input-reminder-message"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!text.trim() || sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
                data-testid="button-send-reminder"
              >
                Send
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
