/* global clearTimeout, document */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {sourceDigest} from './evidence.mjs';

// A loopback proxy loses a response AFTER the real fixture server commits it.
// No response is fabricated into a successful product or provider result.
const base=process.env.DEMO_BASE_URL;
assert.ok(base&&new URL(base).hostname==='127.0.0.1','Local isolated fixture URL required');
const dir='output/playwright/csv-preview-recovery-'+new Date().toISOString().replaceAll(':','-');
await mkdir(dir,{recursive:true});
const source=await sourceDigest(),oracleHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
let inject=null,current='setup';const steps=[],actors=[],owners=[],proxyEvents=[],pageErrors=[],externalRequests=[];
const json=(file,value)=>writeFile(dir+'/'+file,JSON.stringify(value,null,2));
const proxy=createServer((incoming,outgoing)=>{
 const fault=inject&&incoming.method===inject.method&&incoming.url===inject.path?inject:null;if(fault)inject=null;
 const upstream=httpRequest(base+incoming.url,{method:incoming.method,headers:incoming.headers},response=>{
  if(!fault){outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);return;}
  const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
   const body=Buffer.concat(chunks),value=JSON.parse(body.toString());fault.complete?.(value);
   proxyEvents.push({scenario:current,status:response.statusCode,path:incoming.url,bytes:body.length,delayMs:fault.delayMs});
   const headers={...response.headers};delete headers['content-length'];outgoing.writeHead(response.statusCode,headers);outgoing.flushHeaders();
   const split=Math.max(1,Math.floor(body.length/2));outgoing.write(body.subarray(0,split));
   const timer=setTimeout(()=>{if(!outgoing.destroyed)outgoing.end(body.subarray(split));},fault.delayMs);
   outgoing.once('close',()=>clearTimeout(timer));
  });
 });
 upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});incoming.pipe(upstream);
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+proxy.address().port;
const browser=await chromium.launch();
const visible=l=>l.waitFor({state:'visible',timeout:20000});
const status=(a,text)=>visible(a.page.getByRole('status').filter({hasText:text}));
async function actor(label){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 await context.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();externalRequests.push(new URL(r.request().url()).origin);return r.abort();});
 page.on('pageerror',e=>pageErrors.push({label,message:e.message}));
 const a={label,context,page,posts:[],workspaceGets:0};
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(r.method()==='POST'&&p.endsWith('/inventory-imports'))a.posts.push({path:p,key:r.headers()['idempotency-key']});if(r.method()==='GET'&&p.endsWith('/workspace'))a.workspaceGets++;});
 actors.push(a);return a;
}
async function owner(label){const a=await actor(label);await a.page.goto(url);await a.page.getByRole('button',{name:'Try a bookstore demo',exact:true}).click();await visible(a.page.getByRole('heading',{name:'Good books deserve another chance.',exact:true}));owners.push(a);return a;}
async function workspace(a,staff=false){const r=await a.context.request.get(url+'/api/v1/'+(staff?'staff/':'')+'workspace');assert.equal(r.status(),200);return r.json();}
async function mutation(a,path,data,method='POST',key=randomUUID()){
 const s=await(await a.context.request.get(url+'/api/v1/session')).json();
 return a.context.request.fetch(url+'/api/v1/'+path,{method,headers:{origin:url,'x-csrf-token':s.csrfToken,'idempotency-key':key},data});
}
async function curator(own,label){const r=await mutation(own,'memberships',{identityId:label,permissions:['inventory_review']});assert.equal(r.status(),201);const grant=await r.json(),a=await actor(label);await a.page.goto(grant.inviteUrl);await visible(a.page.getByRole('heading',{name:'Staff workspace',exact:true}));assert.equal((await a.context.cookies()).some(c=>c.name==='ss_merchant'),false);a.grantId=grant.id;return a;}
async function inventory(a,staff=false){await a.page.getByRole('button',{name:'Your inventory',exact:true}).click();await visible(a.page.getByLabel('Upload inventory CSV'));const r=await a.context.request.get(url+'/api/v1/'+(staff?'staff/':'')+'sample-csv');assert.equal(r.status(),200);return r.body();}
async function upload(a,csv){await a.page.getByLabel('Upload inventory CSV').setInputFiles({name:'recovery.csv',mimeType:'text/csv',buffer:csv});}
function previewResponse(a){return a.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/inventory-imports'));}
function auditCount(w){return w.audit.filter(e=>e.action==='post.inventory-imports').length;}
async function check(name,fn){current=name;const start=Date.now();try{const details=await fn();steps.push({name,status:'PASS',durationMs:Date.now()-start,...details});console.log('PASS '+name);}catch(e){steps.push({name,status:'FAIL',durationMs:Date.now()-start,error:e.message});await actors.at(-1)?.page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});throw e;}finally{await json('progress.json',{steps});}}
let own,staff,csv;
try{
 const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'fixture');assert.equal(health.persistence,'embedded-postgresql');
 own=await owner('owner');staff=await curator(own,'independent-curator');csv=await inventory(own);await inventory(staff,true);
 for(const [a,prefix]of [[own,''],[staff,'staff/']])await check('R0'+(prefix?'2 Curator':'1 Owner')+' lost committed response recovers the same preview',async()=>{
  const before=await workspace(own),beforeAudit=auditCount(before);let committed;
  inject={method:'POST',path:'/api/v1/'+prefix+'inventory-imports',delayMs:17000,complete:v=>committed=v};
  const start=Date.now();await upload(a,csv);
  await visible(a.page.getByRole('alert').filter({hasText:'preview response was not confirmed'}));const elapsed=Date.now()-start;
  assert.ok(elapsed>=14000&&elapsed<20000,'Original 15s deadline retained');assert.equal(committed.status,'validated');assert.equal(committed.acceptedRowNumbers.length,12);
  assert.equal(await a.page.locator('.import-preview').count(),0);assert.equal(a.posts.length,1,'No automatic retry');
  assert.deepEqual((await workspace(own)).books,before.books,'Lost preview response must not activate stock');
  // Slow the recovery response briefly so a real double-click challenges busy UI.
  inject={method:'POST',path:'/api/v1/'+prefix+'inventory-imports',delayMs:500};
  const replay=previewResponse(a);await a.page.getByRole('button',{name:'Retry preview',exact:true}).dblclick();
  const r=await replay;assert.equal(r.status(),201);const recovered=await r.json();await status(a,'CSV preview ready');
  assert.equal(recovered.id,committed.id);assert.equal(a.posts.length,2,'Double click must issue only one retry');assert.equal(a.posts[0].key,a.posts[1].key);
  const after=await workspace(own);assert.equal(auditCount(after),beforeAudit+1,'Same-key replay must not create a second import/audit operation');
  assert.deepEqual(after.books,before.books);assert.equal(after.importId,before.importId);
  assert.equal(await a.page.getByRole('button',{name:'Retry preview',exact:true}).count(),0);
  await a.page.screenshot({path:dir+'/'+a.label+'-recovered.png',fullPage:true});
  return{timeoutMs:elapsed,samePreviewId:true,sameOperationKey:true,noExtraImportOperation:true,noActivation:true,independentStaff:!!prefix};
 });
 await check('R03 Owner preview has no workspace dependency; activation still refreshes',async()=>{
  const beforeGets=own.workspaceGets,replay=previewResponse(own);await upload(own,csv);const r=await replay;assert.equal(r.status(),201);await status(own,'CSV preview ready');await delay(300);
  assert.equal(own.workspaceGets,beforeGets,'Preview must not request workspace');
  const preview=await r.json();await own.page.getByRole('button',{name:'Activate valid rows',exact:true}).click();await status(own,'Inventory snapshot activated');
  assert.equal(own.workspaceGets,beforeGets+1);assert.equal((await workspace(own)).importId,preview.id);return{previewWorkspaceGets:0,activationWorkspaceGets:1};
 });
 await check('R04 Curator preview has no workspace dependency; activation still refreshes',async()=>{
  const beforeGets=staff.workspaceGets,rp=previewResponse(staff);await upload(staff,csv);const r=await rp;await status(staff,'CSV preview ready');assert.equal(staff.workspaceGets,beforeGets);
  const preview=await r.json();await staff.page.getByRole('button',{name:'Activate valid rows',exact:true}).click();await status(staff,'Inventory snapshot activated');assert.equal(staff.workspaceGets,beforeGets+1);assert.equal((await workspace(own)).importId,preview.id);
 });
 for(const [a,role]of [[own,'Owner'],[staff,'Curator']])await check('R05 '+role+' received CSV validation error, discard, corrected replacement key',async()=>{
  const before=await workspace(own),posts=a.posts.length,rp=previewResponse(a);await upload(a,Buffer.from('wrong,headers\nx,y'));assert.equal((await rp).status(),400);
  const validation=a.page.getByRole('alert').filter({hasText:'Required columns'});await visible(validation);assert.doesNotMatch(await validation.innerText(),/not confirmed/);
  await visible(a.page.getByRole('region',{name:'Pending CSV preview'}).or(a.page.locator('[aria-label="Pending CSV preview"]')));
  const rejectedKey=a.posts.at(-1).key,previewPosts=a.posts.length;
  await a.page.getByRole('button',{name:'Discard pending preview',exact:true}).click();assert.equal(await a.page.getByRole('button',{name:'Retry preview',exact:true}).count(),0);assert.equal(a.posts.length,previewPosts);
  assert.deepEqual((await workspace(own)).books,before.books);
  const corrected=previewResponse(a);await upload(a,csv);await corrected;await status(a,'CSV preview ready');assert.notEqual(a.posts.at(-1).key,rejectedKey);assert.equal(a.posts.length,posts+2);
 });
 await check('R06 Replacement after network loss uses a new key; changed payload under old key conflicts',async()=>{
  await own.page.route('**/api/v1/inventory-imports',r=>r.abort('failed'),{times:1});
  await upload(own,csv);await visible(own.page.getByRole('alert').filter({hasText:'preview response was not confirmed'}));const lost=own.posts.at(-1).key;
  const changed=Buffer.concat([csv,Buffer.from('\n')]),rp=previewResponse(own);await upload(own,changed);await rp;await status(own,'CSV preview ready');assert.notEqual(own.posts.at(-1).key,lost);
  // Use a successfully recorded operation to challenge the existing server fingerprint.
  const s=await(await own.context.request.get(url+'/api/v1/session')).json();const conflict=await own.context.request.post(url+'/api/v1/inventory-imports',{headers:{origin:url,'x-csrf-token':s.csrfToken,'idempotency-key':own.posts.at(-1).key},multipart:{file:{name:'changed.csv',mimeType:'text/csv',buffer:csv}}});assert.equal(conflict.status(),409);
 });
 await check('R07 Rejected rows cannot activate; stale preview activation remains a conflict',async()=>{
  const lines=csv.toString().trim().split('\n'),headers=lines[0].replace(/\r$/,'').split(','),row=lines[1].replace(/\r$/,'').split(',');assert.ok(headers.includes('on_hand'));row[headers.indexOf('on_hand')]='-1';
  let rp=previewResponse(own);await upload(own,Buffer.from(lines[0]+'\n'+row.join(',')));const rejected=await(await rp).json();assert.equal(rejected.acceptedRowNumbers.length,0);await status(own,'CSV preview ready');assert.equal(await own.page.getByRole('button',{name:'Activate valid rows',exact:true}).isDisabled(),true);
  rp=previewResponse(own);await upload(own,csv);await rp;await status(own,'CSV preview ready');const before=await workspace(own),book=before.books[0];assert.equal((await mutation(own,'inventory/'+encodeURIComponent(book.sku),{expectedRevision:book.revision,onHand:book.onHand+1},'PATCH')).status(),200);
  const commit=own.page.waitForResponse(r=>r.url().includes('/commit')&&r.request().method()==='POST');await own.page.getByRole('button',{name:'Activate valid rows',exact:true}).click();assert.equal((await commit).status(),409);await visible(own.page.locator('.notice.error[role="alert"]'));assert.equal((await workspace(own)).importId,before.importId);
 });
 await check('R08 Revoked curator cannot recover a pending operation',async()=>{
  const rp=previewResponse(staff);await upload(staff,Buffer.from('wrong,headers\nx,y'));await rp;await visible(staff.page.getByRole('button',{name:'Retry preview',exact:true}));
  assert.equal((await mutation(own,'memberships/'+staff.grantId,{},'DELETE')).status(),200);
  const denied=previewResponse(staff);await staff.page.getByRole('button',{name:'Retry preview',exact:true}).click();assert.equal((await denied).status(),401);await visible(staff.page.getByRole('heading',{name:'Sample staff access unavailable',exact:true}));
  assert.equal((await staff.context.request.get(url+'/api/v1/staff/workspace')).status(),401);
 });
 await check('R09 Keyboard recovery controls and narrow viewport remain usable',async()=>{
  await own.page.setViewportSize({width:390,height:844});await own.page.route('**/api/v1/inventory-imports',r=>r.abort('failed'),{times:1});await upload(own,csv);await visible(own.page.getByRole('button',{name:'Retry preview',exact:true}));
  const discard=own.page.getByRole('button',{name:'Discard pending preview',exact:true});await discard.focus();assert.equal(await discard.evaluate(e=>e===document.activeElement),true);await own.page.keyboard.press('Enter');assert.equal(await discard.count(),0);await own.page.screenshot({path:dir+'/narrow-inventory.png',fullPage:true});
 });
 assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.equal(await sourceDigest(),source);
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{
 const cleanup=[];for(const a of owners){try{const r=await mutation(a,'store',{confirm:true},'DELETE');cleanup.push({actor:a.label,status:r.status()});if(r.status()!==202)process.exitCode=1;}catch(e){cleanup.push({actor:a.label,error:e.message});process.exitCode=1;}}
 for(const a of actors)await a.context.tracing.stop({path:dir+'/'+a.label+'-trace.zip'}).catch(()=>{});await browser.close();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));
 const receipt={at:new Date().toISOString(),base,proxy:url,sourceDigest:source,oracleHash,status:process.exitCode?'FAIL':'PASS',steps,proxyEvents,pageErrors,externalRequests,cleanup,providerMode:'fixture',publicWrites:0,providerCalls:0,originalTransportCause:'UNKNOWN',traces:'PRIVATE synthetic credentials; do not publish raw traces'};await json('results.json',receipt);console.log('Receipt '+dir+'/results.json');
}
