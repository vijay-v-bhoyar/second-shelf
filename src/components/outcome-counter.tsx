"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { adjustmentValues } from "@/lib/outcome-adjustment";
import { confirmedOutcome, makeOutcomeIntent, readOutcomeIntent, type OutcomeBody, type OutcomeIntent } from "@/lib/outcome-intent";
import type { Book, Outcome } from "@/lib/types";
import { money } from "./ui";

type Snapshot={books:(Book&{effectiveQuantity:number})[];outcomes:Outcome[]};
type Props=Snapshot&{storeId:string;csrfToken:string;prefix?:string;blocked:boolean;onBusy:(value:boolean)=>void;reload:()=>Promise<Snapshot>};
export function OutcomeCounter({storeId,csrfToken,prefix="",books,outcomes,blocked,onBusy,reload}:Props){
  const [type,setType]=useState<OutcomeBody["type"]>("purchase"),[code,setCode]=useState(""),[sku,setSku]=useState(""),[quantity,setQuantity]=useState("1"),[receipt,setReceipt]=useState(""),[parent,setParent]=useState(""),[reason,setReason]=useState("");
  const [pending,setPending]=useState<OutcomeIntent>(),[storageKey,setStorageKey]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState("");
  const lock=useRef(false),generation=useRef(0);
  useEffect(()=>{let stopped=false;void(async()=>{
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(csrfToken));
    const key=`ss-outcome-v1:${storeId}:${prefix}:${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")}`;
    const raw=sessionStorage.getItem(key),saved=raw?readOutcomeIntent(raw):undefined;
    if(!stopped){setPending(saved);setStorageKey(key);}
  })().catch(()=>{if(!stopped)setError("Pending-intent storage is unavailable or invalid. Submitting is blocked; inspect the ledger before recovering browser storage.");});return()=>{stopped=true;generation.current++;};},[storeId,csrfToken,prefix]);
  function persist(intent:OutcomeIntent){sessionStorage.setItem(storageKey,JSON.stringify(intent));setPending(intent);}
  async function execute(intent:OutcomeIntent,fresh=false){
    if(lock.current||blocked||!storageKey)return;
    lock.current=true;onBusy(true);const epoch=generation.current,current=()=>epoch===generation.current;
    setError("");setMessage("");let accepted=!!intent.eventId;
    try{
      persist(intent); // Must succeed before any write request.
      if(!intent.eventId){
        const reply=await api<{id:string}>(`${prefix}outcomes`,intent.body,"POST",false,{idempotencyKey:intent.key});accepted=true;
        if(!current())return;
        intent=readOutcomeIntent(JSON.stringify({...intent,eventId:reply.id}));persist(intent);
      }
      const snapshot=await reload();if(!current())return;
      const event=confirmedOutcome(snapshot.outcomes,intent);
      sessionStorage.removeItem(storageKey);setPending(undefined);setReceipt("");
      setMessage(`Sample outcome verified in ledger: ${event.id}. ${event.quantity} copies, ${money(event.amountMinor)} USD. Original recorded time retained.`);
    }catch(e){if(current()){
      // A rejected POST is distinct from lost acknowledgment or failed readback after a commit.
      if(fresh&&!accepted&&e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==408){sessionStorage.removeItem(storageKey);setPending(undefined);setError(`Request rejected. Inspect the ledger before editing: ${e.message}`);}
      else setError(`Outcome not confirmed here. Keep the original intent and retry; do not enter a replacement sale. ${(e as Error).message}`);
    }}finally{lock.current=false;onBusy(false);}
  }
  let amount:number|undefined,previewError="",remaining:number|undefined;
  try{
    const units=Number(quantity);if(!Number.isInteger(units)||units<1||units>100)throw new Error("Enter a whole quantity from 1 to 100.");
    if(type==="purchase"){
      const book=books.find(b=>b.sku===sku);if(book){if(units>book.effectiveQuantity)throw new Error("Quantity exceeds the last loaded stock. Refresh the ledger and confirm physical stock.");amount=book.priceMinor*units;}
    }else if(parent){const value=adjustmentValues(outcomes,parent,units);amount=value.amountMinor;remaining=value.remainingQuantity;}
  }catch(e){previewError=(e as Error).message;}
  async function submit(){
    if(lock.current||pending||amount===undefined||previewError)return;
    const common={type,quantity:Number(quantity),currency:"USD" as const,amountMinor:amount,occurredAt:new Date().toISOString(),receiptReference:receipt.trim()};
    try{const body:OutcomeBody=type==="purchase"?{...common,sku,sessionCode:code.trim().toUpperCase()}:{...common,sku:outcomes.find(o=>o.id===parent)!.sku,parentEventId:parent,reason:reason.trim()};await execute(makeOutcomeIntent(body),true);}catch(e){setError((e as Error).message);}
  }
  async function inspect(){if(lock.current||blocked)return;lock.current=true;onBusy(true);setError("");try{await reload();setMessage("Ledger and stock refreshed. A pending intent stays unchanged until its exact event is confirmed.");}catch(e){setError((e as Error).message);}finally{lock.current=false;onBusy(false);}}
  const disabled=blocked||!!pending||!storageKey;
  return <section className="panel" aria-label="Counter verification"><h2>Verify a sample outcome</h2><p>A counter code attributes an offered edition. Confirm physical stock separately; this is not payment or a reservation. Only the owner or granted staff can record events.</p>
    {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice success">{message}</p>}
    {pending&&<section className="panel" aria-label="Pending outcome"><h3>Unconfirmed outcome</h3><p>{pending.body.type} · {pending.body.sku} · {pending.body.quantity} copies · {money(pending.body.amountMinor)} USD</p><p>Receipt: {pending.body.receiptReference}. Intent: <span style={{overflowWrap:"anywhere"}}>{pending.key}</span></p><p>This exact payload and key survive reload in this tab and staff session. Retry checks the same intent; it does not prepare a new sale. Closing the tab or changing staff sessions can lose this recovery path.</p><button className="button primary" disabled={blocked} onClick={()=>void execute(pending)}>Retry same outcome</button></section>}
    <fieldset disabled={disabled} style={{border:0,padding:0,minWidth:0}}><div className="form-grid">
      <label>Outcome type<select aria-label="Outcome type" value={type} onChange={e=>setType(e.target.value as OutcomeBody["type"])}><option value="purchase">Purchase</option><option value="return">Return</option><option value="correction">Correction / reversal</option></select></label>
      {type==="purchase"?<><label>Counter code<input aria-label="Counter code" maxLength={200} value={code} onChange={e=>setCode(e.target.value)}/></label><label>Book<select aria-label="Book" value={sku} onChange={e=>setSku(e.target.value)}><option value="">Select an offered book</option>{books.map(b=><option key={b.sku} value={b.sku}>{b.title} · {b.sku}</option>)}</select></label></>:<><label>Original purchase<select aria-label="Original purchase" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Choose the original event</option>{outcomes.filter(o=>o.type==="purchase").map(o=><option key={o.id} value={o.id}>{o.bookTitle??o.sku} · {o.id}</option>)}</select></label><label>Adjustment reason<input aria-label="Adjustment reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><p>Adjustments use the original purchase amount and edition, even after taste deletion or catalog removal. A return requires separate stock confirmation; a correction reverses the recorded sale quantity.</p></>}
      <label>Quantity (copies)<input aria-label="Quantity" type="number" min={1} max={100} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>Receipt reference<input aria-label="Receipt reference" maxLength={200} value={receipt} onChange={e=>setReceipt(e.target.value)}/></label>
    </div>{previewError&&<p role="alert">{previewError}</p>}{amount!==undefined&&!previewError&&<p aria-label="Outcome amount">{type==="purchase"?"Purchase":"Reversal"}: {quantity} copies · {money(amount)} USD ({amount} minor units). {remaining!==undefined&&`${remaining} copies remain before this adjustment.`}</p>}
    <button className="button primary" disabled={amount===undefined||!!previewError||!receipt.trim()||(type==="purchase"?!code.trim():!reason.trim())} onClick={()=>void submit()}>Verify sample outcome</button></fieldset>
    <button className="button secondary" disabled={blocked} onClick={()=>void inspect()}>Inspect current ledger and stock</button>
  </section>;
}
