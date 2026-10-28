import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {sourceDigest} from './evidence.mjs';
const base=process.env.DEMO_BASE_URL,dir=process.env.SS_INVENTORY_EVIDENCE;
assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&dir);await mkdir(dir,{recursive:true});
const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'fixture');
const digest=await sourceDigest(),browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir,size:{width:1280,height:720}}});
const page=await context.newPage(),start=Date.now(),chapters=[],errors=[],external=[];page.setDefaultTimeout(15000);
await context.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();external.push(r.request().url());return r.abort();});page.on('pageerror',e=>errors.push(e.message));
const button=n=>page.getByRole('button',{name:n,exact:true});
async function scene(name,text,locator){if(locator)await locator.scrollIntoViewIfNeeded();const at=(Date.now()-start)/1000;await page.screenshot({path:dir+'/'+name+'.png'});chapters.push({name,text,start:at});await page.waitForTimeout(5000);chapters.at(-1).end=(Date.now()-start)/1000;}
let passed=false;
try{
 await page.goto(base);await scene('01-problem','LOCAL SYNTHETIC DEMO. Help a bookseller introduce overlooked stock through cultural interests.');
 await button('Try a bookstore demo').click();await page.getByRole('heading',{name:'Good books deserve another chance.',exact:true}).waitFor();
 await scene('02-owner','Each browser gets a sample bookstore. Qloo is not connected in this recording.');
 await button('Your inventory').click();await scene('03-inventory','Review edition identities, dated stock and eligibility before offering a book.',page.getByRole('heading',{name:'Your inventory',exact:true}));
 await button('Cultural displays').click();await scene('04-review','The bookseller reviews the saved selection. Approval and activation are separate actions.');
 await button('Approve display').click();await page.getByRole('status').filter({hasText:'Display approved'}).waitFor();await button('Activate display').click();await page.getByRole('status').filter({hasText:'Display is active'}).waitFor();
 const url=await page.getByRole('link',{name:'Open shopper experience',exact:true}).getAttribute('href');await scene('05-qr','An active display has a QR and a direct link. This localhost link works only on this computer.',page.locator('.qr-panel'));
 await page.goto(url);await page.getByLabel('Search a film or musician').fill('Spirited');await button('Spirited Away Film').click();await page.getByLabel('Your budget in dollars').fill('25');await scene('06-input','A shopper chooses an interest and a budget. No imported reading history is needed.');
 await button('Find my next read').click();await page.getByRole('region',{name:'Inputs used for these results'}).waitFor();await scene('07-results','These matches are illustrative fixtures. Stock needs confirmation; affinity is not purchase probability.',page.locator('.recommendation-card').first());
 const firstTitle=await page.locator('.recommendation-card h3').first().innerText();await button('Show at counter').first().click();await page.getByRole('region',{name:'Your counter code'}).waitFor();const code=await page.locator('.counter-code strong').innerText();await scene('08-counter-code','The sample counter code links an offered book to an outcome. It is not a reservation or payment.',page.locator('.counter-code'));
 await page.goto(base+'/studio');await button('Weekly review').click();const w=await(await context.request.get(base+'/api/v1/workspace')).json(),book=w.books.find(b=>b.title===firstTitle);assert.ok(book);
 await page.getByLabel('Counter code',{exact:true}).fill(code);await page.getByLabel('Book',{exact:true}).selectOption(book.sku);await page.getByLabel('Quantity',{exact:true}).fill('1');await page.getByLabel('Receipt reference',{exact:true}).fill('SYNTHETIC-DEMO-'+randomUUID());await button('Verify sample outcome').click();await page.getByRole('status').filter({hasText:'Sample outcome verified in ledger:'}).waitFor();
 await scene('09-ledger','A synthetic purchase is verified against the original ledger. Returns and corrections append events.',page.getByRole('heading',{name:'Outcome history',exact:true}));
 await button('Apply review period').click();await page.getByRole('region',{name:'Applied activity results'}).waitFor();await scene('10-review','Applied UTC activity counts show what happened. They do not establish conversion lift or time saved.',page.getByRole('region',{name:'Applied activity results'}));
 await button('Data & privacy').click();await scene('11-privacy','Owner-only exports and scoped staff access are explicit. Preference deletion retains cashier events.');
 await page.getByRole('heading',{name:'Storage and retention',exact:true}).scrollIntoViewIfNeeded();await scene('12-limits','LOCAL SYNTHETIC CANDIDATE. Read-only MCP agent tools are also available; see the separate tool walkthrough. No embedded LLM or measured benefit.');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(await sourceDigest(),digest);passed=true;
 const current=await(await context.request.get(base+'/api/v1/workspace')).json();const deleted=await context.request.delete(base+'/api/v1/store',{headers:{origin:base,'x-csrf-token':current.csrfToken,'idempotency-key':randomUUID()},data:{confirm:true}});assert.ok(deleted.ok());
}catch(e){errors.push(e.stack);console.error(e.stack);process.exitCode=1;}
finally{
 const video=page.video();await context.close();await copyFile(await video.path(),dir+'/second-shelf-local-draft.webm');await browser.close();
 const stamp=s=>{const ms=Math.floor(s*1000);return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(x=>String(x).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');};
 await writeFile(dir+'/demo.vtt','WEBVTT\n\n'+chapters.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
 await writeFile(dir+'/results.json',JSON.stringify({passed:passed&&!errors.length,sourceDigest:digest,health,chapters,errors,external,limits:'Silent local synthetic walkthrough; one browser plays owner/shopper roles; separate-role tests elsewhere. No published, provider, human or causal evidence.'},null,2));
}
