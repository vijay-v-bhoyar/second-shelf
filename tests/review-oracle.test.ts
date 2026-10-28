import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
test("S4-D01 numeric activity oracle and S4-D02 empty interval are authoritative API results",async t=>{
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"ss-review-oracle-"));
  const {dispatch}=await import("../src/server/service"),{db,mutateStore,getStore}=await import("../src/server/repository");
  const origin="http://127.0.0.1:4397",owner={cookie:"",csrf:""},start="2026-10-20T00:00:00.000Z",end="2026-10-21T00:00:00.000Z",inside="2026-10-20T12:00:00.000Z";
  async function call(actor:typeof owner,route:string,body?:unknown,key=randomUUID()){
    const r=await dispatch(new Request(origin+"/api/v1/"+route,{method:body===undefined?"GET":"POST",headers:{origin,cookie:actor.cookie,"x-csrf-token":actor.csrf,"idempotency-key":key,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}),route.split("?")[0].split("/"));if(r.headers.get("set-cookie"))actor.cookie=r.headers.get("set-cookie")!.split(";")[0];return{status:r.status,data:await r.json()};
  }
  try{
    const storeId=(await call(owner,"demo-sessions",{})).data.storeId;owner.csrf=(await call(owner,"session")).data.csrfToken;let campaignId="";
    await mutateStore(storeId,s=>{
      const c=s.campaigns[0];campaignId=c.id;
      for(const [i,at] of ["2026-10-19T12:00:00.000Z",inside].entries()){
        const sessionId=randomUUID();s.shoppers.push({id:sessionId,campaignId:c.id,versionId:c.versionId,token:randomUUID(),csrf:randomUUID(),expiresAt:s.expiresAt,measurementOptIn:true,noticeVersion:"demo-notice-v1",rejected:[]});
        s.assignments.push({id:randomUUID(),sessionId,experimentId:randomUUID(),arm:i===0?"treatment":"control",at,candidateSkus:c.candidateSkus,interests:[],budgetMinor:2500});
        s.jobs.push({id:randomUUID(),sessionId,status:"succeeded",createdAt:inside,deadlineAt:end},{id:randomUUID(),sessionId,status:i===0?"succeeded":"failed",createdAt:inside,deadlineAt:end});
        const purchase={id:randomUUID(),sessionId,type:"purchase" as const,sku:s.books[0].sku,quantity:1,amountMinor:1800,currency:"USD",occurredAt:inside,recordedAt:inside,receiptDigest:randomUUID(),dataMode:"demo" as const};s.outcomes.push(purchase);
        if(i===1)s.outcomes.push({...purchase,id:randomUUID(),type:"return",parentEventId:purchase.id,receiptDigest:randomUUID()});
      }
    });
    const route=`campaigns/${campaignId}/review`,query=`?periodStart=${start}&periodEnd=${end}`;
    await t.test("D01 counts are 1 assigned, 2 served, 1 failed, 3 runs, 2 purchases, 0 withdrawals",async()=>{
      const r=await call(owner,route+query);assert.equal(r.status,200);assert.deepEqual([r.data.assigned,r.data.served,r.data.failed,r.data.generationRuns,r.data.verifiedPurchases,r.data.withdrawnVisits],[1,2,1,3,2,0]);assert.equal(r.data.missingOutcomes,1);assert.equal(r.data.arms.find((a:{arm:string})=>a.arm==="control").verifiedPurchasingSessions,0);assert.deepEqual([r.data.differencePercentagePoints,r.data.intervalLower,r.data.intervalUpper],[null,null,null]);
    });
    await t.test("D02 empty successful interval has six explicit zeros",async()=>{
      const r=await call(owner,route+'?periodStart=2099-01-01T00:00:00Z&periodEnd=2099-01-02T00:00:00Z');assert.equal(r.status,200);assert.deepEqual([r.data.assigned,r.data.served,r.data.failed,r.data.generationRuns,r.data.verifiedPurchases,r.data.withdrawnVisits],[0,0,0,0,0,0]);
    });
    await t.test("read-only reviewer receives aggregates without transaction payload or write rights",async()=>{
      const grant=(await call(owner,"memberships",{identityId:"Synthetic review observer",permissions:["review_read"]})).data,reviewer={cookie:"",csrf:""};await call(reviewer,"staff-sessions",{inviteToken:new URL(grant.inviteUrl).hash.slice(8)});reviewer.csrf=(await call(reviewer,"staff/session")).data.csrfToken;
      assert.equal((await call(reviewer,"staff/"+route+query)).data.verifiedPurchases,2);assert.deepEqual((await call(reviewer,"staff/workspace")).data.outcomes,[]);const c=(await getStore(storeId)).campaigns[0];assert.equal((await call(reviewer,"staff/"+route,{expectedRevision:c.revision,periodStart:start,periodEnd:end,decision:"keep",rationale:"Forbidden",activeWorkSeconds:0})).status,403);assert.equal((await getStore(storeId)).reviews.length,0);
    });
    await t.test("decision retry returns one persisted ID with the exact normalized interval",async()=>{
      const c=(await getStore(storeId)).campaigns[0],body={expectedRevision:c.revision,periodStart:start,periodEnd:end,decision:"change",rationale:"S4-D01 synthetic activity only",activeWorkSeconds:0},key=randomUUID();const a=await call(owner,route,body,key),b=await call(owner,route,body,key);assert.equal(a.status,200);assert.deepEqual(b,a);const saved=(await getStore(storeId)).reviews;assert.equal(saved.length,1);assert.equal(saved[0].id,a.data.id);assert.equal(saved[0].periodStart,start);assert.equal(saved[0].periodEnd,end);assert.equal(saved[0].rationale,body.rationale);assert.equal((await call(owner,route,{...body,rationale:"Changed"},key)).status,409);
    });
  }finally{await(await db()).close();}
});
