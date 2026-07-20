import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { Search, Clock, Ban, Trash2, RotateCcw, Users as UsersIcon } from "lucide-react";

// Matches toPublicUser() on the server: the full User row minus password.
type AdminUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  isAdmin: boolean;
  status: "active" | "suspended" | "banned";
  suspendedUntil: number | null;
  restrictionReason: string | null;
  createdAt: number;
};

const SUSPEND_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
];

export default function Users() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [suspending, setSuspending] = useState<AdminUser | null>(null);
  const [banning, setBanning] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    refetchOnMount: "always",
  });

  const q = search.trim().toLowerCase();
  const filtered = (data ?? []).filter((u) => {
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.phone.toLowerCase().includes(q);
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/users/${id}/reactivate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Account reactivated" });
    },
    onError: (err: any) => toast({ title: "Could not reactivate", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Account deleted", description: "Their postings, bids, and messages were removed too." });
      setDeleting(null);
    },
    onError: (err: any) => toast({ title: "Could not delete", description: err.message, variant: "destructive" }),
  });

  if (!user?.isAdmin) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold mb-1 flex items-center gap-2" data-testid="text-page-title">
          <UsersIcon className="h-5 w-5 text-accent" /> User List
        </h1>
        <p className="text-sm text-muted-foreground">
          Search, suspend, ban, or delete accounts. Suspended and banned users lose access to everything —
          including viewing their own postings — until reactivated.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, or phone..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-user-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="text-center py-12 space-y-2" data-testid="text-error-state">
          <p className="text-sm text-destructive">Couldn't load users: {(error as any)?.message ?? "Unknown error"}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12" data-testid="text-empty-state">
          {search ? "No users match your search." : "No users yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((u) => (
            <UserRow
              key={u.id}
              u={u}
              isSelf={u.id === user.id}
              onSuspend={() => setSuspending(u)}
              onBan={() => setBanning(u)}
              onReactivate={() => reactivateMutation.mutate(u.id)}
              onDelete={() => setDeleting(u)}
              reactivating={reactivateMutation.isPending}
            />
          ))}
        </div>
      )}

      <SuspendDialog listing={suspending} onOpenChange={(open) => !open && setSuspending(null)} />
      <BanDialog user={banning} onOpenChange={(open) => !open && setBanning(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  This permanently removes {deleting.name} ({deleting.email}), along with every posting, bid,
                  message, and notification tied to them. This can't be undone.
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
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UserStatusBadge({ u }: { u: AdminUser }) {
  if (u.status === "banned") {
    return (
      <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 font-medium text-xs" data-testid={`status-banned-${u.id}`}>
        Banned
      </Badge>
    );
  }
  if (u.status === "suspended" && u.suspendedUntil) {
    return (
      <Badge variant="outline" className="bg-chart-2/15 text-chart-2 border-chart-2/30 font-medium text-xs" data-testid={`status-suspended-${u.id}`}>
        Suspended until {formatDateTime(u.suspendedUntil)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-accent/15 text-accent border-accent/30 font-medium text-xs" data-testid={`status-active-${u.id}`}>
      Active
    </Badge>
  );
}

function UserRow({
  u,
  isSelf,
  onSuspend,
  onBan,
  onReactivate,
  onDelete,
  reactivating,
}: {
  u: AdminUser;
  isSelf: boolean;
  onSuspend: () => void;
  onBan: () => void;
  onReactivate: () => void;
  onDelete: () => void;
  reactivating: boolean;
}) {
  const restricted = u.status !== "active";

  return (
    <Card data-testid={`card-user-${u.id}`}>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{u.name}</span>
            {u.isAdmin && (
              <Badge variant="outline" className="text-xs" data-testid={`badge-admin-${u.id}`}>
                Admin
              </Badge>
            )}
            <UserStatusBadge u={u} />
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {u.email} · {u.phone}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Joined {formatDateTime(u.createdAt)}
            {restricted && u.restrictionReason ? ` · Reason: ${u.restrictionReason}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isSelf ? (
            <span className="text-xs text-muted-foreground">You</span>
          ) : u.isAdmin ? (
            <span className="text-xs text-muted-foreground">Admin account</span>
          ) : restricted ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={onReactivate}
                disabled={reactivating}
                data-testid={`button-reactivate-${u.id}`}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reactivate
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={onDelete}
                data-testid={`button-delete-user-${u.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onSuspend} data-testid={`button-suspend-${u.id}`}>
                <Clock className="h-3.5 w-3.5" /> Suspend
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onBan} data-testid={`button-ban-${u.id}`}>
                <Ban className="h-3.5 w-3.5" /> Ban
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={onDelete}
                data-testid={`button-delete-user-${u.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SuspendDialog({ listing, onOpenChange }: { listing: AdminUser | null; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");

  const suspendMutation = useMutation({
    mutationFn: async () => {
      if (!listing) throw new Error("No user selected");
      const untilMs = Date.now() + Number(days) * 24 * 60 * 60 * 1000;
      const res = await apiRequest("POST", `/api/admin/users/${listing.id}/suspend`, { untilMs, reason: reason.trim() || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Account suspended", description: `${listing?.name} is suspended for ${days} day${days === "1" ? "" : "s"}.` });
      setReason("");
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Could not suspend", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!listing} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspend account</DialogTitle>
        </DialogHeader>
        {listing && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {listing.name} ({listing.email}) won't be able to sign in or use the app until the suspension lifts.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Duration</label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger data-testid="select-suspend-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUSPEND_PRESETS.map((p) => (
                    <SelectItem key={p.days} value={String(p.days)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Reason (optional, shown to the user)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Repeated no-shows after accepting bids"
                data-testid="input-suspend-reason"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={suspendMutation.isPending} onClick={() => suspendMutation.mutate()} data-testid="button-confirm-suspend">
                Suspend for {SUSPEND_PRESETS.find((p) => String(p.days) === days)?.label ?? `${days} days`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BanDialog({ user, onOpenChange }: { user: AdminUser | null; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const banMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No user selected");
      const res = await apiRequest("POST", `/api/admin/users/${user.id}/ban`, { reason: reason.trim() || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Account banned", description: `${user?.name} is banned indefinitely.` });
      setReason("");
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Could not ban", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban account</DialogTitle>
        </DialogHeader>
        {user && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {user.name} ({user.email}) will be banned indefinitely — they lose access until you reactivate the
              account. Unlike deleting, their history is kept.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Reason (optional, shown to the user)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Violated platform guidelines"
                data-testid="input-ban-reason"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={banMutation.isPending}
                onClick={() => banMutation.mutate()}
                data-testid="button-confirm-ban"
              >
                Ban account
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
