"use client";
import {useEffect,useRef,useState} from "react";
import {api,waitJob} from "@/lib/client";
import type {Job,StaffPermission} from "@/lib/types";
import {exactGrant,exportLease,grantStatus,permissionLabels,type MembershipView} from "@/lib/access-view";

function time(value:string|null){const parsed=value?Date.parse(value):NaN;return Number.isFinite(parsed)?new Date(parsed).toISOString():"Unavailable";}
type ExportIntent={format:"json"|"csv";key:string;job?:Job};
type GrantIntent={kind:"grant";key:string;identityId:string;permissions:StaffPermission[];result?:{id:string;inviteUrl:string}}|{kind:"revoke";key:string;id:string;ack?:boolean};
type Props={memberships:MembershipView[];blocked:boolean;onBusy:(busy:boolean)=>void;reload:()=>Promise<{memberships:MembershipView[]}>};

export function AccessPrivacy({memberships,blocked,onBusy,reload}:Props){
  const [now,setNow]=useState(()=>Date.now()),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [identity,setIdentity]=useState(""),[permissions,setPermissions]=useState<StaffPermission[]>(["outcome_verify"]);
  const [pendingExport,setPendingExport]=useState<ExportIntent>(),[ready,setReady]=useState<{url:string;expiresAt:string;format:string}>();
  const [pendingGrant,setPendingGrant]=useState<GrantIntent>(),[invite,setInvite]=useState<{id:string;url:string}>();
  const running=useRef(false);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  async function run(work:()=>Promise<void>){
    if(running.current)return;running.current=true;onBusy(true);setError("");setMessage("");
    try{await work();}catch(e){setError((e as Error).message);}finally{running.current=false;onBusy(false);}
  }
  async function prepare(intent:ExportIntent){await run(async()=>{
    setReady(undefined);setPendingExport(intent);
    if(!intent.job){intent.job=await api<Job>("exports",{format:intent.format},"POST",false,{idempotencyKey:intent.key});setPendingExport({...intent});}
    const job=await api<Job>(`jobs/${intent.job.id}`,undefined,"GET");
    if(job.id!==intent.job.id)throw new Error("Export status belongs to a different job. Retry this request to check its own status.");
    const result=await waitJob(job);setReady({...exportLease(result,intent.job.id,intent.format,window.location.origin),format:intent.format});
    setPendingExport(undefined);setMessage("Export link verified. Review the scope below, then choose Download. No file has been downloaded yet.");
  });}
  async function access(intent:GrantIntent){await run(async()=>{
    setPendingGrant(intent);
    if(intent.kind==="grant"){
      if(!intent.result){intent.result=await api("memberships",{identityId:intent.identityId,permissions:intent.permissions},"POST",false,{idempotencyKey:intent.key});setPendingGrant({...intent});}
      const fresh=await reload();const member=fresh.memberships.find(m=>m.id===intent.result!.id);
      if(!exactGrant(member,intent))throw new Error("Grant readback does not match the requested identity and permissions. Refresh and inspect access before replacing this request.");
      const url=new URL(intent.result!.inviteUrl);if(url.origin!==window.location.origin||url.pathname!=="/staff")throw new Error("Invitation address is not valid for this bookstore.");
      setInvite({id:member!.id,url:url.href});setMessage("Sample grant recorded and verified. Give the one-time credential only to the intended sample user.");
    }else{
      setInvite(current=>current?.id===intent.id?undefined:current);
      if(!intent.ack){await api(`memberships/${intent.id}`,{},"DELETE",false,{idempotencyKey:intent.key});intent.ack=true;setPendingGrant({...intent});}
      const fresh=await reload();if(fresh.memberships.some(m=>m.id===intent.id))throw new Error("Grant is still present. Revocation is not verified.");
      setMessage("Grant removal verified. Its invitation and staff sessions can no longer authorize requests.");
    }
    setPendingGrant(undefined);
  });}
  const invited=invite&&memberships.find(m=>m.id===invite.id);
  const usable=invited?.status==="pending"&&Date.parse(invited.inviteExpiresAt??"")>now;
  const locked=blocked||!!pendingGrant||!!pendingExport;
  return <>
    {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice success">{message}</p>}
    <div className="two-column">
      <section className="panel" aria-label="Export records"><h2>Review your export</h2>
        <p>JSON includes this store’s sample inventory, display decisions, rules, reviews and outcome ledger. CSV includes inventory only. Neither includes credentials, invitation tokens or raw provider responses. Ledger event and pseudonymous visit identifiers remain in JSON.</p>
        <p>The file contains current records at download time, not a frozen snapshot from when you prepare the link. Links last 15 minutes and require this owner session. Downloaded copies are outside the app’s deletion controls.</p>
        <div className="button-row">{(["json","csv"] as const).map(format=><button className="button secondary" key={format} disabled={locked} onClick={()=>void prepare({format,key:crypto.randomUUID()})}>Prepare {format.toUpperCase()} export</button>)}</div>
        {pendingExport&&<div role="region" aria-label="Pending export"><p>Export confirmation pending. Retry keeps this request{pendingExport.job?` and reads job ${pendingExport.job.id}`:" and its operation key"}. Leaving this page loses recovery state; a new request may create another export job.</p><div className="button-row"><button className="button secondary" disabled={blocked} onClick={()=>void prepare(pendingExport)}>Retry same export</button><button className="button ghost" disabled={blocked} onClick={()=>{setPendingExport(undefined);setError("");}}>Leave export recovery</button></div><p>Leaving recovery does not cancel an accepted job.</p></div>}
        {ready&&<div role="region" aria-label="Prepared export"><p>{ready.format.toUpperCase()} · expires {time(ready.expiresAt)} (UTC). Only this store’s current records are included.</p>{Date.parse(ready.expiresAt)>now?<a className="button secondary" href={ready.url} download={`second-shelf-sample.${ready.format}`} onClick={e=>{if(Date.parse(ready.expiresAt)<=Date.now()){e.preventDefault();setNow(Date.now());}}}>Download {ready.format.toUpperCase()}</a>:<p role="status">Export link expired. Prepare a new export.</p>}</div>}
      </section>
      <section className="panel" aria-label="Staff grants"><h2>Sample staff access</h2>
        <p>Invite only the permissions needed. One-time links last 15 minutes; sessions end with this sample store. Possession grants sample access; it does not verify a real identity. A consumed or expired invitation cannot restore a lost session: revoke that grant and issue a new one.</p>
        <label>Sample staff identity<input disabled={locked} value={identity} onChange={e=>setIdentity(e.target.value)} placeholder="sample-bookseller"/></label>
        <fieldset className="permission-picker" disabled={locked}><legend>Staff permissions</legend>{(Object.entries(permissionLabels) as [StaffPermission,string][]).map(([permission,label])=><label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={e=>setPermissions(e.target.checked?[...permissions,permission]:permissions.filter(p=>p!==permission))}/>{label}</label>)}</fieldset>
        <button className="button secondary" disabled={locked||!identity.trim()||!permissions.length} onClick={()=>void access({kind:"grant",key:crypto.randomUUID(),identityId:identity.trim(),permissions:[...permissions]})}>Record sample staff grant</button>
        {pendingGrant&&<div role="region" aria-label="Pending access change"><p>Confirmation pending for {pendingGrant.kind==="grant"?pendingGrant.identityId:pendingGrant.id}. Retry retains the same intent. Inspect access after leaving or reloading before creating a replacement.</p><div className="button-row"><button className="button secondary" disabled={blocked} onClick={()=>void access(pendingGrant)}>Retry same access change</button><button className="button ghost" disabled={blocked} onClick={()=>{setPendingGrant(undefined);setError("");}}>Leave access recovery</button></div><p>This does not undo a change already saved.</p></div>}
        {invite&&usable&&<div className="staff-invite"><label>One-time sample invitation<input readOnly value={invite.url}/></label><a className="button secondary" href={invite.url} target="_blank" rel="noreferrer">Open sample staff access</a><p>Share this credential only with the intended sample user. The fragment is removed after redemption. It is kept only in this page’s memory.</p></div>}
        <p>Statuses reflect the last refresh; activity in another browser is not pushed here.</p><button className="button ghost" disabled={blocked} onClick={()=>void run(async()=>{await reload();setMessage("Access status refreshed.");})}>Refresh access status</button>
        {memberships.map(m=><div className="staff-row" key={m.id}><div><strong>{m.identityId}</strong><small>{m.permissions.map(p=>permissionLabels[p]).join(", ")}</small><p>{grantStatus(m,now)}</p><small>Invitation expiry: {time(m.inviteExpiresAt)} (UTC)<br/>Session expiry: {time(m.expiresAt)} (UTC)</small></div><button className="inline-link danger-text" aria-label={`Revoke grant for ${m.identityId}`} disabled={locked} onClick={()=>void access({kind:"revoke",id:m.id,key:crypto.randomUUID()})}>Revoke grant</button></div>)}
        {!memberships.length&&<p>No staff grants in this store.</p>}
      </section>
    </div>
  </>;
}
