import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { rulePass } from "@/lib/display-review";
export { rulePass } from "@/lib/display-review";
import type { Book, Campaign, Store } from "@/lib/types";

export const id = () => randomUUID();
export const secret = () => randomBytes(32).toString("hex");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const now = () => new Date().toISOString();
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) { super(message.slice(0, 200)); }
}
export function requireThat(value: unknown, code: string, message: string, status = 409): asserts value {
  if (!value) throw new AppError(code, message, status);
}
export const schemas = {
  revision: z.object({ expectedRevision: z.number().int().positive() }).strict(),
  draft: z.object({ title: z.string().trim().min(1).max(200), candidateSkus: z.array(z.string().max(80)).min(1).max(500), ruleRevisionIds: z.array(z.string().uuid()) }).strict(),
  recommendation: z.object({ interestIds: z.array(z.string().min(1).max(200)).min(1).max(3).refine(x => new Set(x).size === x.length), budgetMinor: z.number().int().min(0).max(1000000), excludedSkus: z.array(z.string().min(1).max(80)).max(100).refine(x => new Set(x).size === x.length) }).strict(),
  outcome: z.object({ type: z.enum(["purchase", "return", "correction"]), sessionCode: z.string().min(1).max(200).optional(), sku: z.string().min(1).max(80), quantity: z.number().int().positive().max(100), amountMinor: z.number().int().nonnegative().max(10000000), currency: z.literal("USD"), occurredAt: z.string().datetime(), receiptReference: z.string().min(1).max(200), parentEventId: z.string().uuid().optional(), reason: z.string().min(1).max(500).optional() }).strict()
};
export function revision(actual: number, expected: unknown) {
  requireThat(actual === expected, "CONFLICT", "This record changed. Reload and review the latest version.");
}
export function ruleViolations(store: Store, campaign: Campaign) {
  return store.rules.filter(r => r.active && (r.scope === "store" || r.campaignId === campaign.id)).flatMap(r =>
    store.books.filter(b => campaign.candidateSkus.includes(b.sku) && (!(Date.parse(r.reviewAt) > Date.now()) || !rulePass(r, b))).map(b => ({ ruleId: r.id, sku: b.sku, message: !(Date.parse(r.reviewAt) > Date.now()) ? "Rule review expired; renew or disable after review." : `${b.title} does not pass ${r.type}.` })));
}
export function effectiveQuantity(store: Store, book: Book) {
  const purchases = store.outcomes.filter(o => o.type === "purchase" && o.sku === book.sku && Date.parse(o.occurredAt) > Date.parse(book.observedAt));
  // Returned stock must be confirmed by a fresh import; it is never automatically offered again.
  return Math.max(0, book.onHand - purchases.reduce((n, o) => n + o.quantity - store.outcomes.filter(c=>c.type==="correction"&&c.parentEventId===o.id).reduce((q,c)=>q+c.quantity,0), 0));
}
export function eligible(store: Store, book: Book, budget = Infinity, campaign?: Campaign) {
  const fresh = Date.now() - Date.parse(book.observedAt) <= 86400000 && Date.parse(book.observedAt) <= Date.now() + 300000;
  const applicable = store.rules.filter(r => r.active && (r.scope === "store" || r.campaignId === campaign?.id));
  return fresh && effectiveQuantity(store, book) > 0 && book.priceMinor <= budget && book.currency === "USD"
    && book.mappingStatus === "confirmed" && !!book.entityId && (!campaign || campaign.candidateSkus.includes(book.sku))
    && applicable.every(r => Date.parse(r.reviewAt) > Date.now() && rulePass(r, book));
}
export const wireBook = (store: Store, book: Book) => ({ ...book, effectiveQuantity: effectiveQuantity(store, book), eligible: eligible(store, book) });
export function safeCell(value: unknown) { const text = String(value ?? ""); return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; }
export function csvCell(value: unknown) { return `"${safeCell(value).replaceAll('"', '""')}"`; }
export function checkIsbn(isbn: string) {
  if (!/^\d{13}$/.test(isbn)) return false;
  const sum = [...isbn].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0;
}
const header = ["sku", "isbn13", "title", "author", "format", "language", "price_minor", "currency", "on_hand", "shelf", "stock_observed_at", "units_sold_90d"];
export function previewCsv(csv: string, existing: Book[] = []) {
  requireThat(Buffer.byteLength(csv, "utf8") <= 1048576, "INVALID_INPUT", "CSV must be at most 1 MiB.", 413);
  let rows: Record<string, string>[];
  try { rows = parse(csv.replace(/^\uFEFF/, ""), { columns: true, skip_empty_lines: true, trim: true, max_record_size: 16384 }); }
  catch { throw new AppError("INVALID_INPUT", "CSV could not be read. Check quoting and column counts."); }
  requireThat(rows.length > 0 && rows.length <= 500, "INVALID_INPUT", "Include between 1 and 500 inventory rows.",400);
  requireThat(header.every(h => Object.hasOwn(rows[0], h)), "INVALID_INPUT", `Required columns: ${header.join(", ")}`,400);
  const books: Book[] = [], errors: {row: number; field: string; message: string}[] = [], acceptedRowNumbers: number[] = [];
  const duplicate = new Set<string>(), seen = new Set<string>();
  for (const row of rows) { if (seen.has(row.sku)) duplicate.add(row.sku); seen.add(row.sku); }
  rows.forEach((row, index) => {
    const before = errors.length;
    const err = (field: string, message: string) => errors.push({ row: index + 1, field, message });
    for (const field of ["sku", "title", "author", "format", "language", "shelf"]) if (!row[field] || row[field].length > (field === "title" || field === "author" ? 200 : 80)) err(field, "Required text is missing or too long.");
    if (duplicate.has(row.sku)) err("sku", "Duplicate SKU. Each edition needs one row.");
    if (!checkIsbn(row.isbn13)) err("isbn13", "Use a valid ISBN-13 with a correct check digit.");
    for (const field of ["price_minor", "on_hand", "units_sold_90d"]) if (!/^\d+$/.test(row[field]) || !Number.isSafeInteger(Number(row[field]))) err(field, "Use a nonnegative integer.");
    if (row.currency !== "USD") err("currency", "This demo store uses USD only.");
    if (!Number.isFinite(Date.parse(row.stock_observed_at)) || Date.parse(row.stock_observed_at) > Date.now() + 300000) err("stock_observed_at", "Use a valid timestamp no more than five minutes in the future.");
    if (before !== errors.length) return;
    const old = existing.find(b => b.sku === row.sku && b.isbn13 === row.isbn13 && b.author === row.author && b.title === row.title);
    books.push({ sku: row.sku, isbn13: row.isbn13, title: row.title, author: row.author, format: row.format, language: row.language,
      priceMinor: Number(row.price_minor), currency: row.currency, onHand: Number(row.on_hand), shelf: row.shelf,
      observedAt: new Date(row.stock_observed_at).toISOString(), unitsSold90d: Number(row.units_sold_90d),
      mappingId: old?.mappingId ?? id(), mappingStatus: old?.mappingStatus ?? "unresolved", entityId: old?.entityId,
      tags: old?.tags ?? [], color: old?.color ?? "#355e59", revision: (old?.revision ?? 0) + 1 });
    acceptedRowNumbers.push(index + 1);
  });
  return { books, errors, acceptedRowNumbers, rowCount: rows.length };
}
export function sampleCsv(books: Book[]) {
  return header.join(",") + "\n" + books.map(b => [b.sku,b.isbn13,b.title,b.author,b.format,b.language,b.priceMinor,b.currency,b.onHand,b.shelf,now(),b.unitsSold90d].map(csvCell).join(",")).join("\n");
}
export function audit(store: Store, action: string, target: string) { store.audit.push({ id: id(), action, at: now(), target }); }
