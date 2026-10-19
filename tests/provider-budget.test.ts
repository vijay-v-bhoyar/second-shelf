import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, reserveProviderCall } from "../src/server/repository";
import { providerMode, searchEntities } from "../src/server/providers";
import { makeStore } from "../src/server/fixtures";

test("persistent provider allowance and fail-closed live configuration",async t=>{
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"second-shelf-budget-"));
  const day=new Date("2026-10-13T12:00:00Z"),pg=await db();
  await t.test("concurrent reservations cannot exceed the shared daily allowance",async()=>{
    const results=await Promise.all(Array.from({length:25},()=>reserveProviderCall("concurrent-test",7,day)));
    assert.equal(results.filter(Boolean).length,7);assert.equal((await pg.query<{used:number}>("SELECT used FROM provider_call_budgets WHERE provider=$1",["concurrent-test"])).rows[0].used,7);
  });
  await t.test("raising/lowering limits respects recorded usage; each UTC day is distinct",async()=>{
    assert.equal(await reserveProviderCall("concurrent-test",3,day),false);assert.equal(await reserveProviderCall("concurrent-test",8,day),true);
    assert.equal(await reserveProviderCall("concurrent-test",1,new Date("2026-10-14T00:00:00Z")),true);
    assert.equal(await reserveProviderCall("offset-test",1,new Date("2026-10-13T23:30:00-02:00")),true);
    assert.equal(await reserveProviderCall("offset-test",1,new Date("2026-10-14T01:30:00Z")),false);
  });
  await t.test("invalid limits fail without consuming an allowance",async()=>{
    for(const limit of [0,-1,NaN,Infinity,1.5])await assert.rejects(()=>reserveProviderCall("invalid-test",limit,day),/positive integer/);
    assert.equal((await pg.query("SELECT used FROM provider_call_budgets WHERE provider=$1",["invalid-test"])).rows.length,0);
  });
  await t.test("unknown modes and blank keys never admit live calls",()=>{
    process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";
    process.env.SECOND_SHELF_PROVIDER_MODE="typo";assert.equal(providerMode(),"unconfigured");process.env.SECOND_SHELF_PROVIDER_MODE="live";process.env.QLOO_API_KEY=" ";assert.equal(providerMode(),"unconfigured");process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";assert.equal(providerMode(),"live");
  });
  await t.test("provider errors consume attempts; exhaustion blocks before network access",async()=>{
    process.env.QLOO_BASE_URL="https://hackathon.api.qloo.com";process.env.SECOND_SHELF_QLOO_DAILY_CALL_LIMIT="2";
    let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({error:"simulated outage"},{status:503});};
    try{const store=makeStore("test");for(let i=0;i<2;i++)await assert.rejects(()=>searchEntities("Film","movie",store),/Qloo returned 503/);
      await assert.rejects(()=>searchEntities("Film","movie",store),/allowance is exhausted/);assert.equal(calls,2);
    }finally{globalThis.fetch=original;}
  });
  await t.test("disallowed provider authority does not consume a reservation",async()=>{
    process.env.QLOO_BASE_URL="https://hackathon.api.qloo.com:444";process.env.SECOND_SHELF_QLOO_DAILY_CALL_LIMIT="3";
    await assert.rejects(()=>searchEntities("Film","movie",makeStore("test")),/not allowlisted/);
    assert.equal((await pg.query<{used:number}>("SELECT used FROM provider_call_budgets WHERE provider='qloo'")).rows[0].used,2);
  });
});
