import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatListingNumber } from "@/lib/format";
import type { Listing } from "@shared/schema";
import { StatusBadge } from "./status-badge";
import { MapPin } from "lucide-react";

type ListingWithOwner = Listing & { ownerName?: string };

export function ListingCard({ listing, showStatus = false }: { listing: ListingWithOwner; showStatus?: boolean }) {
  return (
    <Link href={`/listings/${listing.id}`} data-testid={`card-listing-${listing.id}`} className="block">
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardContent className="p-4 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
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
