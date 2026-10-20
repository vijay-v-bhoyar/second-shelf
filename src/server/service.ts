import { z } from "zod";
import { randomInt } from "node:crypto";
import type { Campaign, Job, Rule, Shopper, Store } from "@/lib/types";
import { AppError, audit, csvCell, effectiveQuantity, eligible, hash, id, now, previewCsv, requireThat, revision, rulePass, ruleViolations, sampleCsv, schemas, secret, wireBook } from "./domain";
import { interests, makeStore } from "./fixtures";
import { allStores, createOrReuseDemo, databaseMode, db, deleteStore, findOwner, forgetShopper, getStore, insertStore, mutateStore } from "./repository";
import { providerMode, rankBooks, searchEntities } from "./providers";
import { bootstrapOwnerToken, invitationToken, membershipWire, staffAuthority, staffCan } from "./access";
import { isRejected, rejectedWorks, selectEditions } from "./book-selection";

type Payload = Record<string, unknown>;
type InternalJob = Job & { payload?: Payload; kind?: string; attempts?: number; staffSessionId?:string; runnerToken?:string };
type Context = {store:Store;kind:"owner"|"shopper"|"staff";sessionId?:string;staffSessionId?:string};
type Reply = {data:unknown;status?:number;headers?:Record<string,string>};
const g=globalThis as typeof globalThis & {__ssRunning?:Set<string>;__ssRates?:Map<string,{at:number;count:number}>;__ssDemoKeys?:Map<string,{token:string;storeId:string;expires:number}>};
const noCache={"Cache-Control":"no-store"};
const cookie=(name:string,value:string,https:boolean,maxAge=86400)=>`${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${https?"; Secure":""}`;
const readCookie=(request:Request,name:string)=>request.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(`${name}=`))?.slice(name.length+1);
const findCampaign=(s:Store,cid:string)=>{const c=s.campaigns.filter(x=>x.id===cid).at(-1);requireThat(c,"NOT_FOUND","Campaign not found in your store.",404);return c;};
function shopperWire(store:Store,session:Shopper){
  const assignment=store.assignments.find(a=>a.id===session.assignmentId);
  return{id:session.id,campaignVersionId:session.versionId,expiresAt:session.expiresAt,measurementOptIn:session.measurementOptIn,measurementAllowed:session.measurementAllowed!==false,measured:false,dataMode:"demo",frozenPreferences:assignment?{interests:assignment.interests.map((id,index)=>({id,name:providerMode()==="fixture"?interests.find(i=>i.id===id)?.name??`Original choice ${index+1}`:`Original choice ${index+1}`})),budgetMinor:assignment.budgetMinor}:null};
}
function rate(request:Request,path:string) {
  const key=`${request.headers.get("x-forwarded-for")?.split(",")[0]??"local"}:${path.split("/")[0]}`;
  g.__ssRates??=new Map();
  const limit=path==="demo-sessions"?30:300;
  const value=g.__ssRates.get(key);
  if(!value||Date.now()-value.at>60000)g.__ssRates.set(key,{at:Date.now(),count:1});
  else {value.count++;requireThat(value.count<=limit,"RATE_LIMITED","Too many requests. Try again in one minute.",429);}
  if(g.__ssRates.size>2000) for(const [k,v] of g.__ssRates)if(Date.now()-v.at>60000)g.__ssRates.delete(k);
}
async function context(request:Request,preferShopper=false,preferStaff=false):Promise<Context> {
  const owner=readCookie(request,"ss_merchant");
  if(owner&&!preferShopper&&!preferStaff) {const store=await findOwner(hash(owner));if(store)return{store,kind:"owner"};}
  const staff=readCookie(request,"ss_staff");
  if(staff&&!preferShopper)for(const store of await allStores()){const session=store.staffSessions?.find(x=>x.token===hash(staff)&&Date.parse(x.expiresAt)>Date.now());if(session){staffAuthority(store,session.id);return{store,kind:"staff",staffSessionId:session.id};}}
  if(preferStaff)throw new AppError("UNAUTHENTICATED","Open an owner-issued sample staff invitation.",401);
  const token=readCookie(request,"ss_shopper");
  if(token)for(const store of await allStores()){const shopper=store.shoppers.find(x=>x.token===hash(token)&&!x.closedAt&&Date.parse(x.expiresAt)>Date.now());if(shopper)return{store,kind:"shopper",sessionId:shopper.id};}
  throw new AppError("UNAUTHENTICATED","Start a demo or open an active bookstore display.",401);
}
function owner(ctx:Context){requireThat(ctx.kind==="owner","FORBIDDEN","Only the bookstore owner can perform this action.",403);}
function csrf(request:Request,ctx:Context){const expected=ctx.kind==="owner"?ctx.store.csrf:ctx.kind==="staff"?staffAuthority(ctx.store,ctx.staffSessionId!).session.csrf:ctx.store.shoppers.find(x=>x.id===ctx.sessionId)?.csrf;requireThat(expected&&request.headers.get("x-csrf-token")===expected,"FORBIDDEN","Session security check failed. Reload this page.",403);}
function authorize(ctx:Context,method:string,parts:string[],store=ctx.store){
  if(ctx.kind==="owner")return;
  const [head,,action]=parts;
  if(ctx.kind==="shopper"){requireThat(head==="shopper"||head==="jobs"||head==="entities","FORBIDDEN","This action requires authorized bookstore access.",403);return;}
  const member=staffAuthority(store,ctx.staffSessionId!).member,can=(p:string)=>member.permissions.includes(p as typeof member.permissions[number]);
  if(method==="GET"&&["session","workspace","entities","jobs"].includes(head)||head==="logout")return;
  if(method==="GET"&&["inventory","sample-csv"].includes(head)){requireThat(can("inventory_review")||can("campaign_draft")||can("outcome_verify")||can("review_read"),"FORBIDDEN","Inventory access was not granted.",403);return;}
  if(["inventory-imports","inventory","entity-mappings"].includes(head)){requireThat(can("inventory_review"),"FORBIDDEN","Inventory review permission is required.",403);return;}
  if(head==="campaigns"){
    if(method==="GET"){requireThat(!action||action==="review"&&(can("review_read")||can("outcome_verify")),"FORBIDDEN","Review access was not granted.",403);return;}
    requireThat((!parts[1]||method==="PATCH"&&!action||action==="plan")&&can("campaign_draft"),"FORBIDDEN","Only the owner can approve, publish, retire or change display policy.",403);return;
  }
  if(head==="outcomes"){requireThat(can("outcome_verify"),"FORBIDDEN","Outcome verification permission is required.",403);return;}
  owner(ctx);
}
function appOrigin(request:Request){
  const configured=process.env.SECOND_SHELF_APP_ORIGIN;
  if(configured)return new URL(configured).origin;
  const url=new URL(request.url),host=request.headers.get("host");
  // Next may canonicalize its internal URL to localhost. Preserve only an explicitly
  // loopback Host; arbitrary hosts and forwarded origins never become trusted.
  if(host&&/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host))return `${url.protocol}//${host}`;
  return url.origin;
}
function origin(request:Request){requireThat(request.headers.get("origin")===appOrigin(request),"FORBIDDEN","This change must come from this application's origin.",403);}
async function json(request:Request):Promise<Payload> {
  requireThat(Number(request.headers.get("content-length")??0)<=65536,"INVALID_INPUT","Request is too large.",413);
  const text=await request.text();requireThat(Buffer.byteLength(text)<=65536,"INVALID_INPUT","Request is too large.",413);
  try {const value=JSON.parse(text||"{}");requireThat(value&&typeof value==="object"&&!Array.isArray(value),"INVALID_INPUT","Use a JSON object.",400);return value;}
  catch(error){if(error instanceof AppError)throw error;throw new AppError("INVALID_INPUT","Request is not valid JSON.");}
}
function campaignWire(c:Campaign,base:string){return{...c,qrUrl:c.state==="active"?`${base}/discover/${c.token}`:null};}
function makeJob(s:Store,kind:string,payload:Payload,sessionId?:string,staffSessionId?:string):InternalJob{
  const running=s.jobs.filter(j=>(j.status==="queued"||j.status==="running")&&Date.parse(j.deadlineAt)>Date.now());
  requireThat(running.length<2,"RATE_LIMITED","Two tasks are already running. Wait for them to finish.",429);
  const job:InternalJob={id:id(),status:"queued",createdAt:now(),deadlineAt:new Date(Date.now()+30000).toISOString(),kind,payload,sessionId,staffSessionId,attempts:0};s.jobs.push(job);return publicJob(job);
}
function publicJob(job:Job):Job{const {id,status,createdAt,deadlineAt,result,error}=job;return{id,status,createdAt,deadlineAt,...(result?{result}:{}),...(error?{error}:{})};}
async function runJob(storeId:string,jobId:string) {
  g.__ssRunning??=new Set();if(g.__ssRunning.has(jobId))return;g.__ssRunning.add(jobId);const runnerToken=id();
  try{
    let job:InternalJob|undefined;
    await mutateStore(storeId,s=>{const j=s.jobs.find(x=>x.id===jobId) as InternalJob|undefined;if(!j||!["queued","running"].includes(j.status))return;
      if(Date.parse(j.deadlineAt)<Date.now()){j.status="failed";j.error={code:"PROVIDER_UNAVAILABLE",message:"Task deadline elapsed. Please start a new task.",requestId:id(),retryable:true};return;}
      if(j.status==="running")return;
      j.runnerToken=runnerToken;j.status="running";j.attempts=(j.attempts??0)+1;job=structuredClone(j);
    });
    if(!job)return;
    const store=await getStore(storeId),p=job.payload??{};
    if(job.staffSessionId)requireThat(staffCan(store,job.staffSessionId,"campaign_draft"),"FORBIDDEN","Staff drafting access was revoked.",403);
    let result:Payload;
    if(job.kind==="recommendations"){
      const shopper=store.shoppers.find(x=>x.id===job!.sessionId);requireThat(shopper,"UNAUTHENTICATED","Shopper session expired.",401);
      const c=store.campaigns.find(x=>x.versionId===shopper.versionId);requireThat(c?.state==="active","CONFLICT","This display changed. Open its current QR page.");
      const input=schemas.recommendation.parse(p);
      const rejected=rejectedWorks(store,shopper);
      const pool=store.books.filter(b=>eligible(store,b,input.budgetMinor,c)&&!isRejected(shopper,rejected,b)&&!input.excludedSkus.includes(b.sku));
      const assignment=store.assignments.find(a=>a.id===shopper.assignmentId);
      const simulatedControl=assignment?.arm==="control";
      const ranked=simulatedControl?selectEditions(pool).sort((a,b)=>a.title.localeCompare(b.title)):await rankBooks(pool,input.interestIds);
      const evidenceMode=simulatedControl?"simulation":providerMode()==="live"?"live":"fixture";
      const interpretation=simulatedControl?"Simulated comparison: eligible books are sorted alphabetically. Qloo was not called for this run. This is not a real LLM comparison or pilot evidence.":providerMode()==="fixture"?"Sample curator match using the interests you chose. This association is illustrative; Qloo has not been called.":"Ranked by Qloo for your selected cultural interests within this store's eligible book list. This is association, not a purchase prediction.";
      result={kind:"recommendations",runId:job.id,dataMode:"demo",evidenceMode,emptyReason:ranked.length?null:"No suitable books fit your current choices. Try another interest or budget.",items:ranked.slice(0,3).map((b,i)=>({sku:b.sku,entityId:b.entityId,title:b.title,author:b.author,priceMinor:b.priceMinor,currency:b.currency,shelf:b.shelf,rank:i+1,color:b.color,tags:b.tags,inventoryObservedAt:b.observedAt,evidenceRef:id(),evidenceMode,interpretation}))};
    }else if(job.kind==="plan"){
      const c=findCampaign(store,String(p.campaignId)),pool=store.books.filter(b=>eligible(store,b,Infinity,c));
      requireThat(pool.length,"NO_ELIGIBLE_ITEMS","Select eligible books and save the draft before generating a proposal. Check mappings, stock and bookseller rules if none are eligible.",422);
      const chosen=(Array.isArray(p.interestIds)&&p.interestIds.length?p.interestIds:["fixture-film-miyazaki","fixture-artist-boniver"]) as string[];
      if(providerMode()==="live")requireThat(chosen.every(i=>!i.startsWith("fixture-")),"INVALID_INPUT","Choose real film/music IDs for a live proposal.",422);
      const ranked=await rankBooks(pool,chosen);
      result={kind:"plan",campaignId:c.id,expectedRevision:c.revision,selectedSkus:ranked.slice(0,6).map(x=>x.sku),summary:providerMode()==="fixture"?"A sample display ranked from the selected films or musicians. Invite customers to start with a cultural interest they love.":"A cultural display grounded in Qloo's ranked eligible inventory. Ask readers which films and musicians they love.",evidenceRefs:ranked.slice(0,6).map(()=>id())};
    }else if(job.kind==="replay"){
      const c=store.campaigns.find(c=>c.versionId===p.campaignVersionId);requireThat(c,"NOT_FOUND","Campaign version not found.",404);
      const violations=ruleViolations(store,c);result={kind:"replay",passed:violations.length===0,violations};
    }else if(job.kind==="evaluation"){
      result={kind:"evaluation",status:"insufficient_evidence",protocolVersion:"second-shelf-policy-v1",evidenceCutoff:now(),receiptId:id(),message:"This sample bookstore has no real prospective holdout. Promotion remains blocked."};
    }else if(job.kind==="export"){
      const format=p.format=== "csv"?"csv":"json";result={kind:"export",format,downloadUrl:new URL(`/api/v1/exports/${job.id}/download`,String(p.base)).toString(),expiresAt:new Date(Date.now()+900000).toISOString()};
    }else throw new AppError("INVALID_INPUT","Unknown task type.");
    await mutateStore(storeId,s=>{
      const current=s.jobs.find(j=>j.id===jobId);if(!current||current.status!=="running"||(current as InternalJob).runnerToken!==runnerToken)return;
      requireThat(Date.parse(current.deadlineAt)>Date.now(),"PROVIDER_UNAVAILABLE","Task deadline elapsed. Please start a new task.",502);
      if(job!.staffSessionId)requireThat(staffCan(s,job!.staffSessionId,"campaign_draft"),"FORBIDDEN","Staff drafting access was revoked.",403);
      if(job!.sessionId)requireThat(s.shoppers.some(x=>x.id===job!.sessionId&&!x.closedAt&&Date.parse(x.expiresAt)>Date.now()),"UNAUTHENTICATED","Session expired.",401);
      if(result.kind==="recommendations"){
        const session=s.shoppers.find(x=>x.id===job!.sessionId)!;const c=s.campaigns.find(x=>x.versionId===session.versionId);
        requireThat(c?.state==="active","CONFLICT","Display changed while generating. Reopen the QR page.");
        const rejected=rejectedWorks(s,session);
        result.items=(result.items as Payload[]).filter(x=>{const b=s.books.find(b=>b.sku===x.sku);return b&&b.entityId===x.entityId&&eligible(s,b,Number(p.budgetMinor),c)&&!isRejected(session,rejected,b);});
        if(!(result.items as Payload[]).length)result.emptyReason="No eligible stock remains for these choices.";
      }
      if(result.kind==="plan"){
        const c=findCampaign(s,String(result.campaignId));revision(c.revision,result.expectedRevision);requireThat(c.state==="draft","CONFLICT","Only a draft can receive a proposal.");
        const selected=result.selectedSkus as string[];requireThat(selected.every(sku=>{const b=s.books.find(b=>b.sku===sku);return b&&eligible(s,b,Infinity,c);}),"STALE_INVENTORY","Proposed stock changed. Review inventory before planning again.");c.candidateSkus=selected;c.plan=String(result.summary);c.evidenceRefs=result.evidenceRefs as string[];c.revision++;
        result={kind:"plan",campaign:{...c,qrUrl:null},evidenceRefs:c.evidenceRefs};
      }
      if(result.kind==="evaluation"){const policy=s.policies.find(x=>x.id===p.policyId);if(policy)policy.status="insufficient_evidence";}
      current.status="succeeded";current.result=result;audit(s,`job.${result.kind}.complete`,jobId);
    });
  }catch(error){
    const e=error instanceof AppError?error:new AppError("PROVIDER_UNAVAILABLE",error instanceof z.ZodError?"Task input is invalid.":"The task could not complete. No substitute result was fabricated.",502);
    try{await mutateStore(storeId,s=>{const j=s.jobs.find(x=>x.id===jobId);if(j&&j.status==="running"&&(j as InternalJob).runnerToken===runnerToken){j.status="failed";j.error={code:e.code,message:e.message,requestId:id(),retryable:e.retryable};}});}catch{/* Store may have been deleted; never recreate it. */}
  }finally{g.__ssRunning.delete(jobId);}
}
function schedule(store:Store,defer?:(task:()=>Promise<void>)=>void){for(const j of store.jobs)if(j.status==="queued"||j.status==="running"){const task=()=>runJob(store.id,j.id);if(defer)defer(task);else void task();}}
function endEnrollment(store:Store,reason:string){for(const experiment of store.experiments)if(experiment.state==="frozen"){experiment.state="ended";experiment.endedAt=now();experiment.endReason=reason;experiment.revision++;}}
function reviewPeriod(start?:string|null,end?:string|null){
  requireThat(Boolean(start)===Boolean(end),"INVALID_INPUT","Supply both review period start and end.",400);
  const input=z.object({periodStart:z.string().datetime({offset:true}),periodEnd:z.string().datetime({offset:true})}).parse({periodStart:start??new Date(Date.now()-7*86400000).toISOString(),periodEnd:end??now()});
  const from=Date.parse(input.periodStart),until=Date.parse(input.periodEnd);requireThat(until>from&&until-from<=366*86400000,"INVALID_INPUT","Review end must follow start within a maximum of 366 days.",400);
  return{periodStart:new Date(from).toISOString(),periodEnd:new Date(until).toISOString(),contains:(at:string)=>Date.parse(at)>=from&&Date.parse(at)<until};
}
function weekly(store:Store,campaignId:string,period:ReturnType<typeof reviewPeriod>){
  const c=findCampaign(store,campaignId),sessions=store.shoppers.filter(x=>x.campaignId===c.id),sessionIds=new Set(sessions.map(x=>x.id));
  const assignments=store.assignments.filter(a=>sessionIds.has(a.sessionId)&&period.contains(a.at));
  const outcomes=store.outcomes.filter(o=>period.contains(o.occurredAt)),runs=store.jobs.filter(j=>j.sessionId&&sessionIds.has(j.sessionId)&&period.contains(j.createdAt));
  const armStats=["treatment","control"].map(arm=>{const as=assignments.filter(a=>a.arm===arm),ids=new Set(as.map(a=>a.sessionId));const jobs=runs.filter(j=>j.sessionId&&ids.has(j.sessionId));
    const purchased=new Set(outcomes.filter(o=>o.type==="purchase"&&ids.has(o.sessionId)&&o.quantity>outcomes.filter(r=>r.parentEventId===o.id&&r.type!=="purchase").reduce((n,r)=>n+r.quantity,0)).map(o=>o.sessionId));
    return{arm,assigned:as.length,served:new Set(jobs.filter(j=>j.status==="succeeded").map(j=>j.sessionId)).size,failed:new Set(jobs.filter(j=>j.status==="failed").map(j=>j.sessionId)).size,verifiedPurchasingSessions:purchased.size,missingAscertainment:Math.max(0,as.length-purchased.size)};});
  return{campaignId:c.id,periodStart:period.periodStart,periodEnd:period.periodEnd,periodBasis:"activity_window",periodNotice:"UTC start inclusive, end exclusive. Assignments use assignment time; runs use request time; outcomes use occurred time; withdrawals and decisions use recorded time. Arm summaries include only assignments within this period. These are activity counts, not a conversion estimate.",assigned:assignments.length,served:new Set(runs.filter(j=>j.status==="succeeded").map(j=>j.sessionId)).size,failed:new Set(runs.filter(j=>j.status==="failed").map(j=>j.sessionId)).size,generationRuns:runs.filter(j=>j.status==="succeeded").length,withdrawnVisits:store.privacyWithdrawals?.filter(w=>w.campaignId===c.id&&period.contains(w.at)).length??0,verifiedPurchases:outcomes.filter(o=>o.type==="purchase"&&sessionIds.has(o.sessionId)).length,missingOutcomes:armStats.reduce((n,a)=>n+a.missingAscertainment,0),evidenceStatus:"simulation",dataMode:"demo",analysisVersion:"demo-v3",arms:armStats,differencePercentagePoints:null,intervalLower:null,intervalUpper:null,ownerActiveWorkSeconds:store.reviews.filter(r=>r.campaignId===c.id&&period.contains(r.at)).reduce((n,r)=>n+r.activeWorkSeconds,0)};
}

export async function dispatch(request:Request,parts:string[],defer?:(task:()=>Promise<void>)=>void):Promise<Response> {
  const staffRoute=parts[0]==="staff";if(staffRoute)parts=parts.slice(1);
  const path=parts.join("/"),method=request.method,base=appOrigin(request);
  try{
    if(staffRoute)requireThat(!["demo-sessions","staff-sessions","public","shopper","health"].includes(parts[0]),"NOT_FOUND","Staff route not found.",404);
    rate(request,path);
    if(method==="GET"&&path==="health"){await(await db()).query("SELECT 1 AS ready");return Response.json({app:"Second Shelf",version:"0.1.0",dataMode:"demo",providerMode:providerMode(),persistence:databaseMode(),databaseReady:true,publicRelease:"not-verified"},{headers:noCache});}
    const mutation=method!=="GET";
    let key:string|undefined,body:Payload={};
    if(mutation){origin(request);key=request.headers.get("idempotency-key")??undefined;requireThat(key&&key.length>=16&&key.length<=128,"INVALID_INPUT","Supply an Idempotency-Key of 16–128 characters.",400);
      if(path!=="inventory-imports")body=await json(request);
    }
    if(mutation){const allowed=method==="POST" && /^(demo-sessions|staff-sessions|logout|inventory-imports|inventory-imports\/[^/]+\/commit|campaigns|campaigns\/[^/]+\/(plan|approve|activate|retire|review|experiments|policy-proposals)|rules|rules\/[^/]+\/replay|public\/campaigns\/[^/]+\/sessions|shopper\/(recommendations|events|purchase-code|forget)|outcomes|experiments\/[^/]+\/(freeze|end)|policy-proposals\/[^/]+\/(evaluate|approve)|exports|memberships)$/.test(path)
      ||method==="PATCH"&&/^(entity-mappings|campaigns|inventory|rules)\/[^/]+$/.test(path)
      ||method==="POST"&&path==="shopper/new-visit"||method==="DELETE"&&/^(store|memberships\/[^/]+)$/.test(path);
      requireThat(allowed,"NOT_FOUND","This HTTP action is not supported.",404);
    }
    if(method==="POST"&&path==="demo-sessions"){
      z.object({}).strict().parse(body);const stableToken=bootstrapOwnerToken(key!);
      if(stableToken){const s=await createOrReuseDemo(hash(key!),makeStore(stableToken,providerMode()==="fixture"));return Response.json({storeId:s.id,expiresAt:s.expiresAt,dataMode:"demo",providerMode:providerMode()},{status:201,headers:{...noCache,"Set-Cookie":cookie("ss_merchant",stableToken,request.url.startsWith("https:"))}});}
      g.__ssDemoKeys??=new Map();const prior=g.__ssDemoKeys.get(key!);
      if(prior&&prior.expires>Date.now()){const s=await getStore(prior.storeId);return Response.json({storeId:s.id,expiresAt:s.expiresAt,dataMode:"demo",providerMode:providerMode()},{status:201,headers:{...noCache,"Set-Cookie":cookie("ss_merchant",prior.token,request.url.startsWith("https:"))}});}
      const token=secret(),s=makeStore(token,providerMode()==="fixture");await insertStore(s);g.__ssDemoKeys.set(key!,{token,storeId:s.id,expires:Date.parse(s.expiresAt)});
      return Response.json({storeId:s.id,expiresAt:s.expiresAt,dataMode:"demo",providerMode:providerMode()},{status:201,headers:{...noCache,"Set-Cookie":cookie("ss_merchant",token,request.url.startsWith("https:"))}});
    }
    if(method==="POST"&&path==="staff-sessions"){
      const input=z.object({inviteToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body);
      const store=(await allStores()).find(s=>s.memberships.some(m=>m.inviteNonce&&invitationToken(s,m)===input.inviteToken));requireThat(store,"NOT_FOUND","This sample invitation is invalid or was revoked.",404);
      const member=store.memberships.find(m=>m.inviteNonce&&invitationToken(store,m)===input.inviteToken)!;
      const existing=readCookie(request,"ss_staff"),resumed=store.staffSessions?.find(s=>s.token===hash(existing??"")&&s.membershipId===member.id&&Date.parse(s.expiresAt)>Date.now());
      if(resumed){staffAuthority(store,resumed.id);return Response.json({status:"active",dataMode:"demo"},{status:201,headers:noCache});}
      const raw=secret();await mutateStore(store.id,s=>{const m=s.memberships.find(x=>x.id===member.id);requireThat(m&&m.inviteExpiresAt&&Date.parse(m.inviteExpiresAt)>Date.now()&&!m.redeemedAt,"CONFLICT","This sample invitation expired or was already used. Ask the owner for a new one.");m.redeemedAt=now();s.staffSessions??=[];s.staffSessions.push({id:id(),membershipId:m.id,token:hash(raw),csrf:secret(),expiresAt:m.expiresAt!});audit(s,"staff.invitation.redeemed",m.id);});
      return Response.json({status:"active",dataMode:"demo"},{status:201,headers:{...noCache,"Set-Cookie":cookie("ss_staff",raw,request.url.startsWith("https:"))}});
    }
    if(parts[0]==="public"&&parts[1]==="campaigns"){
      const token=parts[2];const s=(await allStores()).find(s=>s.campaigns.some(c=>c.token===token&&c.state==="active"));requireThat(s,"NOT_FOUND","This display is retired, expired, or not active yet.",404);
      const c=s.campaigns.find(c=>c.token===token&&c.state==="active")!;
      if(method==="GET"&&parts.length===3)return Response.json({title:c.title,storeName:s.name,versionId:c.versionId,dataMode:"demo",providerMode:providerMode(),currency:"USD",observedAt:s.books[0]?.observedAt??now(),measurementNoticeVersion:"demo-notice-v1"},{headers:noCache});
      if(method==="POST"&&parts[3]==="sessions"){
        const b=z.object({measurementOptIn:z.boolean().optional(),noticeVersion:z.literal("demo-notice-v1")}).strict().parse(body);
        const existing=readCookie(request,"ss_shopper"),previous=s.shoppers.find(x=>x.token===hash(existing??"")&&Date.parse(x.expiresAt)>Date.now()),found=previous&&!previous.closedAt&&previous.versionId===c.versionId?previous:undefined;
        if(found){if(b.measurementOptIn!==undefined)await mutateStore(s.id,current=>{const session=current.shoppers.find(x=>x.id===found.id)!;requireThat(!b.measurementOptIn||session.measurementAllowed!==false,"CONFLICT","This fresh visit is unmeasured; the prior simulation cannot be rerolled.");requireThat(!session.assignmentId||session.measurementOptIn===b.measurementOptIn,"CONFLICT","An assigned experiment visit cannot change its measurement choice.");session.measurementOptIn=b.measurementOptIn!;});return Response.json(shopperWire(s,{...found,measurementOptIn:b.measurementOptIn??found.measurementOptIn}),{status:201,headers:{...noCache,"X-CSRF-Token":found.csrf}});}
        const group=previous?.privacyGroupId??previous?.id??id(),assignedHere=previous&&s.shoppers.some(v=>(v.privacyGroupId??v.id)===group&&v.versionId===c.versionId&&v.assignmentId),measurementAllowed=previous?.measurementAllowed!==false&&!assignedHere;
        requireThat(!b.measurementOptIn||measurementAllowed,"CONFLICT","This fresh visit is unmeasured; a previous assignment cannot be rerolled.");
        const raw=secret(),shopper={id:id(),campaignId:c.id,versionId:c.versionId,token:hash(raw),csrf:secret(),expiresAt:s.expiresAt,measurementOptIn:b.measurementOptIn??false,measurementAllowed,privacyGroupId:group,noticeVersion:b.noticeVersion,rejected:[]};
        await mutateStore(s.id,current=>{requireThat(current.campaigns.some(x=>x.versionId===c.versionId&&x.state==="active"),"CONFLICT","Display changed.");if(previous){const prior=current.shoppers.find(x=>x.id===previous.id);if(prior){prior.privacyGroupId??=group;prior.closedAt??=now();}}current.shoppers.push(shopper);});
        return Response.json(shopperWire(s,shopper),{status:201,headers:{...noCache,"Set-Cookie":cookie("ss_shopper",raw,request.url.startsWith("https:")),"X-CSRF-Token":shopper.csrf}});
      }
      throw new AppError("NOT_FOUND","Public route not found.",404);
    }
    const shopperRoute=parts[0]==="shopper",ctx=await context(request,shopperRoute||request.headers.get("x-second-shelf-session")==="shopper",staffRoute);if(mutation)csrf(request,ctx);
    schedule(ctx.store,defer);
    authorize(ctx,method,parts);
    if(method==="GET"){
      const s=await getStore(ctx.store.id);
      authorize(ctx,method,parts,s);
      const staff=ctx.kind==="staff"?staffAuthority(s,ctx.staffSessionId!):null;
      if(path==="shopper/session"){const session=s.shoppers.find(x=>x.id===ctx.sessionId);requireThat(session,"UNAUTHENTICATED","Your shopper session ended.",401);return Response.json({id:session.id,csrfToken:session.csrf,expiresAt:session.expiresAt,dataMode:"demo"},{headers:noCache});}
      if(path==="session")return Response.json({storeId:s.id,permissions:staff?.member.permissions??["owner"],csrfToken:staff?.session.csrf??s.csrf,dataMode:"demo"},{headers:noCache});
      if(path==="workspace")return Response.json({id:s.id,name:s.name,csrfToken:staff?.session.csrf??s.csrf,actor:staff?"staff":"owner",identityLabel:staff?.member.identityId??"Sample owner",permissions:staff?.member.permissions??["owner"],expiresAt:s.expiresAt,revision:s.revision,importId:s.importId,dataMode:"demo",providerMode:providerMode(),persistence:databaseMode(),books:s.books.map(b=>wireBook(s,b)),campaigns:s.campaigns.map(c=>campaignWire(c,base)),rules:s.rules,outcomes:!staff||staff.member.permissions.includes("outcome_verify")?s.outcomes.map(({receiptDigest,...o})=>({...o,receiptReference:receiptDigest.slice(0,12)})):[],reviews:!staff||staff.member.permissions.includes("review_read")?s.reviews:[],policies:staff?[]:s.policies,experiments:staff?[]:s.experiments,audit:staff?[]:s.audit.slice(-30),memberships:staff?[]:s.memberships.map(membershipWire)},{headers:noCache});
      if(path==="sample-csv")return new Response(sampleCsv(s.books),{headers:{...noCache,"Content-Type":"text/csv","Content-Disposition":"attachment; filename=second-shelf-sample.csv"}});
      if(path==="inventory")return Response.json({items:s.books.map(b=>wireBook(s,b)),nextCursor:null,revision:s.revision},{headers:noCache});
      if(path==="entities"){
        const url=new URL(request.url),query=z.string().min(1).max(100).parse(url.searchParams.get("query")),type=z.enum(["movie","artist","book"]).parse(url.searchParams.get("type"));
        requireThat(type!=="book"||ctx.kind==="owner"||ctx.kind==="staff"&&staffCan(s,ctx.staffSessionId!,"inventory_review"),"FORBIDDEN","Inventory review permission is required for identity matching.",403);
        return Response.json({items:await searchEntities(query,type,s)},{headers:noCache});
      }
      if(path==="campaigns")return Response.json({items:s.campaigns.map(c=>campaignWire(c,base))},{headers:noCache});
      if(parts[0]==="campaigns"){
        const c=findCampaign(s,parts[1]);
        if(parts[2]==="review"){const query=new URL(request.url).searchParams;requireThat(query.getAll("periodStart").length<=1&&query.getAll("periodEnd").length<=1,"INVALID_INPUT","Review date parameters cannot be repeated.",400);return Response.json(weekly(s,c.id,reviewPeriod(query.get("periodStart"),query.get("periodEnd"))),{headers:noCache});}
        if(parts.length===2)return Response.json(campaignWire(c,base),{headers:noCache});
      }
      if(parts[0]==="jobs"){
        const job=s.jobs.find(x=>x.id===parts[1]) as InternalJob|undefined;requireThat(job,"NOT_FOUND","Task not found.",404);requireThat(ctx.kind==="owner"||ctx.kind==="staff"&&job.staffSessionId===ctx.staffSessionId||ctx.kind==="shopper"&&job.sessionId===ctx.sessionId,"FORBIDDEN","Task belongs to another session.",403);
        return Response.json(publicJob(job),{headers:noCache});
      }
      if(parts[0]==="exports"&&parts[2]==="download"){
        const job=s.jobs.find(x=>x.id===parts[1]);requireThat(job?.result?.kind==="export"&&Date.parse(String(job.result.expiresAt))>Date.now(),"NOT_FOUND","Export link expired or is not ready.",404);
        const data={dataMode:"demo",storeName:s.name,exportedAt:now(),inventory:s.books,outcomes:s.outcomes,campaigns:s.campaigns.map(c=>({id:c.id,versionId:c.versionId,revision:c.revision,title:c.title,state:c.state,candidateSkus:c.candidateSkus,ruleRevisionIds:c.ruleRevisionIds,inventoryImportId:c.inventoryImportId,dataMode:c.dataMode,plan:c.plan,evidenceRefs:c.evidenceRefs,approvedAt:c.approvedAt})),rules:s.rules,reviews:s.reviews};
        if(job.result.format==="csv")return new Response("data_mode,sku,title,author,price_minor,on_hand\n"+s.books.map(b=>["demo",b.sku,b.title,b.author,b.priceMinor,b.onHand].map(csvCell).join(",")).join("\n"),{headers:{...noCache,"Content-Type":"text/csv","Content-Disposition":"attachment; filename=second-shelf-sample-export.csv"}});
        return new Response(JSON.stringify(data,null,2),{headers:{...noCache,"Content-Type":"application/json","Content-Disposition":"attachment; filename=second-shelf-sample-export.json"}});
      }
      throw new AppError("NOT_FOUND","Route not found.",404);
    }
    if(path==="logout"){
      z.object({}).strict().parse(body);if(ctx.kind==="staff")await mutateStore(ctx.store.id,s=>{s.staffSessions=s.staffSessions?.filter(x=>x.id!==ctx.staffSessionId);audit(s,"staff.signed_out",ctx.staffSessionId!);});
      const headers=new Headers(noCache);for(const name of ["ss_merchant","ss_staff","ss_shopper"])headers.append("Set-Cookie",cookie(name,"",request.url.startsWith("https:"),0));return Response.json({status:"signed_out",dataMode:"demo"},{headers});
    }
    if(path==="shopper/forget"){
      z.object({confirm:z.literal(true)}).strict().parse(body);await forgetShopper(ctx.store.id,ctx.sessionId!);
      return Response.json({status:"preferences_deleted",transactionRecords:"retained_without_taste_linkage",dataMode:"demo"},{headers:{...noCache,"Set-Cookie":cookie("ss_shopper","",request.url.startsWith("https:"),0)}});
    }
    if(path==="shopper/new-visit"){
      z.object({confirm:z.literal(true)}).strict().parse(body);const raw=secret();await mutateStore(ctx.store.id,s=>{const prior=s.shoppers.find(x=>x.id===ctx.sessionId&&!x.closedAt);requireThat(prior,"UNAUTHENTICATED","This shopper session ended.",401);requireThat(s.campaigns.some(c=>c.versionId===prior.versionId&&c.state==="active"),"CONFLICT","Open the current active display before starting again.");prior.closedAt=now();prior.privacyGroupId??=prior.id;s.shoppers.push({id:id(),campaignId:prior.campaignId,versionId:prior.versionId,token:hash(raw),csrf:secret(),expiresAt:s.expiresAt,measurementOptIn:false,measurementAllowed:false,privacyGroupId:prior.privacyGroupId,noticeVersion:prior.noticeVersion,rejected:[]});});
      return Response.json({status:"new_unmeasured_visit",dataMode:"demo"},{status:201,headers:{...noCache,"Set-Cookie":cookie("ss_shopper",raw,request.url.startsWith("https:"))}});
    }
    if(method==="DELETE"&&path==="store"){
      z.object({confirm:z.literal(true)}).strict().parse(body);await deleteStore(ctx.store.id);return Response.json({id:ctx.store.id,status:"access_revoked",purgeDueAt:now()},{status:202,headers:{...noCache,"Set-Cookie":cookie("ss_merchant","",request.url.startsWith("https:"),0)}});
    }
    if(path==="inventory-imports"){
      requireThat((request.headers.get("content-type")??"").includes("multipart/form-data"),"INVALID_INPUT","Upload a CSV file using the inventory form.",400);
      requireThat(Number(request.headers.get("content-length")??0)<=1100000,"INVALID_INPUT","Upload must be at most 1 MiB.",413);
      const form=await request.formData(),file=form.get("file");requireThat(file instanceof File&&file.size<=1048576,"INVALID_INPUT","Choose a CSV file no larger than 1 MiB.",413);body={csv:await file.text()};
    }
    const fingerprint=hash(`${method}:${path}:${JSON.stringify(body)}`);
    const reply=await mutateStore(ctx.store.id,s=>{
      authorize(ctx,method,parts,s);
      const replayKey=`${ctx.kind}:${ctx.staffSessionId??ctx.sessionId??"owner"}:${key}`;
      const prior=s.requests[replayKey];if(prior){requireThat(prior.hash===fingerprint,"CONFLICT","This request key was used with different input.");return{data:prior.data,status:prior.status};}
      const response=perform(s,ctx,method,parts,body,base);
      s.requests[replayKey]={hash:fingerprint,data:response.data,status:response.status??200};
      if(Object.keys(s.requests).length>500){const oldest=Object.keys(s.requests)[0];delete s.requests[oldest];}
      audit(s,`${method.toLowerCase()}.${parts[0]}`,parts[1]??s.id);return response;
    });
    const current=await getStore(ctx.store.id);schedule(current,defer);
    if(path==="memberships"&&method==="POST"){const m=current.memberships.find(m=>m.id===(reply.data as {id:string}).id)!;return Response.json({...reply.data as object,inviteUrl:`${base}/staff#invite=${invitationToken(current,m)}`,inviteExpiresAt:m.inviteExpiresAt},{status:reply.status??200,headers:noCache});}
    return Response.json(reply.data,{status:reply.status??200,headers:{...noCache,...reply.headers}});
  }catch(error){
    const e=error instanceof AppError?error:error instanceof z.ZodError?new AppError("INVALID_INPUT",error.issues.map(x=>`${x.path.join(".")||"input"}: ${x.message}`).join("; ")):new AppError("PROVIDER_UNAVAILABLE","The request could not complete. Please retry.",500);
    return Response.json({code:e.code,message:e.message,requestId:id(),retryable:e.retryable},{status:e.status,headers:noCache});
  }
}

function perform(s:Store,ctx:Context,method:string,parts:string[],body:Payload,base:string):Reply{
  const [head,objectId,action]=parts;
  if(head==="inventory"&&method==="PATCH"){
    const book=s.books.find(x=>x.sku===decodeURIComponent(objectId));requireThat(book,"NOT_FOUND","Edition not found.",404);
    const input=z.object({expectedRevision:z.number().int().positive(),onHand:z.number().int().nonnegative().max(10000)}).strict().parse(body);revision(book.revision,input.expectedRevision);
    book.onHand=input.onHand;book.observedAt=now();book.revision++;s.revision++;endEnrollment(s,"inventory_changed");return{data:{id:book.mappingId,revision:book.revision}};
  }
  if(head==="inventory-imports"&&!objectId){const parsed=previewCsv(String(body.csv),s.books),importId=id();s.imports.push({id:importId,status:parsed.books.length?"validated":"rejected",baseRevision:s.revision,books:parsed.books,acceptedRowNumbers:parsed.acceptedRowNumbers,errors:parsed.errors,checksum:hash(String(body.csv))});return{data:{id:importId,status:parsed.books.length?"validated":"rejected",baseRevision:s.revision,rowCount:parsed.rowCount,acceptedRowNumbers:parsed.acceptedRowNumbers,errors:parsed.errors},status:201};}
  if(head==="inventory-imports"&&action==="commit"){
    const input=z.object({expectedRevision:z.number().int().positive(),acceptedRowNumbers:z.array(z.number().int().positive()).min(1)}).strict().parse(body),imp=s.imports.find(x=>x.id===objectId);requireThat(imp,"NOT_FOUND","Import not found.",404);revision(s.revision,input.expectedRevision);requireThat(imp.status==="validated","CONFLICT","This preview is not valid or has already been activated.");
    requireThat(new Set(input.acceptedRowNumbers).size===input.acceptedRowNumbers.length&&input.acceptedRowNumbers.every(x=>imp.acceptedRowNumbers.includes(x)),"INVALID_INPUT","Only valid preview rows can be activated once.",400);
    const selected=new Set(input.acceptedRowNumbers);s.books=imp.books.filter((_,i)=>selected.has(imp.acceptedRowNumbers[i]));s.importId=imp.id;s.revision++;imp.status="active";endEnrollment(s,"inventory_changed");
    return{data:{id:imp.id,revision:s.revision}};
  }
  if(head==="entity-mappings"&&method==="PATCH"){
    const b=s.books.find(x=>x.mappingId===objectId);requireThat(b,"NOT_FOUND","Inventory mapping not found.",404);
    const input=z.object({expectedRevision:z.number().int().positive(),status:z.enum(["confirmed","excluded"]),entityId:z.string().min(1).max(200).optional(),reason:z.string().min(1).max(200)}).strict().parse(body);revision(b.revision,input.expectedRevision);
    requireThat(input.status!=="confirmed"||input.entityId,"INVALID_INPUT","Choose an entity before confirming.",400);requireThat(input.status!=="confirmed"||providerMode()==="fixture"||!input.entityId!.startsWith("fixture-"),"INVALID_INPUT","Illustrative identities cannot be confirmed outside sample mode.",422);b.mappingStatus=input.status;b.entityId=input.entityId;b.revision++;endEnrollment(s,"inventory_changed");return{data:{id:b.mappingId,revision:b.revision}};
  }
  if(head==="campaigns"&&!objectId){const input=schemas.draft.parse(body);requireThat(input.candidateSkus.every(sku=>s.books.some(b=>b.sku===sku)),"INVALID_INPUT","A selected SKU is not in this store.",400);const c:Campaign={id:id(),versionId:id(),revision:1,...input,state:"draft",inventoryImportId:s.importId,token:secret().slice(0,32),dataMode:"demo",evidenceRefs:[]};s.campaigns.push(c);return{data:campaignWire(c,base),status:201};}
  if(head==="campaigns"){
    const c=findCampaign(s,objectId);
    if(!action&&method==="PATCH"){
      const input=z.object({expectedRevision:z.number().int().positive(),draft:schemas.draft}).strict().parse(body);revision(c.revision,input.expectedRevision);requireThat(input.draft.candidateSkus.every(sku=>s.books.some(b=>b.sku===sku)),"INVALID_INPUT","Invalid candidate SKU.",400);
      if(c.state==="draft"){Object.assign(c,input.draft);c.revision++;}else{const next:Campaign={...c,...input.draft,versionId:id(),revision:c.revision+1,state:"draft",approvedAt:undefined};s.campaigns.push(next);return{data:campaignWire(next,base)};}return{data:campaignWire(c,base)};
    }
    if(action==="plan"){const input=z.object({expectedRevision:z.number().int().positive(),interestIds:z.array(z.string().min(1).max(200)).max(3).optional()}).strict().parse(body);revision(c.revision,input.expectedRevision);requireThat(c.state==="draft","CONFLICT","Only draft displays can be planned.");if(providerMode()!=="fixture"){requireThat(providerMode()==="live","CONFIGURATION_NOT_READY","Live Qloo access is not configured.",503);requireThat(input.interestIds?.length&&input.interestIds.every(i=>!i.startsWith("fixture-")),"INVALID_INPUT","Choose real film/music IDs for a live proposal.",422);}return{data:makeJob(s,"plan",{campaignId:c.id,interestIds:input.interestIds??[]},undefined,ctx.staffSessionId),status:202};}
    if(["approve","activate","retire"].includes(action)){
      const input=schemas.revision.parse(body);revision(c.revision,input.expectedRevision);
      if(action==="approve"){requireThat(c.state==="draft","CONFLICT","Only a draft can be approved.");requireThat(c.candidateSkus.length&&c.candidateSkus.every(sku=>{const b=s.books.find(x=>x.sku===sku);return b&&eligible(s,b,Infinity,c);}),"CONFLICT","All selected books must pass mapping, stock and rule checks before approval.");requireThat(!ruleViolations(s,c).length,"CONFLICT","Resolve rule violations first.");c.state="approved";c.approvedAt=now();}
      if(action==="activate"){requireThat(c.state==="approved","CONFLICT","Approve the display before activating it.");requireThat(c.candidateSkus.every(sku=>{const b=s.books.find(x=>x.sku===sku);return b&&eligible(s,b,Infinity,c);}),"STALE_INVENTORY","Inventory changed since approval. Create a revised draft.");for(const prior of s.campaigns)if(prior.state==="active")prior.state="superseded";c.state="active";}
      if(action==="retire"){requireThat(c.state!=="retired","CONFLICT","This display is already retired.");c.state="retired";}
      if(action==="activate"||action==="retire")endEnrollment(s,"display_changed");c.revision++;return{data:campaignWire(c,base)};
    }
    if(action==="review"){
      const input=z.object({expectedRevision:z.number().int().positive(),periodStart:z.string().datetime({offset:true}),periodEnd:z.string().datetime({offset:true}),decision:z.enum(["keep","change","retire"]),rationale:z.string().min(1).max(200),activeWorkSeconds:z.number().int().nonnegative().max(86400)}).strict().parse(body);revision(c.revision,input.expectedRevision);const period=reviewPeriod(input.periodStart,input.periodEnd);
      const review={id:id(),campaignId:c.id,periodStart:period.periodStart,periodEnd:period.periodEnd,decision:input.decision,rationale:input.rationale,activeWorkSeconds:input.activeWorkSeconds,at:now()};s.reviews.push(review);return{data:{id:review.id,revision:c.revision}};
    }
    if(action==="experiments"){
      const input=z.object({campaignVersionId:z.string().uuid(),comparison:z.enum(["qloo_vs_llm","policy_vs_policy"]),protocolVersion:z.string().min(1).max(200),modelVersion:z.string().min(1).max(200),policyVersionIds:z.array(z.string().uuid()).min(1).max(2),plannedSampleSize:z.number().int().positive(),enrollmentClosesAt:z.string().datetime()}).strict().parse(body);requireThat(input.campaignVersionId===c.versionId,"CONFLICT","Experiment must use this display version.");const e={id:id(),revision:1,...input,state:"draft" as const};s.experiments.push(e);return{data:{id:e.id,revision:e.revision},status:201};
    }
    if(action==="policy-proposals"){
      const input=z.object({expectedRevision:z.number().int().positive(),rationale:z.string().min(1).max(1000),rankOffsets:z.array(z.object({sku:z.string().max(80),positions:z.number().int().min(-1).max(1)}).strict()).max(10),trainingExperimentIds:z.array(z.string().uuid()),evaluationExperimentId:z.string().uuid().optional()}).strict().parse(body);revision(c.revision,input.expectedRevision);requireThat(input.rankOffsets.every(x=>c.candidateSkus.includes(x.sku)),"INVALID_INPUT","Policy changes must stay within this display's books.",400);const p={id:id(),revision:1,campaignId:c.id,...input,status:"proposed" as const};s.policies.push(p);return{data:{id:p.id,revision:p.revision},status:201};
    }
  }
  if(head==="rules"&&objectId&&method==="PATCH"){
    const rule=s.rules.find(r=>r.id===objectId);requireThat(rule,"NOT_FOUND","Rule not found.",404);const input=z.object({expectedRevision:z.number().int().positive(),active:z.boolean().optional(),reviewAt:z.string().datetime().optional()}).strict().refine(x=>x.active!==undefined||x.reviewAt!==undefined).parse(body);revision(rule.revision,input.expectedRevision);if(input.reviewAt)requireThat(Date.parse(input.reviewAt)>Date.now(),"INVALID_INPUT","Review date must be in the future.",400);
    rule.history??=[];rule.history.push({revision:rule.revision,active:rule.active,reviewAt:rule.reviewAt,changedAt:now()});if(input.active!==undefined)rule.active=input.active;if(input.reviewAt)rule.reviewAt=input.reviewAt;rule.revision++;endEnrollment(s,"rules_changed");return{data:{id:rule.id,revision:rule.revision}};
  }
  if(head==="rules"&&!objectId){
    const ruleCase=z.object({sku:z.string().min(1).max(80),language:z.string().min(1).max(80),format:z.string().min(1).max(80),priceMinor:z.number().int().nonnegative(),expectedPass:z.boolean()}).strict();
    const input=z.object({type:z.enum(["exclude_sku","require_language","require_format","max_price_minor"]),operand:z.union([z.string().min(1).max(80),z.number().int().nonnegative()]),scope:z.enum(["store","campaign"]),campaignId:z.string().uuid().optional(),example:ruleCase,counterexample:ruleCase,reviewAt:z.string().datetime()}).strict().parse(body);
    requireThat(input.scope!=="campaign"||s.campaigns.some(c=>c.id===input.campaignId),"INVALID_INPUT","Choose a campaign for this rule.",400);
    requireThat(input.type==="max_price_minor"?typeof input.operand==="number":typeof input.operand==="string","INVALID_INPUT","The rule operand has the wrong type.",400);
    requireThat(Date.parse(input.reviewAt)>Date.now(),"INVALID_INPUT","Rule review date must be in the future.",400);
    requireThat(input.example.expectedPass===true&&input.counterexample.expectedPass===false&&rulePass(input,input.example)&&!rulePass(input,input.counterexample),"INVALID_INPUT","The example must pass and the counterexample must fail this rule.",400);
    const rule:Rule={id:id(),revision:1,...input,active:true};s.rules.push(rule);endEnrollment(s,"rules_changed");return{data:{id:rule.id,revision:rule.revision},status:201};
  }
  if(head==="rules"&&action==="replay"){requireThat(s.rules.some(r=>r.id===objectId),"NOT_FOUND","Rule not found.",404);const input=z.object({campaignVersionId:z.string().uuid()}).strict().parse(body);return{data:makeJob(s,"replay",input),status:202};}
  if(head==="experiments"&&["freeze","end"].includes(action)){const e=s.experiments.find(e=>e.id===objectId);requireThat(e,"NOT_FOUND","Experiment not found.",404);revision(e.revision,schemas.revision.parse(body).expectedRevision);if(action==="freeze"){requireThat(e.state==="draft"&&!s.experiments.some(x=>x.campaignVersionId===e.campaignVersionId&&x.state==="frozen"),"CONFLICT","This display already has frozen enrollment or this definition is not a draft.");e.state="frozen";}else{requireThat(e.state==="frozen","CONFLICT","Only frozen enrollment can be ended.");e.state="ended";e.endedAt=now();e.endReason="owner_ended";}e.revision++;return{data:{id:e.id,revision:e.revision}};}
  if(head==="shopper"){
    const shopper=s.shoppers.find(x=>x.id===ctx.sessionId);requireThat(shopper,"UNAUTHENTICATED","Open the bookstore QR page first.",401);const c=s.campaigns.find(x=>x.versionId===shopper.versionId);requireThat(c,"NOT_FOUND","Display version no longer exists.",404);
    if(objectId==="recommendations"){
      const input=schemas.recommendation.parse(body);requireThat(c.state==="active"&&c.versionId===shopper.versionId,"CONFLICT","This display changed. Open its current QR page.");
      const pool=s.books.filter(b=>eligible(s,b,input.budgetMinor,c));const experiment=s.experiments.find(e=>e.campaignVersionId===c.versionId&&e.state==="frozen"&&Date.parse(e.enrollmentClosesAt)>Date.now());
      const prior=s.assignments.find(x=>x.id===shopper.assignmentId);if(prior)requireThat(prior.budgetMinor===input.budgetMinor&&JSON.stringify(prior.interests)===JSON.stringify(input.interestIds),"CONFLICT","An assigned visit keeps its original interests and budget even after enrollment ends.");
      if(experiment&&shopper.measurementOptIn&&pool.length){
        requireThat(shopper.measurementAllowed!==false,"CONFLICT","This fresh visit cannot join the previous simulation.");
        const prior=s.assignments.find(x=>x.id===shopper.assignmentId);
        if(prior)requireThat(prior.budgetMinor===input.budgetMinor&&JSON.stringify(prior.interests)===JSON.stringify(input.interestIds),"CONFLICT","A simulated experiment keeps its original interests and budget. Start a new unmeasured visit to change them.");
        else{const a={id:id(),sessionId:shopper.id,experimentId:experiment.id,arm:randomInt(2)===0?"treatment" as const:"control" as const,at:now(),candidateSkus:pool.map(x=>x.sku),interests:input.interestIds,budgetMinor:input.budgetMinor};s.assignments.push(a);shopper.assignmentId=a.id;}
      }
      return{data:makeJob(s,"recommendations",input,shopper.id),status:202};
    }
    if(objectId==="events"){
      const input=z.object({runId:z.string().uuid(),sku:z.string().min(1).max(80),type:z.enum(["impression","interest","reject"])}).strict().parse(body);
      const run=s.jobs.find(j=>j.id===input.runId&&j.sessionId===shopper.id);requireThat(run?.status==="succeeded"&&(run.result?.items as Payload[]|undefined)?.some(x=>x.sku===input.sku),"FORBIDDEN","Feedback must reference a book actually offered to your session.",403);
      if(!s.feedback.some(e=>e.sessionId===shopper.id&&e.runId===input.runId&&e.sku===input.sku&&e.type===input.type))s.feedback.push({id:id(),sessionId:shopper.id,...input,at:now()});
      if(input.type==="reject"){
        if(!shopper.rejected.includes(input.sku))shopper.rejected.push(input.sku);
        const offered=(run.result!.items as Payload[]).find(x=>x.sku===input.sku)!;
        if(typeof offered.entityId==="string"&&offered.entityId){
          shopper.rejectedWorkIds??=[];
          if(!shopper.rejectedWorkIds.includes(offered.entityId))shopper.rejectedWorkIds.push(offered.entityId);
        }
      }
      return{data:{id:run.id,revision:1}};
    }
    if(objectId==="purchase-code"){
      const input=z.object({runId:z.string().uuid()}).strict().parse(body);requireThat(s.jobs.some(j=>j.id===input.runId&&j.sessionId===shopper.id&&j.status==="succeeded"),"FORBIDDEN","Complete discovery before asking for a counter code.",403);shopper.code??=secret().slice(0,12).toUpperCase();return{data:{code:shopper.code,expiresAt:shopper.expiresAt}};
    }
  }
  if(head==="outcomes"){
    const input=schemas.outcome.parse(body),digest=hash(`${s.id}:${input.receiptReference}`);let sessionId:string,bookTitle:string|undefined,isbn13:string|undefined;
    requireThat(Date.parse(input.occurredAt)<=Date.now()+300000,"INVALID_INPUT","Outcome time cannot be in the future.",400);
    if(input.type==="purchase"){
      requireThat(input.sessionCode&&!input.parentEventId,"INVALID_INPUT","A purchase needs its counter code and cannot have an adjustment parent.",400);
      const shopper=s.shoppers.find(x=>x.code===input.sessionCode);requireThat(shopper,"NOT_FOUND","Counter code not found in this store.",404);
      requireThat(Date.parse(input.occurredAt)>=Date.parse(shopper.expiresAt)-86400000&&Date.parse(input.occurredAt)<=Date.parse(shopper.expiresAt)-86400000+7*86400000,"INVALID_INPUT","Purchase time must be within the attribution window.",400);
      const book=s.books.find(b=>b.sku===input.sku);requireThat(book,"NOT_FOUND","Book not found.",404);
      requireThat(s.jobs.some(j=>j.sessionId===shopper.id&&(j.result?.items as Payload[]|undefined)?.some(x=>x.sku===input.sku)),"INVALID_INPUT","Only books offered to this session can be attributed.",400);sessionId=shopper.id;bookTitle=book.title;isbn13=book.isbn13;
    }else{
      requireThat(input.parentEventId&&input.reason,"INVALID_INPUT","A return/correction needs its original event and a reason.",400);
      const parent=s.outcomes.find(o=>o.id===input.parentEventId&&o.type==="purchase"&&o.sku===input.sku&&o.currency===input.currency);requireThat(parent,"INVALID_INPUT","Original purchase is not valid for this correction.",400);
      requireThat(Date.parse(input.occurredAt)>=Date.parse(parent.occurredAt)&&Date.parse(input.occurredAt)<=Date.parse(parent.occurredAt)+7*86400000,"INVALID_INPUT","Adjustment time must follow the original purchase within seven days.",400);sessionId=parent.sessionId;bookTitle=parent.bookTitle;isbn13=parent.isbn13;
    }
    const duplicate=s.outcomes.find(o=>o.receiptDigest===digest&&o.sku===input.sku&&o.type===input.type);
    if(duplicate){requireThat(duplicate.sessionId===sessionId&&duplicate.parentEventId===input.parentEventId&&duplicate.quantity===input.quantity&&duplicate.amountMinor===input.amountMinor&&duplicate.currency===input.currency,"CONFLICT","This receipt reference already records different transaction details.");return{data:{id:duplicate.id,revision:1}};}
    if(input.type!=="purchase"){
      const parent=s.outcomes.find(o=>o.id===input.parentEventId)!;const adjustments=s.outcomes.filter(o=>o.parentEventId===parent.id&&o.type!=="purchase");requireThat(adjustments.reduce((n,o)=>n+o.quantity,0)+input.quantity<=parent.quantity&&adjustments.reduce((n,o)=>n+o.amountMinor,0)+input.amountMinor<=parent.amountMinor,"INVALID_INPUT","Return quantity or amount exceeds the remaining original purchase.",400);
    }else{const book=s.books.find(b=>b.sku===input.sku)!;requireThat(input.quantity<=effectiveQuantityForService(s,input.sku)&&input.amountMinor<=book.priceMinor*input.quantity,"INVALID_INPUT","Purchase quantity or amount exceeds eligible stock/price.",400);}
    const {receiptReference,sessionCode,...rest}=input;void receiptReference;void sessionCode;
    const outcome={id:id(),...rest,sessionId,bookTitle,isbn13,recordedAt:now(),receiptDigest:digest,dataMode:"demo" as const};s.outcomes.push(outcome);return{data:{id:outcome.id,revision:1},status:201};
  }
  if(head==="policy-proposals"){
    const policy=s.policies.find(p=>p.id===objectId);requireThat(policy,"NOT_FOUND","Policy proposal not found.",404);revision(policy.revision,schemas.revision.parse(body).expectedRevision);
    if(action==="evaluate")return{data:makeJob(s,"evaluation",{policyId:policy.id}),status:202};
    if(action==="approve")throw new AppError("INSUFFICIENT_EVIDENCE","Promotion is blocked: sample observations do not establish a prospective policy benefit.",409);
  }
  if(head==="exports"){const input=z.object({format:z.enum(["json","csv"])}).strict().parse(body);return{data:makeJob(s,"export",{...input,base}),status:202};}
  if(head==="memberships"){
    if(method==="DELETE"){const index=s.memberships.findIndex(m=>m.id===objectId);requireThat(index>=0,"NOT_FOUND","Staff grant not found.",404);s.memberships.splice(index,1);s.staffSessions=s.staffSessions?.filter(x=>x.membershipId!==objectId);return{data:{id:objectId,revision:1}};}
    const input=z.object({identityId:z.string().trim().min(1).max(200),permissions:z.array(z.enum(["inventory_review","campaign_draft","outcome_verify","review_read"])).min(1).refine(p=>new Set(p).size===p.length)}).strict().parse(body);const member={id:id(),...input,inviteNonce:secret(),inviteExpiresAt:new Date(Math.min(Date.now()+900000,Date.parse(s.expiresAt))).toISOString(),expiresAt:s.expiresAt};s.memberships.push(member);return{data:{id:member.id,revision:1},status:201};
  }
  throw new AppError("NOT_FOUND","Action not found.",404);
}
function effectiveQuantityForService(s:Store,sku:string){return effectiveQuantity(s,s.books.find(b=>b.sku===sku)!);}
