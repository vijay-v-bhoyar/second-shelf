import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {parseEnv} from "node:util";
import type {Store} from "../src/lib/types";
import {hostedDatabase,type Database,type DatabaseSession} from "../src/server/postgres";
import {captureLocalBackup,restoreLocalBackup,type ProviderBudget} from "../src/server/recovery";
import {sourceDigest} from "./evidence.mjs";

const base="https://second-shelf-liard.vercel.app",env=parseEnv(await readFile(".env.vercel.production.local","utf8"));
assert.ok(env.DATABASE_URL,"Hosted database configuration is missing");
const root=hostedDatabase(env.DATABASE_URL),schema="ss_recovery_"+randomUUID().replaceAll("-","");
assert.match(schema,/^ss_recovery_[a-f0-9]{32}$/);
let created=false,stage="setup",calls=0;const checks:{name:string;status:string}[]=[],owners:{id:string;cookie:string;csrf:string}[]=[];
async function scoped<T>(fn:(tx:DatabaseSession)=>Promise<T>){return root.transaction(async tx=>{await tx.exec(`SET LOCAL search_path TO "${schema}",pg_catalog`);return fn(tx);});}
const target:Database={query:<T>(sql:string,params?:unknown[])=>scoped(tx=>tx.query<T>(sql,params)),exec:sql=>scoped(tx=>tx.exec(sql)),transaction:scoped,close:async()=>{}};
async function api(route:string,body?:unknown,actor?:{cookie:string;csrf:string},method=body===undefined?"GET":"POST",shopper=false){
  const r=await fetch(base+"/api/v1/"+route,{method,headers:{origin:base,"content-type":"application/json","idempotency-key":randomUUID(),...(actor?{cookie:actor.cookie,"x-csrf-token":actor.csrf}:{}),...(shopper?{"x-second-shelf-session":"shopper"}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await r.json();assert.ok(r.ok,`${route.split("/")[0]} returned ${r.status}`);return{data,cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
async function owner(){const r=await api("demo-sessions",{});assert.ok(r.cookie);const w=(await api("workspace",undefined,{cookie:r.cookie,csrf:""})).data;const a={id:w.id,cookie:r.cookie,csrf:w.csrfToken};owners.push(a);return a;}
let snapshot:Awaited<ReturnType<typeof captureLocalBackup>>|undefined,publicBudgets:ProviderBudget[];
try{
  const health=(await api("health")).data;assert.equal(health.app,"Second Shelf");assert.equal(health.providerMode,"live");assert.equal(health.persistence,"hosted-postgresql");
  stage="create owned public witnesses";const kept=await owner(),deleted=await owner();
  const catalog=JSON.parse(await readFile("output/verification/qloo-live-catalog-rank.json","utf8"));assert.equal(catalog.verified,true);
  let w=(await api("workspace",undefined,kept)).data;
  for(const book of w.books.filter((b:{sku:string})=>["PIRANESI","NIGHT","SEA"].includes(b.sku))){const match=catalog.books.find((b:{name:string})=>b.name===book.title);assert.ok(match);await api(`entity-mappings/${book.mappingId}`,{expectedRevision:book.revision,status:"confirmed",entityId:match.id,reason:"Synthetic hosted recovery witness; previously verified genuine work"},kept,"PATCH");}
  let c=w.campaigns.at(-1);await api(`campaigns/${c.id}`,{expectedRevision:c.revision,draft:{title:"Hosted recovery witness",candidateSkus:["PIRANESI","NIGHT","SEA"],ruleRevisionIds:[]}},kept,"PATCH");
  for(const action of ["approve","activate"]){w=(await api("workspace",undefined,kept)).data;c=w.campaigns.at(-1);await api(`campaigns/${c.id}/${action}`,{expectedRevision:c.revision},kept);}
  const invitation=(await api("memberships",{identityId:"Recovery-only synthetic staff",permissions:["review_read"]},kept)).data;
  const inviteToken=new URLSearchParams(new URL(invitation.inviteUrl).hash.slice(1)).get("invite");await api("staff-sessions",{inviteToken});
  const joined=await api(`public/campaigns/${c.token}/sessions`,{noticeVersion:"demo-notice-v1"});assert.ok(joined.cookie);
  const shopper={cookie:joined.cookie,csrf:(await api("shopper/session",undefined,{cookie:joined.cookie,csrf:""},"GET",true)).data.csrfToken};
  const film=JSON.parse(await readFile("output/verification/qloo-live-search.json","utf8")).items[0].id;
  const queued=(await api("shopper/recommendations",{interestIds:[film],budgetMinor:2000,excludedSkus:[]},shopper,"POST",true)).data;calls++;
  let job=queued;for(let i=0;i<80&&!['succeeded','failed'].includes(job.status);i++){await new Promise(r=>setTimeout(r,350));job=(await api("jobs/"+queued.id,undefined,shopper,"GET",true)).data;}
  assert.equal(job.status,"succeeded");assert.equal(job.result.evidenceMode,"live");assert.ok(job.result.items.length>0);
  const book=job.result.items[0],code=(await api("shopper/purchase-code",{runId:queued.id,sku:book.sku},shopper,"POST",true)).data.code;
  await api("outcomes",{type:"purchase",sessionCode:code,sku:book.sku,quantity:1,amountMinor:book.priceMinor,currency:"USD",occurredAt:new Date().toISOString(),receiptReference:"RECOVERY-SYNTHETIC-"+randomUUID()},kept);
  checks.push({name:"Actual public synthetic tenant, staff, shopper, live recommendation and outcome witnesses",status:"PASS"});
  stage="capture only owned data into isolated schema";
  await root.exec(`CREATE SCHEMA "${schema}"`);created=true;
  await target.exec("CREATE TABLE stores(id uuid PRIMARY KEY,owner_hash text UNIQUE NOT NULL,data jsonb NOT NULL,expires_at timestamptz NOT NULL);CREATE TABLE tombstones(store_id uuid PRIMARY KEY,deleted_at timestamptz NOT NULL DEFAULT now());");
  const rows=(await root.query<{data:Store}>("SELECT data FROM public.stores WHERE id=ANY($1::uuid[])",[owners.map(o=>o.id)])).rows;assert.equal(rows.length,2);
  for(const {data}of rows)await target.query("INSERT INTO stores VALUES($1,$2,$3,$4)",[data.id,data.token,JSON.stringify(data),data.expiresAt]);
  publicBudgets=(await root.query<{provider:string;day:string;used:string}>("SELECT provider,day::text,used::text FROM public.provider_call_budgets WHERE day=CURRENT_DATE")).rows.map(b=>({...b,used:Number(b.used)}));
  // The initial capture creates the budget table; second capture includes the source-day accounting.
  await captureLocalBackup(target);for(const b of publicBudgets)await target.query("INSERT INTO provider_call_budgets VALUES($1,$2,$3)",[b.provider,b.day,b.used]);snapshot=await captureLocalBackup(target);
  assert.ok(snapshot.stores.find(s=>s.id===kept.id)!.staffSessions?.length);assert.ok(snapshot.stores.find(s=>s.id===kept.id)!.shoppers.length);
  stage="actual public withdrawal and tenant deletion";
  await api("shopper/forget",{confirm:true},shopper,"POST",true);await api("store",{confirm:true},deleted,"DELETE");
  const tombstones=(await root.query<{store_id:string}>("SELECT store_id FROM public.tombstones WHERE store_id=ANY($1::uuid[])",[owners.map(o=>o.id)])).rows.map(r=>r.store_id);
  const withdrawn=(await root.query<{store_id:string;shopper_id:string}>("SELECT store_id,shopper_id FROM public.shopper_tombstones WHERE store_id=ANY($1::uuid[])",[owners.map(o=>o.id)])).rows.map(r=>({storeId:r.store_id,shopperId:r.shopper_id}));
  assert.ok(tombstones.includes(deleted.id));assert.ok(withdrawn.some(r=>r.storeId===kept.id));
  await target.exec("DELETE FROM stores");
  stage="restore with current manifests";const restored=await restoreLocalBackup(target,snapshot,tombstones,withdrawn,publicBudgets);assert.deepEqual(restored,{restored:1,skipped:1});
  const recovered=(await target.query<{data:Store}>("SELECT data FROM stores WHERE id=$1",[kept.id])).rows[0].data;
  assert.equal(recovered.shoppers.length,0);assert.equal(recovered.jobs.filter(j=>j.sessionId).length,0);assert.equal(recovered.staffSessions?.length,0);assert.ok(recovered.memberships.every(m=>!m.inviteNonce));assert.equal(recovered.outcomes.length,1);assert.equal(recovered.campaigns.at(-1)!.state,"active");
  checks.push({name:"Actual hosted isolated restore preserves campaign/outcome and enforces current public tenant/shopper deletion manifests",status:"PASS"});
  stage="stale manifests and monotonic budgets";const qloo=publicBudgets.find(b=>b.provider==="qloo")!;assert.ok(qloo);
  const injectedHigher=qloo.used+3;await target.query("UPDATE provider_call_budgets SET used=$1 WHERE provider='qloo' AND day=$2",[injectedHigher,qloo.day]);
  await restoreLocalBackup(target,snapshot,[],[],publicBudgets.map(b=>({...b,used:1})));
  assert.equal((await target.query("SELECT id FROM stores WHERE id=$1",[deleted.id])).rows.length,0);
  assert.equal((await target.query<{data:Store}>("SELECT data FROM stores WHERE id=$1",[kept.id])).rows[0].data.shoppers.length,0);
  assert.equal(Number((await target.query<{used:string}>("SELECT used::text FROM provider_call_budgets WHERE provider='qloo' AND day=$1",[qloo.day])).rows[0].used),injectedHigher);
  checks.push({name:"Target tombstones survive stale-manifest replay; isolated injected higher budget cannot decrease",status:"PASS"});
  stage="transaction rollback";await assert.rejects(()=>target.transaction(async tx=>{await tx.query("UPDATE stores SET data=jsonb_set(data,'{name}','\"ROLLBACK\"') WHERE id=$1",[kept.id]);throw Error("intentional rollback");}),/intentional rollback/);
  assert.notEqual((await target.query<{data:Store}>("SELECT data FROM stores WHERE id=$1",[kept.id])).rows[0].data.name,"ROLLBACK");checks.push({name:"Hosted restore schema transaction rollback",status:"PASS"});
}catch(error){checks.push({name:stage,status:"FAIL"});console.error("Hosted recovery check failed at "+stage+" ("+(error instanceof Error?error.name:"unknown")+")");process.exitCode=1;}
finally{
  let cleanup=true;for(const o of owners)try{const status=await fetch(base+"/api/v1/workspace",{headers:{cookie:o.cookie},signal:AbortSignal.timeout(12000)});if(status.ok)await api("store",{confirm:true},o,"DELETE");else assert.equal(status.status,401);}catch{cleanup=false;}
  try{if(created){assert.match(schema,/^ss_recovery_[a-f0-9]{32}$/);await root.exec(`DROP SCHEMA "${schema}" CASCADE`);}}catch{cleanup=false;}
  await root.close();checks.push({name:"Delete only test-owned public stores and newly created isolated schema",status:cleanup?"PASS":"FAIL"});if(!cleanup)process.exitCode=1;
  await writeFile("output/verification/hosted-recovery.json",JSON.stringify({at:new Date().toISOString(),sourceDigest:await sourceDigest(),base,checks,providerCalls:calls,isolatedSchema:true,productionRestorePerformed:false,privateBackupPersisted:false,publicGlobalBudgetsNeverDirectlyWritten:true,scope:"Actual Neon schema recovery using only test-owned public witnesses and current deletion/budget manifests. Not a production disaster recovery, provider PITR, backup retention or operator drill."},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.status==="PASS").length,failed:checks.filter(c=>c.status==="FAIL").length,cleanup,providerCalls:calls}));
}
