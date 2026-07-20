import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Bell, FileCheck2, Gavel, CheckCircle2, HandCoins, XCircle, Megaphone, MessageCircle, RotateCcw, Ban } from "lucide-react";
import { useState } from "react";
import type { Notification } from "@shared/schema";
import { formatDateTime } from "@/lib/format";
import { useLocation } from "wouter";

const ICONS: Record<string, React.ElementType> = {
  new_posting_review: FileCheck2,
  new_bid: Gavel,
  bid_accepted: CheckCircle2,
  bid_rejected: XCircle,
  bid_removed: XCircle,
  bid_cancelled: Ban,
  bid_reopened: RotateCcw,
  bid_reopen_requested: RotateCcw,
  new_message: MessageCircle,
  fee_paid: HandCoins,
  listing_approved: CheckCircle2,
  listing_rejected: XCircle,
  announcement: Megaphone,
};

// Every bid-related notification lands the reader on the listing's Bids tab
// — this is where accept/reject/edit/cancel/reopen all live.
const BIDS_TAB_TYPES = new Set([
  "new_bid",
  "bid_accepted",
  "bid_rejected",
  "bid_removed",
  "bid_cancelled",
  "bid_reopened",
  "bid_reopen_requested",
]);

export function NotificationBell() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 15000,
    refetchOnMount: "always",
  });

  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: !!user,
    refetchInterval: 15000,
    refetchOnMount: "always",
  });

  const readAllMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/notifications/read-all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const readOneMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  if (!user) return null;
  const count = unread?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="button-notification-bell"
          aria-label="Notifications"
          className="relative p-2 rounded-md hover-elevate text-foreground/70 hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span
              data-testid="badge-unread-count"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-medium">Notifications</span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              data-testid="button-mark-all-read"
              onClick={() => readAllMutation.mutate()}
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!notifications || notifications.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No notifications yet.</p>
          ) : (
            notifications.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  data-testid={`notification-${n.id}`}
                  onClick={() => {
                    if (!n.read) readOneMutation.mutate(n.id);
                    if (n.type === "new_posting_review") {
                      navigate("/admin");
                    } else if (n.type === "new_message" && n.relatedListingId) {
                      // Jump straight to the Messages tab (and the right
                      // conversation, if we know who it's with) instead of
                      // dropping the user on Bids and making them go find it.
                      const params = new URLSearchParams({ tab: "messages" });
                      if (n.relatedUserId) params.set("participant", String(n.relatedUserId));
                      navigate(`/listings/${n.relatedListingId}?${params.toString()}`);
                    } else if (BIDS_TAB_TYPES.has(n.type) && n.relatedListingId) {
                      // Land directly on the Bids tab — explicit query param
                      // rather than relying on it being the default tab —
                      // where accept/reject/edit/cancel/reopen all live.
                      navigate(`/listings/${n.relatedListingId}?tab=bids`);
                    } else if (n.relatedListingId) {
                      navigate(`/listings/${n.relatedListingId}`);
                    }
                    // Always close the popover on click, even for notifications
                    // with no destination (e.g. announcements) — otherwise a click
                    // on those appears to do nothing.
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 border-b border-border last:border-b-0 flex items-start gap-2.5 hover-elevate ${
                    n.read ? "" : "bg-primary/5"
                  }`}
                >
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatDateTime(n.createdAt)}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
