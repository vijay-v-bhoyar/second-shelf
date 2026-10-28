import { z } from "zod";
import type { Outcome } from "./types";

// Browser recovery envelope only. Server validation and actor authorization remain authoritative.
const bodySchema=z.object({type:z.enum(["purchase","return","correction"]),sku:z.string().min(1).max(80),quantity:z.number().int().min(1).max(100),amountMinor:z.number().int().min(0).max(10000000),currency:z.literal("USD"),occurredAt:z.string().datetime(),receiptReference:z.string().min(1).max(200),sessionCode:z.string().min(1).max(200).optional(),parentEventId:z.string().uuid().optional(),reason:z.string().min(1).max(500).optional()}).strict();
const intentSchema=z.object({version:z.literal(1),key:z.string().uuid(),body:bodySchema,eventId:z.string().uuid().optional()}).strict();
export type OutcomeBody=z.infer<typeof bodySchema>;
export type OutcomeIntent=z.infer<typeof intentSchema>;
export function readOutcomeIntent(raw:string):OutcomeIntent{return intentSchema.parse(JSON.parse(raw));}
export function makeOutcomeIntent(body:OutcomeBody):OutcomeIntent{return intentSchema.parse({version:1,key:crypto.randomUUID(),body});}
export function confirmedOutcome(outcomes:Outcome[],intent:OutcomeIntent){
  const event=outcomes.find(o=>o.id===intent.eventId),b=intent.body;
  if(!event||event.type!==b.type||event.sku!==b.sku||event.quantity!==b.quantity||event.amountMinor!==b.amountMinor||event.currency!==b.currency||event.parentEventId!==b.parentEventId||event.reason!==b.reason)
    throw new Error("The returned event does not match this intent in the ledger. Keep this pending intent and inspect the ledger.");
  // A receipt-level duplicate may return the original event's timestamp. Never overwrite it.
  return event;
}
