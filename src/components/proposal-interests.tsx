"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Interest } from "@/lib/types";

export function ProposalInterests({mode,prefix="",busy,selected,onChange}:{mode:string;prefix?:string;busy:boolean;selected:Interest[];onChange:(items:Interest[])=>void}) {
  const [query,setQuery]=useState(""),[type,setType]=useState<"movie"|"artist">("movie");
  const [results,setResults]=useState<Interest[]>([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[error,setError]=useState("");
  const unavailable=mode!=="fixture"&&mode!=="live",disabled=busy||searching||unavailable;
  async function search(){
    setSearching(true);setError("");setResults([]);setSearched(false);
    try {const response=await api<{items:Interest[]}>(`${prefix}entities?query=${encodeURIComponent(query.trim())}&type=${type}`,undefined,"GET");setResults(response.items);setSearched(true);}
    catch(e){setError((e as Error).message);}
    finally{setSearching(false);}
  }
  return <fieldset className="proposal-interests" disabled={disabled}>
    <legend>Cultural interests for this display</legend>
    <p>{mode==="fixture"?"Optional: choose up to three sample films or musicians. With none selected, the sample proposal uses Spirited Away and Bon Iver.":unavailable?"Qloo access is not configured. Cultural proposals are unavailable until it is connected.":"Search and confirm one to three films or musicians before requesting a Qloo proposal. Store quantities and outcomes remain simulated."}</p>
    <div className="form-grid"><label>Display interest category<select aria-label="Display interest category" value={type} onChange={e=>{setType(e.target.value as "movie"|"artist");setResults([]);setSearched(false);setError("");}}><option value="movie">Film</option><option value="artist">Musician</option></select></label>
      <label>Search display interests<input aria-label="Search display interests" maxLength={200} value={query} onChange={e=>{setQuery(e.target.value);setResults([]);setSearched(false);setError("");}}/></label></div>
    <button className="button secondary" disabled={disabled||query.trim().length<2} onClick={()=>void search()}>{searching?"Searching display interests…":"Search display interests"}</button>
    {error&&<p role="alert" className="notice error">{error}</p>}
    {searched&&!results.length&&<p role="status">No matching interests. Try another film or musician.</p>}
    <div className="button-row">{results.map(item=><button key={item.id} className="button ghost" disabled={disabled||selected.length>=3||selected.some(s=>s.id===item.id)||(mode==="live"&&item.id.startsWith("fixture-"))} onClick={()=>onChange([...selected,item])}>Add display interest {item.name}</button>)}</div>
    <div className="button-row">{selected.map(item=><button key={item.id} className="button secondary" disabled={busy||searching} onClick={()=>onChange(selected.filter(s=>s.id!==item.id))}>Remove display interest {item.name}</button>)}</div>
  </fieldset>;
}
