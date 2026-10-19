import {chromium} from "playwright";
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {sourceDigest} from "./evidence.mjs";

const base=process.env.PUBLIC_DEMO_URL??"https://second-shelf-liard.vercel.app";
const dir=`output/playwright/live-review-${new Date().toISOString().replaceAll(":","-")}`;
await mkdir(dir,{recursive:true});
const subject=await sourceDigest(),health=await(await fetch(base+"/api/v1/health")).json();
assert.equal(health.providerMode,"live");assert.equal(health.persistence,"hosted-postgresql");
const browser=await chromium.launch(),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
page.setDefaultTimeout(25000);const checks=[],errors=[];page.on("pageerror",e=>errors.push(e.message));
async function check(name,fn){try{await fn();checks.push({name,status:"PASS"});console.log("PASS "+name);}catch(e){checks.push({name,status:"FAIL",error:e.message});throw e;}}
const status=text=>page.getByRole("status").filter({hasText:text}).waitFor();
const tab=name=>page.getByRole("button",{name,exact:true}).click();
async function workspace(){const r=await context.request.get(base+"/api/v1/workspace");assert.equal(r.status(),200);return r.json();}
try{
  await check("R01 P01 opens a separate synthetic store with honest live capability disclosure",async()=>{
    await page.goto(base);await page.getByRole("button",{name:"Try a bookstore demo",exact:true}).click();await page.getByRole("heading",{name:"Good books deserve another chance.",exact:true}).waitFor();assert.equal((await workspace()).providerMode,"live");
  });
  await check("R02 P01 replays, disables and renews an explicit bookseller rule",async()=>{
    await tab("Bookseller rules");await page.getByLabel("Book to exclude",{exact:true}).selectOption("PIRANESI");await page.getByRole("button",{name:"Test and save rule",exact:true}).click();await status("Rule saved");await page.getByRole("button",{name:"Replay against display",exact:true}).click();await status("Rule replay passed");await page.getByRole("button",{name:"Disable rule",exact:true}).click();await status("Rule status updated");await page.getByRole("button",{name:"Renew rule review",exact:true}).click();await status("Rule review renewed");const r=(await workspace()).rules[0];assert.equal(r.active,false);assert.equal(r.history.length,2);
  });
  await check("R03 P01 records a period-bound decision without claiming sales benefit",async()=>{
    await tab("Weekly review");await page.getByLabel("Your reason",{exact:true}).fill("Provider access now works; synthetic records do not establish a sales benefit.");await page.getByRole("button",{name:"Record weekly decision",exact:true}).click();await status("Weekly decision recorded");const d=(await workspace()).reviews.at(-1);assert.ok(d.periodStart&&d.periodEnd);assert.equal(d.decision,"keep");
  });
  await check("R04 P01 policy promotion remains blocked without genuine prospective evidence",async()=>{
    await page.getByLabel("Policy rationale",{exact:true}).fill("Keep promotion blocked until an approved prospective merchant evaluation exists.");await page.getByRole("button",{name:"Record policy proposal",exact:true}).click();await status("Policy proposal recorded");await page.getByRole("button",{name:"Evaluate proposal",exact:true}).click();await status("Policy evaluation is inconclusive");assert.equal((await workspace()).policies[0].status,"insufficient_evidence");const blocked=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/approve")&&r.request().method()==="POST");await page.getByRole("button",{name:"Check promotion gate",exact:true}).click();assert.equal((await blocked).status(),409);
  });
  await check("R05 P01 exports synthetic records without session credentials",async()=>{
    await tab("Data & privacy");const currentWorkspace=await workspace();assert.equal(health.persistence,"hosted-postgresql");assert.equal(currentWorkspace.persistence,health.persistence);assert.equal(await page.getByText("Persistence",{exact:true}).locator("..").locator("dd").innerText(),"Hosted PostgreSQL");await page.screenshot({path:dir+"/hosted-persistence.png",fullPage:true});const downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"Export JSON",exact:true}).click();await(await downloaded).saveAs(dir+"/private-test-export.json");const data=JSON.parse(await readFile(dir+"/private-test-export.json","utf8"));assert.equal(data.dataMode,"demo");assert.equal(data.inventory.length,12);assert.ok(!("token" in data));
  });
  await check("R06 P01 deletes the test-owned store and invalidates its session",async()=>{
    page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Delete sample bookstore",exact:true}).click();await page.waitForURL(base+"/");assert.equal((await context.request.get(base+"/api/v1/workspace")).status(),401);assert.deepEqual(errors,[]);assert.equal(await sourceDigest(),subject);
  });
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
  try{if((await context.request.get(base+"/api/v1/workspace")).status()===200){const session=await(await context.request.get(base+"/api/v1/session")).json();const r=await context.request.delete(base+"/api/v1/store",{headers:{origin:base,"idempotency-key":randomUUID(),"x-csrf-token":session.csrfToken},data:{confirm:true}});assert.equal(r.status(),202);}}catch(e){checks.push({name:"Test-store cleanup",status:"FAIL",error:e.message});process.exitCode=1;}
  await browser.close();const proof={at:new Date().toISOString(),base,health,sourceDigest:subject,oracleHash:createHash("sha256").update(await readFile("scripts/public-live-review-e2e.mjs")).digest("hex"),checks,errors,providerCalls:0,scope:"Public owner review, export and evidence safeguards; synthetic records, no genuine policy or commercial validation"};await writeFile(dir+"/results.json",JSON.stringify(proof,null,2));await writeFile("output/playwright/live-review-latest.json",JSON.stringify({directory:dir,passed:checks.filter(c=>c.status==="PASS").length,failed:checks.filter(c=>c.status==="FAIL").length},null,2));console.log("Evidence "+dir);
}
