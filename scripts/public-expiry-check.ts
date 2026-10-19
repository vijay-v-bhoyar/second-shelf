import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db, mutateStore, deleteStore } from "../src/server/repository";

process.loadEnvFile(".env.vercel.production.local");
const base="https://second-shelf-liard.vercel.app",bootstrapKey=randomUUID(),checks:string[]=[];
let ownerCookie="",ownerCsrf="",storeId="";
async function call(route:string,body?:unknown,cookie=ownerCookie,csrf=ownerCsrf,key=randomUUID()){
  const response=await fetch(base+"/api/v1/"+route,{method:body===undefined?"GET":"POST",headers:{origin:base,cookie,"x-csrf-token":csrf,"content-type":"application/json","idempotency-key":key},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:response.status,data:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]??""};
}
async function staff(label:string){const grant=await call("memberships",{identityId:label,permissions:["review_read"]});assert.equal(grant.status,201);const token=new URLSearchParams(new URL(grant.data.inviteUrl).hash.slice(1)).get("invite");const login=await call("staff-sessions",{inviteToken:token},"","");assert.equal(login.status,201);const session=await call("staff/session",undefined,login.cookie,"");assert.equal(session.status,200);return{cookie:login.cookie,csrf:session.data.csrfToken,memberId:grant.data.id,token};}
try{
  const created=await call("demo-sessions",{},"","",bootstrapKey);assert.equal(created.status,201);ownerCookie=created.cookie;storeId=created.data.storeId;ownerCsrf=(await call("session")).data.csrfToken;
  const first=await staff("Public signout reviewer");assert.equal((await call("staff/logout",{},first.cookie,first.csrf)).status,200);assert.equal((await call("staff/workspace",undefined,first.cookie,"")).status,401);checks.push("signed-out raw staff credential cannot access workspace");
  assert.equal((await call("staff-sessions",{inviteToken:first.token},"","")).status,409);checks.push("used invitation cannot be redeemed after sign-out");
  const second=await staff("Public expiry reviewer");await mutateStore(storeId,s=>{s.staffSessions!.find(x=>x.membershipId===second.memberId)!.expiresAt=new Date(Date.now()-1000).toISOString();});assert.equal((await call("staff/workspace",undefined,second.cookie,"")).status,401);checks.push("expired staff lease rejected by public API");
  const expiry=new Date(Date.now()-1000).toISOString(),pg=await db();await pg.query("UPDATE stores SET data=jsonb_set(data,'{expiresAt}',$2::jsonb),expires_at=$3::timestamptz WHERE id=$1",[storeId,JSON.stringify(expiry),expiry]);await pg.query("UPDATE demo_bootstraps SET expires_at=$2 WHERE store_id=$1",[storeId,expiry]);
  assert.equal((await call("workspace")).status,401);checks.push("expired owner store rejects existing cookie");assert.equal((await call("demo-sessions",{},"","",bootstrapKey)).status,404);checks.push("expired bootstrap retry cannot recreate the store");
  await deleteStore(storeId);storeId="";await writeFile("output/verification/public-expiry.json",JSON.stringify({at:new Date().toISOString(),base,status:"PASS",checks,scope:"Public API with SQL expiry injection on a test-owned tenant only",testStoreDeleted:true,providerCalls:0},null,2));console.log(`PASS: ${checks.length} public signout/replay/expiry checks; test tenant deleted`);
}finally{if(storeId)await deleteStore(storeId);await(await db()).close();}
