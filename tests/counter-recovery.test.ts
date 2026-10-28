import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

test("staff counter intents have one persisted effect and remain permission bound",async t=>{
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"ss-counter-test-"));
  const {dispatch}=await import("../src/server/service"),{db,getStore,mutateStore}=await import("../src/server/repository"),{hash}=await import("../src/server/domain");
  const origin="http://127.0.0.1:4397",owner={cookie:"",csrf:""},staff={cookie:"",csrf:""};
  async function call(actor:typeof owner,route:string,body?:unknown,key=randomUUID(),method=body===undefined?"GET":"POST"){
    const r=await dispatch(new Request(origin+"/api/v1/"+route,{method,headers:{origin,cookie:actor.cookie,"x-csrf-token":actor.csrf,"idempotency-key":key,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}),route.split("/"));if(r.headers.get("set-cookie"))actor.cookie=r.headers.get("set-cookie")!.split(";")[0];return{status:r.status,data:await r.json()};
  }
  try{
    const storeId=(await call(owner,"demo-sessions",{})).data.storeId;owner.csrf=(await call(owner,"session")).data.csrfToken;
    const s=await getStore(storeId),book=s.books[0],sessionId=randomUUID(),code="SYNTHETIC-COUNTER",shopper={cookie:"ss_shopper="+randomUUID(),csrf:randomUUID()};
    await mutateStore(storeId,s=>{s.shoppers.push({id:sessionId,campaignId:s.campaigns[0].id,versionId:s.campaigns[0].versionId,token:hash(shopper.cookie.slice(11)),csrf:shopper.csrf,expiresAt:s.expiresAt,measurementOptIn:false,noticeVersion:"demo-notice-v1",rejected:[],code});s.jobs.push({id:randomUUID(),sessionId,status:"succeeded",createdAt:new Date().toISOString(),deadlineAt:s.expiresAt,result:{items:[{sku:book.sku}]}});});
    const invite=(await call(owner,"memberships",{identityId:"Synthetic cashier",permissions:["outcome_verify"]})).data;
    await call(staff,"staff-sessions",{inviteToken:new URL(invite.inviteUrl).hash.slice(8)});staff.csrf=(await call(staff,"staff/session")).data.csrfToken;
    const purchase={type:"purchase",sessionCode:code,sku:book.sku,quantity:2,amountMinor:book.priceMinor*2,currency:"USD",occurredAt:new Date().toISOString(),receiptReference:"COUNTER-PURCHASE"},key=randomUUID();let eventId="";
    const beforeStock=(await call(staff,"staff/workspace")).data.books.find((b:{sku:string})=>b.sku===book.sku).effectiveQuantity;
    await t.test("concurrent retries return the same ID, one purchase and exact stock decrement",async()=>{
      const replies=await Promise.all([call(staff,"staff/outcomes",purchase,key),call(staff,"staff/outcomes",purchase,key)]);assert.deepEqual(replies.map(r=>r.status),[201,201]);assert.equal(replies[0].data.id,replies[1].data.id);eventId=replies[0].data.id;
      const w=(await call(staff,"staff/workspace")).data;assert.equal(w.outcomes.length,1);assert.equal(w.outcomes[0].id,eventId);assert.equal(w.outcomes[0].quantity,2);assert.equal(w.books.find((b:{sku:string})=>b.sku===book.sku).effectiveQuantity,beforeStock-2);
      assert.equal((await call(staff,"staff/outcomes",{...purchase,quantity:1},key)).status,409);
    });
    await t.test("full return retry preserves the original ID without automatically restocking",async()=>{
      const body={type:"return",sku:book.sku,quantity:2,amountMinor:purchase.amountMinor,currency:"USD",occurredAt:new Date().toISOString(),parentEventId:eventId,reason:"Synthetic full return",receiptReference:"COUNTER-RETURN"},returnKey=randomUUID();
      const first=await call(staff,"staff/outcomes",body,returnKey);assert.equal(first.status,201);
      assert.deepEqual(await call(staff,"staff/outcomes",body,returnKey),first);
      const w=(await call(staff,"staff/workspace")).data;assert.equal(w.outcomes.length,2);assert.equal(w.outcomes[1].parentEventId,eventId);assert.equal(w.books.find((b:{sku:string})=>b.sku===book.sku).effectiveQuantity,beforeStock-2);
      assert.equal((await call(staff,"staff/outcomes",{...body,receiptReference:"EXCESS"})).status,400);assert.equal((await getStore(storeId)).outcomes.length,2);
    });
    await t.test("shopper and ungranted staff cannot verify, even with the intent key",async()=>{
      assert.equal((await call(shopper,"outcomes",purchase,key)).status,403);
      const invitation=(await call(owner,"memberships",{identityId:"Read only sample",permissions:["review_read"]})).data,reader={cookie:"",csrf:""};await call(reader,"staff-sessions",{inviteToken:new URL(invitation.inviteUrl).hash.slice(8)});reader.csrf=(await call(reader,"staff/session")).data.csrfToken;
      assert.equal((await call(reader,"staff/outcomes",purchase,key)).status,403);assert.equal((await getStore(storeId)).outcomes.length,2);
    });
    await t.test("revoked staff cannot replay a previously successful intent",async()=>{
      assert.equal((await call(owner,`memberships/${invite.id}`,{},randomUUID(),"DELETE")).status,200);
      assert.equal((await call(staff,"staff/outcomes",purchase,key)).status,401);assert.equal((await getStore(storeId)).outcomes.length,2);
    });
  }finally{await(await db()).close();}
});
