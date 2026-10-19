import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeStore } from "../src/server/fixtures";
import { createOrReuseDemo, deleteStore, db } from "../src/server/repository";
import { hash } from "../src/server/domain";
import { bootstrapOwnerToken } from "../src/server/access";

test("durable bookstore bootstrap preserves ownership and caps unique creations",async t=>{
  delete process.env.DATABASE_URL;delete process.env.VERCEL;
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"second-shelf-bootstrap-"));
  process.env.SECOND_SHELF_BOOTSTRAP_SECRET="TEST-ONLY-STABLE-SECRET-AT-LEAST-32-CHARACTERS";
  process.env.SECOND_SHELF_DEMO_STORES_PER_DAY="2";
  const token=bootstrapOwnerToken("same-retry-key")!;
  let storeId="";
  await t.test("concurrent cold-instance retries return one store and credential",async()=>{
    const copies=await Promise.all(Array.from({length:10},()=>createOrReuseDemo(hash("same-retry-key"),makeStore(token))));
    storeId=copies[0].id;assert.equal(new Set(copies.map(s=>s.id)).size,1);assert.ok(copies.every(s=>s.token===hash(token)));
    assert.equal(bootstrapOwnerToken("same-retry-key"),token);assert.notEqual(bootstrapOwnerToken("other-key"),token);
    assert.equal((await(await db()).query<{used:number}>("SELECT used FROM provider_call_budgets WHERE provider='demo-stores'")).rows[0].used,1);
  });
  await t.test("deleted stores cannot be resurrected by retrying the bootstrap",async()=>{
    await deleteStore(storeId);await assert.rejects(()=>createOrReuseDemo(hash("same-retry-key"),makeStore(token)),/expired or was deleted/);
  });
  await t.test("store cap is shared; rejecting a creation rolls back its reservation",async()=>{
    await createOrReuseDemo(hash("second-key"),makeStore(bootstrapOwnerToken("second-key")!));
    await assert.rejects(()=>createOrReuseDemo(hash("third-key"),makeStore(bootstrapOwnerToken("third-key")!)),/allowance is exhausted/);
    assert.equal((await(await db()).query("SELECT key_hash FROM demo_bootstraps WHERE key_hash=$1",[hash("third-key")])).rows.length,0);
  });
  await t.test("an expired bootstrap cannot recreate a store or revive its owner credential",async()=>{
    const pg=await db();await pg.query("UPDATE demo_bootstraps SET expires_at=now()-interval '1 hour' WHERE key_hash=$1",[hash("second-key")]);await pg.query("UPDATE stores SET expires_at=now()-interval '1 hour' WHERE owner_hash=$1",[hash(bootstrapOwnerToken("second-key")!)]);
    process.env.SECOND_SHELF_DEMO_STORES_PER_DAY="3";
    await assert.rejects(()=>createOrReuseDemo(hash("second-key"),makeStore(bootstrapOwnerToken("second-key")!)),/expired or was deleted/);
    assert.equal((await pg.query<{used:number}>("SELECT used FROM provider_call_budgets WHERE provider='demo-stores'")).rows[0].used,2);
  });
  await t.test("Vercel cannot use a missing or weak bootstrap secret",()=>{
    process.env.VERCEL="1";delete process.env.SECOND_SHELF_BOOTSTRAP_SECRET;assert.throws(()=>bootstrapOwnerToken("key"),/stable demo session secret/);
    process.env.SECOND_SHELF_BOOTSTRAP_SECRET="short";assert.throws(()=>bootstrapOwnerToken("key"),/too short/);
  });
  await(await db()).close();
});
