import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rankBooks } from "../src/server/providers";
import { makeStore } from "../src/server/fixtures";
import { dispatch } from "../src/server/service";
import { getStore, mutateStore } from "../src/server/repository";
import { eligible } from "../src/server/domain";
import { rejectedWorks, selectEditions } from "../src/server/book-selection";
import type { Book, Rule, Shopper } from "../src/lib/types";

test("edition and rejection regression contract (isolated DB; provider intercepted)",async t=>{
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"second-shelf-editions-"));
  process.env.DATABASE_URL="";
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";
  const realFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error("Unexpected network request in isolated test");};
  const base="http://127.0.0.1:4397";
  const owner={cookie:"",csrf:""},shopper={cookie:"",csrf:""};
  async function call(actor:typeof owner,route:string,body?:unknown,method=body===undefined?"GET":"POST"){
    const r=await dispatch(new Request(base+"/api/v1/"+route,{method,headers:{origin:base,cookie:actor.cookie,"x-csrf-token":actor.csrf,"idempotency-key":randomUUID(),"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}),route.split("/"));
    const cookie=r.headers.get("set-cookie");if(cookie)actor.cookie=cookie.split(";")[0];
    return{status:r.status,data:await r.json()};
  }
  async function finish(actor:typeof owner,job:{id:string}){
    for(let i=0;i<150;i++){const r=await call(actor,`jobs/${job.id}`);if(["succeeded","failed"].includes(r.data.status))return r.data;await new Promise(r=>setTimeout(r,20));}
    throw Error("Job never finished");
  }
  const input={interestIds:["fixture-film-miyazaki"],budgetMinor:2500,excludedSkus:[]};
  async function discover(actor=shopper){const r=await call(actor,"shopper/recommendations",input);assert.equal(r.status,202);const j=await finish(actor,r.data);assert.equal(j.status,"succeeded",JSON.stringify(j.error));return j;}
  try{
    await call(owner,"demo-sessions",{});const workspace=(await call(owner,"workspace")).data;owner.csrf=workspace.csrfToken;
    const book=workspace.books[0],paper={...book,sku:"ED-PAPER",priceMinor:1200,mappingStatus:"confirmed",entityId:"fixture-work-one"},hard={...book,sku:"ED-HARD",priceMinor:1900,mappingStatus:"confirmed",entityId:"fixture-work-one"};
    await t.test("E01 fixture selects one cheapest edition independent of order",async()=>{
      for(const pool of [[paper,hard],[hard,paper]])assert.deepEqual((await rankBooks(pool,input.interestIds)).map(b=>b.sku),["ED-PAPER"]);
    });
    await t.test("E02 stable ordinal SKU tie, not import order",()=>{
      const a={...paper,sku:"a"},b={...paper,sku:"B"};
      for(const pool of [[a,b],[b,a]])assert.equal(selectEditions(pool)[0].sku,"B");
    });
    await t.test("E03 filter each edition before selection across stock, currency, budget, mapping, membership and rules",()=>{
      const s=makeStore("test-only"),c=s.campaigns.at(-1)!;s.books=[paper,hard];s.rules=[];c.candidateSkus=s.books.map(b=>b.sku);
      const choose=(budget=2500)=>selectEditions(s.books.filter(b=>eligible(s,b,budget,c))).map(b=>b.sku);
      for(const override of [{onHand:0},{observedAt:"2000-01-01T00:00:00Z"},{currency:"EUR"},{mappingStatus:"excluded"},{mappingStatus:"unresolved"},{priceMinor:3000}]){
        s.books=[{...paper,...override} as Book,hard];assert.deepEqual(choose(),["ED-HARD"]);
      }
      s.books=[paper,hard];c.candidateSkus=[hard.sku];assert.deepEqual(choose(),["ED-HARD"]);c.candidateSkus=[paper.sku,hard.sku];
      for(const [type,operand,change] of [["exclude_sku",paper.sku,{}],["require_format",hard.format,{format:"invalid"}],["require_language",hard.language,{language:"invalid"}]] as const){
        s.books=[{...paper,...change},hard];s.rules=[{id:randomUUID(),type,operand,scope:"store",active:true,reviewAt:new Date(Date.now()+86400000).toISOString()} as Rule];assert.deepEqual(choose(),["ED-HARD"]);
      }
      s.rules=[];s.books=[paper,hard];assert.deepEqual(choose(1100),[]);
      s.outcomes=[{id:randomUUID(),type:"purchase",sessionId:randomUUID(),sku:paper.sku,quantity:paper.onHand,amountMinor:1200,currency:"USD",occurredAt:new Date(Date.parse(paper.observedAt)+1000).toISOString(),recordedAt:new Date().toISOString(),receiptDigest:"test",dataMode:"demo"}];assert.deepEqual(choose(),["ED-HARD"]);
    });
    await t.test("E04/E05 mocked provider preserves work order, deduplicates IDs and rows, rejects unknown and preserves 50-row cap",async()=>{
      process.env.SECOND_SHELF_PROVIDER_MODE="live";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";process.env.QLOO_BASE_URL="https://hackathon.api.qloo.com";process.env.SECOND_SHELF_QLOO_DAILY_CALL_LIMIT="100";
      const a={...paper,entityId:"work-one"},b={...hard,entityId:"work-one"},other={...paper,sku:"OTHER",entityId:"work-two"};
      let rows=["work-two","work-one","work-two"],calls=0;
      globalThis.fetch=async(url,init)=>{calls++;const u=new URL(String(url));assert.equal(u.hostname,"hackathon.api.qloo.com");assert.equal(u.pathname,"/v2/insights");assert.equal(new Headers(init?.headers).get("X-Api-Key"),"TEST-ONLY-NEVER-SENT");const ids=u.searchParams.get("filter.results.entities")!.split(",");assert.equal(new Set(ids).size,ids.length);assert.equal(Number(u.searchParams.get("take")),ids.length);return Response.json({results:{entities:rows.map(entity_id=>({entity_id}))}});};
      try{
        for(const pool of [[a,b,other],[b,a,other]])assert.deepEqual((await rankBooks(pool,["film-one"])).map(b=>b.sku),["OTHER","ED-PAPER"]);
        rows=["outside"];await assert.rejects(rankBooks([a,b],["film-one"]),/outside the eligible/);
        rows=["work-one"];assert.equal((await rankBooks(Array.from({length:50},(_,i)=>({...a,sku:`SKU-${i}`})),["film-one"])).length,1);
        const before=calls;await assert.rejects(rankBooks(Array.from({length:51},(_,i)=>({...a,sku:`SKU-${i}`})),["film-one"]),/50 mapped/);assert.equal(calls,before);
      }finally{process.env.SECOND_SHELF_PROVIDER_MODE="fixture";globalThis.fetch=async()=>{throw Error("Unexpected external request");};}
    });
    await mutateStore(workspace.id,s=>{s.books=[paper,hard];const c=s.campaigns.at(-1)!;c.candidateSkus=s.books.map(b=>b.sku);c.state="active";});
    const campaign=(await getStore(workspace.id)).campaigns.at(-1)!;
    await call(shopper,`public/campaigns/${campaign.token}/sessions`,{noticeVersion:"demo-notice-v1"});shopper.csrf=(await call(shopper,"shopper/session")).data.csrfToken;
    await t.test("R01 rejecting an offered edition excludes the entire confirmed work",async()=>{
      const offered=await discover(),item=offered.result.items[0];
      assert.equal((await call(shopper,"shopper/events",{runId:offered.id,sku:item.sku,type:"reject"})).status,200);
      assert.deepEqual((await discover()).result.items,[]);
    });
    async function fresh(){
      shopper.cookie="";shopper.csrf="";
      await call(shopper,`public/campaigns/${campaign.token}/sessions`,{noticeVersion:"demo-notice-v1"});
      const visit=(await call(shopper,"shopper/session")).data;shopper.csrf=visit.csrfToken;return visit;
    }
    await t.test("R06 independent shopper unaffected; reload retains rejection; start-fresh resets then privacy removes preferences",async()=>{
      assert.deepEqual((await discover()).result.items,[]);
      const visit=await fresh();assert.equal((await discover()).result.items[0].sku,paper.sku);
      const j=await discover();await call(shopper,"shopper/events",{runId:j.id,sku:paper.sku,type:"reject"});assert.deepEqual((await discover()).result.items,[]);
      assert.equal((await call(shopper,"shopper/new-visit",{confirm:true})).status,201);
      shopper.csrf=(await call(shopper,"shopper/session")).data.csrfToken;
      assert.equal((await discover()).result.items[0].sku,paper.sku);
      assert.equal((await call(shopper,"shopper/forget",{confirm:true})).status,200);
      const s=await getStore(workspace.id);assert.ok(!s.shoppers.some(x=>x.id===visit.id));assert.ok(!s.jobs.some(x=>x.sessionId===visit.id));assert.ok(!s.feedback.some(x=>x.sessionId===visit.id));
    });
    await t.test("R03/R04 original offered identity survives remap; same-title different work is not rejected; repeat is idempotent",async()=>{
      await fresh();const offered=await discover(),original=structuredClone(offered.result);
      await mutateStore(workspace.id,s=>{s.books=[{...paper,entityId:"fixture-work-two"},hard];});
      for(let i=0;i<2;i++)assert.equal((await call(shopper,"shopper/events",{runId:offered.id,sku:paper.sku,type:"reject"})).status,200);
      let s=await getStore(workspace.id);const visit=s.shoppers.at(-1)!;
      assert.deepEqual(visit.rejectedWorkIds,["fixture-work-one"]);assert.deepEqual(s.jobs.find(j=>j.id===offered.id)!.result,original);
      assert.equal(s.feedback.filter(e=>e.runId===offered.id&&e.type==="reject").length,1);
      // A separate SKU with identical title and a different confirmed identity is eligible.
      await mutateStore(workspace.id,s=>{s.books.push({...paper,sku:"DIFFERENT-WORK",entityId:"fixture-work-two"});s.campaigns.at(-1)!.candidateSkus.push("DIFFERENT-WORK");});
      assert.deepEqual((await discover()).result.items.map((b:Book)=>b.sku),["DIFFERENT-WORK"]);
      s=await getStore(workspace.id);assert.deepEqual(s.jobs.find(j=>j.id===offered.id)!.result,original);
    });
    await t.test("R05 legacy SKU-only rejection derives historical identity without rewriting data; missing/ambiguous history stays SKU-only",()=>{
      const s=makeStore("test-only"),v={id:"legacy",rejected:["OLD"]} as Shopper;
      s.jobs=[{id:"run",sessionId:v.id,status:"succeeded",createdAt:"",deadlineAt:"",result:{kind:"recommendations",items:[{sku:"OLD",entityId:"original"}]}}];
      s.feedback=[{id:"event",sessionId:v.id,runId:"run",sku:"OLD",type:"reject",at:""}];
      const before=JSON.stringify({s,v});assert.deepEqual([...rejectedWorks(s,v)],["original"]);assert.equal(JSON.stringify({s,v}),before);
      s.feedback=[];assert.deepEqual([...rejectedWorks(s,v)],["original"]);
      s.jobs.push({...s.jobs[0],id:"other-run",result:{kind:"recommendations",items:[{sku:"OLD",entityId:"other"}]}});assert.deepEqual([...rejectedWorks(s,v)],[]);
      s.jobs=[];assert.deepEqual([...rejectedWorks(s,v)],[]);assert.deepEqual(v.rejected,["OLD"]);assert.equal(v.rejectedWorkIds,undefined);
    });
    await t.test("E06 display plan and simulated-control both select one cheapest eligible edition",async()=>{
      await mutateStore(workspace.id,s=>{s.books=[hard,paper];const c=s.campaigns.at(-1)!;c.candidateSkus=[hard.sku,paper.sku];c.state="draft";});
      const c=(await getStore(workspace.id)).campaigns.at(-1)!;
      const queued=await call(owner,`campaigns/${c.id}/plan`,{expectedRevision:c.revision,interestIds:input.interestIds});assert.equal(queued.status,202);
      const planned=await finish(owner,queued.data);assert.equal(planned.status,"succeeded");assert.deepEqual(planned.result.campaign.candidateSkus,[paper.sku]);assert.equal(planned.result.campaign.state,"draft");
      await mutateStore(workspace.id,s=>{const c=s.campaigns.at(-1)!;c.state="active";c.candidateSkus=[hard.sku,paper.sku];});
      const v=await fresh();
      await mutateStore(workspace.id,s=>{const shopper=s.shoppers.find(x=>x.id===v.id)!;shopper.assignmentId=randomUUID();s.assignments.push({id:shopper.assignmentId,sessionId:v.id,experimentId:randomUUID(),arm:"control",at:new Date().toISOString(),candidateSkus:[hard.sku,paper.sku],interests:input.interestIds,budgetMinor:input.budgetMinor});});
      const j=await discover();assert.equal(j.result.evidenceMode,"simulation");assert.deepEqual(j.result.items.map((b:Book)=>b.sku),[paper.sku]);
      await call(shopper,"shopper/events",{runId:j.id,sku:paper.sku,type:"reject"});assert.deepEqual((await discover()).result.items,[]);
    });
    await t.test("R02 reject during mocked provider request cannot reintroduce another edition at commit",async()=>{
      await mutateStore(workspace.id,s=>{s.books=[{...paper,entityId:"work-one"},{...hard,entityId:"work-one"}];});
      const visit=await fresh();const offered=await discover();
      process.env.SECOND_SHELF_PROVIDER_MODE="live";
      let entered!:()=>void,release!:(r:Response)=>void;
      const started=new Promise<void>(r=>entered=r);
      globalThis.fetch=async()=>{entered();return new Promise<Response>(r=>release=r);};
      try{
        const queued=await call(shopper,"shopper/recommendations",{...input,interestIds:["film-one"]});assert.equal(queued.status,202);
        await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error("Provider mock not reached")),5000))]);
        assert.equal((await call(shopper,"shopper/events",{runId:offered.id,sku:paper.sku,type:"reject"})).status,200);
        release(Response.json({results:[{entity_id:"work-one"}]}));
        const j=await finish(shopper,queued.data);assert.equal(j.status,"succeeded");assert.deepEqual(j.result.items,[]);
        assert.deepEqual((await getStore(workspace.id)).shoppers.find(x=>x.id===visit.id)!.rejectedWorkIds,["work-one"]);
      }finally{process.env.SECOND_SHELF_PROVIDER_MODE="fixture";globalThis.fetch=async()=>{throw Error("Unexpected external request");};}
    });
    await t.test("R07 forged run/SKU, cross-shopper and expired session cannot change rejection preferences",async()=>{
      await mutateStore(workspace.id,s=>{s.books=[paper,hard];});
      const first=await fresh(),offered=await discover(),second=await fresh();
      for(const payload of [{runId:randomUUID(),sku:paper.sku,type:"reject"},{runId:offered.id,sku:paper.sku,type:"reject"}])assert.equal((await call(shopper,"shopper/events",payload)).status,403);
      const current=await discover();assert.equal((await call(shopper,"shopper/events",{runId:current.id,sku:"NOT-OFFERED",type:"reject"})).status,403);
      let s=await getStore(workspace.id);assert.deepEqual(s.shoppers.find(x=>x.id===second.id)!.rejected,[]);assert.deepEqual(s.shoppers.find(x=>x.id===first.id)!.rejected,[]);
      await mutateStore(workspace.id,s=>{s.shoppers.find(x=>x.id===second.id)!.expiresAt="2000-01-01T00:00:00Z";});
      assert.equal((await call(shopper,"shopper/events",{runId:current.id,sku:paper.sku,type:"reject"})).status,401);
      s=await getStore(workspace.id);assert.deepEqual(s.shoppers.find(x=>x.id===second.id)!.rejected,[]);
    });
  }finally{globalThis.fetch=realFetch;}
});
