import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "../src/server/service";
import { getStore, mutateStore } from "../src/server/repository";
import { rankBooks } from "../src/server/providers";

test("live proposal contract with simulated Qloo responses; no credentialed calls",async t=>{
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"second-shelf-live-contract-"));
  process.env.SECOND_SHELF_PROVIDER_MODE="live";
  process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";
  process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";
  process.env.QLOO_BASE_URL="https://hackathon.api.qloo.com";
  process.env.SECOND_SHELF_QLOO_DAILY_CALL_LIMIT="20";
  const base="http://127.0.0.1:4397",realFetch=globalThis.fetch;
  let cookie="",staffCookie="",csrf="",staffCsrf="",providerCalls=0,failProvider=false;
  const movieId=randomUUID(),artistId=randomUUID(),bookIds=[randomUUID(),randomUUID(),randomUUID()];
  globalThis.fetch=async(input,init)=>{
    providerCalls++;const url=new URL(String(input));assert.equal(url.hostname,"hackathon.api.qloo.com");
    assert.equal(new Headers(init?.headers).get("X-Api-Key"),"TEST-ONLY-NEVER-SENT");
    if(failProvider)return Response.json({error:"simulated outage"},{status:503});
    if(url.pathname==="/search"){assert.equal(url.searchParams.get("types"),"urn:entity:movie");return Response.json({results:[{entity_id:movieId,name:"A confirmed film"}]});}
    assert.equal(url.pathname,"/v2/insights");assert.equal(url.searchParams.get("filter.type"),"urn:entity:book");
    assert.equal(url.searchParams.get("signal.interests.entities"),[movieId,artistId].join(","));
    assert.deepEqual(url.searchParams.get("filter.results.entities")?.split(","),bookIds);
    return Response.json({results:{entities:[...bookIds].reverse().map(entity_id=>({entity_id,name:"Mapped book"}))}});
  };
  async function call(route:string,body?:unknown,method=body===undefined?"GET":"POST",staff=false){
    const response=await dispatch(new Request(`${base}/api/v1/${route}`,{method,headers:{origin:base,"content-type":"application/json","idempotency-key":randomUUID(),cookie:staff?staffCookie:cookie,"x-csrf-token":staff?staffCsrf:csrf},body:body===undefined?undefined:JSON.stringify(body)}),route.split("?")[0].split("/"));
    const issued=response.headers.get("set-cookie");if(issued){if(issued.startsWith("ss_staff="))staffCookie=issued.split(";")[0];else cookie=issued.split(";")[0];}
    return{status:response.status,data:await response.json()};
  }
  async function finish(job:{id:string}){
    let result=await call(`jobs/${job.id}`);
    for(let i=0;i<100&&!["succeeded","failed"].includes(result.data.status);i++){await new Promise(r=>setTimeout(r,20));result=await call(`jobs/${job.id}`);}
    return result.data;
  }
  try {
    await call("demo-sessions",{});let workspace=(await call("workspace")).data;csrf=workspace.csrfToken;
    let campaign=workspace.campaigns.at(-1);
    await t.test("live seed has no confirmed fixture identities or selected books",()=>{assert.ok(workspace.books.every((b:{mappingStatus:string;entityId?:string})=>b.mappingStatus==="unresolved"&&!b.entityId));assert.deepEqual(campaign.candidateSkus,[]);});
    await t.test("missing and fixture interests are rejected before a task/provider call",async()=>{
      for(const interestIds of [undefined,[],["fixture-film-miyazaki"]]){const r=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds});assert.equal(r.status,422);}
      assert.equal(providerCalls,0);assert.equal((await getStore(workspace.id)).jobs.length,0);
    });
    await t.test("unconfigured provider fails without pretending a proposal is available",async()=>{process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="false";const r=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds:[movieId]});assert.equal(r.status,503);assert.equal(providerCalls,0);process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";});
    await t.test("illustrative inventory identity cannot be promoted in live mode",async()=>{const book=workspace.books[0];const result=await call(`entity-mappings/${book.mappingId}`,{expectedRevision:book.revision,status:"confirmed",entityId:"fixture-book-FAKE",reason:"Negative identity boundary"},"PATCH");assert.equal(result.status,422);const current=(await call("workspace")).data.books[0];assert.equal(current.mappingStatus,"unresolved");assert.equal(current.revision,book.revision);});
    await t.test("empty eligible inventory returns no matches without a provider call",async()=>{const before=providerCalls;assert.deepEqual(await rankBooks([],[movieId]),[]);assert.equal(providerCalls,before);});
    const books=workspace.books.slice(0,3);
    for(let i=0;i<books.length;i++){const r=await call(`entity-mappings/${books[i].mappingId}`,{expectedRevision:books[i].revision,status:"confirmed",entityId:bookIds[i],reason:"Simulated contract test mapping"},"PATCH");assert.equal(r.status,200);}
    const saved=await call(`campaigns/${campaign.id}`,{expectedRevision:campaign.revision,draft:{title:campaign.title,candidateSkus:books.map((b:{sku:string})=>b.sku),ruleRevisionIds:[]}},"PATCH");assert.equal(saved.status,200);
    workspace=(await call("workspace")).data;campaign=workspace.campaigns.at(-1);
    await t.test("searched real-ID shape and owner proposal preserve constrained provider order",async()=>{
      const search=await call("entities?query=Film&type=movie");assert.equal(search.status,200);assert.equal(search.data.items[0].id,movieId);
      const queued=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds:[movieId,artistId]});assert.equal(queued.status,202);
      const result=await finish(queued.data);assert.equal(result.status,"succeeded");assert.deepEqual(result.result.campaign.candidateSkus,books.map((b:{sku:string})=>b.sku).reverse());assert.match(result.result.campaign.plan,/Qloo/);
    });
    await t.test("independent curator accepts selected IDs but cannot approve",async()=>{
      const grant=await call("memberships",{identityId:"Simulated live curator",permissions:["campaign_draft"]});assert.equal(grant.status,201);
      const token=new URLSearchParams(new URL(grant.data.inviteUrl).hash.slice(1)).get("invite");assert.equal((await call("staff-sessions",{inviteToken:token})).status,201);
      const staff=(await call("staff/workspace",undefined,"GET",true)).data;staffCsrf=staff.csrfToken;assert.equal(staff.providerMode,"live");campaign=staff.campaigns.at(-1);
      const queued=await call(`staff/campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds:[movieId,artistId]},"POST",true);assert.equal(queued.status,202);assert.equal((await finish(queued.data)).status,"succeeded");
      const denied=await call(`staff/campaigns/${campaign.id}/approve`,{expectedRevision:campaign.revision},"POST",true);assert.equal(denied.status,403);
    });
    await t.test("provider failure leaves the draft unchanged without fixture substitution",async()=>{
      failProvider=true;campaign=(await call("workspace")).data.campaigns.at(-1);const before=structuredClone(campaign);
      const queued=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds:[movieId,artistId]});assert.equal(queued.status,202);const result=await finish(queued.data);assert.equal(result.status,"failed");assert.equal(result.error.code,"PROVIDER_UNAVAILABLE");assert.deepEqual((await call("workspace")).data.campaigns.at(-1),before);
    });
    failProvider=false;campaign=(await call("workspace")).data.campaigns.at(-1);
    assert.equal((await call(`campaigns/${campaign.id}/approve`,{expectedRevision:campaign.revision})).status,200);
    campaign=(await call("workspace")).data.campaigns.at(-1);
    assert.equal((await call(`campaigns/${campaign.id}/activate`,{expectedRevision:campaign.revision})).status,200);
    assert.equal((await call(`public/campaigns/${campaign.token}/sessions`,{noticeVersion:"demo-notice-v1"})).status,201);
    const visit=(await call("shopper/session")).data;csrf=visit.csrfToken;
    const assignmentId=randomUUID();
    await mutateStore(workspace.id,s=>{const shopper=s.shoppers.find(v=>v.id===visit.id)!;shopper.assignmentId=assignmentId;s.assignments.push({id:assignmentId,sessionId:shopper.id,experimentId:randomUUID(),arm:"control",at:new Date().toISOString(),candidateSkus:books.map((b:{sku:string})=>b.sku),interests:[movieId,artistId],budgetMinor:2500});});
    await t.test("simulated control never calls or claims Qloo, including item provenance",async()=>{
      const before=providerCalls,queued=await call("shopper/recommendations",{interestIds:[movieId,artistId],budgetMinor:2500,excludedSkus:[]});assert.equal(queued.status,202);
      const job=await finish(queued.data);assert.equal(job.status,"succeeded");assert.equal(providerCalls,before);assert.equal(job.result.evidenceMode,"simulation");assert.ok(job.result.items.length>0);
      assert.deepEqual(job.result.items.map((b:{title:string})=>b.title),job.result.items.map((b:{title:string})=>b.title).sort((a:string,b:string)=>a.localeCompare(b)));
      for(const item of job.result.items){assert.equal(item.evidenceMode,"simulation");assert.match(item.interpretation,/Qloo was not called/);assert.match(item.interpretation,/not a real LLM comparison/);}
    });
    await t.test("empty simulated control retains simulation provenance without calling Qloo",async()=>{
      await mutateStore(workspace.id,s=>{s.assignments.find(a=>a.id===assignmentId)!.budgetMinor=0;});
      const before=providerCalls,queued=await call("shopper/recommendations",{interestIds:[movieId,artistId],budgetMinor:0,excludedSkus:[]});assert.equal(queued.status,202);const job=await finish(queued.data);assert.equal(job.status,"succeeded");assert.equal(job.result.evidenceMode,"simulation");assert.deepEqual(job.result.items,[]);assert.equal(providerCalls,before);
    });
    await t.test("treatment calls the provider and retains live provenance",async()=>{
      await mutateStore(workspace.id,s=>{const a=s.assignments.find(a=>a.id===assignmentId)!;a.arm="treatment";a.budgetMinor=2500;});
      const before=providerCalls,queued=await call("shopper/recommendations",{interestIds:[movieId,artistId],budgetMinor:2500,excludedSkus:[]});assert.equal(queued.status,202);const job=await finish(queued.data);assert.equal(job.status,"succeeded");assert.equal(providerCalls,before+1);assert.equal(job.result.evidenceMode,"live");for(const item of job.result.items){assert.equal(item.evidenceMode,"live");assert.match(item.interpretation,/Ranked by Qloo/);}
    });
  } finally {globalThis.fetch=realFetch;}
});
