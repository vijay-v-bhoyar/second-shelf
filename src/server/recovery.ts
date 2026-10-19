import type { Store } from "@/lib/types";
import type { Database } from "./postgres";
import { requireThat } from "./domain";
import { purgeShopperPreferences, type ShopperTombstone } from "./privacy";
export interface ProviderBudget {provider:string;day:string;used:number}
export interface LocalBackup { schemaVersion:1; capturedAt:string; stores:Store[]; shopperTombstones?:ShopperTombstone[]; storeTombstones?:string[];providerBudgets?:ProviderBudget[] }
function validateBudgets(budgets:ProviderBudget[]){
  requireThat(Array.isArray(budgets),"CONFIGURATION_NOT_READY","Current provider budget manifest is required before restoration.",503);
  requireThat(budgets.every(b=>b&&typeof b.provider==="string"&&b.provider.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(b.day)&&Number.isSafeInteger(b.used)&&b.used>0),"INVALID_INPUT","Provider budget manifest is invalid.");
}
async function captureBudgets(database:Database):Promise<ProviderBudget[]>{
  await database.exec("CREATE TABLE IF NOT EXISTS provider_call_budgets(provider text NOT NULL,day date NOT NULL,used bigint NOT NULL CHECK(used>0),PRIMARY KEY(provider,day));");
  const budgets=(await database.query<{provider:string;day:string;used:string}>("SELECT provider,day::text,used::text FROM provider_call_budgets")).rows.map(b=>({...b,used:Number(b.used)}));validateBudgets(budgets);return budgets;
}
async function shopperTombstones(database:Database):Promise<ShopperTombstone[]>{
  await database.exec("CREATE TABLE IF NOT EXISTS shopper_tombstones(store_id uuid NOT NULL,shopper_id uuid NOT NULL,deleted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,shopper_id));");
  return(await database.query<{store_id:string;shopper_id:string}>("SELECT store_id,shopper_id FROM shopper_tombstones")).rows.map(r=>({storeId:r.store_id,shopperId:r.shopper_id}));
}
// Internal operator utility only. Backups are private; this is not a public export.
export async function captureLocalBackup(database:Database):Promise<LocalBackup>{
  const stores=(await database.query<{data:Store}>("SELECT data FROM stores WHERE expires_at > now()")).rows.map(r=>r.data);
  return{schemaVersion:1,capturedAt:new Date().toISOString(),stores,shopperTombstones:await shopperTombstones(database),storeTombstones:(await database.query<{store_id:string}>("SELECT store_id FROM tombstones")).rows.map(r=>r.store_id),providerBudgets:await captureBudgets(database)};
}
export async function restoreLocalBackup(database:Database,backup:LocalBackup,tombstones:string[],withdrawn:ShopperTombstone[],currentBudgets:ProviderBudget[]){
  requireThat(backup.schemaVersion===1,"INVALID_INPUT","Backup schema is unsupported.");
  requireThat(Array.isArray(withdrawn),"CONFIGURATION_NOT_READY","Current shopper deletion manifest is required before restoration.",503);
  requireThat(Array.isArray(tombstones),"CONFIGURATION_NOT_READY","Current store deletion manifest is required before restoration.",503);
  validateBudgets(currentBudgets);validateBudgets(backup.providerBudgets??[]);
  await captureBudgets(database);
  const deleted=new Set([...tombstones,...backup.storeTombstones??[]]);let restored=0;
  const forgotten=[...await shopperTombstones(database),...backup.shopperTombstones??[],...withdrawn];
  await database.transaction(async tx=>{
    // Target-side deletions remain authoritative even if an operator supplies an older manifest.
    for(const row of(await tx.query<{store_id:string}>("SELECT store_id FROM tombstones")).rows)deleted.add(row.store_id);
    for(const store of backup.stores){
      if(deleted.has(store.id)||Date.parse(store.expiresAt)<=Date.now())continue;
      requireThat(store.id&&store.token&&Array.isArray(store.campaigns)&&Array.isArray(store.outcomes),"INVALID_INPUT","Backup store record is invalid.");
      const copy=structuredClone(store);for(const item of forgotten.filter(x=>x.storeId===store.id)){const prior=copy.shoppers.find(x=>x.id===item.shopperId);purgeShopperPreferences(copy,item.shopperId);copy.privacyWithdrawals??=[];if(!copy.privacyWithdrawals.some(x=>x.shopperId===item.shopperId))copy.privacyWithdrawals.push({shopperId:item.shopperId,campaignId:prior?.campaignId,at:item.at??new Date().toISOString()});}
      // Old backups must never resurrect usable staff credentials or invitations.
      copy.staffSessions=[];copy.memberships=copy.memberships.map(({id,identityId,permissions})=>({id,identityId,permissions}));
      await tx.query("INSERT INTO stores(id,owner_hash,data,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET owner_hash=$2,data=$3,expires_at=$4",[store.id,copy.token,JSON.stringify(copy),store.expiresAt]);restored++;
    }
    for(const storeId of deleted){await tx.query("DELETE FROM stores WHERE id=$1",[storeId]);await tx.query("INSERT INTO tombstones(store_id) VALUES($1) ON CONFLICT DO NOTHING",[storeId]);}
    for(const item of forgotten)await tx.query("INSERT INTO shopper_tombstones(store_id,shopper_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[item.storeId,item.shopperId]);
    // Neither a stale backup nor a stale manifest may replenish consumed provider/demo capacity.
    for(const budget of [...backup.providerBudgets??[],...currentBudgets])await tx.query("INSERT INTO provider_call_budgets(provider,day,used) VALUES($1,$2,$3) ON CONFLICT(provider,day) DO UPDATE SET used=GREATEST(provider_call_budgets.used,EXCLUDED.used)",[budget.provider,budget.day,budget.used]);
  });return{restored,skipped:backup.stores.length-restored};
}
