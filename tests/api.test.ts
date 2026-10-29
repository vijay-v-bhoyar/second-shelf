import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "../src/server/service";
import { db, getStore } from "../src/server/repository";
import { sampleCsv } from "../src/server/domain";
import type { Job } from "../src/lib/types";

test("full API workflow, negative boundaries, isolated tenants, persistence and safe policy gate",async t=>{
  process.env.SECOND_SHELF_DATA_DIR=path.join(await mkdtemp(path.join(tmpdir(),"second-shelf-api-")),"fresh-parent","fresh-store");
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";
  const base="http://127.0.0.1:4397";let ownerCookie="",csrf="",shopperCookie="",shopperCsrf="";
  async function call(route:string,body?:unknown,method="POST",shopper=false,key=randomUUID()){
    const headers:Record<string,string>={origin:base,"idempotency-key":key};
    headers.cookie=shopper?shopperCookie:ownerCookie;headers["x-csrf-token"]=shopper?shopperCsrf:csrf;
    if(!(body instanceof FormData))headers["content-type"]="application/json";
    const response=await dispatch(new Request(`${base}/api/v1/${route}`,{method:body===undefined&&method==="POST"?"GET":method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),route.split("/"));
    const cookie=response.headers.get("set-cookie");if(cookie){if(cookie.startsWith("ss_shopper="))shopperCookie=cookie.split(";")[0];else ownerCookie=cookie.split(";")[0];}
    if(response.headers.get("x-csrf-token"))shopperCsrf=response.headers.get("x-csrf-token")!;
    return{response,data:response.headers.get("content-type")?.includes("json")?await response.json():await response.text()};
  }
  async function job(initial:Job){let current=initial;for(let i=0;i<150&&!["succeeded","failed"].includes(current.status);i++){await new Promise(r=>setTimeout(r,20));current=(await call(`jobs/${current.id}`)).data;}assert.equal(current.status,"succeeded",JSON.stringify(current.error));return current.result!;}
  await t.test("cold health initializes persistence before reporting database readiness",async()=>{const health=await call("health");assert.equal(health.response.status,200);assert.equal(health.data.app,"Second Shelf");assert.equal(health.data.providerMode,"fixture");assert.equal(health.data.databaseReady,true);assert.equal((await (await db()).query<{n:number}>("SELECT COUNT(*)::int AS n FROM stores")).rows[0].n,0);});
  const start=await call("demo-sessions",{});assert.equal(start.response.status,201);const storeId=start.data.storeId;
  const session=await call("session");csrf=session.data.csrfToken;let s=await getStore(storeId);let campaign=s.campaigns[0];
  await t.test("Next internal localhost URL preserves the validated loopback browser origin",async()=>{
    const response=await dispatch(new Request("http://localhost:4397/api/v1/demo-sessions",{method:"POST",headers:{host:"127.0.0.1:4397",origin:base,"idempotency-key":randomUUID(),"content-type":"application/json"},body:"{}"}),["demo-sessions"]);
    assert.equal(response.status,201);
  });
  await t.test("owner context, private schema and wrong method",async()=>{const w=await call("workspace");assert.equal(w.data.dataMode,"demo");assert.equal(w.data.persistence,"embedded-postgresql");assert.equal(w.data.persistence,(await call("health")).data.persistence);assert.ok(!("token" in w.data));assert.equal((await call("campaigns",{},"DELETE")).response.status,404);});
  await t.test("CSV preview, atomic activation and idempotent retry",async()=>{
    const file=new FormData();file.set("file",new File([sampleCsv(s.books)],"stock.csv",{type:"text/csv"}));const p=await call("inventory-imports",file);assert.equal(p.response.status,201);assert.equal(p.data.errors.length,0);
    const key=randomUUID(),body={expectedRevision:p.data.baseRevision,acceptedRowNumbers:p.data.acceptedRowNumbers};const first=await call(`inventory-imports/${p.data.id}/commit`,body,"POST",false,key);assert.equal(first.response.status,200);
    const twice=await call(`inventory-imports/${p.data.id}/commit`,body,"POST",false,key);assert.deepEqual(twice.data,first.data);assert.equal((await getStore(storeId)).books.length,12);
    assert.equal((await call(`inventory-imports/${p.data.id}/commit`,{...body,acceptedRowNumbers:[999]},"POST",false,key)).response.status,409);
  });
  await t.test("malformed CSV headers return an input error without changing inventory",async()=>{
    const before=(await getStore(storeId)).books;const form=new FormData();form.set("file",new File(["wrong,headers\nx,y"],"invalid.csv",{type:"text/csv"}));const r=await call("inventory-imports",form);assert.equal(r.response.status,400);assert.equal(r.data.code,"INVALID_INPUT");assert.deepEqual((await getStore(storeId)).books,before);
  });
  await t.test("mapping confirm and exclusion require current revisions",async()=>{s=await getStore(storeId);const book=s.books.at(-1)!;const r=await call(`entity-mappings/${book.mappingId}`,{expectedRevision:book.revision,status:"confirmed",entityId:`fixture-book-${book.sku}`,reason:"Confirmed sample work"},"PATCH");assert.equal(r.response.status,200);assert.equal((await call(`entity-mappings/${book.mappingId}`,{expectedRevision:book.revision,status:"excluded",reason:"stale"},"PATCH")).response.status,409);});
  await t.test("cultural plan, approval, activation and revision conflicts",async()=>{s=await getStore(storeId);campaign=s.campaigns[0];const proposed=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision});assert.equal(proposed.response.status,202);await job(proposed.data);campaign=(await getStore(storeId)).campaigns[0];assert.equal((await call(`campaigns/${campaign.id}/approve`,{expectedRevision:campaign.revision})).response.status,200);campaign=(await getStore(storeId)).campaigns[0];const activated=await call(`campaigns/${campaign.id}/activate`,{expectedRevision:campaign.revision});assert.equal(activated.response.status,200);assert.ok(activated.data.qrUrl);assert.equal((await call(`campaigns/${campaign.id}/retire`,{expectedRevision:1})).response.status,409);campaign=(await getStore(storeId)).campaigns[0];});
  await t.test("public shopper discovery and rejection do not repeat or exceed budget",async()=>{
    assert.equal((await call(`public/campaigns/${campaign.token}`)).response.status,200);const visit=await call(`public/campaigns/${campaign.token}/sessions`,{measurementOptIn:false,noticeVersion:"demo-notice-v1"});assert.equal(visit.response.status,201);
    const input={interestIds:["fixture-film-miyazaki"],budgetMinor:1800,excludedSkus:[]};const r=await call("shopper/recommendations",input,"POST",true);assert.equal(r.response.status,202);const data=await job(r.data),items=data.items as {sku:string;priceMinor:number}[];assert.ok(items.length>0);assert.ok(items.every(b=>b.priceMinor<=1800));
    const selected=items[0];assert.equal((await call("shopper/events",{runId:data.runId,sku:selected.sku,type:"reject"},"POST",true)).response.status,200);const replacement=await job((await call("shopper/recommendations",input,"POST",true)).data);assert.ok(!(replacement.items as {sku:string}[]).some(b=>b.sku===selected.sku));
    const book=(replacement.items as {sku:string;priceMinor:number}[])[0];const code=await call("shopper/purchase-code",{runId:replacement.runId,sku:book.sku},"POST",true);assert.ok(code.data.code);
    const purchase={type:"purchase",sessionCode:code.data.code,sku:book.sku,quantity:1,amountMinor:book.priceMinor,currency:"USD",occurredAt:new Date().toISOString(),receiptReference:"TEST-001"};
    assert.equal((await call("outcomes",purchase,"POST",true)).response.status,403);
    const verified=await call("outcomes",purchase);assert.equal(verified.response.status,201);assert.equal((await call("outcomes",purchase)).data.id,verified.data.id);
    assert.equal((await call("outcomes",{...purchase,type:"return",parentEventId:verified.data.id,reason:"returned",receiptReference:"TEST-RETURN",quantity:2})).response.status,400);
    assert.equal((await call("outcomes",{...purchase,type:"return",parentEventId:verified.data.id,reason:"returned",receiptReference:"TEST-RETURN"})).response.status,201);
  });
  await t.test("empty result and input attack remain honest",async()=>{const result=await job((await call("shopper/recommendations",{interestIds:["fixture-film-miyazaki"],budgetMinor:0,excludedSkus:[]},"POST",true)).data);assert.equal((result.items as unknown[]).length,0);assert.ok(result.emptyReason);assert.equal((await call("shopper/recommendations",{interestIds:["fixture-film-miyazaki"],budgetMinor:2000,excludedSkus:[],arm:"treatment"},"POST",true)).response.status,400);});
  await t.test("weekly review and policy evaluation never claim simulated uplift",async()=>{const r=await call(`campaigns/${campaign.id}/review`);assert.equal(r.data.evidenceStatus,"simulation");assert.equal(r.data.differencePercentagePoints,null);const latest=(await getStore(storeId)).campaigns[0];const p=await call(`campaigns/${campaign.id}/policy-proposals`,{expectedRevision:latest.revision,rationale:"Test a bounded future change",rankOffsets:[],trainingExperimentIds:[]});const result=await job((await call(`policy-proposals/${p.data.id}/evaluate`,{expectedRevision:1})).data);assert.equal(result.status,"insufficient_evidence");assert.equal((await call(`policy-proposals/${p.data.id}/approve`,{expectedRevision:1})).response.status,409);});
  await t.test("resuming an assigned shopper preserves measurement choice and assignment",async()=>{
    const current=(await getStore(storeId)).campaigns.at(-1)!;
    const experiment=await call(`campaigns/${current.id}/experiments`,{campaignVersionId:current.versionId,comparison:"policy_vs_policy",protocolVersion:"demo-test",modelVersion:"fixture",policyVersionIds:[randomUUID()],plannedSampleSize:20,enrollmentClosesAt:new Date(Date.now()+3600000).toISOString()});assert.equal(experiment.response.status,201);
    assert.equal((await call(`experiments/${experiment.data.id}/freeze`,{expectedRevision:1})).response.status,200);
    const entered=await call(`public/campaigns/${current.token}/sessions`,{measurementOptIn:true,noticeVersion:"demo-notice-v1"},"POST",true);assert.equal(entered.response.status,201);
    const input={interestIds:["fixture-film-miyazaki"],budgetMinor:2000,excludedSkus:[]};await job((await call("shopper/recommendations",input,"POST",true)).data);const before=(await getStore(storeId)).assignments;
    const resumed=await call(`public/campaigns/${current.token}/sessions`,{noticeVersion:"demo-notice-v1"},"POST",true);assert.equal(resumed.response.status,201);assert.equal(resumed.data.id,entered.data.id);assert.equal(resumed.data.measurementOptIn,true);
    assert.deepEqual(resumed.data.frozenPreferences.interests.map((i:{id:string})=>i.id),input.interestIds);assert.equal(resumed.data.frozenPreferences.budgetMinor,input.budgetMinor);
    assert.equal((await call("shopper/recommendations",{...input,budgetMinor:2001},"POST",true)).response.status,409);
    await job((await call("shopper/recommendations",input,"POST",true)).data);assert.deepEqual((await getStore(storeId)).assignments,before);
    assert.equal((await call(`public/campaigns/${current.token}/sessions`,{measurementOptIn:false,noticeVersion:"demo-notice-v1"},"POST",true)).response.status,409);
    assert.deepEqual((await getStore(storeId)).assignments,before);
  });
  await t.test("weekly keep/change/retire decisions never implicitly publish or retire",async()=>{
    const current=(await getStore(storeId)).campaigns.at(-1)!;
    for(const decision of ["keep","change","retire"]){const r=await call(`campaigns/${current.id}/review`,{expectedRevision:current.revision,periodStart:new Date(Date.now()-3600000).toISOString(),periodEnd:new Date().toISOString(),decision,rationale:`Test ${decision}`,activeWorkSeconds:0});assert.equal(r.response.status,200);assert.equal((await getStore(storeId)).campaigns.at(-1)!.state,"active");}
    assert.equal((await call(`public/campaigns/${current.token}`)).response.status,200);
  });
  await t.test("export excludes session secrets and raw provider payloads",async()=>{const result=await job((await call("exports",{format:"json"})).data);const route=new URL(String(result.downloadUrl)).pathname.replace("/api/v1/","");const r=await call(route);assert.equal(r.data.dataMode,"demo");assert.ok(!JSON.stringify(r.data).includes(csrf));assert.ok(!("shoppers" in r.data));});
  await t.test("two tenants cannot read or mutate one another",async()=>{const firstCookie=ownerCookie,firstCsrf=csrf;const second=await call("demo-sessions",{});csrf=(await call("session")).data.csrfToken;const denied=await call(`campaigns/${campaign.id}/retire`,{expectedRevision:campaign.revision});assert.equal(denied.response.status,404);assert.equal((await call(`campaigns/${campaign.id}`)).response.status,404);await call("store",{confirm:true},"DELETE");ownerCookie=firstCookie;csrf=firstCsrf;assert.equal((await call("workspace")).data.id,storeId);assert.notEqual(second.data.storeId,storeId);});
  await t.test("CSRF and origin failures cannot mutate; deletion revokes access",async()=>{const saved=csrf;csrf="bad";assert.equal((await call("exports",{format:"json"})).response.status,403);csrf=saved;const response=await dispatch(new Request(`${base}/api/v1/exports`,{method:"POST",headers:{origin:"https://untrusted.example",cookie:ownerCookie,"x-csrf-token":csrf,"idempotency-key":randomUUID(),"content-type":"application/json"},body:'{"format":"json"}'}),["exports"]);assert.equal(response.status,403);assert.equal((await call("store",{confirm:true},"DELETE")).response.status,202);assert.equal((await call("workspace")).response.status,401);});
  await (await db()).close();
});
