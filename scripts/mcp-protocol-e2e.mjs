import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {sourceDigest} from './evidence.mjs';
const base=process.env.DEMO_BASE_URL,dir=process.env.SS_INVENTORY_EVIDENCE;
assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&dir);await mkdir(dir,{recursive:true});
const health=await(await fetch(base+'/api/v1/health')).json();assert.equal(health.providerMode,'fixture');
const digest=await sourceDigest();let cookie='',csrf='',owned=false;const steps=[];
async function api(route,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+'/api/v1/'+route,{method,headers:{origin:base,'content-type':'application/json','idempotency-key':randomUUID(),cookie,'x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 const issued=response.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
}
const client=new Client({name:'second-shelf-production-protocol-check',version:'0.1.0'});
try{
 await api('demo-sessions',{});owned=true;const w=await api('workspace');csrf=w.csrfToken;let c=w.campaigns.at(-1);
 await api(`campaigns/${c.id}/approve`,{expectedRevision:c.revision});c=(await api('workspace')).campaigns.at(-1);
 await api(`campaigns/${c.id}/activate`,{expectedRevision:c.revision});c=(await api('workspace')).campaigns.at(-1);
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
 const tools=await client.listTools();assert.equal(tools.tools.length,3);steps.push('SDK initialization and exact three-tool list');
 const invoke=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const before=await api('workspace');const display=await invoke('second_shelf_inspect_display',{displayToken:c.token});assert.equal(display.versionId,c.versionId);steps.push('Active public display read');
 const search=await invoke('second_shelf_resolve_interest',{displayToken:c.token,query:'Spirited Away',type:'movie'});const interest=search.items.find(i=>i.name==='Spirited Away');assert.ok(interest);steps.push('Exact synthetic interest resolution');
 const results=await invoke('second_shelf_recommend_books',{displayToken:c.token,interestIds:[interest.id],budgetMinor:2000});assert.equal(results.evidenceMode,'fixture');assert.ok(results.items.length>0);assert.ok(results.items.every(x=>x.priceMinor<=2000));steps.push('Constrained recommendations and provenance');
 const revised=await invoke('second_shelf_recommend_books',{displayToken:c.token,interestIds:[interest.id],budgetMinor:2000,excludedWorkIds:[results.items[0].entityId]});assert.ok(revised.items.every(x=>x.entityId!==results.items[0].entityId));steps.push('Work rejection retained in next tool input');
 assert.deepEqual(await api('workspace'),before);steps.push('No business state, jobs or shopper preferences changed');
 const denied=await fetch(base+'/mcp',{method:'POST',headers:{origin:'https://invalid.example','content-type':'application/json'},body:'{}'});assert.equal(denied.status,403);steps.push('Cross-origin request denied');
 await assert.rejects(client.callTool({name:'second_shelf_record_purchase',arguments:{}}));steps.push('Agent purchase mutation not exposed');
 await api(`campaigns/${c.id}/retire`,{expectedRevision:c.revision});
 const retired=await client.callTool({name:'second_shelf_inspect_display',arguments:{displayToken:c.token}});assert.equal(retired.isError,true);steps.push('Retired display rejected through actual HTTP transport');
 await writeFile(dir+'/results.json',JSON.stringify({passed:true,sourceDigest:digest,health,steps,tools:tools.tools.map(x=>x.name),providerCalls:0,spend:0,limits:'Real local HTTP MCP protocol test with scripted choices; not a live-provider or autonomous-agent result.'},null,2));
}catch(e){await writeFile(dir+'/failure.json',JSON.stringify({sourceDigest:digest,steps,error:String(e)},null,2));throw e;}
finally{await client.close();if(owned)await api('store',{confirm:true},'DELETE');}
