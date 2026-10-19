/* global window, DOMException */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { sourceDigest } from "./evidence.mjs";

const base=process.env.STARTUP_DEMO_URL??"http://127.0.0.1:4397";
const target=base.includes("127.0.0.1")?"local":"public",dir=`output/playwright/startup-${target}-${new Date().toISOString().replaceAll(":","-")}`;
await mkdir(dir,{recursive:true});
const subject=await sourceDigest(),health=await(await fetch(base+"/api/v1/health")).json();
assert.equal(health.app,"Second Shelf");
const browser=await chromium.launch(),checks=[],trials=[],errors=[];
async function scenario(name,fn){
  const context=await browser.newContext(),page=await context.newPage();
  page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push({name,message:e.message}));
  let fallbackCookie="";
  const remember=response=>{fallbackCookie=response.headers()["set-cookie"]?.split(";")[0]??fallbackCookie;};
  await context.tracing.start({screenshots:true,snapshots:true});
  try{await page.goto(base);await fn({page,context,remember});checks.push({name,status:"PASS"});console.log("PASS "+name);}
  catch(e){checks.push({name,status:"FAIL",message:e.message});process.exitCode=1;console.error(name+": "+e.message);}
  finally{
    const headers=fallbackCookie?{cookie:fallbackCookie}:{};
    const sessionResponse=await context.request.get(base+"/api/v1/session",{headers});
    if(sessionResponse.status()===200){const session=await sessionResponse.json();const result=await context.request.delete(base+"/api/v1/store",{data:{confirm:true},headers:{...headers,origin:base,"x-csrf-token":session.csrfToken,"idempotency-key":randomUUID()}});if(result.status()!==202){errors.push({name,message:"Own test store cleanup failed"});process.exitCode=1;}}
    else if(sessionResponse.status()!==401){errors.push({name,message:"Own test cleanup state unknown"});process.exitCode=1;}
    await context.tracing.stop({path:`${dir}/${checks.length}-trace.zip`});await context.close();
  }
}
async function ready(page){await page.getByRole("heading",{name:"Your path to a first display"}).waitFor({state:"visible"});assert(new URL(page.url()).pathname==="/studio");}
async function start(page){await page.getByRole("button",{name:"Try a bookstore demo",exact:true}).click();await ready(page);}
async function workspace(context){const r=await context.request.get(base+"/api/v1/workspace");assert.equal(r.status(),200);return r.json();}
try{
  for(let i=0;i<5;i++)await scenario(`S01.${i+1} P01/P05 fresh browser reaches first value within original 20s`,async({page})=>{const t=Date.now();await start(page);const elapsedMs=Date.now()-t;assert(elapsedMs<20000);trials.push({trial:i+1,elapsedMs,status:"PASS"});});
  await scenario("S02 P01/P05 startup survives blocked studio document transport",async({page})=>{
    let documents=0;page.on("request",r=>{if(new URL(r.url()).pathname==="/studio"&&r.resourceType()==="document")documents++;});
    await page.route(base+"/studio",r=>r.abort("timedout"));await start(page);assert.equal(documents,0,"Bootstrap must not require another studio document request");
  });
  await scenario("S03 P01 lost signup reply retries the same committed bookstore",async({page,context,remember})=>{
    const keys=[];let firstStore;
    await page.route(base+"/api/v1/demo-sessions",async route=>{
      keys.push(route.request().headers()["idempotency-key"]);
      if(keys.length===1){const response=await route.fetch();assert.equal(response.status(),201);remember(response);firstStore=(await response.json()).storeId;await route.abort("failed");}
      else await route.continue();
    });
    await page.getByRole("button",{name:"Try a bookstore demo",exact:true}).click();await page.getByRole("alert").waitFor({state:"visible"});
    await page.getByRole("button",{name:"Retry opening demo",exact:true}).click();await ready(page);
    assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await workspace(context)).id,firstStore);
  });
  await scenario("S04 P01/P05 stalled signup has bounded recovery",async({page})=>{
    let seen=false;await page.route(base+"/api/v1/demo-sessions",async route=>{if(!seen){seen=true;await new Promise(r=>setTimeout(r,10000));await route.abort("timedout").catch(()=>{});}else await route.continue();});
    const t=Date.now();await page.getByRole("button",{name:"Try a bookstore demo",exact:true}).click();await page.getByRole("alert").filter({hasText:"took too long"}).waitFor({state:"visible"});assert(Date.now()-t<12000,"8s request deadline must expose recovery within 12s");
    await page.getByRole("button",{name:"Retry opening demo",exact:true}).click();await ready(page);
  });
  await scenario("S05 P01/P06 workspace timeout resumes without another signup",async({page,context})=>{
    let signups=0,workspaceReads=0;page.on("request",r=>{if(r.url().endsWith("/demo-sessions"))signups++;});
    await page.route(base+"/api/v1/workspace",async route=>{if(++workspaceReads===1){await new Promise(r=>setTimeout(r,10000));await route.abort("timedout").catch(()=>{});}else await route.continue();});
    const t=Date.now();await page.getByRole("button",{name:"Try a bookstore demo",exact:true}).click();await page.getByRole("alert").filter({hasText:"took too long"}).waitFor({state:"visible"});assert(Date.now()-t<15000);
    const before=await workspace(context);await page.getByRole("button",{name:"Retry opening bookstore",exact:true}).click();await ready(page);assert.equal(signups,1);assert.equal((await workspace(context)).id,before.id);
  });
  await scenario("S06 P01/P05 reload and return resume the existing store",async({page,context})=>{
    await start(page);const before=await workspace(context);await page.reload();await ready(page);assert.equal((await workspace(context)).id,before.id);
    await page.goto(base);let signups=0;page.on("request",r=>{if(r.url().endsWith("/demo-sessions"))signups++;});await page.getByRole("button",{name:"Return to your bookstore",exact:true}).click();await ready(page);assert.equal(signups,0);assert.equal((await workspace(context)).id,before.id);
  });
  await scenario("S07 P09 blocked browser storage still permits current-page entry",async({page})=>{
    await page.addInitScript(()=>{Object.defineProperty(window,"sessionStorage",{get(){throw new DOMException("Disabled by preference","SecurityError");}});});await page.reload();await start(page);
  });
  assert.deepEqual(errors,[]);
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
  await browser.close();const proof={at:new Date().toISOString(),base,target,sourceDigest:subject,oracleHash:createHash("sha256").update(await readFile("scripts/startup-e2e.mjs")).digest("hex"),health,checks,trials,errors,scope:"Five scripted fresh-browser trials plus transport/response-loss/timeout/reload/storage recovery injections; not global uptime or human experience",providerCalls:0};
  await writeFile(`${dir}/results.json`,JSON.stringify(proof,null,2));await writeFile(`output/playwright/startup-${target}-latest.json`,JSON.stringify({directory:dir,passed:checks.filter(c=>c.status==="PASS").length,failed:checks.filter(c=>c.status==="FAIL").length},null,2));console.log(`Startup ${target}: ${checks.filter(c=>c.status==="PASS").length} PASS / ${checks.filter(c=>c.status==="FAIL").length} FAIL; ${dir}`);
}
