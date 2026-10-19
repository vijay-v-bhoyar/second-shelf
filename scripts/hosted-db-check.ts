import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db, databaseMode, insertStore, mutateStore, getStore, deleteStore, reserveProviderCall } from "../src/server/repository";
import { makeStore } from "../src/server/fixtures";

process.loadEnvFile(".env.vercel.production.local");
assert.equal(databaseMode(),"hosted-postgresql");
const marker=`hosted-check-${randomUUID()}`,store=makeStore(marker),pg=await db();
try{
  await insertStore(store);
  await Promise.all(Array.from({length:8},()=>mutateStore(store.id,s=>{s.revision++;})));
  assert.equal((await getStore(store.id)).revision,9);
  await assert.rejects(()=>mutateStore(store.id,s=>{s.name="ROLLBACK-MARKER";throw Error("intentional rollback");}),/intentional rollback/);
  assert.equal((await getStore(store.id)).name,store.name);
  const claims=await Promise.all(Array.from({length:10},()=>reserveProviderCall(marker,3)));
  assert.equal(claims.filter(Boolean).length,3);
  await deleteStore(store.id);await assert.rejects(()=>getStore(store.id),/expired or was deleted/);
  await writeFile("output/verification/hosted-db.json",JSON.stringify({at:new Date().toISOString(),mode:databaseMode(),status:"PASS",checks:["eight concurrent serialized mutations","transaction rollback","atomic shared budget","tenant deletion"],testStoreDeleted:true,providerCalls:0},null,2));
  console.log("PASS: hosted PostgreSQL transactions, shared allowance and deletion");
}finally{
  await pg.query("DELETE FROM provider_call_budgets WHERE provider=$1",[marker]);
  await deleteStore(store.id).catch(()=>{});await pg.close();
}
