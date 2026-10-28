import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "../src/server/service";
import { db, getStore, mutateStore } from "../src/server/repository";
import { displayReadiness, ruleExamples, rulePass } from "../src/lib/display-review";
import { makeStore } from "../src/server/fixtures";
import { wireBook } from "../src/server/domain";

test("readiness distinguishes saved order from unsaved changes and unavailable rows",()=>{
  const s=makeStore("synthetic"),c=s.campaigns[0],books=s.books.map(b=>wireBook(s,b));
  assert.equal(displayReadiness(c,c.title,[...c.candidateSkus].reverse(),books,s.rules).dirty,false);
  assert.equal(displayReadiness(c,c.title+" edit",c.candidateSkus,books,s.rules).dirty,true);
  assert.equal(displayReadiness(c,c.title,[...c.candidateSkus,"missing"],books,s.rules).ready,false);
  assert.equal(displayReadiness(c,c.title,c.candidateSkus,books.map(b=>({...b,eligible:false})),s.rules).ready,false);
});
test("generated rule checks remain opposing even for reserved-looking operands",()=>{
  for(const [type,operand] of [["exclude_sku","EXAMPLE-ALLOWED"],["require_language","not-allowed"],["require_format","not-allowed"],["max_price_minor",0]] as const){const pair=ruleExamples(type,operand);assert.equal(rulePass({type,operand},pair.example),true);assert.equal(rulePass({type,operand},pair.counterexample),false);}
});

test("S5-B04 synthetic display approval and rule boundaries",async t=>{
  delete process.env.DATABASE_URL;delete process.env.VERCEL;delete process.env.QLOO_API_KEY;
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"ss-display-"));
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("Unexpected network");};
  type Actor={cookie:string;csrf:string};const pending:(()=>Promise<void>)[]=[];
  async function call(actor:Actor,route:string,body?:unknown,method="POST",key=randomUUID()){
    const origin="http://127.0.0.1:4397";
    const response=await dispatch(new Request(origin+"/api/v1/"+route,{method:body===undefined?"GET":method,headers:{origin,cookie:actor.cookie,"x-csrf-token":actor.csrf,"idempotency-key":key,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}),route.split("/"),fn=>pending.push(fn));
    const cookie=response.headers.get("set-cookie");if(cookie)actor.cookie=cookie.split(";")[0];return{status:response.status,data:await response.json()};
  }
  async function drain(){while(pending.length)await pending.shift()!();}
  async function setup(){await drain();process.env.SECOND_SHELF_PROVIDER_MODE="fixture";const actor={cookie:"",csrf:""};const id=(await call(actor,"demo-sessions",{})).data.storeId;actor.csrf=(await call(actor,"session")).data.csrfToken;return{actor,id,c:(await getStore(id)).campaigns.at(-1)!};}
  const draft=(c:{title:string;candidateSkus:string[];ruleRevisionIds:string[]})=>({title:c.title+" revised",candidateSkus:c.candidateSkus,ruleRevisionIds:c.ruleRevisionIds});
  async function grant(owner:Actor){const invite=(await call(owner,"memberships",{identityId:"Synthetic drafting staff",permissions:["campaign_draft"]})).data;const actor={cookie:"",csrf:""};await call(actor,"staff-sessions",{inviteToken:invite.inviteUrl.split("#invite=")[1]});actor.csrf=(await call(actor,"staff/session")).data.csrfToken;return{actor,memberId:invite.id};}
  try{
    await t.test("queued proposal cannot silently adopt a newer draft revision",async()=>{
      const {actor,id,c}=await setup();const queued=await call(actor,`campaigns/${c.id}/plan`,{expectedRevision:c.revision});assert.equal(queued.status,202);
      assert.equal((await call(actor,`campaigns/${c.id}`,{expectedRevision:c.revision,draft:draft(c)},"PATCH")).status,200);
      const before=structuredClone((await getStore(id)).campaigns.at(-1));await drain();const s=await getStore(id);
      assert.equal(s.jobs.at(-1)?.status,"failed");assert.deepEqual(s.campaigns.at(-1),before);
    });
    await t.test("two-tab stale approval fails; saving an approved display creates an unapproved successor",async()=>{
      const {actor,id,c}=await setup();const edited=await call(actor,`campaigns/${c.id}`,{expectedRevision:c.revision,draft:draft(c)},"PATCH");
      assert.equal((await call(actor,`campaigns/${c.id}/approve`,{expectedRevision:c.revision})).status,409);
      assert.equal((await call(actor,`campaigns/${c.id}/approve`,{expectedRevision:edited.data.revision})).status,200);
      const approved=(await getStore(id)).campaigns.at(-1)!;
      const successor=await call(actor,`campaigns/${c.id}`,{expectedRevision:approved.revision,draft:draft(approved)},"PATCH");assert.equal(successor.data.state,"draft");assert.notEqual(successor.data.versionId,approved.versionId);assert.equal(successor.data.approvedAt,undefined);
      assert.equal((await call(actor,`campaigns/${c.id}/activate`,{expectedRevision:approved.revision})).status,409);
    });
    await t.test("duplicate activation with one intent has one durable effect",async()=>{
      const {actor,id,c}=await setup();const approved=await call(actor,`campaigns/${c.id}/approve`,{expectedRevision:c.revision});const key=randomUUID(),body={expectedRevision:approved.data.revision};
      const first=await call(actor,`campaigns/${c.id}/activate`,body,"POST",key),again=await call(actor,`campaigns/${c.id}/activate`,body,"POST",key);assert.equal(first.status,200);assert.deepEqual(again,first);
      const s=await getStore(id);assert.equal(s.campaigns.filter(x=>x.state==="active").length,1);assert.equal(s.campaigns.at(-1)?.revision,approved.data.revision+1);
      assert.equal((await call(actor,`campaigns/${c.id}/activate`,body)).status,409);
    });
    await t.test("expired rule review fails replay and blocks approval until renewed",async()=>{
      const {actor,id,c}=await setup();const b=(await getStore(id)).books[0];
      const example={sku:b.sku,language:"en",format:"paperback",priceMinor:1200,expectedPass:true};
      const created=await call(actor,"rules",{type:"require_language",operand:"en",scope:"store",example,counterexample:{...example,language:"fr",expectedPass:false},reviewAt:new Date(Date.now()+86400000).toISOString()});assert.equal(created.status,201);
      await mutateStore(id,s=>{s.rules.find(r=>r.id===created.data.id)!.reviewAt="2020-01-01T00:00:00Z";});
      assert.equal((await call(actor,`campaigns/${c.id}/approve`,{expectedRevision:c.revision})).status,409);
      const job=await call(actor,`rules/${created.data.id}/replay`,{campaignVersionId:c.versionId});await drain();const replay=(await getStore(id)).jobs.find(j=>j.id===job.data.id)!.result!;
      assert.equal(replay.passed,false);assert.ok(JSON.stringify(replay.violations).includes("review expired"));
      assert.equal((await call(actor,`rules/${created.data.id}`,{expectedRevision:1,reviewAt:new Date(Date.now()+86400000).toISOString()},"PATCH")).status,200);
      assert.equal((await call(actor,`campaigns/${c.id}/approve`,{expectedRevision:c.revision})).status,200);
    });
    await t.test("staff cannot approve or activate; revocation during intercepted provider work blocks commit",async()=>{
      const {actor,id,c}=await setup(),staff=await grant(actor);
      for(const action of ["approve","activate"])assert.equal((await call(staff.actor,`staff/campaigns/${c.id}/${action}`,{expectedRevision:c.revision})).status,403);
      const entity=randomUUID();await mutateStore(id,s=>{s.books[0].entityId=entity;s.campaigns.at(-1)!.candidateSkus=[s.books[0].sku];});
      process.env.SECOND_SHELF_PROVIDER_MODE="live";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";
      let enter:()=>void=()=>{},release:()=>void=()=>{};const entered=new Promise<void>(r=>{enter=r;});
      globalThis.fetch=async()=>{enter();await new Promise<void>(r=>{release=r;});return Response.json({results:{entities:[{entity_id:entity}]}});};
      const job=await call(staff.actor,`staff/campaigns/${c.id}/plan`,{expectedRevision:c.revision,interestIds:[randomUUID()]});assert.equal(job.status,202);
      const worker=pending.shift()!();await entered;const before=structuredClone((await getStore(id)).campaigns.at(-1));
      try{assert.equal((await call(actor,`memberships/${staff.memberId}`,{},"DELETE")).status,200);}finally{release();await worker;}
      const s=await getStore(id);assert.equal(s.jobs.find(j=>j.id===job.data.id)!.status,"failed");assert.deepEqual(s.campaigns.at(-1),before);
      globalThis.fetch=async()=>{throw Error("Unexpected network");};process.env.SECOND_SHELF_PROVIDER_MODE="fixture";delete process.env.QLOO_API_KEY;
    });
    await t.test("queued replay cannot silently switch to edited rules",async()=>{
      const {actor,id,c}=await setup();const example={sku:"EXAMPLE",language:"en",format:"paperback",priceMinor:1000,expectedPass:true};
      const rule=await call(actor,"rules",{type:"require_language",operand:"en",scope:"store",example,counterexample:{...example,language:"fr",expectedPass:false},reviewAt:new Date(Date.now()+86400000).toISOString()});assert.equal(rule.status,201);
      const job=await call(actor,`rules/${rule.data.id}/replay`,{campaignVersionId:c.versionId});assert.equal(job.status,202);
      await call(actor,`rules/${rule.data.id}`,{expectedRevision:1,active:false},"PATCH");await drain();
      const result=(await getStore(id)).jobs.find(j=>j.id===job.data.id)!;assert.equal(result.status,"failed");assert.equal(result.error?.code,"CONFLICT");
    });
    await t.test("saving an edited proposal clears its stale summary and evidence references",async()=>{
      const {actor,id,c}=await setup();await call(actor,`campaigns/${c.id}/plan`,{expectedRevision:c.revision});await drain();
      const planned=(await getStore(id)).campaigns.at(-1)!;assert.ok(planned.plan);assert.ok(planned.evidenceRefs.length);
      const changed=await call(actor,`campaigns/${c.id}`,{expectedRevision:planned.revision,draft:draft(planned)},"PATCH");assert.equal(changed.status,200);assert.equal(changed.data.plan,undefined);assert.deepEqual(changed.data.evidenceRefs,[]);
    });
    await t.test("insufficient evaluation cannot be promoted",async()=>{
      const {actor,id,c}=await setup();const p=await call(actor,`campaigns/${c.id}/policy-proposals`,{expectedRevision:c.revision,rationale:"Synthetic boundary",rankOffsets:[],trainingExperimentIds:[]});assert.equal(p.status,201);
      assert.equal((await call(actor,`policy-proposals/${p.data.id}/approve`,{expectedRevision:1})).status,409);
      assert.equal((await call(actor,`policy-proposals/${p.data.id}/evaluate`,{expectedRevision:1})).status,202);await drain();const policy=(await getStore(id)).policies.find(x=>x.id===p.data.id)!;assert.equal(policy.status,"insufficient_evidence");assert.equal((await call(actor,`policy-proposals/${p.data.id}/approve`,{expectedRevision:policy.revision})).status,409);
    });
  }finally{globalThis.fetch=originalFetch;await(await db()).close();}
});
