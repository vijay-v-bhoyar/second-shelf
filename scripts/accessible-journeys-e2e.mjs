/* global document, window, chrome, innerWidth, innerHeight, devicePixelRatio, visualViewport, getComputedStyle */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import jsQR from 'jsqr';
import {sourceDigest} from './evidence.mjs';
const base=process.env.DEMO_BASE_URL,dir=process.env.SS_INVENTORY_EVIDENCE;
assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&dir);await mkdir(dir,{recursive:true});
const source=await sourceDigest(),steps=[],errors=[],external=[],zooms=[],layouts=[],consoleErrors=[],expectedConsoleErrors=[];
const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'fixture');
const extension=await mkdtemp(path.join(os.tmpdir(),'ss-accessibility-'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Second Shelf isolated native zoom test',version:'1.0',permissions:['tabs'],background:{service_worker:'worker.js'}}));
await writeFile(path.join(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
let context,page,worker,actorId=0;
const button=name=>page.getByRole('button',{name,exact:true}),visible=l=>l.waitFor({state:'visible'});
async function openActor(state){
 if(context){await context.tracing.stop({path:dir+`/actor-${actorId}-trace.zip`});await context.close();}
 context=await chromium.launchPersistentContext(path.join(extension,'profile-'+(++actorId)),{headless:true,channel:'chromium',viewport:{width:1440,height:1000},reducedMotion:'reduce',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 if(state)await context.addCookies(state.cookies);
 worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();external.push(r.request().url());return r.abort();});
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()!=='error')return;const url=m.location().url;if(url.startsWith(base+'/api/v1/')&&/401|404/.test(m.text())&&(/\/workspace$/.test(url)||url.includes('/public/')))expectedConsoleErrors.push({url:url.replace(/\/public\/.*/, '/public/[synthetic-id]'),message:m.text()});else consoleErrors.push(m.text());});
}
async function check(name,fn){try{await fn();steps.push({name,status:'PASS'});}catch(e){steps.push({name,status:'FAIL',error:e.message});await page.screenshot({path:dir+'/failure-'+steps.length+'.png',fullPage:true}).catch(()=>{});}finally{console.log(steps.at(-1).status+' '+name);await writeFile(dir+'/progress.json',JSON.stringify(steps,null,2));}}
async function zoom(value){
 const result=await worker.evaluate(async({base,value})=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url?.startsWith(base));if(!tab)throw new Error('Owned local tab missing');await chrome.tabs.setZoom(tab.id,value);return chrome.tabs.getZoom(tab.id);},{base,value});
 await page.waitForFunction(f=>Math.abs(window.devicePixelRatio-f)<.01,value);return result;
}
async function scan(name){
 await zoom(1);
 for(const width of [360,768,1440]){await page.setViewportSize({width,height:1000});const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));layouts.push({name,width,...dims});assert.ok(dims.scroll<=dims.width+1,`${name} page overflow at ${width}: ${dims.scroll}`);}
 const before=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale}));assert.equal(await zoom(2),2);
 const after=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale,scroll:document.documentElement.scrollWidth}));zooms.push({name,before,after,factor:2,method:'Isolated Chromium extension chrome.tabs.setZoom; native browser zoom, not CSS or deviceScaleFactor'});
 assert.equal(after.width,before.width/2);assert.equal(after.dpr,2);assert.equal(after.scale,1);assert.ok(after.scroll<=after.width+1,name+' native zoom overflow');
 const primary=page.locator('main button:not([disabled]),main a[href]').first();if(await primary.count()){await primary.focus();await primary.scrollIntoViewIfNeeded();const rect=await primary.boundingBox(),viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert.ok(rect&&rect.x>=-1&&rect.x+rect.width<=viewport.w+1&&rect.y>=-1&&rect.y<viewport.h,name+' primary action unreachable at native zoom');}
 const cdp=await context.newCDPSession(page),metrics=await cdp.send('Page.getLayoutMetrics');const size=metrics.contentSize;zooms.at(-1).captureMetrics={device:size,css:metrics.cssContentSize};const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});await writeFile(dir+'/'+name+'-zoom200.png',Buffer.from(capture.data,'base64'));await cdp.detach();await zoom(1);await page.setViewportSize({width:360,height:800});
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();await writeFile(dir+'/'+name+'-axe.json',JSON.stringify(axe,null,2));assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name+' axe');
}
async function workspace(prefix=''){const r=await context.request.get(base+'/api/v1/'+prefix+'workspace');assert.equal(r.status(),200);return r.json();}
async function mutate(route,data,method='POST'){const s=await(await context.request.get(base+'/api/v1/session')).json();const r=await context.request.fetch(base+'/api/v1/'+route,{method,headers:{origin:base,'x-csrf-token':s.csrfToken,'idempotency-key':randomUUID()},data});assert.ok(r.ok(),route+' '+r.status());return r.json();}
let ownerState,shopperUrl,grants=[];
try{
 await openActor();await page.goto(base);
 await check('V01 landing responsive, native zoom and automated accessibility',()=>scan('landing'));
 await check('K01 skip navigation reaches main content using keyboard',async()=>{await page.reload();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to main content');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main-content');});
 await button('Try a bookstore demo').click();await visible(page.getByRole('heading',{name:'Good books deserve another chance.',exact:true}));
 for(const [tab,name]of [['Overview','overview'],['Your inventory','inventory'],['Cultural displays','display-draft'],['Bookseller rules','rules-empty'],['Weekly review','review-unloaded'],['Data & privacy','access']]){
  await button(tab).click();await check('V '+name+' responsive, zoom and accessibility',()=>scan(name));
 }
 await button('Your inventory').click();
 await check('K02 identity review opens at its heading and closes to the initiating row',async()=>{
  const target=button('Review match').first();await target.focus();await page.keyboard.press('Enter');await visible(page.getByRole('region',{name:'Review book identity'}));assert.match(await page.evaluate(()=>document.activeElement.textContent),/Review book identity/);await button('Close identity review').click();assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Review match');
 });
 await button('Weekly review').click();
 await check('K03 Apply review period focuses the applied result heading',async()=>{await button('Apply review period').click();await visible(page.getByRole('region',{name:'Applied activity results'}));assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Activity in the applied period');});
 await check('K05 primary action hit area and rendered focus indicator contrast',async()=>{
  await button('Apply review period').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Apply review period');const style=await button('Apply review period').evaluate(el=>{const s=getComputedStyle(el);return{outline:s.outlineColor,outlineWidth:parseFloat(s.outlineWidth),outlineStyle:s.outlineStyle,height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,paper:getComputedStyle(document.body).backgroundColor};});
  const lum=c=>{const [r,g,b]=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
  const values=[lum(style.outline),lum(style.paper)].sort((a,b)=>b-a),ratio=(values[0]+.05)/(values[1]+.05);await writeFile(dir+'/rendered-focus.json',JSON.stringify({...style,contrastAgainstPaper:ratio},null,2));assert.ok(style.outlineWidth>=2&&style.outlineStyle!=='none');assert.ok(ratio>=3);assert.ok(style.height>=44&&style.width>=44);
 });
 await check('V06 applied review with count definitions and empty ledger' ,()=>scan('review-applied'));
 await button('Bookseller rules').click();await page.getByLabel('Book to exclude',{exact:true}).selectOption((await workspace()).books.at(-1).sku);await button('Test and save rule').click();await visible(page.getByRole('status').filter({hasText:'Rule saved'}));await check('V07 saved rule examples and expiry',()=>scan('rules-saved'));
 await button('Cultural displays').click();await button('Approve display').click();await visible(page.getByRole('status').filter({hasText:'Display approved'}));await button('Activate display').click();await visible(page.getByRole('status').filter({hasText:'Display is active'}));shopperUrl=await page.getByRole('link',{name:'Open shopper experience',exact:true}).getAttribute('href');
 await check('V10 QR decodes to active destination with visible non-QR and print alternatives',async()=>{
  const img=page.getByAltText('QR code for the active bookstore discovery page');await visible(img);await page.waitForFunction(()=>document.querySelector('.qr-panel img')?.complete);
  const pixels=await img.evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=el.naturalWidth;canvas.height=el.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(el,0,0);return{width:canvas.width,height:canvas.height,data:[...ctx.getImageData(0,0,canvas.width,canvas.height).data]};});
  assert.equal(jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height)?.data,shopperUrl);
  const card=page.locator('.qr-panel');assert.match(await card.innerText(),/Browse the shelves|browse without scanning/);assert.match(await card.innerText(),/Juniper & Ink/);assert.match(await card.innerText(),/version|Version/);
  await page.emulateMedia({media:'print'});assert.equal(await page.getByRole('link',{name:'Open shopper experience',exact:true}).isVisible(),true);assert.match(await card.innerText(),/local demo on this computer/);assert.match(await card.innerText(),/no longer be active|may change|may be retired/);await page.pdf({path:dir+'/synthetic-display-card.pdf',printBackground:true});await page.screenshot({path:dir+'/print-preview.png',fullPage:true});await page.emulateMedia({media:'screen'});
 });
 await page.emulateMedia({media:'screen'});await check('V03 active display and QR panel',()=>scan('display-active'));
 for(const [identityId,permissions]of [['Synthetic curator',['inventory_review','campaign_draft']],['Synthetic cashier',['outcome_verify']],['Synthetic reviewer',['review_read']]])grants.push(await mutate('memberships',{identityId,permissions}));
 ownerState=await context.storageState();
 for(const [i,tabs]of [['0',['Your inventory','Draft displays']],['1',['Verify outcomes']],['2',['Read reviews']]]){
  await openActor();await page.goto(grants[Number(i)].inviteUrl);await visible(button(tabs[0]));
  for(const tab of tabs){await button(tab).click();await check('Staff '+tab+' responsive, zoom and accessibility',()=>scan('staff-'+tab.toLowerCase().replaceAll(' ','-')));
   if(tab==='Your inventory')await check('K06 staff identity close returns focus to its edition row',async()=>{const book=(await workspace('staff/')).books[0];await button('Review '+book.sku).focus();await page.keyboard.press('Enter');await visible(page.getByRole('region',{name:'Review book identity'}));assert.match(await page.evaluate(()=>document.activeElement.textContent),/^Review /);await button('Close identity review').click();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Review '+book.sku);});
  }
 }
 await openActor();await page.goto(shopperUrl);await visible(button('Find my next read'));await check('V04 shopper input and privacy alternatives',()=>scan('shopper-input'));
 await page.getByLabel('Search a film or musician').fill('Spirited');await button('Spirited Away Film').click();await button('Find my next read').click();await visible(page.getByRole('region',{name:'Inputs used for these results'}));await check('V04 shopper results and focus',async()=>{assert.equal(await page.evaluate(()=>document.activeElement.tagName),'H2');await scan('shopper-results');});
 await check('K04 reduced viewport task controls remain reachable; edit-return focus restores results',async()=>{
  await button('Edit interests or budget').click();await page.setViewportSize({width:360,height:400});await page.getByLabel('Your budget in dollars').focus();await button('Return to results').click();assert.equal(await page.evaluate(()=>document.activeElement.tagName),'H2');await button('Show at counter').first().focus();await page.keyboard.press('Enter');await visible(page.getByRole('region',{name:'Your counter code'}));assert.ok(await button('Forget my choices').isEnabled());
 });
 await check('V04 privacy reset and empty-result state',async()=>{page.once('dialog',d=>d.accept());await button('Forget my choices').click();await visible(page.getByRole('heading',{name:'Your choices were cleared',exact:true}));await scan('shopper-cleared');await page.getByRole('link',{name:'Begin a new ordinary visit',exact:true}).click();await visible(page.getByLabel('Search a film or musician'));await page.getByLabel('Search a film or musician').fill('Spirited');await button('Spirited Away Film').click();await page.getByLabel('Your budget in dollars').fill('0');await button('Find my next read').click();await visible(page.getByRole('heading',{name:'A narrower path this time.',exact:true}));await scan('shopper-empty');});
 await openActor(ownerState);await page.goto(base+'/studio');await visible(button('Data & privacy'));
 await mutate('store',{confirm:true},'DELETE');await page.reload();await visible(page.getByRole('main').getByRole('alert'));await check('V01 expired owner recovery',()=>scan('owner-expired'));
 await openActor();await page.goto(base+'/staff');await visible(page.getByRole('main').getByRole('alert'));await check('V08 denied staff invitation recovery',()=>scan('staff-denied'));
 await page.goto(shopperUrl);await visible(page.getByRole('heading',{name:'This display is unavailable',exact:true}));await check('V04 unavailable display keeps recovery and ordinary browsing exit',()=>scan('shopper-unavailable'));
 await check('Integrity: current source, fixture-only browser and no runtime errors',async()=>{assert.equal(await sourceDigest(),source);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(external,[]);});
}catch(e){steps.push({name:'Journey setup/transition',status:'FAIL',error:e.stack});console.error(e.stack);}
finally{if(context){await context.tracing.stop({path:dir+`/actor-${actorId}-trace.zip`}).catch(()=>{});await context.close();}const passed=steps.length>=24&&steps.every(s=>s.status==='PASS');await writeFile(dir+'/results.json',JSON.stringify({at:new Date().toISOString(),passed,sourceDigest:source,oracleHash:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),steps,zooms,layouts,errors,consoleErrors,expectedConsoleErrors,external,health,providerCalls:0,spend:0,limits:['Local headless Chromium native browser zoom; no physical device or human assistive acceptance','Reduced viewport simulates keyboard space, not an actual on-screen keyboard','S4-V09 operations remains S5-B10; no Stage8 started']},null,2));if(!passed)process.exitCode=1;}
