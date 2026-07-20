export function formatSGD(amount: number): string {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(amount);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysLeft(deadlineMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Listing reference numbers shown in the UI (e.g. "#1600001") are just the
// listing's real database id offset by this base — purely a display format,
// not a separate id. Listing id 1 becomes 1600001, id 2 becomes 1600002, etc.
const LISTING_NUMBER_BASE = 1_600_000;

export function formatListingNumber(id: number): string {
  return String(LISTING_NUMBER_BASE + id);
}

export const CATEGORIES = [
  "Home Services",
  "Tutoring",
  "Tech & Repairs",
  "Moving & Delivery",
  "Beauty & Wellness",
  "Events",
  "Pet Care",
  "Other",
] as const;
