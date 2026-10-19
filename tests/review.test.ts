import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";

test("review activity windows and retained decision periods",async t=>{
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"ss-review-tests-"));
  const {dispatch}=await import("../src/server/service"),{db,mutateStore,getStore}=await import("../src/server/repository");
  const origin="http://127.0.0.1:4397",owner={cookie:"",csrf:""},start="2026-10-01T00:00:00.000Z",end="2026-10-02T00:00:00.000Z",inside="2026-10-01T12:00:00.000Z";
  async function call(actor:typeof owner,route:string,body?:unknown){const r=await dispatch(new Request(`${origin}/api/v1/${route}`,{method:body===undefined?"GET":"POST",headers:{cookie:actor.cookie,origin,"x-csrf-token":actor.csrf,"content-type":"application/json","idempotency-key":randomUUID()},body:body===undefined?undefined:JSON.stringify(body)}),route.split("?")[0].split("/"));const cookie=r.headers.get("set-cookie");if(cookie)actor.cookie=cookie.split(";")[0];return{status:r.status,data:await r.json()};}
  try{
    const storeId=(await call(owner,"demo-sessions",{})).data.storeId;owner.csrf=(await call(owner,"session")).data.csrfToken;let campaignId="";
    await mutateStore(storeId,s=>{
      const c=s.campaigns[0];campaignId=c.id;
      for(const at of ["2026-09-30T23:59:59.999Z",start,end]){const sessionId=randomUUID();s.shoppers.push({id:sessionId,campaignId:c.id,versionId:c.versionId,token:randomUUID(),csrf:randomUUID(),expiresAt:s.expiresAt,measurementOptIn:true,noticeVersion:"demo-notice-v1",rejected:[]});s.assignments.push({id:randomUUID(),sessionId,experimentId:randomUUID(),arm:"treatment",at,candidateSkus:c.candidateSkus,interests:[],budgetMinor:2000});s.jobs.push({id:randomUUID(),sessionId,status:"succeeded",createdAt:at,deadlineAt:end});const purchase={id:randomUUID(),type:"purchase" as const,sessionId,sku:s.books[0].sku,quantity:2,amountMinor:2000,currency:"USD",occurredAt:at,recordedAt:at,receiptDigest:randomUUID(),dataMode:"demo" as const};s.outcomes.push(purchase);
        if(at===start){s.jobs.push({id:randomUUID(),sessionId,status:"succeeded",createdAt:inside,deadlineAt:end},{id:randomUUID(),sessionId,status:"failed",createdAt:inside,deadlineAt:end});s.outcomes.push({...purchase,id:randomUUID(),type:"return",parentEventId:purchase.id,quantity:1,amountMinor:1000,occurredAt:inside,receiptDigest:randomUUID()},{...purchase,id:randomUUID(),type:"correction",parentEventId:purchase.id,quantity:1,amountMinor:1000,occurredAt:end,receiptDigest:randomUUID()});}
      }
      s.privacyWithdrawals=[{shopperId:randomUUID(),campaignId:c.id,at:inside},{shopperId:randomUUID(),campaignId:c.id,at:end}];s.reviews.push({id:randomUUID(),campaignId:c.id,decision:"keep",rationale:"Inside",activeWorkSeconds:9,at:inside},{id:randomUUID(),campaignId:c.id,decision:"keep",rationale:"Outside",activeWorkSeconds:50,at:end});
    });
    const route=`campaigns/${campaignId}/review`;
    await t.test("half-open range filters assignment/run/outcome/withdrawal/decision times",async()=>{
      const r=await call(owner,`${route}?periodStart=${start}&periodEnd=${end}`);assert.equal(r.status,200);const x=r.data;assert.deepEqual([x.assigned,x.served,x.failed,x.generationRuns,x.verifiedPurchases,x.withdrawnVisits,x.ownerActiveWorkSeconds],[1,1,1,2,1,1,9]);assert.equal(x.arms[0].verifiedPurchasingSessions,1);assert.equal(x.missingOutcomes,0);assert.equal(x.differencePercentagePoints,null);assert.equal(x.periodBasis,"activity_window");assert.equal(x.periodStart,start);assert.equal(x.periodEnd,end);
    });
    await t.test("future period is empty and offsets normalize to the same UTC interval",async()=>{
      const empty=await call(owner,`${route}?periodStart=2099-01-01T00:00:00Z&periodEnd=2099-01-02T00:00:00Z`);assert.equal(empty.status,200);assert.deepEqual([empty.data.assigned,empty.data.served,empty.data.failed,empty.data.generationRuns,empty.data.verifiedPurchases,empty.data.withdrawnVisits,empty.data.ownerActiveWorkSeconds],[0,0,0,0,0,0,0]);
      const query=new URLSearchParams({periodStart:"2026-10-01T01:00:00+01:00",periodEnd:"2026-10-02T01:00:00+01:00"});const offset=await call(owner,`${route}?${query}`);assert.equal(offset.status,200);assert.equal(offset.data.periodStart,start);assert.equal(offset.data.periodEnd,end);assert.equal(offset.data.verifiedPurchases,1);
    });
    await t.test("invalid/incomplete/repeated/reversed/equal/oversized intervals fail without writes",async()=>{
      const before=await getStore(storeId);for(const query of [`periodStart=${start}`,`periodEnd=${end}`,`periodStart=nope&periodEnd=${end}`,`periodStart=${end}&periodEnd=${start}`,`periodStart=${start}&periodEnd=${start}`,"periodStart=2024-01-01T00:00:00Z&periodEnd=2026-01-01T00:00:00Z",`periodStart=${start}&periodStart=${start}&periodEnd=${end}`])assert.equal((await call(owner,`${route}?${query}`)).status,400,query);assert.deepEqual((await getStore(storeId)).reviews,before.reviews);
    });
    await t.test("decision retains normalized interval and independent reviewer cannot mutate it",async()=>{
      const campaign=(await getStore(storeId)).campaigns[0],body={expectedRevision:campaign.revision,periodStart:start,periodEnd:end,decision:"change",rationale:"Period-bound sample decision",activeWorkSeconds:0};assert.equal((await call(owner,route,body)).status,200);const decision=(await getStore(storeId)).reviews.at(-1)!;assert.equal(decision.periodStart,start);assert.equal(decision.periodEnd,end);assert.equal((await call(owner,route,{...body,periodEnd:start})).status,400);
      const grant=await call(owner,"memberships",{identityId:"Period reviewer",permissions:["review_read"]}),staff={cookie:"",csrf:""};assert.equal(grant.status,201);assert.equal((await call(staff,"staff-sessions",{inviteToken:new URL(grant.data.inviteUrl).hash.slice(8)})).status,201);staff.csrf=(await call(staff,"staff/session")).data.csrfToken;assert.equal((await call(staff,`staff/${route}?periodStart=${start}&periodEnd=${end}`)).data.verifiedPurchases,1);assert.equal((await call(staff,`staff/${route}`,body)).status,403);
    });
  }finally{await(await db()).close();}
});
