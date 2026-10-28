import type { Book } from "@/lib/types";
import { inventoryState, inventoryTimestamp, type InventoryRow } from "@/lib/inventory-view";
import { Badge } from "./ui";

export function EditionDetails({ book }: { book: Book }) {
  return <span className="cell-sub">SKU {book.sku} · ISBN {book.isbn13} · {book.format} · {book.language}</span>;
}

export function InventoryState({ book }: { book: InventoryRow }) {
  const state = inventoryState(book);
  return <><Badge tone={state === "Eligible at last refresh" ? "green" : "amber"}>{state}</Badge><span className="cell-sub">Mapping: {book.mappingStatus}</span><span className="cell-sub">Observed: <time dateTime={book.observedAt}>{inventoryTimestamp(book.observedAt)}</time></span></>;
}
