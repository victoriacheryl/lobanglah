import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListingCard } from "@/components/listing-card";
import { CATEGORIES, formatDate, formatDateTime } from "@/lib/format";
import { Search, Users, ShieldCheck, HandCoins, PlusCircle, Megaphone, ShieldAlert } from "lucide-react";
import type { Listing } from "@shared/schema";
import { SG_TOWNS } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

type ListingWithOwner = Listing & { ownerName: string };
type AnnouncementItem = { id: number; title: string; body: string; createdAt: number };
type RestrictedUser = {
  id: number;
  name: string;
  status: "suspended" | "banned";
  restrictionReason: string | null;
  suspendedUntil: number | null;
};

export default function Home() {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [location, setLocation] = useState<string>("all");
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (category !== "all") params.set("category", category);
  if (location !== "all") params.set("location", location);
  if (q) params.set("q", q);
  const qs = params.toString();

  const { data, isLoading } = useQuery<ListingWithOwner[]>({
    queryKey: [`/api/listings${qs ? `?${qs}` : ""}`],
    refetchOnMount: "always",
  });

  const { data: announcements } = useQuery<AnnouncementItem[]>({
    queryKey: ["/api/announcements"],
  });
  const { data: restrictedUsers } = useQuery<RestrictedUser[]>({
    queryKey: ["/api/restricted-users"],
  });
  const hasBoardContent = (announcements && announcements.length > 0) || (restrictedUsers && restrictedUsers.length > 0);

  // Clicking an "announcement" notification links here with
  // ?scrollTo=announcements so the reader lands right on the board instead
  // of having to scroll and find it themselves.
  const search = useSearch();
  const scrollToAnnouncements = new URLSearchParams(search).get("scrollTo") === "announcements";
  const boardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (scrollToAnnouncements && hasBoardContent) {
      boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToAnnouncements, hasBoardContent]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      {hasBoardContent && (
        <section
          ref={boardRef}
          className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          data-testid="section-announcement-board"
        >
          <div className="h-1 w-full bg-gradient-to-r from-primary via-accent to-primary" />
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                <Megaphone className="h-4 w-4 text-primary" />
              </span>
              <h2 className="font-display text-base font-semibold" data-testid="text-announcement-board-title">
                Announcement Board
              </h2>
              {announcements && announcements.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                  {announcements.length}
                </span>
              )}
            </div>

            {announcements && announcements.length > 0 && (
              <div className="space-y-2.5">
                {announcements.map((a) => {
                  const isNew = Date.now() - a.createdAt < 24 * 60 * 60 * 1000;
                  return (
                    <div
                      key={a.id}
                      className="group rounded-lg bg-muted/50 hover:bg-muted/80 border-l-2 border-primary p-3.5 transition-colors"
                      data-testid={`card-announcement-${a.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          {a.title}
                          {isNew && (
                            <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 py-0" variant="outline">
                              New
                            </Badge>
                          )}
                        </h3>
                        <span className="text-[11px] text-muted-foreground shrink-0">{formatDate(a.createdAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1.5 pl-3.5 whitespace-pre-wrap">{a.body}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {restrictedUsers && restrictedUsers.length > 0 && (
              <div className={announcements && announcements.length > 0 ? "space-y-2.5 pt-4 border-t border-border" : "space-y-2.5"}>
                <p className="flex items-center gap-1.5 text-xs font-medium text-destructive uppercase tracking-wide">
                  <ShieldAlert className="h-3.5 w-3.5" /> Account Restrictions
                </p>
                <div className="space-y-2">
                  {restrictedUsers.map((u) => (
                    <div
                      key={u.id}
                      className={`flex items-start justify-between gap-3 text-sm rounded-lg border-l-2 p-3.5 transition-colors bg-gradient-to-r ${
                        u.status === "banned"
                          ? "from-destructive/20 via-destructive/10 to-transparent hover:from-destructive/25 border-destructive"
                          : "from-chart-2/20 via-chart-2/10 to-transparent hover:from-chart-2/25 border-chart-2"
                      }`}
                      data-testid={`row-restricted-${u.id}`}
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{u.name}</span>
                        {u.restrictionReason && (
                          <p className="text-xs text-muted-foreground mt-0.5">Reason: {u.restrictionReason}</p>
                        )}
                      </div>
                      {u.status === "banned" ? (
                        <Badge
                          variant="outline"
                          className="bg-destructive/15 text-destructive border-destructive/30 font-medium text-xs shrink-0"
                          data-testid={`status-banned-${u.id}`}
                        >
                          Banned
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-chart-2/15 text-chart-2 border-chart-2/30 font-medium text-xs shrink-0"
                          data-testid={`status-suspended-${u.id}`}
                        >
                          {u.suspendedUntil ? `Suspended until ${formatDateTime(u.suspendedUntil)}` : "Suspended"}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div>
          <h1 className="font-display text-xl font-semibold" data-testid="text-page-title">
            Find help, or offer yours — right in your neighbourhood
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            LobangLah! connects Singapore residents to seek or offer services and goods, with admin-reviewed
            listings and a small platform fee charged to the poster only when a bid is accepted.
          </p>
        </div>
        <Button
          size="lg"
          className="mt-5"
          data-testid="button-post-lobang"
          onClick={() => navigate(user ? "/post" : "/register")}
        >
          <PlusCircle className="h-4 w-4 mr-2" /> Post a Lobang
        </Button>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-accent shrink-0" /> Every listing is admin-reviewed
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <HandCoins className="h-4 w-4 text-accent shrink-0" /> Posters only pay a small fee on bid acceptance
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4 text-accent shrink-0" /> Contact details stay private until you're ready
          </div>
        </div>
      </section>

      <section className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search listings, e.g. aircon servicing, tuition..."
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-md border border-border p-1 gap-1" role="group" aria-label="Filter by type">
          {([
            { value: "all", label: "All types" },
            { value: "seek", label: "Seeking" },
            { value: "offer", label: "Offering" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`button-type-${opt.value}`}
              aria-pressed={type === opt.value}
              onClick={() => setType(opt.value)}
              className={`px-3 py-1.5 rounded-sm text-sm font-medium transition-colors whitespace-nowrap ${
                type === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-44" data-testid="select-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={location} onValueChange={setLocation}>
          <SelectTrigger className="sm:w-44" data-testid="select-location-filter">
            <SelectValue placeholder="Town" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All towns</SelectItem>
            {SG_TOWNS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground" data-testid="text-empty-state">
            {qs ? (
              <>
                No listings match your search or filters.{" "}
                <button
                  data-testid="button-clear-filters"
                  className="text-primary underline underline-offset-2"
                  onClick={() => {
                    setQ("");
                    setType("all");
                    setCategory("all");
                    setLocation("all");
                  }}
                >
                  Clear filters
                </button>{" "}
                to see everything.
              </>
            ) : (
              "No listings posted yet. Be the first to post one!"
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
