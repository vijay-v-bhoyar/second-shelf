"use client";
import {useEffect,useRef,useState} from "react";
import {api,ApiError} from "@/lib/client";
import {defaultReviewDates,reviewDateQuery} from "@/lib/review-period";
import {activityMetrics,confirmReviewDecision,readActivityReview,type ActivityReview as Review,type ReviewDecision} from "@/lib/review-view";
import {ReviewPeriod} from "./review-period";
import {inventoryTimestamp} from "@/lib/inventory-view";
type Applied={data:Review;refreshKey:number;campaignRevision:number};
type DecisionBody={expectedRevision:number;periodStart:string;periodEnd:string;decision:"keep"|"change"|"retire";rationale:string;activeWorkSeconds:0};
type Pending={key:string;body:DecisionBody;id?:string};
type Props={campaign:{id:string;revision:number};refreshKey:number;reviews:ReviewDecision[];prefix?:string;blocked:boolean;reload:()=>Promise<{reviews:ReviewDecision[]}>;onBusy:(busy:boolean)=>void};
export function ActivityReview({campaign,refreshKey,reviews,prefix="",blocked,reload,onBusy}:Props){
  const [dates,setDates]=useState(defaultReviewDates),[applied,setApplied]=useState<Applied>(),[phase,setPhase]=useState<"idle"|"loading"|"ready"|"failed"|"stale">("idle"),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [decision,setDecision]=useState<DecisionBody["decision"]>("keep"),[rationale,setRationale]=useState(""),[pending,setPending]=useState<Pending>();
  const appliedHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(phase==="ready")appliedHeading.current?.focus();},[applied,phase]);
  const serial=useRef(0),saving=useRef(false),lifetime=useRef(0);
  useEffect(()=>()=>{serial.current++;lifetime.current++;},[]);
  const current=phase==="ready"&&applied?.refreshKey===refreshKey&&applied.campaignRevision===campaign.revision&&applied.data.periodStart.slice(0,10)===dates.start&&applied.data.periodEnd.slice(0,10)===dates.end;
  function edit(field:"start"|"end",value:string){if(saving.current||pending)return;serial.current++;setDates(d=>({...d,[field]:value}));setPhase(applied?"stale":"idle");setError("");setMessage("");}
  async function apply(){
    if(saving.current||pending||blocked)return;const request=++serial.current;setError("");setMessage("");
    try{
      const query=reviewDateQuery(dates.start,dates.end),params=new URLSearchParams(query);setPhase("loading");
      const raw=await api<unknown>(`${prefix}campaigns/${campaign.id}/review?${query}`,undefined,"GET");
      if(request!==serial.current)return;
      const data=readActivityReview(raw,campaign.id,params.get("periodStart")!,params.get("periodEnd")!);
      setApplied({data,refreshKey,campaignRevision:campaign.revision});setPhase("ready");setMessage("Review period applied.");
    }catch(e){if(request===serial.current){setPhase("failed");setError((e as Error).message);}}
  }
  async function save(intent?:Pending){
    if(prefix||saving.current||blocked||(!intent&&!current))return;
    const submitted=intent??{key:crypto.randomUUID(),body:{expectedRevision:applied!.campaignRevision,periodStart:applied!.data.periodStart,periodEnd:applied!.data.periodEnd,decision,rationale:rationale.trim(),activeWorkSeconds:0 as const}};
    saving.current=true;onBusy(true);setPending(submitted);setError("");setMessage("");const generation=lifetime.current;let received=!!submitted.id;
    try{
      if(!submitted.id){const result=await api<{id:string}>(`campaigns/${campaign.id}/review`,submitted.body,"POST",false,{idempotencyKey:submitted.key});received=true;submitted.id=result.id;}
      if(generation!==lifetime.current)return;setPending({...submitted});
      const snapshot=await reload();if(generation!==lifetime.current)return;
      confirmReviewDecision(snapshot.reviews,submitted.id!,{campaignId:campaign.id,periodStart:submitted.body.periodStart,periodEnd:submitted.body.periodEnd,decision:submitted.body.decision,rationale:submitted.body.rationale});
      setPending(undefined);setRationale("");setMessage(`Weekly decision recorded and verified: ${submitted.id}. Its applied period and rationale match saved history.`);
    }catch(e){if(generation===lifetime.current){if(!intent&&!received&&e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==408)setPending(undefined);setError((e as Error).message);}}
    finally{saving.current=false;onBusy(false);}
  }
  return <section aria-label="Weekly activity review">
    <ReviewPeriod start={dates.start} end={dates.end} busy={blocked||!!pending} onStart={v=>edit("start",v)} onEnd={v=>edit("end",v)} onApply={()=>void apply()}/>
    {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice success">{message}</p>}
    {phase==="loading"&&<p role="status">Loading the requested UTC activity window…</p>}
    {!applied&&<p aria-label="Review availability">{phase==="loading"?"Current measurements are not available while loading.":phase==="failed"?"Review unavailable. Correct the dates or retry Apply review period; no measured values are shown.":"Review not loaded. Apply a UTC period to see its activity; no measured values are shown."}</p>}
    {applied&&<section className="panel" aria-label={current?"Applied activity results":"Prior review snapshot"}>
      {!current&&<p className="notice neutral">Stale snapshot — these counts are from the prior successful load. They do not describe the current request or refreshed workspace. Apply the period again before recording a decision.</p>}
      <h2 ref={appliedHeading} tabIndex={-1}>{current?"Activity in the applied period":"Previously loaded activity"}</h2><p aria-label="Applied review period">Showing {applied.data.periodStart} to {applied.data.periodEnd} · UTC end excluded · Campaign {campaign.id}</p>
      <p>Simulation only. Insufficient evidence for an effect estimate or interval. No conversion uplift, causal comparison or sales benefit is established.</p>
      <dl className="activity-metrics">{activityMetrics.map(metric=><div key={metric.key} data-metric={metric.key}><dt>{metric.label}</dt><dd><strong>{applied.data[metric.key]}</strong><p>{metric.definition}</p></dd></div>)}</dl>
      <p>These counts use different populations and event times. Served and failed sessions can overlap; they are not stages of a funnel. A session assigned before the window can still contribute activity inside it.</p>
      <details><summary>Why these counts do not show conversion or measured missingness</summary><p>Legacy missing-outcome proxy: {applied.data.missingOutcomes}. This is not measured follow-up missingness: it can include an observed full return, a nonpurchase or an unobserved outcome. It cannot distinguish them.</p></details>
      <p>Active work time is not measured by this interface. Stored zero effort values are placeholders, not evidence of time worked or time saved.</p>
    </section>}
    {!prefix&&<section className="panel" aria-label="Review decision"><h2>Decide what happens next</h2><p>A decision records your rationale for the applied period. It does not activate, retire or promote a display or policy.</p>
      {pending&&<section className="notice neutral" aria-label="Pending review decision"><p>Decision confirmation is pending for {pending.body.periodStart} to {pending.body.periodEnd}: {pending.body.decision} — {pending.body.rationale}. Retry preserves this exact intent and reads back its saved event. Reloading or leaving this view loses this in-page recovery; inspect saved history before any replacement.</p><button className="button secondary" disabled={blocked} onClick={()=>void save(pending)}>Retry same decision</button></section>}
      <label>Weekly decision<select aria-label="Weekly decision" disabled={blocked||!!pending} value={decision} onChange={e=>setDecision(e.target.value as DecisionBody["decision"])}><option value="keep">Keep this display</option><option value="change">Change the next display</option><option value="retire">Retire this display</option></select></label>
      <label>Your reason<textarea aria-label="Your reason" disabled={blocked||!!pending} maxLength={200} value={rationale} onChange={e=>setRationale(e.target.value)}/></label>
      <button className="button primary" disabled={blocked||!!pending||!current||!rationale.trim()} onClick={()=>void save()}>Record weekly decision</button>
    </section>}
    <section className="panel decision-history" aria-label="Saved review decisions"><h2>Owner decisions</h2>{reviews.filter(r=>r.campaignId===campaign.id).map(r=><article key={r.id}><h3>{r.decision}</h3><p>{r.rationale}</p><p>Event {r.id} · {inventoryTimestamp(r.at)}{r.periodStart&&r.periodEnd?` · Review: ${r.periodStart} to ${r.periodEnd} (UTC end excluded)`:" · Legacy review period unavailable"}. Effort timing not measured here.</p></article>)}{!reviews.some(r=>r.campaignId===campaign.id)&&<p>No saved decisions for this campaign.</p>}</section>
  </section>;
}
