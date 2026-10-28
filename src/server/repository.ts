import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Store } from "@/lib/types";
import { AppError } from "./domain";
import { purgeShopperPreferences } from "./privacy";
import { hostedDatabase, type Database } from "./postgres";

type Globals = typeof globalThis & { __secondShelfDb?: Promise<Database> };
export function databaseMode(){return process.env.DATABASE_URL?"hosted-postgresql":process.env.VERCEL?"unconfigured":"embedded-postgresql";}
export function db() {
  const g = globalThis as Globals;
  if (!g.__secondShelfDb) g.__secondShelfDb = (async () => {
    // Runtime-created local data must never be traced into a deployable build artifact.
    if(databaseMode()==="unconfigured")throw new AppError("CONFIGURATION_NOT_READY","Durable DATABASE_URL is required on Vercel.",503);
    let pg:Database;
    if(process.env.DATABASE_URL)pg=hostedDatabase(process.env.DATABASE_URL);
    else {
      const dataDir=path.resolve(/* turbopackIgnore: true */ process.env.SECOND_SHELF_DATA_DIR ?? ".data/second-shelf");
      await mkdir(/* turbopackIgnore: true */ dataDir,{recursive:true});
      pg=new PGlite(dataDir);
    }
    await pg.exec(`CREATE TABLE IF NOT EXISTS stores (id uuid PRIMARY KEY, owner_hash text UNIQUE NOT NULL, data jsonb NOT NULL, expires_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones (store_id uuid PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS shopper_tombstones(store_id uuid NOT NULL,shopper_id uuid NOT NULL,deleted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,shopper_id));
      CREATE TABLE IF NOT EXISTS provider_call_budgets(provider text NOT NULL,day date NOT NULL,used bigint NOT NULL CHECK(used>0),PRIMARY KEY(provider,day));
      CREATE TABLE IF NOT EXISTS demo_bootstraps(key_hash text PRIMARY KEY,store_id uuid UNIQUE NOT NULL,expires_at timestamptz NOT NULL);`);
    return pg;
  })().catch(error=>{g.__secondShelfDb=undefined;throw error;});
  return g.__secondShelfDb;
}
export async function reserveProviderCall(provider:string,limit:number,at=new Date()):Promise<boolean>{
  if(!Number.isSafeInteger(limit)||limit<=0||!Number.isFinite(at.getTime()))throw new AppError("CONFIGURATION_NOT_READY","Provider call allowance must be a positive integer.",503);
  const result=await(await db()).query<{used:number}>(`INSERT INTO provider_call_budgets(provider,day,used) VALUES($1,$2,1)
    ON CONFLICT(provider,day) DO UPDATE SET used=provider_call_budgets.used+1
    WHERE provider_call_budgets.used<$3 RETURNING used`,[provider,at.toISOString().slice(0,10),limit]);
  return result.rows.length===1;
}
export async function insertStore(store: Store) {
  const pg = await db();
  await pg.query("INSERT INTO stores(id,owner_hash,data,expires_at) VALUES($1,$2,$3,$4)",[store.id,store.token,JSON.stringify(store),store.expiresAt]);
}
export async function createOrReuseDemo(keyHash:string,candidate:Store):Promise<Store>{
  return(await db()).transaction(async tx=>{
    const claimed=await tx.query<{store_id:string}>(`INSERT INTO demo_bootstraps(key_hash,store_id,expires_at) VALUES($1,$2,$3)
      ON CONFLICT(key_hash) DO NOTHING RETURNING store_id`,[keyHash,candidate.id,candidate.expiresAt]);
    if(claimed.rows.length){
      const cap=Number(process.env.SECOND_SHELF_DEMO_STORES_PER_DAY??"100");
      if(!Number.isSafeInteger(cap)||cap<1)throw new AppError("CONFIGURATION_NOT_READY","Demo store allowance must be a positive integer.",503);
      const permitted=await tx.query(`INSERT INTO provider_call_budgets(provider,day,used) VALUES('demo-stores',$2,1)
        ON CONFLICT(provider,day) DO UPDATE SET used=provider_call_budgets.used+1 WHERE provider_call_budgets.used<$1 RETURNING used`,[cap,new Date().toISOString().slice(0,10)]);
      if(!permitted.rows.length)throw new AppError("RATE_LIMITED","The public demo's daily bookstore allowance is exhausted. Try tomorrow.",429);
      await tx.query("INSERT INTO stores(id,owner_hash,data,expires_at) VALUES($1,$2,$3,$4)",[candidate.id,candidate.token,JSON.stringify(candidate),candidate.expiresAt]);return candidate;
    }
    const existing=(await tx.query<{data:Store}>("SELECT s.data FROM demo_bootstraps b JOIN stores s ON s.id=b.store_id WHERE b.key_hash=$1 AND b.expires_at>now() AND s.expires_at>now()",[keyHash])).rows[0]?.data;
    if(!existing)throw new AppError("NOT_FOUND","That demo bookstore expired or was deleted. Start a new demo.",404);
    if(existing.token!==candidate.token)throw new AppError("CONFLICT","Session configuration changed. Start a new demo.",409);
    return existing;
  });
}
export async function allStores(): Promise<Store[]> {
  const pg = await db();
  await pg.query("DELETE FROM stores WHERE expires_at < now()");
  return (await pg.query<{data:Store}>("SELECT data FROM stores WHERE expires_at > now()")).rows.map(r=>r.data);
}
export async function getStore(storeId: string): Promise<Store> {
  const rows=(await (await db()).query<{data:Store}>("SELECT data FROM stores WHERE id=$1 AND expires_at > now()",[storeId])).rows;
  if (!rows[0]) throw new AppError("NOT_FOUND","This sample store has expired or was deleted.",404);
  return rows[0].data;
}

/** Public display lookup without the expired-store cleanup performed by allStores. */
export async function findActiveDisplay(token: string): Promise<Store | undefined> {
  const result=await(await db()).query<{data:Store}>(`SELECT data FROM stores
    WHERE expires_at > now() AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(data->'campaigns') campaign
      WHERE campaign->>'token'=$1 AND campaign->>'state'='active'
    ) LIMIT 1`,[token]);
  return result.rows[0]?.data;
}
export async function findOwner(tokenHash: string) {
  return (await (await db()).query<{data:Store}>("SELECT data FROM stores WHERE owner_hash=$1 AND expires_at > now()",[tokenHash])).rows[0]?.data;
}
export async function mutateStore<T>(storeId:string,fn:(store:Store)=>T|Promise<T>):Promise<T> {
  const pg=await db();
  return pg.transaction(async tx=>{
    const rows=(await tx.query<{data:Store}>("SELECT data FROM stores WHERE id=$1 AND expires_at > now() FOR UPDATE",[storeId])).rows;
    if(!rows[0]) throw new AppError("NOT_FOUND","This sample store has expired or was deleted.",404);
    const store=rows[0].data;
    const value=await fn(store);
    await tx.query("UPDATE stores SET data=$2 WHERE id=$1",[storeId,JSON.stringify(store)]);
    return value;
  });
}
export async function deleteStore(storeId:string) {
  const pg=await db();
  await pg.transaction(async tx=>{await tx.query("INSERT INTO tombstones(store_id) VALUES($1) ON CONFLICT DO NOTHING",[storeId]);await tx.query("DELETE FROM stores WHERE id=$1",[storeId]);});
}
export async function forgetShopper(storeId:string,shopperId:string){
  const pg=await db();await pg.transaction(async tx=>{
    const rows=(await tx.query<{data:Store}>("SELECT data FROM stores WHERE id=$1 AND expires_at>now() FOR UPDATE",[storeId])).rows;
    if(!rows[0])throw new AppError("NOT_FOUND","This sample store expired or was deleted.",404);
    const store=rows[0].data,session=store.shoppers.find(s=>s.id===shopperId&&!s.closedAt);if(!session)throw new AppError("UNAUTHENTICATED","Your shopper session ended.",401);
    const group=session.privacyGroupId??session.id,visits=store.shoppers.filter(s=>(s.privacyGroupId??s.id)===group);store.privacyWithdrawals??=[];
    for(const visit of visits){purgeShopperPreferences(store,visit.id);store.privacyWithdrawals.push({shopperId:visit.id,campaignId:visit.campaignId,at:new Date().toISOString()});await tx.query("INSERT INTO shopper_tombstones(store_id,shopper_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[storeId,visit.id]);}
    await tx.query("UPDATE stores SET data=$2 WHERE id=$1",[storeId,JSON.stringify(store)]);
  });
}
