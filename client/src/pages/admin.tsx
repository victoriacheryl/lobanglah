import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatListingNumber } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, ShieldCheck, Megaphone } from "lucide-react";
import type { Listing } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";

type ListingWithOwner = Listing & { ownerName: string };

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");

  const { data, isLoading } = useQuery<ListingWithOwner[]>({
    queryKey: ["/api/admin/listings/pending"],
    enabled: !!user?.isAdmin,
    refetchOnMount: "always",
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/listings/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/listings/pending"] });
      toast({ title: "Listing approved and now live" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("POST", `/api/admin/listings/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/listings/pending"] });
      toast({ title: "Listing rejected" });
    },
  });

  const announceMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/announcements", { title: announceTitle, body: announceBody }),
    onSuccess: () => {
      toast({ title: "Announcement sent to all users" });
      setAnnounceTitle("");
      setAnnounceBody("");
    },
    onError: (err: any) => toast({ title: "Could not send announcement", description: err.message, variant: "destructive" }),
  });

  if (!user?.isAdmin) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1 flex items-center gap-2" data-testid="text-page-title">
          <ShieldCheck className="h-5 w-5 text-accent" /> Listing review
        </h1>
        <p className="text-sm text-muted-foreground">Approve or reject listings before they go live to the public.</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-medium text-sm flex items-center gap-1.5">
            <Megaphone className="h-4 w-4 text-accent" /> Send an announcement
          </h2>
          <p className="text-xs text-muted-foreground">Posts a notification to every registered user's bell.</p>
          <Input
            placeholder="Announcement title"
            value={announceTitle}
            onChange={(e) => setAnnounceTitle(e.target.value)}
            data-testid="input-announcement-title"
          />
          <Textarea
            placeholder="Announcement details..."
            value={announceBody}
            onChange={(e) => setAnnounceBody(e.target.value)}
            className="min-h-20"
            data-testid="input-announcement-body"
          />
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!announceTitle.trim() || !announceBody.trim() || announceMutation.isPending}
            onClick={() => announceMutation.mutate()}
            data-testid="button-send-announcement"
          >
            <Megaphone className="h-4 w-4" /> Send to all users
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-empty-state">
          Nothing pending review. All caught up!
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((l) => (
            <Card key={l.id} data-testid={`card-pending-${l.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      <span className="font-mono normal-case" data-testid={`text-listing-number-${l.id}`}>#{formatListingNumber(l.id)}</span> ·{" "}
                      {l.type === "seek" ? "Seeking" : "Offering"} · {l.category} · {l.location} · by {l.ownerName}
                    </p>
                    <h3 className="font-medium mt-0.5">{l.title}</h3>
                  </div>
                  <span className="font-display font-semibold text-primary shrink-0">{l.price}</span>
                </div>
                <p className="text-sm text-muted-foreground">{l.description}</p>
                <p className="text-xs text-muted-foreground">Submitted {formatDate(l.createdAt)}</p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => approveMutation.mutate(l.id)}
                    disabled={approveMutation.isPending}
                    data-testid={`button-approve-${l.id}`}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                  <Input
                    placeholder="Rejection reason"
                    className="h-9 max-w-56"
                    value={reasons[l.id] ?? ""}
                    onChange={(e) => setReasons((r) => ({ ...r, [l.id]: e.target.value }))}
                    data-testid={`input-reason-${l.id}`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => rejectMutation.mutate({ id: l.id, reason: reasons[l.id] || "Did not meet guidelines" })}
                    disabled={rejectMutation.isPending}
                    data-testid={`button-reject-${l.id}`}
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
