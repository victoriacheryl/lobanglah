import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatListingNumber, daysLeft } from "@/lib/format";
import type { Listing } from "@shared/schema";
import { StatusBadge } from "./status-badge";
import { MapPin, Clock } from "lucide-react";

type ListingWithOwner = Listing & { ownerName?: string };

export function ListingCard({ listing, showStatus = false }: { listing: ListingWithOwner; showStatus?: boolean }) {
  // Only live listings are actually counting down to auto-close — pending,
  // rejected, and already-closed ones have nothing left to show here.
  const remaining = listing.status === "live" && listing.expiresAt ? daysLeft(listing.expiresAt) : null;
  const urgent = remaining !== null && remaining <= 2;
  const closingLabel = remaining === 0 ? "Closes today" : remaining === 1 ? "Closes tomorrow" : `${remaining} days left`;

  return (
    <Link href={`/listings/${listing.id}`} data-testid={`card-listing-${listing.id}`} className="block">
        <Card className={`h-full transition-shadow hover:shadow-md ${urgent ? "ring-1 ring-destructive/40" : ""}`}>
          <CardContent className="p-4 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={
                    listing.type === "seek"
                      ? "bg-chart-2/15 text-chart-2 border-chart-2/30 text-xs"
                      : "bg-primary/10 text-primary border-primary/30 text-xs"
                  }
                >
                  {listing.type === "seek" ? "Seeking" : "Offering"}
                </Badge>
                {showStatus && <StatusBadge status={listing.status} />}
                {remaining !== null && (
                  <Badge
                    variant="outline"
                    className={`gap-1 text-xs font-semibold ${
                      urgent
                        ? "bg-destructive/15 text-destructive border-destructive/30 animate-pulse"
                        : "bg-chart-3/15 text-chart-3 border-chart-3/30"
                    }`}
                    data-testid={`badge-closing-${listing.id}`}
                  >
                    <Clock className="h-3 w-3 shrink-0" /> {closingLabel}
                  </Badge>
                )}
              </div>
              <span className="text-xs font-mono text-muted-foreground shrink-0" data-testid={`text-listing-number-${listing.id}`}>
                #{formatListingNumber(listing.id)}
              </span>
            </div>
            <h3 className="font-display font-semibold text-base leading-snug line-clamp-2" data-testid={`text-title-${listing.id}`}>
              {listing.title}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2">{listing.description}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-location-${listing.id}`}>
              <MapPin className="h-3 w-3 shrink-0" /> {listing.location}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{listing.category}</span>
              <span className="font-display font-semibold text-primary" data-testid={`text-price-${listing.id}`}>
                {listing.price}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border mt-1">
              <span>{listing.ownerName ?? ""}</span>
              <span>{formatDate(listing.createdAt)}</span>
            </div>
          </CardContent>
        </Card>
    </Link>
  );
}
