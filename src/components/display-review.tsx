"use client";
import { useState } from "react";
import type { Book, Campaign, Job, Rule, RuleCase } from "@/lib/types";
import type { displayReadiness } from "@/lib/display-review";
import { api, waitJob } from "@/lib/client";
import { Badge, money } from "./ui";

export function DisplayReadiness({campaign,readiness,books,busy,onReload,staff=false}:{campaign?:Campaign;readiness:ReturnType<typeof displayReadiness>;books:Book[];busy:boolean;onReload:()=>void;staff?:boolean}) {
  return <section className="notice neutral" aria-label="Saved display readiness" style={{display:"block",overflowWrap:"anywhere"}}>
    <strong>{campaign ? `Saved ${campaign.state} · revision ${campaign.revision}` : "No saved display"}</strong>
    {campaign&&<p>Version <span style={{overflowWrap:"anywhere"}}>{campaign.versionId}</span> · {campaign.candidateSkus.length} saved edition rows</p>}
    <p>{readiness.dirty?"Unsaved changes. Save this draft before generating, approving or activating.":readiness.ready?"Saved selection passes local readiness checks. The server rechecks it before each action.":"Not ready. Review the selected editions and active rules."}</p>
    {readiness.blocked.length>0&&<p>Unavailable selections: {readiness.blocked.map(sku=>`${books.find(b=>b.sku===sku)?.title??"Missing edition"} (${sku})`).join(", ")}</p>}
    {readiness.expired.length>0&&<p>Rule review expired: {readiness.expired.map(r=>`${r.type} (${r.id})`).join(", ")}. Renew or disable the rule after review.</p>}
    <p>{staff?"Staff can save and propose. Only the owner can approve and activate.":"Approval and activation apply to the saved version, not unsaved edits."}</p>
    <button className="button ghost" style={{width:"100%",whiteSpace:"normal",textAlign:"left"}} disabled={busy} onClick={onReload}>Reload saved display and discard local edits</button>
  </section>;
}

export function RuleExamples({example,counterexample}:{example:RuleCase;counterexample:RuleCase}) {
  const describe=(c:RuleCase)=>`SKU ${c.sku}; language ${c.language}; format ${c.format}; price ${money(c.priceMinor)}`;
  return <div aria-label="Rule example and counterexample" style={{overflowWrap:"anywhere"}}><p><strong>Must pass:</strong> {describe(example)}</p><p><strong>Must fail:</strong> {describe(counterexample)}</p></div>;
}

type Act=(fn:()=>Promise<unknown>,message?:string,refresh?:boolean)=>Promise<void>;
export function RuleCard({rule,campaign,books,busy,act}:{rule:Rule;campaign?:Campaign;books:Book[];busy:boolean;act:Act}) {
  const [replay,setReplay]=useState<{passed:boolean;violations:{ruleId:string;sku:string;message:string}[]}>();
  const expired=Date.parse(rule.reviewAt)<=Date.now();
  return <section className="rule-card" aria-label={`Rule ${rule.type} ${rule.operand}`}>
    <Badge tone={!rule.active||expired?"amber":"green"}>{!rule.active?"Disabled":expired?"Review expired — blocks eligibility":"Active · review current at load"}</Badge>
    <h3>{rule.type.replaceAll("_"," ")}: {rule.type==="max_price_minor"?money(Number(rule.operand)):rule.operand}</h3>
    <p>Scope: {rule.scope} · Revision {rule.revision} · Review due <time dateTime={rule.reviewAt}>{rule.reviewAt}</time></p>
    <RuleExamples example={rule.example} counterexample={rule.counterexample}/>
    <p>Stored deterministic checks; passing examples do not establish policy benefit.</p>
    <button className="button ghost" disabled={busy||!campaign} onClick={()=>void act(async()=>{setReplay(undefined);const result=await waitJob(await api<Job>(`rules/${rule.id}/replay`,{campaignVersionId:campaign!.versionId}));setReplay(result as typeof replay);},undefined,false)}>Replay against display</button>
    {replay&&<div role="status"><p>{replay.passed?"Rule replay passed":"Rule replay blocked"} · {replay.violations.length} rule/edition violations. Snapshot of all active display rules, version {campaign?.versionId}, revision {campaign?.revision}. Replay after changes.</p>{replay.violations.length>0&&<ul>{replay.violations.map((v,i)=><li key={i}>{books.find(b=>b.sku===v.sku)?.title??"Missing edition"} ({v.sku}): {v.message}</li>)}</ul>}</div>}
    <div className="button-row"><button className="button secondary" disabled={busy} onClick={()=>void act(()=>api(`rules/${rule.id}`,{expectedRevision:rule.revision,active:!rule.active},"PATCH"),"Rule status updated. Frozen sample enrollment ended.")}>{rule.active?"Disable rule":"Enable rule"}</button><button className="button secondary" disabled={busy} onClick={()=>void act(()=>api(`rules/${rule.id}`,{expectedRevision:rule.revision,reviewAt:new Date(Date.now()+30*86400000).toISOString()},"PATCH"),"Rule review renewed.")}>Renew rule review</button></div>
  </section>;
}
