/* global document */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {sourceDigest} from './evidence.mjs';
const base=process.env.DEMO_BASE_URL;
assert.ok(base&&new URL(base).hostname==='127.0.0.1','Isolated loopback server required');
const dir='output/playwright/edition-rejection-'+new Date().toISOString().replaceAll(':','-');
await mkdir(dir,{recursive:true});
const source=await sourceDigest(),oracleHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'fixture');assert.equal(health.persistence,'embedded-postgresql');
const browser=await chromium.launch(),actors=[],steps=[],errors=[],external=[];
const visible=l=>l.waitFor({state:'visible'});
const status=(a,text)=>visible(a.page.getByRole('status').filter({hasText:text}));
async function actor(label,mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:393,height:851}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();external.push(new URL(r.request().url()).origin);return r.abort();});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push({label,message:e.message}));page.on('console',m=>{if(m.type()==='error')errors.push({label,message:m.text()});});
 const a={label,context,page};actors.push(a);return a;
}
async function workspace(a,staff=false){const r=await a.context.request.get(base+'/api/v1/'+(staff?'staff/':'')+'workspace');assert.equal(r.status(),200);return r.json();}
async function mutate(a,route,data,method='POST'){const s=await(await a.context.request.get(base+'/api/v1/session')).json();return a.context.request.fetch(base+'/api/v1/'+route,{method,headers:{origin:base,'x-csrf-token':s.csrfToken,'idempotency-key':randomUUID()},data});}
async function check(name,fn){try{await fn();steps.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){steps.push({name,status:'FAIL',error:e.message});await actors.at(-1)?.page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});throw e;}finally{await writeFile(dir+'/progress.json',JSON.stringify({steps},null,2));}}
function csv(books){const header='sku,isbn13,title,author,format,language,price_minor,currency,on_hand,shelf,stock_observed_at,units_sold_90d';const cell=x=>'"'+String(x).replaceAll('"','""')+'"';return header+'\n'+books.map(b=>[b.sku,b.isbn13,b.title,b.author,b.format,b.language,b.priceMinor,b.currency,b.onHand,b.shelf,new Date().toISOString(),b.unitsSold90d].map(cell).join(',')).join('\n');}
async function upload(a,books){await a.page.getByRole('button',{name:'Your inventory',exact:true}).click();await a.page.getByLabel('Upload inventory CSV').setInputFiles({name:'duplicate-editions.csv',mimeType:'text/csv',buffer:Buffer.from(csv(books))});await status(a,'CSV preview ready');await a.page.getByRole('button',{name:'Activate valid rows',exact:true}).click();await status(a,'Inventory snapshot activated');}
async function find(a){await a.page.getByLabel('Search a film or musician').fill('Spirited');await a.page.getByRole('button',{name:'Spirited Away Film',exact:true}).click();await a.page.getByLabel('Your budget in dollars').fill('25');await a.page.getByRole('button',{name:'Find my next read',exact:true}).click();await visible(a.page.locator('.recommendation-card').first());}
async function settled(a){await a.page.getByRole('button',{name:'Find my next read',exact:true}).waitFor();await a.page.waitForFunction(()=>!document.querySelector('.find-button')?.disabled);}
let own,curator,visitor,other,seed,firstSelection,qr;
try{
 own=await actor('owner');
 await check('B01 owner previews and activates a duplicate-edition CSV',async()=>{
  await own.page.goto(base);await own.page.getByRole('button',{name:'Try a bookstore demo',exact:true}).click();await visible(own.page.getByRole('heading',{name:'Good books deserve another chance.',exact:true}));
  const w=await workspace(own),paper={...w.books[0],priceMinor:1200},hard={...paper,sku:'PIRANESI-HARDBACK',format:'hardback',priceMinor:1900};
  seed=[paper,hard,w.books[1],w.books[2]];await writeFile(dir+'/seed.csv',csv(seed));await upload(own,seed);assert.equal((await workspace(own)).books.length,4);await own.page.screenshot({path:dir+'/owner-import.png',fullPage:true});
 });
 await check('B02 owner confirms common identity and proposes only the cheapest edition',async()=>{
  await own.page.locator('tbody tr').filter({hasText:'hardback'}).getByRole('button',{name:'Review match',exact:true}).click();await own.page.getByLabel('Candidate identity').selectOption(seed[0].entityId);await own.page.getByRole('button',{name:'Confirm identity',exact:true}).click();await status(own,'Identity confirmed');
  await own.page.getByRole('button',{name:'Cultural displays',exact:true}).click();await own.page.getByRole('button',{name:'Remove missing selections',exact:true}).click();await own.page.locator('.selection-row').filter({hasText:'Piranesi'}).filter({hasText:'19.00'}).getByRole('checkbox').check();await own.page.getByRole('button',{name:'Save draft',exact:true}).click();await status(own,'Draft saved');
  await own.page.getByRole('button',{name:'Generate cultural proposal',exact:true}).click();await status(own,'Cultural proposal ready');firstSelection=(await workspace(own)).campaigns.at(-1).candidateSkus;
  assert.ok(firstSelection.includes('PIRANESI'));assert.ok(!firstSelection.includes('PIRANESI-HARDBACK'));await own.page.screenshot({path:dir+'/owner-proposal.png',fullPage:true});
 });
 await check('B03 independent curator imports the same editions in reverse order',async()=>{
  const r=await mutate(own,'memberships',{identityId:'Edition test curator',permissions:['inventory_review','campaign_draft']});assert.equal(r.status(),201);const invitation=await r.json();
  curator=await actor('curator');await curator.page.goto(invitation.inviteUrl);await visible(curator.page.getByRole('heading',{name:'Staff workspace',exact:true}));assert.ok(!(await curator.context.cookies()).some(c=>c.name==='ss_merchant'));
  await upload(curator,[...seed].reverse());const w=await workspace(curator,true);assert.equal(w.books.find(b=>b.sku==='PIRANESI-HARDBACK').entityId,seed[0].entityId);await curator.page.screenshot({path:dir+'/curator-reversed-import.png',fullPage:true});
 });
 await check('B04 reordered proposal is stable; owner explicitly approves both eligible editions for rejection test',async()=>{
  await own.page.reload();await own.page.getByRole('button',{name:'Cultural displays',exact:true}).click();
  await own.page.locator('.selection-row').filter({hasText:'Piranesi'}).filter({hasText:'19.00'}).getByRole('checkbox').check();await own.page.getByRole('button',{name:'Save draft',exact:true}).click();await status(own,'Draft saved');
  await own.page.getByRole('button',{name:'Generate cultural proposal',exact:true}).click();await status(own,'Cultural proposal ready');assert.deepEqual((await workspace(own)).campaigns.at(-1).candidateSkus,firstSelection);
  await own.page.locator('.selection-row').filter({hasText:'Piranesi'}).filter({hasText:'19.00'}).getByRole('checkbox').check();await own.page.getByRole('button',{name:'Save draft',exact:true}).click();await status(own,'Draft saved');
  await own.page.getByRole('button',{name:'Approve display',exact:true}).click();await status(own,'Display approved');await own.page.getByRole('button',{name:'Activate display',exact:true}).click();await status(own,'Display is active');
  qr=await own.page.getByRole('link',{name:'Open shopper experience',exact:true}).getAttribute('href');assert.ok(qr.startsWith(base));assert.ok((await workspace(own)).campaigns.at(-1).candidateSkus.includes('PIRANESI-HARDBACK'));
 });
 await check('B05 mobile Chromium shopper sees one Piranesi at the cheaper price',async()=>{
  visitor=await actor('mobile-shopper',true);await visitor.page.goto(qr);await visible(visitor.page.getByRole('button',{name:'Find my next read',exact:true}));await find(visitor);
  const card=visitor.page.locator('.recommendation-card').filter({has:visitor.page.getByRole('heading',{name:'Piranesi',exact:true})});assert.equal(await card.count(),1);assert.match(await card.innerText(),/\$12\.00/);
  await visitor.page.screenshot({path:dir+'/mobile-cheapest-edition.png',fullPage:true});
 });
 await check('B06 rejected work stays absent after repeated discovery and page reload',async()=>{
  await visitor.page.locator('.recommendation-card').filter({hasText:'Piranesi'}).getByRole('button',{name:'Try another',exact:true}).click();await settled(visitor);await visible(visitor.page.locator('.recommendation-card').first());assert.equal(await visitor.page.locator('.recommendation-card').filter({hasText:'Piranesi'}).count(),0);
  await visitor.page.getByRole('button',{name:'Find my next read',exact:true}).click();await settled(visitor);assert.equal(await visitor.page.locator('.recommendation-card').filter({hasText:'Piranesi'}).count(),0);
  await visitor.page.reload();await visible(visitor.page.getByRole('button',{name:'Find my next read',exact:true}));await find(visitor);assert.equal(await visitor.page.locator('.recommendation-card').filter({hasText:'Piranesi'}).count(),0);await visitor.page.screenshot({path:dir+'/mobile-rejected-work-absent.png',fullPage:true});
 });
 await check('B07 separate shopper unaffected; start-fresh restores choice; privacy clearing revokes session',async()=>{
  other=await actor('independent-shopper');await other.page.goto(qr);await visible(other.page.getByRole('button',{name:'Find my next read',exact:true}));await find(other);assert.equal(await other.page.locator('.recommendation-card').filter({hasText:'Piranesi'}).count(),1);
  visitor.page.once('dialog',d=>d.accept());await visitor.page.getByRole('button',{name:'Start a new unmeasured visit',exact:true}).click();await visible(visitor.page.getByText('This fresh visit is unmeasured.',{exact:false}));await find(visitor);assert.equal(await visitor.page.locator('.recommendation-card').filter({hasText:'Piranesi'}).count(),1);
  visitor.page.once('dialog',d=>d.accept());await visitor.page.getByRole('button',{name:'Forget my choices',exact:true}).click();await visible(visitor.page.getByRole('heading',{name:'Your choices were cleared',exact:true}));await visitor.page.screenshot({path:dir+'/privacy-cleared.png',fullPage:true});
  assert.equal((await visitor.context.request.get(base+'/api/v1/shopper/session')).status(),401);
 });
 await check('B08 synthetic store removed; no browser exceptions, external requests or source drift',async()=>{
  const r=await mutate(own,'store',{confirm:true},'DELETE');assert.equal(r.status(),202);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(await sourceDigest(),source);
 });
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{
 for(const a of actors)await a.context.tracing.stop({path:dir+'/'+a.label+'-trace.zip'}).catch(()=>{});
 await browser.close();await writeFile(dir+'/results.json',JSON.stringify({at:new Date().toISOString(),base,health,sourceDigest:source,oracleHash,steps,errors,external,providerCalls:0,publicWrites:0,evidence:'Local fixture Chromium desktop/mobile emulation; not physical Android or live Qloo proof'},null,2));console.log('Evidence '+dir);
}
