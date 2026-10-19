import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "../src/server/service";
import { getStore, mutateStore, db } from "../src/server/repository";

test("serverless deferral, atomic job ownership and deadline recovery",async t=>{
  delete process.env.DATABASE_URL;delete process.env.VERCEL;
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"second-shelf-serverless-"));
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";
  const base="http://127.0.0.1:4397",pending:(()=>Promise<void>)[]=[];
  let cookie="",csrf="",calls=0,release:()=>void=()=>{},entered:()=>void=()=>{};
  const enteredPromise=()=>new Promise<void>(r=>{entered=r;});
  async function call(route:string,body?:unknown){
    const response=await dispatch(new Request(`${base}/api/v1/${route}`,{method:body===undefined?"GET":"POST",headers:{origin:base,cookie,"x-csrf-token":csrf,"idempotency-key":randomUUID(),"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}),route.split("/"),task=>pending.push(task));
    const issued=response.headers.get("set-cookie");if(issued)cookie=issued.split(";")[0];return{status:response.status,data:await response.json()};
  }
  const created=await call("demo-sessions",{}),storeId=created.data.storeId;csrf=(await call("workspace")).data.csrfToken;
  const bookId=randomUUID(),interestId=randomUUID();
  await mutateStore(storeId,s=>{s.books[0].entityId=bookId;s.campaigns[0].candidateSkus=[s.books[0].sku];});
  process.env.SECOND_SHELF_PROVIDER_MODE="live";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";process.env.QLOO_BASE_URL="https://hackathon.api.qloo.com";
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;entered();await new Promise<void>(r=>{release=r;});return Response.json({results:{entities:[{entity_id:bookId}]}});};
  const resetInstance=()=>{(globalThis as typeof globalThis&{__ssRunning?:Set<string>}).__ssRunning=new Set();};
  try{
    await t.test("response queues work for framework after-response execution",async()=>{
      const campaign=(await getStore(storeId)).campaigns[0],queued=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds:[interestId]});assert.equal(queued.status,202);assert.equal(calls,0);
      assert.equal((await getStore(storeId)).jobs[0].status,"queued");assert.equal(pending.length,1);
    });
    await t.test("another application instance cannot reclaim a running job",async()=>{
      const job=(await getStore(storeId)).jobs[0];await call(`jobs/${job.id}`);assert.equal(pending.length,2);
      const ready=enteredPromise(),worker=pending.shift()!();await ready;assert.equal(calls,1);
      resetInstance();await pending.shift()!();assert.equal(calls,1);assert.equal((await getStore(storeId)).jobs[0].status,"running");
      release();await worker;const result=(await getStore(storeId)).jobs[0];assert.equal(result.status,"succeeded");assert.equal(result.result?.kind,"plan");
    });
    await t.test("expired ownership fails safely; a late provider result cannot publish",async()=>{
      const campaign=(await getStore(storeId)).campaigns[0],queued=await call(`campaigns/${campaign.id}/plan`,{expectedRevision:campaign.revision,interestIds:[interestId]});
      const ready=enteredPromise(),worker=pending.shift()!();await ready;const before=structuredClone((await getStore(storeId)).campaigns[0]);
      await mutateStore(storeId,s=>{s.jobs.find(j=>j.id===queued.data.id)!.deadlineAt=new Date(Date.now()-1000).toISOString();});
      resetInstance();await call(`jobs/${queued.data.id}`);await pending.shift()!();assert.equal((await getStore(storeId)).jobs.at(-1)?.status,"failed");
      release();await worker;const after=await getStore(storeId);assert.equal(after.jobs.at(-1)?.status,"failed");assert.deepEqual(after.campaigns[0],before);assert.equal(calls,2);
    });
  }finally{release();globalThis.fetch=originalFetch;await(await db()).close();}
});
