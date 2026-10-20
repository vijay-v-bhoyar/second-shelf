import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {sourceDigest} from './evidence.mjs';

const base=process.env.PUBLIC_DEMO_URL;
assert.equal(base,'https://second-shelf-liard.vercel.app','Only approved target');
const dir='output/playwright/public-csv-recovery-'+new Date().toISOString().replaceAll(':','-');
await mkdir(dir,{recursive:true});
const source=await sourceDigest(),oracleHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const json=(name,value)=>writeFile(dir+'/'+name,JSON.stringify(value,null,2));
const browser=await chromium.launch(),actors=[],steps=[],errors=[],cleanup=[];let own,current='setup';
async function actor(label){const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(25000);await context.tracing.start({screenshots:true,snapshots:true,sources:true});page.on('pageerror',e=>errors.push({label,message:e.message}));const a={label,context,page,posts:[],workspaceGets:0};page.on('request',r=>{const p=new URL(r.url()).pathname;if(r.method()==='POST'&&p.endsWith('/inventory-imports'))a.posts.push({key:r.headers()['idempotency-key']});if(r.method()==='GET'&&p.endsWith('/workspace'))a.workspaceGets++;});actors.push(a);return a;}
const shown=l=>l.waitFor({state:'visible',timeout:25000});
async function workspace(a,staff=false){const r=await a.context.request.get(base+'/api/v1/'+(staff?'staff/':'')+'workspace');assert.equal(r.status(),200);return r.json();}
async function mutation(a,route,data,method='POST'){const s=await(await a.context.request.get(base+'/api/v1/session')).json();return a.context.request.fetch(base+'/api/v1/'+route,{method,headers:{origin:base,'x-csrf-token':s.csrfToken,'idempotency-key':randomUUID()},data});}
async function status(a,text){await shown(a.page.getByRole('status').filter({hasText:text}));}
try{
 const h=await(await fetch(base+'/api/v1/health')).json();assert.equal(h.persistence,'hosted-postgresql');assert.equal(h.providerMode,'live');
 own=await actor('owner');await own.page.goto(base);await own.page.getByRole('button',{name:'Try a bookstore demo',exact:true}).click();await shown(own.page.getByRole('heading',{name:'Good books deserve another chance.',exact:true}));
 const grantResponse=await mutation(own,'memberships',{identityId:'CSV recovery independent curator',permissions:['inventory_review']});assert.equal(grantResponse.status(),201);const grant=await grantResponse.json(),staff=await actor('curator');await staff.page.goto(grant.inviteUrl);await shown(staff.page.getByRole('heading',{name:'Staff workspace',exact:true}));assert.equal((await staff.context.cookies()).some(c=>c.name==='ss_merchant'),false);
 for(const [a,prefix]of [[own,''],[staff,'staff/']]){
  current=a.label+' committed response loss, deliberate retry and activation';const start=Date.now();
  await a.page.getByRole('button',{name:'Your inventory',exact:true}).click();await shown(a.page.getByLabel('Upload inventory CSV'));
  const csvResponse=await a.context.request.get(base+'/api/v1/'+prefix+'sample-csv');assert.equal(csvResponse.status(),200);const csv=await csvResponse.body();
  const before=await workspace(own),auditBefore=before.audit.filter(e=>e.action==='post.inventory-imports').length,getsBefore=a.workspaceGets;
  let committed,interceptFailure;const routePattern='**/api/v1/'+prefix+'inventory-imports';
  // The real hosted server commits first. Only delivery to this test browser is delayed.
  await a.page.route(routePattern,async route=>{try{const r=await route.fetch();assert.equal(r.status(),201);committed=await r.json();await delay(17000);await route.fulfill({response:r}).catch(()=>{});}catch(e){interceptFailure=e.message;await route.abort().catch(()=>{});}},{times:1});
  const uploadAt=Date.now();await a.page.getByLabel('Upload inventory CSV').setInputFiles({name:'hosted-recovery.csv',mimeType:'text/csv',buffer:csv});
  await shown(a.page.getByRole('alert').filter({hasText:'preview response was not confirmed'}));const timeoutMs=Date.now()-uploadAt;
  assert.equal(interceptFailure,undefined);assert.ok(committed,'Hosted commit must be observed before loss');assert.equal(committed.status,'validated');assert.equal(committed.acceptedRowNumbers.length,12);assert.ok(timeoutMs>=14000&&timeoutMs<22000);
  assert.equal(a.posts.length,1,'No automatic retry');assert.deepEqual((await workspace(own)).books,before.books);assert.equal(a.workspaceGets,getsBefore);
  await a.page.screenshot({path:dir+'/'+a.label+'-uncertain.png',fullPage:true});
  await a.page.route(routePattern,async route=>{const r=await route.fetch();await delay(500);await route.fulfill({response:r});},{times:1});
  const response=a.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/'+prefix+'inventory-imports');await a.page.getByRole('button',{name:'Retry preview',exact:true}).dblclick();
  const replay=await response;assert.equal(replay.status(),201);const recovered=await replay.json();await status(a,'CSV preview ready');
  assert.equal(recovered.id,committed.id);assert.equal(a.posts.length,2);assert.equal(a.posts[0].key,a.posts[1].key);assert.equal(a.workspaceGets,getsBefore);
  const after=await workspace(own);assert.equal(after.audit.filter(e=>e.action==='post.inventory-imports').length,auditBefore+1);assert.deepEqual(after.books,before.books);assert.equal(after.importId,before.importId);
  await a.page.screenshot({path:dir+'/'+a.label+'-recovered.png',fullPage:true});
  await a.page.getByRole('button',{name:'Activate valid rows',exact:true}).click();await status(a,'Inventory snapshot activated');assert.equal(a.workspaceGets,getsBefore+1);assert.equal((await workspace(own)).importId,recovered.id);
  await a.page.screenshot({path:dir+'/'+a.label+'-activated.png',fullPage:true});
  steps.push({name:current,status:'PASS',durationMs:Date.now()-start,timeoutMs,realHostedCommit:true,samePreviewId:true,sameOperationKey:true,noDuplicateImport:true,noAutomaticActivation:true,explicitActivation:true,independentStaff:!!prefix});await json('progress.json',{steps});console.log('PASS '+current);
 }
 assert.deepEqual(errors,[]);assert.equal(await sourceDigest(),source);
}catch(e){steps.push({name:current,status:'FAIL',error:e.message});console.error(e.stack);process.exitCode=1;await actors.at(-1)?.page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});}
finally{
 if(own){try{const r=await mutation(own,'store',{confirm:true},'DELETE');cleanup.push({status:r.status()});if(r.status()!==202)process.exitCode=1;}catch(e){cleanup.push({error:e.message});process.exitCode=1;}}
 for(const a of actors)await a.context.tracing.stop({path:dir+'/'+a.label+'-trace.zip'}).catch(()=>{});await browser.close();
 const receipt={at:new Date().toISOString(),base,sourceDigest:source,oracleHash,status:process.exitCode?'FAIL':'PASS',steps,errors,cleanup,originalTransportCause:'UNKNOWN',fault:'Test browser delays delivery of a real successful hosted response; provider responses are not mocked',traces:'PRIVATE synthetic credentials; do not publish raw'};await json('results.json',receipt);console.log('Receipt '+dir+'/results.json');
}
