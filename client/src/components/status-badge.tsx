import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  live: "bg-accent/15 text-accent border-accent/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  closed: "bg-muted text-muted-foreground border-border",
  accepted: "bg-accent/15 text-accent border-accent/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  paid: "bg-accent/15 text-accent border-accent/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  live: "Live",
  rejected: "Rejected",
  closed: "Closed",
  accepted: "Accepted",
  cancelled: "Cancelled",
  paid: "Fee paid",
  failed: "Payment failed",
};

export function StatusBadge({ status, context }: { status: string; context?: "listing" | "bid" | "fee" }) {
  let label = STATUS_LABELS[status] ?? status;
  if (context === "bid" && status === "pending") label = "Pending";
  if (context === "fee" && status === "pending") label = "Awaiting payment";
  return (
    <Badge
      variant="outline"
      data-testid={`status-${status}`}
      className={`${STATUS_STYLES[status] ?? ""} font-medium text-xs`}
    >
      {label}
    </Badge>
  );
}
