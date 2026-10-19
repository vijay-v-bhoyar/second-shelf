import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { sourceDigest } from "./evidence.mjs";

const base=process.env.DEMO_BASE_URL??"http://127.0.0.1:4397";
const dir=`output/playwright/personas-${new Date().toISOString().replaceAll(":","-")}`;
await mkdir(dir,{recursive:true});
const initialDigest=await sourceDigest();
const health=await (await fetch(`${base}/api/v1/health`)).json();
assert.equal(health.app,"Second Shelf");assert.equal(health.providerMode,"fixture");
const browser=await chromium.launch({headless:true}),contexts=[],pages=[],steps=[],errors=[],network=[];
let current="setup",expected=[],qrUrl,offeredTitle,code,ownerStoreId;
async function actor(persona,cookies){
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  contexts.push({persona,context});context.setDefaultTimeout(15000);await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  if(cookies)await context.addCookies(cookies);
  const page=await context.newPage();pages.push({persona,page});
  page.on("pageerror",e=>errors.push({persona,step:current,message:e.message}));
  page.on("console",m=>{if(m.type()==="error"&&!(/Failed to load resource/.test(m.text())&&expected.length))errors.push({persona,step:current,message:m.text()});});
  page.on("response",r=>{if(r.status()>=400&&!expected.some(x=>r.status()===x.status&&new URL(r.url()).pathname===`/api/v1/${x.path}`))network.push({persona,step:current,status:r.status(),path:new URL(r.url()).pathname});});
  return{page,context};
}
async function check(persona,journeys,name,fn,allowed=[]){
  current=name;expected=allowed;const start=Date.now();
  try{await fn();steps.push({persona,journeys,name,status:"PASS",durationMs:Date.now()-start});console.log(`PASS ${persona} ${journeys.join("/")} ${name}`);return true;}
  catch(e){steps.push({persona,journeys,name,status:"FAIL",durationMs:Date.now()-start,error:e.message});console.error(`FAIL ${persona} ${name}: ${e.message}`);for(const a of pages.filter(a=>a.persona===persona))if(!a.page.isClosed())await a.page.screenshot({path:`${dir}/${steps.length}-${a.persona}-failure.png`,fullPage:true}).catch(()=>{});process.exitCode=1;return false;}
  finally{expected=[];}
}
async function shown(locator){await locator.waitFor({state:"visible",timeout:15000});}
async function notice(page,text){await shown(page.getByRole("status").filter({hasText:text}));}
async function tab(page,name){await page.getByRole("button",{name,exact:true}).click();await shown(page.getByRole("heading",{name,exact:true,level:1}));}
async function workspace(context){const r=await context.request.get(`${base}/api/v1/workspace`);assert.equal(r.status(),200);return r.json();}
async function selectFilm(page){await page.getByLabel("Search a film or musician").fill("Spirited");await page.getByRole("button",{name:"Spirited Away Film"}).click();}
async function find(page){await page.getByRole("button",{name:"Find my next read"}).click();await page.getByRole("button",{name:"Find my next read"}).waitFor({state:"visible"});await page.waitForFunction(()=>!document.querySelector('.find-button')?.disabled);}
async function ownerRequest(context,path,body,method="POST"){
  const session=await (await context.request.get(`${base}/api/v1/session`)).json();
  return context.request.fetch(`${base}/api/v1/${path}`,{method,headers:{origin:base,"x-csrf-token":session.csrfToken,"idempotency-key":randomUUID()},data:body});
}
try{
  const p01=await actor("P01"),p04=await actor("P04"),p05=await actor("P05");
  await check("P01",["U01"],"Owner establishes and resumes sample workspace",async()=>{
    await p01.page.goto(base);await p01.page.getByRole("button",{name:"Try a bookstore demo"}).click();await p01.page.waitForURL("**/studio");await shown(p01.page.getByRole("heading",{name:"Good books deserve another chance."}));
    ownerStoreId=(await workspace(p01.context)).id;await p01.page.reload();await shown(p01.page.getByRole("heading",{name:"Good books deserve another chance."}));assert.equal((await workspace(p01.context)).id,ownerStoreId);
  });
  const p02=await actor("P02"),p03=await actor("P03");
  await check("P01",["U12"],"Unredeemed grants do not authenticate separate staff",async()=>{
    await tab(p01.page,"Data & privacy");for(const identity of ["persona-inventory","persona-cashier"]){await p01.page.getByLabel("Sample staff identity").fill(identity);await p01.page.getByRole("button",{name:"Record sample staff grant"}).click();await notice(p01.page,"Sample permission grant recorded");}
    for(const a of [p02,p03]){assert.equal((await a.context.request.get(`${base}/api/v1/workspace`)).status(),401);await a.page.goto(`${base}/studio`);await shown(a.page.getByRole("heading",{name:"Your bookstore session"}));await shown(a.page.getByRole("link",{name:"Start a new demo"}));}
    assert.equal((await workspace(p01.context)).memberships.length,2);
  },[{status:401,path:"workspace"}]);
  // Test-owned owner leases are deliberately copied for functional rehearsal only.
  // This does not impersonate an authenticated limited staff principal.
  for(const a of [p02,p03]){await a.context.addCookies((await p01.context.cookies()).filter(c=>c.name==="ss_merchant"));await a.page.goto(`${base}/studio`);await shown(a.page.getByRole("heading",{name:"Good books deserve another chance."}));}
  await check("P02",["U01","U02"],"Inventory rehearsal: download, bad input, corrected import and snapshot replacement",async()=>{
    await tab(p02.page,"Your inventory");await p02.page.getByLabel("Search inventory").fill("Piranesi");assert.equal(await p02.page.locator("tbody tr").count(),1);await p02.page.getByLabel("Search inventory").fill("");
    const waiting=p02.page.waitForEvent("download");await p02.page.getByRole("link",{name:"Sample CSV"}).click();const download=await waiting;await download.saveAs(`${dir}/inventory.csv`);
    await p02.page.getByLabel("Upload inventory CSV").setInputFiles({name:"bad.csv",mimeType:"text/csv",buffer:Buffer.from("wrong,headers\nx,y")});await shown(p02.page.locator(".notice.error"));assert.equal(await p02.page.locator("tbody tr").count(),12);
    const before=(await workspace(p02.context)).books.map(b=>[b.sku,b.onHand]);
    for(let i=0;i<2;i++){await p02.page.getByLabel("Upload inventory CSV").setInputFiles(`${dir}/inventory.csv`);await notice(p02.page,"CSV preview ready");await p02.page.getByRole("button",{name:"Activate valid rows"}).click();await notice(p02.page,"Inventory snapshot activated");assert.deepEqual((await workspace(p02.context)).books.map(b=>[b.sku,b.onHand]),before);}
  },[{status:400,path:"inventory-imports"}]);
  await check("P02",["U03"],"Curator confirms identity, excludes edition and reconfirms stock",async()=>{
    await p02.page.getByLabel("Inventory filter").selectOption("review");await p02.page.getByRole("button",{name:"Review match",exact:true}).click();await shown(p02.page.getByLabel("Candidate identity"));await p02.page.getByRole("button",{name:"Confirm identity"}).click();await notice(p02.page,"Identity confirmed");assert.equal(await p02.page.locator("tbody tr").count(),0);
    await p02.page.getByLabel("Inventory filter").selectOption("all");await p02.page.getByLabel("Search inventory").fill("review edition");await p02.page.getByRole("button",{name:"Review match",exact:true}).click();await p02.page.getByRole("button",{name:"Exclude edition",exact:true}).click();await notice(p02.page,"Uncertain edition excluded");await shown(p02.page.getByText("Excluded",{exact:true}));await p02.page.getByLabel("Search inventory").fill("");
    const row=p02.page.locator("tr").filter({has:p02.page.getByText("Piranesi",{exact:true})});await row.getByRole("button",{name:"Mark unavailable"}).click();await notice(p02.page,"Sample stock set to zero");await shown(row.getByText("Out of stock",{exact:true}));await row.getByRole("button",{name:"Confirm 3 in stock"}).click();await notice(p02.page,"Stock confirmed");
  });
  await check("P02",["U04"],"Curator prepares a draft for owner handoff",async()=>{
    await tab(p02.page,"Cultural displays");await p02.page.getByRole("button",{name:"Generate cultural proposal"}).click();await notice(p02.page,"Cultural proposal ready");await p02.page.getByLabel("Display title",{exact:true}).fill("Persona handoff display");await p02.page.getByRole("button",{name:"Save draft",exact:true}).click();await notice(p02.page,"Draft saved");assert.equal((await workspace(p02.context)).campaigns.at(-1).state,"draft");
  });
  await check("P01",["U04"],"Owner reviews, activates and prints curator draft",async()=>{
    await p01.page.reload();await shown(p01.page.getByRole("heading",{name:"Good books deserve another chance."}));await tab(p01.page,"Cultural displays");assert.equal(await p01.page.getByLabel("Display title",{exact:true}).inputValue(),"Persona handoff display");
    await p01.page.getByRole("button",{name:"Approve display",exact:true}).click();await notice(p01.page,"Display approved");await p01.page.getByRole("button",{name:"Activate display",exact:true}).click();await notice(p01.page,"Display is active");qrUrl=await p01.page.getByRole("link",{name:"Open shopper experience"}).getAttribute("href");
    await shown(p01.page.getByRole("img",{name:"QR code for the active bookstore discovery page"}));await p01.page.getByRole("button",{name:"Print display card"}).click();await p01.page.emulateMedia({media:"print"});assert.equal(await p01.page.locator(".sidebar").isVisible(),false);await p01.page.pdf({path:`${dir}/display-card.pdf`,printBackground:true});await p01.page.emulateMedia({media:"screen"});
  });
  await check("P04",["U05"],"Anonymous shopper searches, selects three interests and removes one",async()=>{
    await p04.page.goto(qrUrl);await shown(p04.page.getByRole("button",{name:"Find my next read"}));assert.equal((await p04.context.cookies()).some(c=>c.name==="ss_merchant"),false);
    await p04.page.getByLabel("Search a film or musician").fill("unsupported-xyz");await shown(p04.page.getByText("No matches yet. Try a supported name."));await selectFilm(p04.page);
    await p04.page.getByLabel("Interest category").selectOption("artist");for(const name of ["Radiohead","Bon Iver"]){await p04.page.getByLabel("Search a film or musician").fill(name);await p04.page.getByRole("button",{name:`${name} Musician`}).click();}assert.equal(await p04.page.locator(".interest-chip").count(),3);
    await p04.page.getByLabel("Search a film or musician").fill("Phoebe");const fourth=p04.page.getByRole("button",{name:"Phoebe Bridgers Musician"});await shown(fourth);assert.equal(await fourth.isDisabled(),true);await p04.page.getByRole("button",{name:"Remove Bon Iver"}).click();assert.equal(await p04.page.locator(".interest-chip").count(),2);
    await p04.page.getByLabel("Your budget in dollars").fill("20");await find(p04.page);await shown(p04.page.locator(".recommendation-card").first());for(const price of await p04.page.locator(".book-kicker").allTextContents())assert.ok(Number(price.match(/\$([0-9.]+)/)[1])<=20);await p04.page.locator(".recommendation-card summary").first().click();assert.match(await p04.page.locator(".recommendation-card").first().innerText(),/illustrative; Qloo has not been called/);
  });
  await check("P04",["U06"],"Reject and replace, then provide exact title and code to cashier",async()=>{
    const rejected=await p04.page.locator(".recommendation-card h3").first().innerText();await p04.page.locator(".recommendation-card").first().getByRole("button",{name:"Try another"}).click();await p04.page.waitForFunction(title=>!Array.from(document.querySelectorAll('.recommendation-card h3')).some(x=>x.textContent===title),rejected);await p04.page.waitForFunction(()=>!document.querySelector('.find-button')?.disabled);await shown(p04.page.locator('.recommendation-card').first());assert.ok(!(await p04.page.locator(".recommendation-card h3").allTextContents()).includes(rejected));
    const stock=await workspace(p01.context);const titles=await p04.page.locator(".recommendation-card h3").allTextContents();offeredTitle=titles.find(t=>stock.books.some(b=>b.title===t&&b.effectiveQuantity>=2));assert.ok(offeredTitle);
    await p04.page.locator(".recommendation-card").filter({has:p04.page.getByRole("heading",{name:offeredTitle,exact:true})}).getByRole("button",{name:"Show at counter"}).click();await shown(p04.page.getByLabel("Your counter code"));code=await p04.page.locator(".counter-code strong").innerText();
  });
  await check("P03",["U07"],"Cashier denies wrong code, records purchase, deduplicates and appends adjustments",async()=>{
    await p03.page.reload();await shown(p03.page.getByRole("heading",{name:"Good books deserve another chance."}));await tab(p03.page,"Weekly review");await p03.page.getByLabel("Counter code",{exact:true}).fill("WRONG-CODE");await p03.page.getByLabel("Book",{exact:true}).selectOption({label:offeredTitle});await p03.page.getByLabel("Receipt reference",{exact:true}).fill("PERSONA-SALE");await p03.page.getByRole("button",{name:"Verify sample outcome"}).click();await shown(p03.page.locator(".notice.error"));assert.match(await p03.page.locator(".notice.error").innerText(),/Counter code not found/);
    await p03.page.getByLabel("Counter code",{exact:true}).fill(code);await p03.page.getByLabel("Quantity",{exact:true}).fill("2");await p03.page.getByRole("button",{name:"Verify sample outcome"}).click();await notice(p03.page,"Sample outcome verified");
    const rows=p03.page.locator(".panel").filter({has:p03.page.getByRole("heading",{name:"Outcome history"})}).locator("tbody tr");assert.equal(await rows.count(),1);await p03.page.getByRole("button",{name:"Verify sample outcome"}).click();await notice(p03.page,"Sample outcome verified");assert.equal(await rows.count(),1);
    await p03.page.getByLabel("Quantity",{exact:true}).fill("1");for(const type of ["return","correction"]){await p03.page.getByLabel("Outcome type",{exact:true}).selectOption(type);await p03.page.getByLabel("Original purchase",{exact:true}).selectOption({index:1});await p03.page.getByLabel("Receipt reference",{exact:true}).fill(`PERSONA-${type}`);await p03.page.getByRole("button",{name:"Verify sample outcome"}).click();await notice(p03.page,"Sample outcome verified");}assert.equal(await rows.count(),3);
  },[{status:404,path:"outcomes"}]);
  await check("P03",["U07"],"Unoffered SKU and excessive adjustments are rejected",async()=>{
    const stock=await workspace(p03.context),unoffered=stock.books.find(b=>b.title==="Dune"),purchase=stock.outcomes.find(o=>o.type==="purchase");assert.ok(unoffered);assert.ok(purchase);
    const common={type:"purchase",sessionCode:code,sku:unoffered.sku,quantity:1,amountMinor:unoffered.priceMinor,currency:"USD",occurredAt:new Date().toISOString(),receiptReference:"PERSONA-WRONG-SKU"};assert.equal((await ownerRequest(p03.context,"outcomes",common)).status(),400);
    assert.equal((await ownerRequest(p03.context,"outcomes",{...common,type:"correction",sku:purchase.sku,parentEventId:purchase.id,reason:"Exceeds adjusted purchase",receiptReference:"PERSONA-EXCESS",amountMinor:purchase.amountMinor/2})).status(),400);assert.equal((await workspace(p03.context)).outcomes.length,3);
  });
  await check("P04",["U07","U12"],"Shopper cannot read owner workspace or verify a purchase",async()=>{
    assert.equal((await p04.context.request.get(`${base}/api/v1/workspace`)).status(),403);
    const token=new URL(qrUrl).pathname.split("/").at(-1);const session=await p04.context.request.post(`${base}/api/v1/public/campaigns/${token}/sessions`,{headers:{origin:base,"idempotency-key":randomUUID()},data:{measurementOptIn:false,noticeVersion:"demo-notice-v1"}});assert.equal(session.status(),201);
    const denied=await p04.context.request.post(`${base}/api/v1/outcomes`,{headers:{origin:base,"idempotency-key":randomUUID(),"x-csrf-token":session.headers()["x-csrf-token"]},data:{}});assert.equal(denied.status(),403);
  });
  await check("P04",["U05","U06"],"New zero-budget discovery clears old counter handoff and recovers",async()=>{
    await p04.page.getByLabel("Your budget in dollars").fill("0");await find(p04.page);await shown(p04.page.getByText("A narrower path this time."));assert.equal(await p04.page.locator(".recommendation-card").count(),0);assert.equal(await p04.page.getByLabel("Your counter code").count(),0);
    await p04.page.getByLabel("Your budget in dollars").fill("20");await find(p04.page);await shown(p04.page.locator(".recommendation-card").first());
  });
  await check("P01",["U08"],"Owner records keep and change decisions without changing publication",async()=>{
    await p01.page.reload();await shown(p01.page.getByRole("heading",{name:"Good books deserve another chance."}));await tab(p01.page,"Weekly review");assert.match(await p01.page.locator("main").innerText(),/simulat/i);
    for(const decision of ["keep","change"]){await p01.page.getByLabel("Weekly decision",{exact:true}).selectOption(decision);await p01.page.getByLabel("Your reason",{exact:true}).fill(`Persona ${decision} rationale`);await p01.page.getByRole("button",{name:"Record weekly decision"}).click();await notice(p01.page,"Weekly decision recorded");await shown(p01.page.locator(".decision-history").getByText(`Persona ${decision} rationale`,{exact:true}));assert.equal((await p01.context.request.get(qrUrl)).status(),200);}
  });
  await check("P01",["U11"],"Owner evaluates proposal, blocks promotion and freezes simulation",async()=>{
    await p01.page.getByLabel("Policy rationale",{exact:true}).fill("Persona conservative policy proposal");await p01.page.getByRole("button",{name:"Record policy proposal"}).click();await notice(p01.page,"Policy proposal recorded");await p01.page.getByRole("button",{name:"Evaluate proposal"}).click();await notice(p01.page,"Policy evaluation is inconclusive");expected.push({status:409,path:`policy-proposals/${(await workspace(p01.context)).policies.at(-1).id}/approve`});await p01.page.getByRole("button",{name:"Check promotion gate"}).click();await shown(p01.page.locator(".notice.error"));assert.match(await p01.page.locator(".notice.error").innerText(),/Promotion is blocked/);await p01.page.getByRole("button",{name:"Freeze simulated experiment"}).click();await notice(p01.page,"Simulated experiment frozen");
  });
  await check("P04",["U11"],"Opted-in simulation visit survives reload without changing assignment",async()=>{
    // The prior zero-budget probe may fail before its recovery, so restore a valid budget here.
    await p04.page.getByLabel("Your budget in dollars").fill("20");await p04.page.getByRole("checkbox").check();await find(p04.page);await shown(p04.page.locator(".recommendation-card").first());const campaign=(await workspace(p01.context)).campaigns.at(-1);const reviewPath=`${base}/api/v1/campaigns/${campaign.id}/review`;const before=await (await p01.context.request.get(reviewPath)).json();assert.equal(before.assigned,1);
    const resumed=p04.page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith("/sessions"));await p04.page.reload();const resumeResponse=await resumed;assert.equal(resumeResponse.status(),201,"Resuming the assigned visit must succeed");await p04.page.waitForFunction(()=>document.querySelector('.measurement-choice input')?.checked);assert.equal(await p04.page.locator(".notice.error").count(),0);assert.equal(await p04.page.locator(".interest-chip").count(),2);await shown(p04.page.getByText("Spirited Away",{exact:true}));await shown(p04.page.getByText("Radiohead",{exact:true}));assert.equal(await p04.page.getByLabel("Your budget in dollars").inputValue(),"20");assert.equal(await p04.page.getByLabel("Your budget in dollars").isDisabled(),true);assert.equal(await p04.page.getByRole("checkbox").isDisabled(),true);await find(p04.page);await shown(p04.page.locator(".recommendation-card").first());const after=await (await p01.context.request.get(reviewPath)).json();assert.equal(after.assigned,before.assigned);assert.deepEqual(after.arms.map(a=>[a.arm,a.assigned]),before.arms.map(a=>[a.arm,a.assigned]));await p04.page.screenshot({path:`${dir}/resumed-assignment.png`,fullPage:true});
  });
  await check("P01",["U09"],"Owner tests all structured rules and replays display",async()=>{
    await tab(p01.page,"Bookseller rules");const excluded=(await workspace(p01.context)).books.find(b=>b.title===offeredTitle).sku;await p01.page.getByLabel("Book to exclude",{exact:true}).selectOption(excluded);await p01.page.getByRole("button",{name:"Test and save rule"}).click();await notice(p01.page,"Rule saved");await p01.page.getByRole("button",{name:"Replay against display"}).click();await notice(p01.page,"Rule replay found");
    for(const [type,label,value] of [["require_language","Language code (for example, en)","en"],["require_format","Book format (for example, paperback)","paperback"],["max_price_minor","Maximum price in dollars","25"]]){await p01.page.getByLabel("Rule type",{exact:true}).selectOption(type);await p01.page.getByLabel(label,{exact:true}).fill(value);await p01.page.getByRole("button",{name:"Test and save rule"}).click();await notice(p01.page,"Rule saved");}assert.equal(await p01.page.locator(".rule-card").count(),4);
  });
  await check("P01",["U10"],"Owner publishes eligible revision using the stable QR",async()=>{
    await tab(p01.page,"Cultural displays");for(const box of await p01.page.locator('.selection-row input').all())if(await box.isChecked())await box.uncheck();const stock=await workspace(p01.context);const selected=stock.books.filter(b=>b.eligible).slice(0,3);assert.equal(selected.length,3);for(const book of selected)await p01.page.locator(".selection-row").filter({has:p01.page.getByText(book.title,{exact:true})}).getByRole("checkbox").check();
    await p01.page.getByLabel("Display title",{exact:true}).fill("Persona revised display");await p01.page.getByRole("button",{name:"Save draft",exact:true}).click();await notice(p01.page,"Draft saved");await p01.page.getByRole("button",{name:"Approve display",exact:true}).click();await notice(p01.page,"Display approved");await p01.page.getByRole("button",{name:"Activate display",exact:true}).click();await notice(p01.page,"Display is active");assert.equal(await p01.page.getByRole("link",{name:"Open shopper experience"}).getAttribute("href"),qrUrl);const states=(await workspace(p01.context)).campaigns.map(c=>c.state);assert.ok(states.includes("superseded"));assert.equal(states.filter(s=>s==="active").length,1);
  });
  await check("P01",["U08","U10"],"Retire decision records rationale before separate retirement action",async()=>{
    await tab(p01.page,"Weekly review");await p01.page.getByLabel("Weekly decision",{exact:true}).selectOption("retire");await p01.page.getByLabel("Your reason",{exact:true}).fill("Persona retire rationale");await p01.page.getByRole("button",{name:"Record weekly decision"}).click();await notice(p01.page,"Weekly decision recorded");await shown(p01.page.locator(".decision-history").getByText("Persona retire rationale",{exact:true}));assert.equal((await workspace(p01.context)).campaigns.at(-1).state,"active","Recording a decision must not retire the active display");
  });
  await check("P01",["U12"],"Owner exports only own sample data and revokes preview grants",async()=>{
    await tab(p01.page,"Data & privacy");for(const format of ["JSON","CSV"]){const waiting=p01.page.waitForEvent("download");await p01.page.getByRole("button",{name:`Export ${format}`,exact:true}).click();const download=await waiting;const file=`${dir}/owner-export.${format.toLowerCase()}`;await download.saveAs(file);const raw=await readFile(file,"utf8");assert.ok(raw.includes("demo"));assert.ok(!raw.includes('"token"'));}
    assert.ok(await p01.page.locator(".audit-list > div").count());while(await p01.page.getByRole("button",{name:"Revoke grant"}).count()){await p01.page.getByRole("button",{name:"Revoke grant"}).first().click();await notice(p01.page,"Sample grant revoked");}assert.equal((await workspace(p01.context)).memberships.length,0);
  });
  await check("P05",["U01","U12"],"Independent judge owns a separate sample store",async()=>{
    await p05.page.goto(base);await p05.page.getByRole("button",{name:"Try a bookstore demo"}).click();await p05.page.waitForURL("**/studio");await shown(p05.page.getByRole("heading",{name:"Good books deserve another chance."}));const judge=await workspace(p05.context);assert.notEqual(judge.id,ownerStoreId);assert.equal(judge.rules.length,0);assert.equal(judge.outcomes.length,0);assert.equal(judge.memberships.length,0);
    const campaign=(await workspace(p01.context)).campaigns.at(-1);assert.equal((await p05.context.request.get(`${base}/api/v1/campaigns/${campaign.id}`)).status(),404);
  });
  await check("P04",["U05","U06","U11"],"Shopper completes revised display on a narrow screen",async()=>{
    await p04.page.setViewportSize({width:360,height:800});await p04.page.goto(qrUrl);await shown(p04.page.getByRole("button",{name:"Find my next read"}));await selectFilm(p04.page);await find(p04.page);await shown(p04.page.locator(".recommendation-card").first());assert.equal(await p04.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await p04.page.screenshot({path:`${dir}/shopper-mobile.png`,fullPage:true});
  });
  await check("P01",["U10"],"Explicit retirement stops new shopper visits",async()=>{
    await tab(p01.page,"Cultural displays");await p01.page.getByRole("button",{name:"Retire display",exact:true}).click();await notice(p01.page,"Display retired");await p04.page.goto(qrUrl);await shown(p04.page.getByRole("heading",{name:"This display is unavailable"}));
  },[{status:404,path:`public/campaigns/${new URL(qrUrl).pathname.split("/").at(-1)}`}]);
  await check("P01",["U12"],"Deletion revokes owner and rehearsal actors without changing judge store",async()=>{
    await tab(p01.page,"Data & privacy");p01.page.once("dialog",d=>d.accept());await p01.page.getByRole("button",{name:"Delete sample bookstore",exact:true}).click();await p01.page.waitForURL(base+"/");assert.equal((await p02.context.request.get(`${base}/api/v1/workspace`)).status(),401);assert.equal((await p03.context.request.get(`${base}/api/v1/workspace`)).status(),401);assert.notEqual((await workspace(p05.context)).id,ownerStoreId);
  });
  await check("P05",["U12"],"Judge deletes its own sample store",async()=>{await tab(p05.page,"Data & privacy");p05.page.once("dialog",d=>d.accept());await p05.page.getByRole("button",{name:"Delete sample bookstore",exact:true}).click();await p05.page.waitForURL(base+"/");});
  await check("ALL",[],"No unexpected browser errors or failed network responses",async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.equal(await sourceDigest(),initialDigest,"Source changed during browser verification");});
}catch(e){console.error(e);process.exitCode=1;}
finally{
  for(const {persona,context} of contexts)await context.tracing.stop({path:`${dir}/${persona}-trace.zip`}).catch(()=>{});
  await browser.close();const result={at:new Date().toISOString(),base,health,sourceDigest:initialDigest,oracleHash:createHash("sha256").update(await readFile("scripts/persona-e2e.mjs")).digest("hex"),steps,browserErrors:errors,unexpectedNetwork:network,staffAccess:"Legacy owner-proxy regression only; actual independent sample staff credentials are exercised by gap-e2e.mjs. Real identity-provider verification remains unconfigured.",operatorJourney:"U13 is recorded separately in command/restart receipts"};
  await writeFile(`${dir}/results.json`,JSON.stringify(result,null,2));await writeFile("output/playwright/personas-latest.json",JSON.stringify({directory:dir,passed:steps.filter(s=>s.status==="PASS").length,failed:steps.filter(s=>s.status==="FAIL").length},null,2));console.log(`Persona E2E: ${steps.filter(s=>s.status==="PASS").length} passed; ${steps.filter(s=>s.status==="FAIL").length} failed. Evidence: ${dir}`);
}
