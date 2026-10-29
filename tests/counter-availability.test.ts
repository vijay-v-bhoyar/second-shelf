import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {dispatch} from "../src/server/service";
import {db,getStore,mutateStore} from "../src/server/repository";
import type {Store} from "../src/lib/types";

test("counter handoff validates the selected offer against current inventory",async t=>{
  delete process.env.DATABASE_URL;delete process.env.VERCEL;delete process.env.QLOO_API_KEY;
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="false";
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"ss-counter-availability-"));
  const originalFetch=globalThis.fetch;let networkAttempts=0;
  globalThis.fetch=async()=>{networkAttempts++;throw Error("Network forbidden");};
  const origin="http://127.0.0.1:4397";process.env.SECOND_SHELF_APP_ORIGIN=origin;
  type Actor={cookie:string;csrf:string};const owner:Actor={cookie:"",csrf:""},shopper:Actor={cookie:"",csrf:""};
  const pending:(()=>Promise<void>)[]=[];
  async function call(actor:Actor,route:string,body?:unknown,method="POST",key=randomUUID()){
    const response=await dispatch(new Request(origin+"/api/v1/"+route,{method:body===undefined?"GET":method,headers:{origin,cookie:actor.cookie,"x-csrf-token":actor.csrf,"idempotency-key":key,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}),route.split("/"),fn=>pending.push(fn));
    const cookie=response.headers.get("set-cookie");if(cookie)actor.cookie=cookie.split(";")[0];
    const csrf=response.headers.get("x-csrf-token");if(csrf)actor.csrf=csrf;
    return{status:response.status,data:await response.json()};
  }
  async function drain(){while(pending.length)await pending.shift()!();}
  let storeId:string|undefined;
  try{
    const created=await call(owner,"demo-sessions",{});assert.equal(created.status,201);storeId=created.data.storeId;
    owner.csrf=(await call(owner,"session")).data.csrfToken;
    let c=(await getStore(storeId!)).campaigns[0];
    const plan=await call(owner,`campaigns/${c.id}/plan`,{expectedRevision:c.revision});await drain();
    c=(await getStore(storeId!)).campaigns[0];
    const approved=await call(owner,`campaigns/${c.id}/approve`,{expectedRevision:c.revision});assert.equal(approved.status,200);
    assert.equal((await call(owner,`campaigns/${c.id}/activate`,{expectedRevision:approved.data.revision})).status,200);
    c=(await getStore(storeId!)).campaigns[0];
    const join=()=>`public/campaigns/${c.token}/sessions`;
    assert.equal((await call(shopper,join(),{measurementOptIn:false,noticeVersion:"demo-notice-v1"})).status,201);
    const queued=await call(shopper,"shopper/recommendations",{interestIds:["fixture-film-miyazaki"],budgetMinor:2500,excludedSkus:[]});await drain();
    const run=(await call(shopper,`jobs/${queued.data.id}`)).data;assert.equal(run.status,"succeeded");
    const book=run.result.items[0],request={runId:run.id,sku:book.sku},key=randomUUID();
    const valid=await call(shopper,"shopper/purchase-code",request,"POST",key);
    await t.test("eligible handoff and retries reuse one attribution code",async()=>{
      assert.equal(valid.status,200);assert.ok(valid.data.code);
      assert.deepEqual(await call(shopper,"shopper/purchase-code",request,"POST",key),valid);
      assert.deepEqual(await call(shopper,"shopper/purchase-code",request),valid);
    });
    await t.test("missing SKU and key reuse with changed selection fail",async()=>{
      assert.equal((await call(shopper,"shopper/purchase-code",{runId:run.id})).status,400);
      assert.equal((await call(shopper,"shopper/purchase-code",{...request,sku:"not-offered"},"POST",key)).status,409);
    });
    await t.test("never-offered SKU, another shopper's run and non-recommendation job fail",async()=>{
      assert.equal((await call(shopper,"shopper/purchase-code",{...request,sku:"not-offered"})).status,403);
      const other:Actor={cookie:"",csrf:""};await call(other,join(),{noticeVersion:"demo-notice-v1"});
      assert.equal((await call(other,"shopper/purchase-code",request)).status,403);
      assert.equal((await call(shopper,"shopper/purchase-code",{...request,runId:plan.data.id})).status,403);
    });
    const baseline=await getStore(storeId!);
    async function changed(change:(s:Store)=>void,check:()=>Promise<void>){
      await mutateStore(storeId!,change);
      try{await check();}finally{await mutateStore(storeId!,s=>{s.books=structuredClone(baseline.books);s.campaigns=structuredClone(baseline.campaigns);s.rules=structuredClone(baseline.rules);s.shoppers=structuredClone(baseline.shoppers);});}
    }
    await t.test("zero stock blocks fresh and cached handoff; checkout still rejects without ledger writes",async()=>{
      await changed(s=>{s.books.find(b=>b.sku===book.sku)!.onHand=0;},async()=>{
        for(const replayKey of [randomUUID(),key])assert.equal((await call(shopper,"shopper/purchase-code",request,"POST",replayKey)).status,409);
        const purchase=await call(owner,"outcomes",{type:"purchase",sessionCode:valid.data.code,sku:book.sku,quantity:1,amountMinor:book.priceMinor,currency:"USD",occurredAt:new Date().toISOString(),receiptReference:"zero-stock-test"});
        assert.equal(purchase.status,400);assert.equal((await getStore(storeId!)).outcomes.length,0);
      });
    });
    for(const [name,change] of Object.entries({
      "unresolved identity":(s:Store)=>{s.books.find(b=>b.sku===book.sku)!.mappingStatus="unresolved";},
      "remapped identity":(s:Store)=>{s.books.find(b=>b.sku===book.sku)!.entityId="changed-work";},
      "over original budget":(s:Store)=>{s.books.find(b=>b.sku===book.sku)!.priceMinor=2600;},
      "changed price within budget":(s:Store)=>{s.books.find(b=>b.sku===book.sku)!.priceMinor=1900;},
      "expired stock snapshot":(s:Store)=>{s.books.find(b=>b.sku===book.sku)!.observedAt="2020-01-01T00:00:00Z";},
      "wrong currency":(s:Store)=>{s.books.find(b=>b.sku===book.sku)!.currency="EUR";},
      "removed selection":(s:Store)=>{s.campaigns[0].candidateSkus=s.campaigns[0].candidateSkus.filter(sku=>sku!==book.sku);},
      "retired display":(s:Store)=>{s.campaigns[0].state="retired";},
      "rejected work":(s:Store)=>{s.shoppers[0].rejectedWorkIds=[book.entityId];},
      "new price rule":(s:Store)=>{s.rules.push({id:randomUUID(),revision:1,type:"max_price_minor",operand:100,scope:"store",active:true,reviewAt:new Date(Date.now()+3600000).toISOString(),example:{sku:"x",language:"en",format:"paperback",priceMinor:100,expectedPass:true},counterexample:{sku:"x",language:"en",format:"paperback",priceMinor:101,expectedPass:false}});}
    }))await t.test(name+" blocks handoff",async()=>changed(change,async()=>{
      const response=await call(shopper,"shopper/purchase-code",request);assert.equal(response.status,409,JSON.stringify(response.data));
    }));
    await t.test("empty result cannot authorize a book; CSRF still enforced",async()=>{
      const empty=await call(shopper,"shopper/recommendations",{interestIds:["fixture-film-miyazaki"],budgetMinor:0,excludedSkus:[]});await drain();
      assert.equal((await call(shopper,"shopper/purchase-code",{...request,runId:empty.data.id})).status,403);
      const csrf=shopper.csrf;shopper.csrf="bad";
      try{assert.equal((await call(shopper,"shopper/purchase-code",request)).status,403);}finally{shopper.csrf=csrf;}
    });
    await t.test("eligible original selection still works after rejected attempts",async()=>{
      assert.deepEqual(await call(shopper,"shopper/purchase-code",request),valid);
      assert.equal(networkAttempts,0);
    });
  }finally{
    try{if(storeId){assert.equal((await call(owner,"store",{confirm:true},"DELETE")).status,202);assert.equal((await(await db()).query<{n:number}>("SELECT COUNT(*)::int AS n FROM stores WHERE id=$1",[storeId])).rows[0].n,0);}}
    finally{await(await db()).close();globalThis.fetch=originalFetch;}
  }
});
