import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("independent sample access, revocation, least privilege and privacy",async t=>{
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"second-shelf-access-"));process.env.SECOND_SHELF_PROVIDER_MODE="fixture";
  const {dispatch}=await import("../src/server/service"),{db,getStore,mutateStore}=await import("../src/server/repository");
  const base="http://127.0.0.1:4397";
  type Actor={cookie:string;csrf:string};const owner:Actor={cookie:"",csrf:""};
  async function call(actor:Actor,route:string,body?:unknown,method="POST",extra:Record<string,string>={}){
    const response=await dispatch(new Request(`${base}/api/v1/${route}`,{method:body===undefined?"GET":method,headers:{origin:base,cookie:actor.cookie,"content-type":"application/json","x-csrf-token":actor.csrf,"idempotency-key":randomUUID(),...extra},body:body===undefined?undefined:JSON.stringify(body)}),route.split("/"));
    const cookie=response.headers.get("set-cookie");if(cookie)actor.cookie=cookie.split(";")[0];
    return{status:response.status,data:await response.json(),response};
  }
  const created=await call(owner,"demo-sessions",{});owner.csrf=(await call(owner,"session")).data.csrfToken;const storeId=created.data.storeId;
  async function grant(permissions:string[],label:string){const r=await call(owner,"memberships",{identityId:label,permissions});assert.equal(r.status,201);assert.ok(r.data.inviteUrl.includes("/staff#invite="));const token=new URL(r.data.inviteUrl).hash.slice(8),actor:Actor={cookie:"",csrf:""};assert.equal((await call(actor,"staff-sessions",{inviteToken:token})).status,201);const session=await call(actor,"staff/session");assert.equal(session.status,200);actor.csrf=session.data.csrfToken;return{actor,memberId:r.data.id,token};}
  const curator=await grant(["inventory_review","campaign_draft"],"sample curator"),cashier=await grant(["outcome_verify"],"sample cashier"),reviewer=await grant(["review_read"],"sample reviewer");
  await t.test("independent credentials expose only granted metadata and own CSRF",async()=>{
    for(const {actor} of [curator,cashier,reviewer]){assert.ok(actor.cookie.startsWith("ss_staff="));assert.notEqual(actor.csrf,owner.csrf);const w=(await call(actor,"staff/workspace")).data;assert.equal(w.actor,"staff");assert.deepEqual(w.memberships,[]);assert.ok(!("token" in w));assert.ok(!("staffSessions" in w));assert.deepEqual(w.audit,[]);}
    assert.deepEqual((await call(reviewer.actor,"staff/workspace")).data.outcomes,[]);
  });
  await t.test("single-use, expired and revoked invitations cannot be redeemed",async()=>{
    assert.equal((await call({cookie:"",csrf:""},"staff-sessions",{inviteToken:curator.token})).status,409);
    const r=await call(owner,"memberships",{identityId:"expired",permissions:["outcome_verify"]});await mutateStore(storeId,s=>{s.memberships.find(m=>m.id===r.data.id)!.inviteExpiresAt=new Date(Date.now()-1).toISOString();});assert.equal((await call({cookie:"",csrf:""},"staff-sessions",{inviteToken:new URL(r.data.inviteUrl).hash.slice(8)})).status,409);
    await call(owner,`memberships/${r.data.id}`,{},"DELETE");assert.equal((await call({cookie:"",csrf:""},"staff-sessions",{inviteToken:new URL(r.data.inviteUrl).hash.slice(8)})).status,404);
  });
  await t.test("staff cannot approve, invite, export, delete or self-escalate",async()=>{
    const campaign=(await getStore(storeId)).campaigns[0];
    for(const a of [curator.actor,cashier.actor,reviewer.actor])for(const [route,body,method] of [[`staff/campaigns/${campaign.id}/approve`,{expectedRevision:campaign.revision},"POST"],["staff/memberships",{identityId:"evil",permissions:["inventory_review"]},"POST"],["staff/exports",{format:"json"},"POST"],["staff/store",{confirm:true},"DELETE"]] as const)assert.equal((await call(a,route,body,method)).status,403);
    const book=(await getStore(storeId)).books[0];assert.equal((await call(cashier.actor,`staff/inventory/${book.sku}`,{expectedRevision:book.revision,onHand:99},"PATCH")).status,403);assert.equal((await call(reviewer.actor,"staff/outcomes",{})).status,403);
  });
  await t.test("curator can change stock and draft, reviewer can only read",async()=>{
    const s=await getStore(storeId),book=s.books[0],campaign=s.campaigns[0];assert.equal((await call(curator.actor,`staff/inventory/${book.sku}`,{expectedRevision:book.revision,onHand:3},"PATCH")).status,200);
    assert.equal((await call(curator.actor,`staff/campaigns/${campaign.id}`,{expectedRevision:campaign.revision,draft:{title:"Staff-prepared",candidateSkus:campaign.candidateSkus,ruleRevisionIds:[]}},"PATCH")).status,200);
    assert.equal((await call(reviewer.actor,`staff/campaigns/${campaign.id}/review`)).status,200);assert.equal((await call(reviewer.actor,`staff/campaigns/${campaign.id}`,{expectedRevision:2,draft:{title:"Forbidden",candidateSkus:campaign.candidateSkus,ruleRevisionIds:[]}},"PATCH")).status,403);
  });
  await t.test("revocation and logout invalidate independent staff sessions",async()=>{
    await call(owner,`memberships/${curator.memberId}`,{},"DELETE");assert.equal((await call(curator.actor,"staff/workspace")).status,401);
    const cookie=cashier.actor.cookie;assert.equal((await call(cashier.actor,"staff/logout",{})).status,200);assert.equal((await call({cookie,csrf:cashier.actor.csrf},"staff/workspace")).status,401);
  });
  await t.test("expiry, cross-store access and revoked queued drafting fail closed",async()=>{
    const expired=await grant(["review_read"],"expired staff");await mutateStore(storeId,s=>{s.staffSessions!.find(x=>x.membershipId===expired.memberId)!.expiresAt=new Date(Date.now()-1).toISOString();});assert.equal((await call(expired.actor,"staff/workspace")).status,401);
    const second:Actor={cookie:"",csrf:""};await call(second,"demo-sessions",{});second.csrf=(await call(second,"session")).data.csrfToken;const foreign=(await call(second,"workspace")).data.campaigns[0];assert.equal((await call(reviewer.actor,`staff/campaigns/${foreign.id}/review`)).status,404);
    const queued=await grant(["campaign_draft"],"queued curator"),jobId=randomUUID(),before=(await getStore(storeId)).campaigns[0].revision;
    await mutateStore(storeId,s=>{const session=s.staffSessions!.find(x=>x.membershipId===queued.memberId)!;s.jobs.push({id:jobId,status:"queued",createdAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+30000).toISOString(),kind:"plan",payload:{campaignId:s.campaigns[0].id,interestIds:[]},staffSessionId:session.id} as typeof s.jobs[number]);});
    await call(owner,`memberships/${queued.memberId}`,{},"DELETE");let job=(await call(owner,`jobs/${jobId}`)).data;for(let i=0;i<100&&job.status!=="failed";i++){await new Promise(r=>setTimeout(r,10));job=(await call(owner,`jobs/${jobId}`)).data;}assert.equal(job.status,"failed");assert.equal(job.error.code,"UNAUTHENTICATED");assert.equal((await getStore(storeId)).campaigns[0].revision,before);
    await call(second,"store",{confirm:true},"DELETE");
  });
  const campaign=(await getStore(storeId)).campaigns[0];await call(owner,`campaigns/${campaign.id}/approve`,{expectedRevision:campaign.revision});const approved=(await getStore(storeId)).campaigns[0];await call(owner,`campaigns/${campaign.id}/activate`,{expectedRevision:approved.revision});
  const shopper:Actor={cookie:"",csrf:""},other:Actor={cookie:"",csrf:""};
  async function enter(a:Actor){const r=await call(a,`public/campaigns/${campaign.token}/sessions`,{measurementOptIn:false,noticeVersion:"demo-notice-v1"});a.csrf=r.response.headers.get("x-csrf-token")!;return r.data.id;}
  const first=await enter(shopper),otherId=await enter(other);
  await t.test("review counts distinct served visits rather than recommendation retries",async()=>{
    await mutateStore(storeId,s=>{for(let i=0;i<2;i++)s.jobs.push({id:randomUUID(),sessionId:otherId,status:"succeeded",createdAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+30000).toISOString()});});
    const review=(await call(reviewer.actor,`staff/campaigns/${campaign.id}/review`)).data;assert.equal(review.served,1);assert.equal(review.generationRuns,2);
  });
  await mutateStore(storeId,s=>{s.shoppers.find(x=>x.id===first)!.assignmentId="assignment-test";s.assignments.push({id:"assignment-test",sessionId:first,experimentId:"experiment-test",arm:"control",at:new Date().toISOString(),candidateSkus:campaign.candidateSkus,interests:["fixture-film-miyazaki"],budgetMinor:2000});});
  await t.test("fresh visit closes prior lease, preserves assignment and cannot reroll",async()=>{
    const oldCookie=shopper.cookie;assert.equal((await call(shopper,"shopper/new-visit",{confirm:true})).status,201);assert.equal((await call({cookie:oldCookie,csrf:shopper.csrf},"shopper/session")).status,401);
    const resumed=await call(shopper,`public/campaigns/${campaign.token}/sessions`,{noticeVersion:"demo-notice-v1"});shopper.csrf=resumed.response.headers.get("x-csrf-token")!;assert.equal(resumed.data.measurementAllowed,false);assert.notEqual(resumed.data.id,first);
    assert.equal((await call(shopper,`public/campaigns/${campaign.token}/sessions`,{measurementOptIn:true,noticeVersion:"demo-notice-v1"})).status,409);assert.equal((await getStore(storeId)).assignments[0].sessionId,first);
    assert.equal((await call({cookie:oldCookie,csrf:""},`public/campaigns/${campaign.token}/sessions`,{measurementOptIn:true,noticeVersion:"demo-notice-v1"})).status,409);
  });
  await t.test("display revisions preserve privacy ownership of earlier visits",async()=>{
    const s=await getStore(storeId),current=s.campaigns.at(-1)!;await call(owner,`campaigns/${current.id}`,{expectedRevision:current.revision,draft:{title:"Updated privacy display",candidateSkus:current.candidateSkus,ruleRevisionIds:[]}},"PATCH");let revised=(await getStore(storeId)).campaigns.at(-1)!;await call(owner,`campaigns/${revised.id}/approve`,{expectedRevision:revised.revision});revised=(await getStore(storeId)).campaigns.at(-1)!;await call(owner,`campaigns/${revised.id}/activate`,{expectedRevision:revised.revision});
    const resumed=await call(shopper,`public/campaigns/${revised.token}/sessions`,{noticeVersion:"demo-notice-v1"});shopper.csrf=resumed.response.headers.get("x-csrf-token")!;assert.equal(resumed.status,201);assert.equal(resumed.data.measurementAllowed,false);const visits=(await getStore(storeId)).shoppers.filter(x=>x.id!==otherId);assert.equal(new Set(visits.map(x=>x.privacyGroupId)).size,1);
  });
  await t.test("forget removes linked prior visits and taste caches but preserves other visits and ledger",async()=>{
    const s=await getStore(storeId),book=s.books[0];await mutateStore(storeId,x=>{x.outcomes.push({id:randomUUID(),type:"purchase",sessionId:first,sku:book.sku,quantity:1,amountMinor:book.priceMinor,currency:"USD",occurredAt:new Date().toISOString(),recordedAt:new Date().toISOString(),receiptDigest:"sample-ledger",dataMode:"demo"});x.requests[`shopper:${first}:cached`]={hash:"example",data:{interestIds:["private-choice"]},status:200};});
    assert.equal((await call(shopper,"shopper/forget",{confirm:true})).status,200);const after=await getStore(storeId);assert.equal(after.shoppers.length,1);assert.equal(after.shoppers[0].id,otherId);assert.equal(after.assignments.length,0);assert.equal(after.outcomes.length,1);assert.ok(!Object.keys(after.requests).some(k=>k.startsWith(`shopper:${first}:`)));assert.equal(after.privacyWithdrawals?.length,3);assert.equal((await call(other,"shopper/session")).status,200);
    assert.equal((await (await db()).query("SELECT * FROM shopper_tombstones WHERE store_id=$1",[storeId])).rows.length,3);
  });
  await t.test("owner rule lifecycle preserves history and ends unsafe enrollment",async()=>{
    const c=(await getStore(storeId)).campaigns.at(-1)!;const experiment=await call(owner,`campaigns/${c.id}/experiments`,{campaignVersionId:c.versionId,comparison:"policy_vs_policy",protocolVersion:"sample-test",modelVersion:"fixture",policyVersionIds:[randomUUID()],plannedSampleSize:20,enrollmentClosesAt:new Date(Date.now()+3600000).toISOString()});assert.equal(experiment.status,201);assert.equal((await call(owner,`experiments/${experiment.data.id}/freeze`,{expectedRevision:1})).status,200);
    const r=await call(owner,"rules",{type:"max_price_minor",operand:2000,scope:"store",example:{sku:"allowed",language:"en",format:"paperback",priceMinor:2000,expectedPass:true},counterexample:{sku:"blocked",language:"en",format:"paperback",priceMinor:2001,expectedPass:false},reviewAt:new Date(Date.now()+3600000).toISOString()});assert.equal(r.status,201);assert.equal((await getStore(storeId)).experiments.at(-1)!.state,"ended");
    assert.equal((await call(reviewer.actor,`staff/rules/${r.data.id}`,{expectedRevision:1,active:false},"PATCH")).status,403);
    assert.equal((await call(owner,`rules/${r.data.id}`,{expectedRevision:1,active:false},"PATCH")).status,200);assert.equal((await call(owner,`rules/${r.data.id}`,{expectedRevision:1,active:true},"PATCH")).status,409);
    await mutateStore(storeId,s=>{s.rules.find(x=>x.id===r.data.id)!.reviewAt=new Date(Date.now()-1).toISOString();});assert.equal((await call(owner,`rules/${r.data.id}`,{expectedRevision:2,active:true,reviewAt:new Date(Date.now()+86400000).toISOString()},"PATCH")).status,200);
    const rule=(await getStore(storeId)).rules.find(x=>x.id===r.data.id)!;assert.equal(rule.history?.length,2);assert.equal(rule.active,true);
  });
  await (await db()).close();
});
