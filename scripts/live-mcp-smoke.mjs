// Runs only against a separately authorized disposable local live-Qloo server.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {URLSearchParams} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {sourceDigest} from './evidence.mjs';
assert.equal(process.env.SECOND_SHELF_MCP_LIVE_CHECK_AUTHORIZED,'true','Explicit six-call free-allowance approval required');
const base=process.env.DEMO_BASE_URL,dir=process.env.SS_INVENTORY_EVIDENCE;
assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&dir);await mkdir(dir,{recursive:true});
const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'live');assert.equal(health.persistence,'embedded-postgresql');
const digest=await sourceDigest();let cookie='',csrf='',owned=false,attempts=0;const evidence=[];
async function api(route,body,method=body===undefined?'GET':'POST'){
 const r=await fetch(base+'/api/v1/'+route,{method,headers:{origin:base,'content-type':'application/json','idempotency-key':randomUUID(),cookie,'x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 const issued=r.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;
}
function unique(items,title){const matches=items.filter(i=>i.name.toLowerCase()===title.toLowerCase());assert.equal(matches.length,1,'Missing or ambiguous exact identity; stop without another search.');return matches[0];}
const client=new Client({name:'second-shelf-authorized-live-smoke',version:'0.1.0'});
let passed=false;
try{
 await api('demo-sessions',{});owned=true;let w=await api('workspace');csrf=w.csrfToken;
 const selected=['PIRANESI','NIGHT','SEA'];
 for(const sku of selected){const book=w.books.find(b=>b.sku===sku);assert.ok(book);attempts++;
  const r=await api('entities?'+new URLSearchParams({query:book.title,type:'book'}));const match=unique(r.items,book.title);
  await api('entity-mappings/'+book.mappingId,{expectedRevision:book.revision,status:'confirmed',entityId:match.id,reason:'Authorized private six-call integration test; unique exact book-title result.'},'PATCH');
  evidence.push({operation:'book-resolution',sku,title:book.title,entityId:match.id});
 }
 w=await api('workspace');let c=w.campaigns.at(-1);
 await api('campaigns/'+c.id,{expectedRevision:c.revision,draft:{title:'Private MCP live smoke — synthetic shop',candidateSkus:selected,ruleRevisionIds:[]}},'PATCH');
 c=(await api('workspace')).campaigns.at(-1);await api(`campaigns/${c.id}/approve`,{expectedRevision:c.revision});c=(await api('workspace')).campaigns.at(-1);await api(`campaigns/${c.id}/activate`,{expectedRevision:c.revision});c=(await api('workspace')).campaigns.at(-1);
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
 const invoke=async(name,args)=>{assert.ok(attempts<6);attempts++;const r=await client.callTool({name,arguments:{displayToken:c.token,...args}});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const search=await invoke('second_shelf_resolve_interest',{query:'Spirited Away',type:'movie'});assert.equal(search.evidenceMode,'live');const interest=unique(search.items,'Spirited Away');evidence.push({operation:'interest-resolution',id:interest.id,name:interest.name});
 const result=await invoke('second_shelf_recommend_books',{interestIds:[interest.id],budgetMinor:2000});assert.equal(result.evidenceMode,'live');assert.ok(result.items.length>0,'Live provider returned no eligible recommendation; no success or fallback claimed.');assert.ok(result.items.every(b=>b.priceMinor<=2000&&selected.includes(b.sku)));
 evidence.push({operation:'recommend',evidenceMode:result.evidenceMode,items:result.items});
 const rejected=result.items[0].entityId;
 const next=await invoke('second_shelf_recommend_books',{interestIds:[interest.id],budgetMinor:2000,excludedWorkIds:[rejected]});assert.equal(next.evidenceMode,'live');assert.ok(next.items.every(b=>b.entityId!==rejected&&b.priceMinor<=2000&&selected.includes(b.sku)));
 evidence.push({operation:'reject-and-recommend',excludedWorkId:rejected,evidenceMode:next.evidenceMode,items:next.items});passed=true;
}catch(e){evidence.push({operation:'stopped',error:String(e)});process.exitCode=1;}
finally{
 await client.close();if(owned){try{await api('store',{confirm:true},'DELETE');evidence.push({operation:'owned-synthetic-store-deleted'});}catch(e){evidence.push({operation:'cleanup-failed',error:String(e)});passed=false;process.exitCode=1;}}
 await writeFile(dir+'/results.json',JSON.stringify({passed,sourceDigest:digest,health,maximumProviderAttempts:6,requestedProviderOperations:attempts,evidence,limits:'Private live API/MCP check on synthetic local store only. Free allowance owner-confirmed; actual billing not independently measured. No publication, deployment, general rights clearance or benefit claim.'},null,2));
}
