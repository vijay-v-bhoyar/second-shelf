import type { Outcome } from "@/lib/types";
import { inventoryTimestamp } from "@/lib/inventory-view";
import { money } from "./ui";

export function OutcomeLedger({outcomes}:{outcomes:Outcome[]}){
  return <section className="panel" aria-label="Outcome history"><h2>Outcome history</h2><p>Original events stay intact. Returns and corrections append separate events. These sample records remain after taste choices are deleted; they are not payments or proof of real sales. Returns do not automatically restock shelves; confirm returned stock separately. Corrections reverse recorded sale quantities.</p>{!outcomes.length?<p>No verified sample outcomes yet.</p>:outcomes.map(o=><article className="panel" id={`outcome-${o.id}`} key={o.id} aria-label={`Ledger event ${o.id}`}>
    <h3>{o.type==="purchase"?"Purchase":o.type==="return"?"Return":"Correction / reversal"} · {o.bookTitle??o.sku}</h3>
    <dl className="outcome-ledger-details"><div><dt>Event ID</dt><dd style={{overflowWrap:"anywhere"}}>{o.id}</dd></div><div><dt>Edition SKU</dt><dd>{o.sku}</dd></div><div><dt>Copies</dt><dd>{o.type==="purchase"?"+":"−"}{o.quantity} {o.type==="purchase"?"purchased":"reversed"}</dd></div><div><dt>Amount (USD)</dt><dd>{o.type==="purchase"?"+":"−"}{money(o.amountMinor)} · {o.amountMinor} minor units</dd></div><div><dt>Occurred (UTC)</dt><dd>{inventoryTimestamp(o.occurredAt)}</dd></div><div><dt>Recorded (UTC)</dt><dd>{inventoryTimestamp(o.recordedAt)}</dd></div></dl>
    {o.parentEventId&&<p>Original purchase: <a href={`#outcome-${o.parentEventId}`} style={{overflowWrap:"anywhere"}}>{o.parentEventId}</a></p>}{o.reason&&<p>Reason: {o.reason}</p>}
  </article>)}</section>;
}
