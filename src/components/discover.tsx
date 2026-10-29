"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, setCsrf, waitJob } from "@/lib/client";
import type { EvidenceMode, Interest, Job, Recommendation } from "@/lib/types";
import { Badge, Cover, Icon, Mark, money } from "./ui";
import { discoveryEvidenceLabel, discoveryProviderNotice, validDiscoveryBudget } from "@/lib/discovery-view";
import { inventoryTimestamp } from "@/lib/inventory-view";
type Preferences={interests:{id:string;name:string}[];budgetMinor:number};
type Pending={job:Job;inputs:Preferences};
type PublicCampaign={title:string;storeName:string;versionId:string;dataMode:string;providerMode:string;currency:string;observedAt:string;measurementNoticeVersion:string};
type Result={runId:string;items:Recommendation[];emptyReason:string|null;evidenceMode:EvidenceMode};
type Visit={measurementOptIn:boolean;measurementAllowed:boolean;frozenPreferences:{interests:{id:string;name:string}[];budgetMinor:number}|null};
export default function Discover({token}:{token:string}){
  const [campaign,setCampaign]=useState<PublicCampaign>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[query,setQuery]=useState(""),[type,setType]=useState("movie"),[suggestions,setSuggestions]=useState<Interest[]>([]),[selected,setSelected]=useState<{id:string;name:string}[]>([]),[budget,setBudget]=useState("25"),[result,setResult]=useState<Result>(),[code,setCode]=useState(""),[notice,setNotice]=useState(""),[optIn,setOptIn]=useState(false),[excluded,setExcluded]=useState<string[]>([]),[frozen,setFrozen]=useState(false);
  const [editing,setEditing]=useState(false),[applied,setApplied]=useState<Preferences>(),[pending,setPending]=useState<Pending>(),[retry,setRetry]=useState(0),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState("");
  const operation=useRef(false),epoch=useRef(0),resultHeading=useRef<HTMLHeadingElement>(null);
  const [staleSkus,setStaleSkus]=useState<string[]>([]);
  useEffect(()=>()=>{epoch.current++;operation.current=false;},[token]);
  useEffect(()=>{if(result&&!editing)resultHeading.current?.focus();},[result,editing]);
  useEffect(()=>{let cancelled=false;void api<PublicCampaign>(`public/campaigns/${token}`,undefined,"GET").then(async c=>{if(cancelled)return;const visit=await api<Visit>(`public/campaigns/${token}/sessions`,{noticeVersion:c.measurementNoticeVersion});if(cancelled)return;setOptIn(visit.measurementOptIn);setMeasurementAllowed(visit.measurementAllowed);if(visit.frozenPreferences){setSelected(visit.frozenPreferences.interests);setBudget(String(visit.frozenPreferences.budgetMinor/100));setFrozen(true);}setCampaign(c);}).catch(e=>{if(!cancelled)setError((e as Error).message);});return()=>{cancelled=true;};},[token,retry]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{
    if(!query.trim())return;
    void api<{items:Interest[]}>(`entities?query=${encodeURIComponent(query)}&type=${type}`,undefined,"GET",true)
      .then(r=>{if(!cancelled)setSuggestions(r.items);})
      .catch(e=>{if(!cancelled)setSearchError((e as Error).message);})
      .finally(()=>{if(!cancelled)setSearching(false);});
  },300);return()=>{cancelled=true;clearTimeout(timer);};},[query,type]);
  async function perform(action:(current:()=>boolean)=>Promise<void>){
    if(operation.current)return;
    operation.current=true;const generation=epoch.current;const current=()=>epoch.current===generation;
    setBusy(true);setError("");
    try{await action(current);}catch(e){if(current())setError((e as Error).message);}
    finally{if(current()){operation.current=false;setBusy(false);}}
  }
  async function receive(request:Pending,current:()=>boolean){
    const data=await waitJob(request.job,true) as unknown as Result;
    if(!current()||!campaign)return;
    const visit=await api<Visit>(`public/campaigns/${token}/sessions`,{noticeVersion:campaign.measurementNoticeVersion});
    if(!current())return;
    setFrozen(!!visit.frozenPreferences);
    if(visit.frozenPreferences){setSelected(visit.frozenPreferences.interests);setBudget(String(visit.frozenPreferences.budgetMinor/100));}
    setApplied(visit.frozenPreferences??request.inputs);setResult(data);setStaleSkus([]);setPending(undefined);setEditing(false);
    try{for(const book of data.items){if(!current())return;await api("shopper/events",{runId:data.runId,sku:book.sku,type:"impression"},"POST",true);}}
    catch{if(current())setNotice("Books are available to review, but sample impression logging could not be confirmed.");}
  }
  async function searchBooks(nextExcluded:string[],current:()=>boolean){
    if(!campaign||!selected.length||!validDiscoveryBudget(budget))return;
    const inputs={interests:selected.map(i=>({id:i.id,name:i.name})),budgetMinor:Math.round(Number(budget)*100)};
    setNotice("");setCode("");setResult(undefined);setPending(undefined);
    await api(`public/campaigns/${token}/sessions`,{measurementOptIn:optIn,noticeVersion:campaign.measurementNoticeVersion});
    if(!current())return;
    const job=await api<Job>("shopper/recommendations",{interestIds:inputs.interests.map(i=>i.id),budgetMinor:inputs.budgetMinor,excludedSkus:nextExcluded},"POST",true);
    if(!current())return;
    const request={job,inputs};setPending(request);await receive(request,current);
  }
  async function findBooks(){await perform(current=>searchBooks(excluded,current));}
  async function recover(){if(!pending)return;await perform(async current=>{
    const job=await api<Job>(`jobs/${pending.job.id}`,undefined,"GET",true);
    if(current())await receive({...pending,job},current);
  });}
  async function choose(book:Recommendation){if(!result)return;await perform(async current=>{
    setCode("");setNotice("");
    await api("shopper/events",{runId:result.runId,sku:book.sku,type:"interest"},"POST",true);
    if(!current())return;
    try{
      const value=await api<{code:string}>("shopper/purchase-code",{runId:result.runId,sku:book.sku},"POST",true);
      if(current()){setCode(value.code);setNotice(`Bring this code to the counter for ${book.title}. Interest does not reserve stock.`);}
    }catch(error){
      if(current()&&error instanceof ApiError&&error.status===409)setStaleSkus(skus=>[...new Set([...skus,book.sku])]);
      throw error;
    }
  });}
  async function reject(book:Recommendation){if(!result)return;await perform(async current=>{
    await api("shopper/events",{runId:result.runId,sku:book.sku,type:"reject"},"POST",true);
    if(!current())return;
    const next=[...new Set([...excluded,book.sku])];setExcluded(next);await searchBooks(next,current);
  });}
  const [cleared,setCleared]=useState(false),[measurementAllowed,setMeasurementAllowed]=useState(true);
  async function manageVisit(action:"forget"|"new-visit"){
    if(operation.current)return;
    if(!window.confirm(action==="forget"?"Delete your choices, feedback and measurement linkage? The store keeps cashier-verified transaction records without your taste choices.":"Start a fresh unmeasured visit? Your previous simulated assignment will remain unchanged."))return;
    await perform(async current=>{const session=await api<{csrfToken:string}>("shopper/session",undefined,"GET",true);if(!current())return;setCsrf(session.csrfToken,true);await api(`shopper/${action}`,{confirm:true},"POST",true);if(!current())return;if(action==="forget"){setResult(undefined);setPending(undefined);setCode("");setCleared(true);}else window.location.reload();});
  }
  if(cleared)return <main id="main-content" tabIndex={-1} className="loading-page"><a href="/" className="brand"><Mark/>Second Shelf.</a><h1>Your choices were cleared</h1><p>Your visit's choices, feedback, recommendation runs and measurement links were deleted, including prior visits linked to this browser's reset journey. Cashier-verified transaction records remain without taste linkage. This is a sample-data action, not a legal compliance certification.</p><a href={`/discover/${token}`} className="button secondary">Begin a new ordinary visit</a></main>;
  if(!campaign)return <main id="main-content" tabIndex={-1} className="loading-page"><a className="brand" href="/"><Mark/>Second Shelf.</a><h1>{error?"This display is unavailable":"Opening a world of books…"}</h1>{error&&<><p role="alert">{error}</p><button className="button secondary" disabled={busy} onClick={()=>{setError("");setRetry(n=>n+1);}}>Retry opening display</button></>}<button className="button secondary" disabled={busy} onClick={()=>void manageVisit("forget")}>Forget my choices</button><a href="/" className="button secondary">Visit Second Shelf</a></main>;
  return <div className="discover-page"><header className="discover-header"><a className="brand" href="/"><Mark/>Second Shelf<span className="brand-dot">.</span></a><span>{campaign.storeName}</span><Badge tone="sample">SAMPLE BOOKSTORE</Badge></header><main id="main-content" tabIndex={-1} className="discover-main"><div className="discover-intro"><div className="eyebrow"><Icon name="spark" size={17}/> A CULTURAL PATH TO YOUR NEXT READ</div><h1>A film you love.<br/>A song that stays.<br/><em>A book waiting here.</em></h1><p>Start with what you love watching or listening to. We’ll find a few books on these shelves that might surprise you.</p><div className="notice neutral"><Icon name="data" size={17}/>{discoveryProviderNotice(campaign.providerMode)}</div></div>
      {result&&applied&&<section className="panel" aria-label="Inputs used for these results"><h2>Your search</h2><p>{applied.interests.map(i=>i.name).join(" · ")} · Up to {money(applied.budgetMinor)} USD</p><p>{frozen?"These original inputs are fixed for this simulated visit. Start a new unmeasured visit to change them.":"These are the inputs used for the results below."}</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={()=>{setEditing(!editing);setCode("");setNotice("");}}>{editing?"Return to results":frozen?"Review original inputs":"Edit interests or budget"}</button>{!editing&&<button className="button primary find-button" disabled={busy||!selected.length||!validDiscoveryBudget(budget)} onClick={()=>void findBooks()}>{busy?"Looking through the shelves…":"Find my next read"}</button>}</div></section>}
      {(!result||editing)&&<section className="discovery-form" aria-label="Find your next book"><div className="form-step"><span className="step-number">1</span><div><h2>What do you already love?</h2><p>Choose up to three films or musicians.</p></div></div><div className="interest-search"><select aria-label="Interest category" disabled={frozen||busy} value={type} onChange={e=>{setType(e.target.value);setQuery("");setSuggestions([]);setSearchError("");setSearching(false);}}><option value="movie">Film / filmmaker</option><option value="artist">Musician</option></select><div className="search-field"><Icon name="search"/><input aria-label="Search a film or musician" disabled={frozen||busy} value={query} onChange={e=>{setQuery(e.target.value);setSuggestions([]);setSearchError("");setSearching(!!e.target.value.trim());}} placeholder={type==="movie"?"Try Spirited Away or Interstellar":"Try Radiohead or Phoebe Bridgers"} autoComplete="off"/></div></div>{query.trim()&&<div className="suggestions" aria-label="Interest search results">{searching?<p role="status">Searching supported interests…</p>:searchError?<p role="alert">{searchError} Edit the search to try again.</p>:suggestions.length?suggestions.map(i=><button key={i.id} disabled={frozen||busy||selected.length>=3||selected.some(x=>x.id===i.id)} onClick={()=>{setSelected([...selected,i]);setQuery("");setSuggestions([]);}}><span>{i.name}</span><small>{i.type==="movie"?"Film":"Musician"}</small><Icon name="arrow" size={16}/></button>):<p>No matches yet. Try a supported name.</p>}</div>}<div className="selected-interests">{selected.map(i=><span className="interest-chip" key={i.id}>{i.name}<button aria-label={`Remove ${i.name}`} disabled={frozen||busy} onClick={()=>setSelected(selected.filter(x=>x.id!==i.id))}><Icon name="close" size={14}/></button></span>)}</div>
        <div className="form-step second"><span className="step-number">2</span><div><h2>A little room for discovery</h2><p>Every suggestion stays within your budget.</p></div></div><label className="budget-label">Your budget (USD)<div className="budget-input"><span>$</span><input aria-label="Your budget in dollars" disabled={frozen||busy} value={budget} onChange={e=>setBudget(e.target.value)} type="number" min="0" max="10000" step="0.01"/></div></label>{!validDiscoveryBudget(budget)&&<p role="alert">Enter a budget from $0 to $10,000 USD.</p>}<label className="measurement-choice"><input type="checkbox" disabled={frozen||busy||!measurementAllowed} checked={optIn} onChange={e=>setOptIn(e.target.checked)}/><span>Try simulated experiment assignment if the owner enabled it. These visits never become real pilot evidence.</span></label><button className="button primary large find-button" disabled={busy||!selected.length||!validDiscoveryBudget(budget)} onClick={()=>void findBooks()}>{busy?"Looking through the shelves…":"Find my next read"}<Icon name={busy?"refresh":"arrow"}/></button>{frozen&&<p className="discovery-footnote">This simulated visit keeps its original interests and budget. Reload resumes the same assignment.</p>}<p className="discovery-footnote">No account needed. No reading history imported. Stock is a dated snapshot; ask staff to confirm.</p></section>}
      {pending&&!busy&&<section className="panel" aria-label="Accepted request recovery"><h2>Your request was accepted</h2><p>Its outcome is not confirmed here. Check the existing request without creating another. A failed or retired display may require a fresh search. Reloading loses this in-page recovery link.</p><button className="button secondary" onClick={()=>void recover()}>Check existing request</button></section>}
      {error&&<div role="alert" className="notice error">{error}</div>}{notice&&<div role="status" className="notice success">{notice}</div>}{staleSkus.length>0&&!editing&&<div className="notice"><p>Refresh to check current availability using the same interests, budget and exclusions.</p><button className="button secondary" disabled={busy} onClick={()=>void findBooks()}>Refresh matches</button></div>}{code&&<section className="counter-code" aria-label="Your counter code"><span>SHOW THIS AT THE COUNTER</span><strong>{code}</strong><p>A sample attribution code, not a reservation or payment.</p></section>}
      {result&&!editing&&<section className="discovery-results" aria-live="polite"><div className="section-heading"><div><div className="eyebrow">A SECOND LOOK AT THESE SHELVES</div><h2 ref={resultHeading} tabIndex={-1}>{result.items.length?"Something you might not have found.":"A narrower path this time."}</h2></div><Badge tone="sample">{discoveryEvidenceLabel(result.evidenceMode)}</Badge></div>{!result.items.length?<div className="panel empty-state"><p>{result.emptyReason}</p><p>{frozen?"Start a new unmeasured visit to change your original interests or budget.":"Edit your interests or budget to try again."} We won’t fill the gaps with invented books.</p></div>:<div className="recommendation-grid">{result.items.map(book=><article className="recommendation-card" key={book.sku}><div className="recommendation-cover"><Cover title={book.title} author={book.author} color={book.color}/></div><div className="recommendation-copy"><span className="book-kicker">{staleSkus.includes(book.sku)?"RECHECK REQUIRED":"ON THESE SHELVES"} · {money(book.priceMinor)}</span><h3>{book.title}</h3><p className="book-author">{book.author}</p><div className="book-location"><Icon name="location" size={15}/>{book.shelf}</div><details><summary>Why this book?</summary><p>{book.interpretation}</p></details><p className="evidence-time">Stock snapshot (UTC): {inventoryTimestamp(book.inventoryObservedAt)}. Confirm availability at the counter.</p>{staleSkus.includes(book.sku)&&<p>Availability changed. Refresh matches before choosing this book.</p>}<div className="card-actions"><button className="button primary" onClick={()=>void choose(book)} disabled={busy||staleSkus.includes(book.sku)}>Show at counter <Icon name="arrow" size={15}/></button><button className="button ghost" onClick={()=>void reject(book)} disabled={busy}><Icon name="refresh" size={15}/>Try another</button></div></div></article>)}</div>}</section>}
      <section className="panel privacy-controls"><h2>Your visit, your choices</h2><p>Try another excludes other editions of the same confirmed book for this visit.</p><p>Start over without rerolling a prior simulation, or delete choices, feedback and measurement linkage. Cashier-verified transaction records remain without taste choices.</p>{!measurementAllowed&&<p>This fresh visit is unmeasured. It cannot join the previous simulation again.</p>}<div className="button-row"><button className="button secondary" disabled={busy} onClick={()=>void manageVisit("new-visit")}>Start a new unmeasured visit</button><button className="button secondary" disabled={busy} onClick={()=>void manageVisit("forget")}>Forget my choices</button></div></section><footer className="discover-footer"><Mark/><p>Bookseller judgment comes first.<br/>Cultural associations are a starting point, never a promise.</p><a href="/studio" className="inline-link">Back to your bookstore <Icon name="arrow" size={15}/></a></footer></main></div>;
}
