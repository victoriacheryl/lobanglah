import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatListingNumber } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, ShieldCheck, Megaphone, Pencil, Trash2, CalendarClock } from "lucide-react";
import type { Listing, Announcement } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
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

type ListingWithOwner = Listing & { ownerName: string };

/** Converts an epoch-ms timestamp to the local-time string a
 *  <input type="datetime-local"> expects, and back. Scheduling is always
 *  entered/shown in the admin's own local time, converted to a plain epoch
 *  timestamp for the backend. */
function toDateTimeLocal(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromDateTimeLocal(value: string): number {
  return new Date(value).getTime();
}

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");
  const [announceScheduledFor, setAnnounceScheduledFor] = useState("");
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);

  const { data, isLoading } = useQuery<ListingWithOwner[]>({
    queryKey: ["/api/admin/listings/pending"],
    enabled: !!user?.isAdmin,
    refetchOnMount: "always",
  });

  const { data: announcements, isLoading: announcementsLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/admin/announcements"],
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
    mutationFn: async () => {
      const scheduledFor = announceScheduledFor ? fromDateTimeLocal(announceScheduledFor) : undefined;
      const res = await apiRequest("POST", "/api/admin/announcements", { title: announceTitle, body: announceBody, scheduledFor });
      return res.json();
    },
    onSuccess: (row: Announcement) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      toast({
        title: row.publishedAt ? "Announcement sent to all users" : `Scheduled for ${formatDateTime(row.scheduledFor!)}`,
      });
      setAnnounceTitle("");
      setAnnounceBody("");
      setAnnounceScheduledFor("");
    },
    onError: (err: any) => toast({ title: "Could not send announcement", description: err.message, variant: "destructive" }),
  });

  const updateAnnouncementMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Pick<Announcement, "title" | "body">> & { scheduledFor?: number | null } }) => {
      const res = await apiRequest("PATCH", `/api/admin/announcements/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      toast({ title: "Announcement updated" });
      setEditingAnnouncement(null);
    },
    onError: (err: any) => toast({ title: "Could not update announcement", description: err.message, variant: "destructive" }),
  });

  const deleteAnnouncementMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/announcements/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      toast({ title: "Announcement deleted" });
      setDeletingAnnouncement(null);
    },
    onError: (err: any) => toast({ title: "Could not delete announcement", description: err.message, variant: "destructive" }),
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
          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" /> Schedule for later (optional)
            </label>
            <Input
              type="datetime-local"
              value={announceScheduledFor}
              onChange={(e) => setAnnounceScheduledFor(e.target.value)}
              data-testid="input-announcement-schedule"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to send immediately. Otherwise it stays hidden until the date/time you pick.
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!announceTitle.trim() || !announceBody.trim() || announceMutation.isPending}
            onClick={() => announceMutation.mutate()}
            data-testid="button-send-announcement"
          >
            <Megaphone className="h-4 w-4" />
            {announceScheduledFor && fromDateTimeLocal(announceScheduledFor) > Date.now() ? "Schedule announcement" : "Send to all users"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-medium text-sm flex items-center gap-1.5">
          <Megaphone className="h-4 w-4 text-accent" /> Announcements
        </h2>
        {announcementsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : !announcements || announcements.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2" data-testid="text-announcements-empty">
            No announcements yet.
          </p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => {
              const isPending = !a.publishedAt;
              return (
                <Card key={a.id} data-testid={`card-announcement-${a.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-sm" data-testid={`text-announcement-title-${a.id}`}>{a.title}</h3>
                          {isPending ? (
                            <Badge variant="outline" className="bg-chart-2/15 text-chart-2 border-chart-2/30 text-[11px]" data-testid={`badge-scheduled-${a.id}`}>
                              Scheduled for {formatDateTime(a.scheduledFor!)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[11px]" data-testid={`badge-published-${a.id}`}>
                              Published {formatDateTime(a.publishedAt!)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{a.body}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8"
                          onClick={() => setEditingAnnouncement(a)}
                          data-testid={`button-edit-announcement-${a.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-destructive hover:text-destructive"
                          onClick={() => setDeletingAnnouncement(a)}
                          data-testid={`button-delete-announcement-${a.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

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

      <EditAnnouncementDialog
        announcement={editingAnnouncement}
        onOpenChange={(open) => !open && setEditingAnnouncement(null)}
        onSave={(patch) => editingAnnouncement && updateAnnouncementMutation.mutate({ id: editingAnnouncement.id, patch })}
        saving={updateAnnouncementMutation.isPending}
      />

      <AlertDialog open={!!deletingAnnouncement} onOpenChange={(open) => !open && setDeletingAnnouncement(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingAnnouncement && (
                <>
                  "{deletingAnnouncement.title}" will be removed from the announcement board and this list. Anyone
                  who already received it in their notifications keeps that copy.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteAnnouncementMutation.isPending}
              onClick={() => deletingAnnouncement && deleteAnnouncementMutation.mutate(deletingAnnouncement.id)}
              data-testid="button-confirm-delete-announcement"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditAnnouncementDialog({
  announcement,
  onOpenChange,
  onSave,
  saving,
}: {
  announcement: Announcement | null;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: { title: string; body: string; scheduledFor?: number | null }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  // Re-seed the form fields whenever a different announcement is opened for
  // editing (or the dialog closes and reopens on the same one).
  const [loadedId, setLoadedId] = useState<number | null>(null);
  if (announcement && announcement.id !== loadedId) {
    setLoadedId(announcement.id);
    setTitle(announcement.title);
    setBody(announcement.body);
    setScheduledFor(announcement.scheduledFor ? toDateTimeLocal(announcement.scheduledFor) : "");
  }

  const isPending = !!announcement && !announcement.publishedAt;

  return (
    <Dialog open={!!announcement} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit announcement</DialogTitle>
        </DialogHeader>
        {announcement && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-edit-announcement-title" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Body</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                data-testid="input-edit-announcement-body"
              />
            </div>
            {isPending ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" /> Scheduled for
                </label>
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  data-testid="input-edit-announcement-schedule"
                />
                <p className="text-xs text-muted-foreground">
                  Clear this to publish immediately instead of waiting for the scheduled time.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Already published — the schedule is locked, but the text above can still be corrected.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!title.trim() || !body.trim() || saving}
                onClick={() =>
                  onSave({
                    title: title.trim(),
                    body: body.trim(),
                    ...(isPending ? { scheduledFor: scheduledFor ? fromDateTimeLocal(scheduledFor) : null } : {}),
                  })
                }
                data-testid="button-save-announcement"
              >
                Save changes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
