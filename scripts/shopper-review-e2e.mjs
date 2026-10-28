/* global document, Node */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {sourceDigest} from './evidence.mjs';
const base=process.env.DEMO_BASE_URL,dir=process.env.SS_INVENTORY_EVIDENCE;
assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&dir);
await mkdir(dir,{recursive:true});
const source=await sourceDigest(),steps=[],errors=[],external=[],expectedErrors=[],contexts=[];
const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'fixture');
const browser=await chromium.launch();let injection=false,retiredUrl="";const failedResponses=[];
const visible=l=>l.waitFor({state:'visible'}),button=(p,name)=>p.getByRole('button',{name,exact:true});
async function actor(mobile=false){
 const c=await browser.newContext({viewport:mobile?{width:393,height:851}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});contexts.push(c);
 await c.tracing.start({screenshots:true,snapshots:true,sources:true});
 await c.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();external.push(r.request().url());return r.abort();});
 const p=await c.newPage();p.setDefaultTimeout(15000);p.on('response',r=>{if(r.status()>=400)failedResponses.push({status:r.status(),url:r.url()});});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'){if((injection&&/status of 503/.test(m.text()))||(retiredUrl&&m.location().url===retiredUrl&&/status of 404/.test(m.text())))expectedErrors.push(m.text());else errors.push(m.text());}});return {c,p};
}
async function check(name,fn){try{await fn();steps.push({name,status:'PASS'});}catch(e){steps.push({name,status:'FAIL',error:e.message});throw e;}finally{console.log(steps.at(-1).status+' '+name);await writeFile(dir+'/progress.json',JSON.stringify(steps,null,2));}}
async function post(c,path,data,method='POST'){const s=await(await c.request.get(base+'/api/v1/session')).json();const r=await c.request.fetch(base+'/api/v1/'+path,{method,headers:{origin:base,'x-csrf-token':s.csrfToken,'idempotency-key':randomUUID()},data});assert.ok(r.ok(),path+' '+r.status());return r.json();}
async function select(p){await p.getByLabel('Search a film or musician').fill('Spirited');await button(p,'Spirited Away Film').click();}
async function results(p){await visible(p.getByRole('region',{name:'Inputs used for these results'}));await visible(button(p,'Find my next read'));await p.waitForFunction(()=>!document.querySelector('.find-button')?.disabled);}
let shopper,owner;
try{
 owner=await actor();await owner.p.goto(base);await button(owner.p,'Try a bookstore demo').click();await visible(owner.p.getByRole('heading',{name:'Good books deserve another chance.',exact:true}));
 await button(owner.p,'Cultural displays').click();await button(owner.p,'Approve display').click();await visible(owner.p.getByRole('status').filter({hasText:'Display approved'}));await button(owner.p,'Activate display').click();await visible(owner.p.getByRole('status').filter({hasText:'Display is active'}));
 const url=await owner.p.getByRole('link',{name:'Open shopper experience',exact:true}).getAttribute('href');assert.ok(url.startsWith(base));
 shopper=await actor(true);const {p,c}=shopper;await p.goto(url);await visible(button(p,'Find my next read'));
 await check('S01 supported search clears stale choices and validates budget bounds',async()=>{
  await p.getByLabel('Search a film or musician').fill('Spirited');await visible(button(p,'Spirited Away Film'));await p.getByLabel('Search a film or musician').fill('zzzz-no-match');assert.equal(await button(p,'Spirited Away Film').count(),0);await visible(p.getByText('No matches yet. Try a supported name.',{exact:true}));
  await select(p);await p.getByLabel('Your budget in dollars').fill('10001');assert.equal(await button(p,'Find my next read').isDisabled(),true);await visible(p.getByRole('alert').filter({hasText:'Enter a budget'}));await p.getByLabel('Your budget in dollars').fill('25');
 });
 await check('S02 mobile results identify actual inputs and visible dated evidence',async()=>{
  await button(p,'Find my next read').click();await results(p);const n=await p.locator('.recommendation-card').count();assert.ok(n>0&&n<=3);
  const summary=p.getByRole('region',{name:'Inputs used for these results'});assert.match(await summary.innerText(),/Spirited Away.*\$25\.00 USD/s);assert.equal(await p.getByLabel('Search a film or musician').count(),0);
  await visible(p.getByText('ILLUSTRATIVE MATCHES',{exact:true}));assert.match(await p.locator('.evidence-time').first().innerText(),/Stock snapshot \(UTC\): \d{4}-\d{2}-\d{2}T/);assert.equal(await p.locator('details[open]').count(),0);
  assert.equal(await p.evaluate(()=>document.activeElement?.tagName),'H2');assert.ok(await summary.evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('.discovery-results'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  await p.screenshot({path:dir+'/mobile-results.png',fullPage:true});
 });
 await check('S03 edit-return keeps prior measured inputs explicit and hides old card actions',async()=>{
  await button(p,'Edit interests or budget').click();await p.getByLabel('Your budget in dollars').fill('10001');await button(p,'Return to results').click();assert.equal(await button(p,'Find my next read').isDisabled(),true);await button(p,'Edit interests or budget').click();await p.getByLabel('Your budget in dollars').fill('0');assert.equal(await p.locator('.recommendation-card').count(),0);assert.match(await p.getByRole('region',{name:'Inputs used for these results'}).innerText(),/\$25\.00/);
  await button(p,'Return to results').click();assert.ok(await p.locator('.recommendation-card').count()>0);await button(p,'Find my next read').click();await results(p);assert.equal(await p.locator('.recommendation-card').count(),0);assert.match(await p.getByRole('region',{name:'Inputs used for these results'}).innerText(),/\$0\.00/);await visible(p.getByText('Edit your interests or budget to try again.',{exact:false}));
  await button(p,'Edit interests or budget').click();await p.getByLabel('Your budget in dollars').fill('25');await button(p,'Find my next read').click();await results(p);
 });
 await check('S04 accepted request recovers by readback without another enqueue',async()=>{
  let enqueues=0,fail=true;
  await c.route('**/api/v1/shopper/recommendations',async r=>{enqueues++;const response=await r.fetch();const job=await response.json();await r.fulfill({response,json:{...job,status:'queued',result:undefined}});});
  injection=true;await c.route('**/api/v1/jobs/*',async r=>{if(fail){fail=false;return r.fulfill({status:503,json:{message:'Synthetic interrupted status read'}});}return r.continue();});
  await button(p,'Find my next read').click();await visible(button(p,'Check existing request'));await visible(p.getByRole('alert').filter({hasText:'Synthetic interrupted'}));assert.equal(await p.locator('.recommendation-card').count(),0);
  await button(p,'Check existing request').click();await results(p);assert.equal(enqueues,1);assert.ok(await p.locator('.recommendation-card').count()>0);assert.equal(await button(p,'Check existing request').count(),0);
  await c.unroute('**/api/v1/jobs/*');await c.unroute('**/api/v1/shopper/recommendations');injection=false;
 });
 await check('S05 failed and late job readbacks show no fabricated books and permit a fresh search',async()=>{
  await c.route('**/api/v1/shopper/recommendations',async r=>{const response=await r.fetch();const job=await response.json();await r.fulfill({response,json:{...job,status:'failed',error:{message:'Synthetic ranking failure'}}});});
  await button(p,'Find my next read').click();await visible(p.getByRole('alert').filter({hasText:'Synthetic ranking failure'}));assert.equal(await p.locator('.recommendation-card').count(),0);await c.unroute('**/api/v1/shopper/recommendations');
  await c.route('**/api/v1/shopper/recommendations',async r=>{const response=await r.fetch();const job=await response.json();await r.fulfill({response,json:{...job,status:'queued',deadlineAt:new Date(Date.now()-10000).toISOString()}});});
  await button(p,'Find my next read').click();await visible(p.getByRole('alert').filter({hasText:'taking too long'}));await c.unroute('**/api/v1/shopper/recommendations');await button(p,'Check existing request').click();await results(p);
 });
 await check('S06 immediate counter and rejection guards allow one in-flight action',async()=>{
  let interest=0,reject=0,codes=0;
  await c.route('**/api/v1/shopper/events',async r=>{const kind=r.request().postDataJSON().type;if(kind==='interest'||kind==='reject'){if(kind==='interest')interest++;else reject++;await new Promise(resolve=>setTimeout(resolve,200));}await r.continue();});
  await c.route('**/api/v1/shopper/purchase-code',async r=>{codes++;await r.continue();});
  await button(p,'Show at counter').first().evaluate(el=>{el.click();el.click();});await visible(p.getByRole('region',{name:'Your counter code'}));await results(p);assert.equal(interest,1);assert.equal(codes,1);
  const rejected=await p.locator('.recommendation-card h3').first().innerText();await button(p,'Try another').first().evaluate(el=>{el.click();el.click();});await results(p);assert.equal(reject,1);assert.equal(await p.getByRole('heading',{name:rejected,exact:true}).count(),0);assert.equal(await p.getByRole('region',{name:'Your counter code'}).count(),0);
  await c.unroute('**/api/v1/shopper/events');await c.unroute('**/api/v1/shopper/purchase-code');
 });
 await check('S07 unknown provider configuration and simulation result labels stay honest',async()=>{
  await c.route('**/api/v1/public/campaigns/*',async r=>{if(r.request().method()!=='GET')return r.continue();const response=await r.fetch();await r.fulfill({response,json:{...await response.json(),providerMode:'unconfigured'}});});
  await p.reload();await visible(p.getByText('Qloo connection is not verified for this display.',{exact:false}));assert.equal(await p.getByText('Live Qloo is connected.',{exact:false}).count(),0);await c.unroute('**/api/v1/public/campaigns/*');
  await select(p);await c.route('**/api/v1/jobs/*',async r=>{const response=await r.fetch();const job=await response.json();await r.fulfill({response,json:job.result?{...job,result:{...job.result,evidenceMode:'simulation'}}:job});});
  await button(p,'Find my next read').click();await results(p);await visible(p.getByText('SIMULATED COMPARISON',{exact:true}));assert.equal(await p.getByText('QLOO RANKED',{exact:true}).count(),0);await c.unroute('**/api/v1/jobs/*');
 });
 await check('S08 frozen visit empty state preserves original inputs and directs an unmeasured restart',async()=>{
  await c.route('**/api/v1/public/campaigns/*/sessions',async r=>{const response=await r.fetch();const visit=await response.json();await r.fulfill({response,json:{...visit,frozenPreferences:{interests:[{id:'synthetic-frozen-id',name:'Original synthetic film'}],budgetMinor:0}}});});
  await c.route('**/api/v1/jobs/*',async r=>{const response=await r.fetch();const job=await response.json();await r.fulfill({response,json:job.result?{...job,result:{...job.result,items:[],evidenceMode:'simulation',emptyReason:'Synthetic frozen empty result'}}:job});});
  await button(p,'Find my next read').click();await results(p);assert.match(await p.getByRole('region',{name:'Inputs used for these results'}).innerText(),/Original synthetic film.*\$0\.00/s);await visible(p.getByText('Start a new unmeasured visit to change your original interests or budget.',{exact:false}));await button(p,'Review original inputs').click();assert.equal(await p.getByLabel('Your budget in dollars').isDisabled(),true);assert.equal(await p.getByLabel('Search a film or musician').isDisabled(),true);
  await c.unroute('**/api/v1/jobs/*');await c.unroute('**/api/v1/public/campaigns/*/sessions');
 });
 await check('S09 initial load retry recovers; retired display still permits privacy clearing',async()=>{
  injection=true;let once=true;await c.route('**/api/v1/public/campaigns/*',async r=>{if(r.request().method()==='GET'&&once){once=false;return r.fulfill({status:503,json:{message:'Synthetic opening failure'}});}return r.continue();});
  await p.reload();await visible(button(p,'Retry opening display'));await button(p,'Retry opening display').click();await visible(button(p,'Find my next read'));await c.unroute('**/api/v1/public/campaigns/*');
  const w=await(await owner.c.request.get(base+'/api/v1/workspace')).json(),campaign=w.campaigns.find(x=>x.state==='active');await post(owner.c,`campaigns/${campaign.id}/retire`,{expectedRevision:campaign.revision});retiredUrl=base+'/api/v1/public/campaigns/'+new URL(url).pathname.split('/').at(-1);
  await p.reload();await visible(p.getByRole('heading',{name:'This display is unavailable',exact:true}));p.once('dialog',d=>d.accept());await button(p,'Forget my choices').click();await visible(p.getByRole('heading',{name:'Your choices were cleared',exact:true}));assert.equal((await c.request.get(base+'/api/v1/shopper/session')).status(),401);injection=false;
 });
 await check('S10 local source stable, no external calls or unexpected browser errors',async()=>{assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.equal(failedResponses.length,3);assert.ok(failedResponses[0].status===503&&failedResponses[0].url.startsWith(base+'/api/v1/jobs/'));assert.deepEqual(failedResponses.slice(1),[{status:503,url:retiredUrl},{status:404,url:retiredUrl}]);assert.equal(await sourceDigest(),source);await post(owner.c,'store',{confirm:true},'DELETE');});
}catch(e){console.error(e.stack);process.exitCode=1;await shopper?.p.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});}
finally{for(const [i,c] of contexts.entries())await c.tracing.stop({path:dir+`/actor-${i}-trace.zip`}).catch(()=>{});await browser.close();await writeFile(dir+'/results.json',JSON.stringify({at:new Date().toISOString(),sourceDigest:source,oracleHash:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),health,steps,errors,expectedErrors,failedResponses,external,providerCalls:0,spend:0,evidence:'Local synthetic Chromium mobile emulation; explicit intercepted failure/provenance/frozen-response fixtures; no real provider, measurement or human acceptance proof'},null,2));}
