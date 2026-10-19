import {randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
const base="https://second-shelf-liard.vercel.app",file="output/verification/private-public-witness.json",stage=process.argv[2];
if(stage==="before"){
 const key=randomUUID(),results=await Promise.all(Array.from({length:6},async()=>{const r=await fetch(base+"/api/v1/demo-sessions",{method:"POST",headers:{origin:base,"content-type":"application/json","idempotency-key":key},body:"{}"});assert.equal(r.status,201);return{data:await r.json(),cookie:r.headers.get("set-cookie")};}));
 assert.equal(new Set(results.map(r=>r.data.storeId)).size,1);assert.equal(new Set(results.map(r=>r.cookie.split(";")[0])).size,1);assert.match(results[0].cookie,/Secure/);
 const cookie=results[0].cookie.split(";")[0],r=await fetch(base+"/api/v1/workspace",{headers:{cookie}}),w=await r.json();assert.equal(r.status,200);
 const b=w.books[0],stock=await fetch(base+"/api/v1/inventory/"+b.sku,{method:"PATCH",headers:{cookie,origin:base,"content-type":"application/json","idempotency-key":randomUUID(),"x-csrf-token":w.csrfToken},body:JSON.stringify({expectedRevision:b.revision,onHand:6})});assert.equal(stock.status,200);
 await writeFile(file,JSON.stringify({cookie,storeId:w.id,importId:w.importId,sku:b.sku,phase:"before"}));console.log("PASS: six concurrent bootstrap retries share one store and secure cookie; witness saved");
}else if(stage==="after"){
 const before=JSON.parse(await readFile(file,"utf8")),r=await fetch(base+"/api/v1/workspace",{headers:{cookie:before.cookie}}),w=await r.json();assert.equal(r.status,200);assert.equal(w.id,before.storeId);assert.equal(w.importId,before.importId);assert.equal(w.books.find(b=>b.sku===before.sku).onHand,6);
 const deleted=await fetch(base+"/api/v1/store",{method:"DELETE",headers:{cookie:before.cookie,origin:base,"content-type":"application/json","idempotency-key":randomUUID(),"x-csrf-token":w.csrfToken},body:JSON.stringify({confirm:true})});assert.equal(deleted.status,202);assert.equal((await fetch(base+"/api/v1/workspace",{headers:{cookie:before.cookie}})).status,401);
 await writeFile(file,JSON.stringify({phase:"deleted",credentialsRemoved:true}));await writeFile("output/verification/public-redeploy-persistence.json",JSON.stringify({at:new Date().toISOString(),base,status:"PASS",concurrentBootstrapRetries:6,sameStoreAndCookie:true,storeImportAndStockPreservedAcrossRedeploy:true,testStoreDeleted:true},null,2));console.log("PASS: public store/import/stock survived redeploy; test store deleted");
}else throw Error("Use before or after");
