import type { Book } from "./types";

export type InventoryRow = Book & { eligible: boolean; effectiveQuantity: number };

// Presentation only. The server remains authoritative for selection and writes.
export function inventoryState(book: InventoryRow, now = Date.now()) {
  if (book.mappingStatus === "excluded") return "Excluded";
  if (book.mappingStatus !== "confirmed") return "Needs identity review";
  if (!book.entityId) return "Identity missing";
  const observed = Date.parse(book.observedAt);
  if (!Number.isFinite(observed)) return "Snapshot time missing";
  if (observed > now + 300000) return "Future snapshot — check time";
  if (now - observed > 86400000) return "Stale snapshot — confirm stock";
  if (book.effectiveQuantity <= 0) return "Out of stock";
  if (book.currency !== "USD") return "Unsupported currency";
  return book.eligible ? "Eligible at last refresh" : "Unavailable — review bookseller rules";
}

export function inventoryTimestamp(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "Unknown snapshot time";
}
