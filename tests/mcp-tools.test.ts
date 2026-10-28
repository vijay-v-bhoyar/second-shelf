import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {makeStore} from "../src/server/fixtures";
import {db,getStore,insertStore,mutateStore} from "../src/server/repository";
import {inspectDisplay,recommendBooks,resolveInterests} from "../src/server/mcp-tools";
import {handleMcpRequest} from "../src/server/mcp-http";

test("MCP discovery contracts: synthetic data only, no credentialed requests",async t=>{
  process.env.SECOND_SHELF_DATA_DIR=await mkdtemp(path.join(tmpdir(),"ss-mcp-test-"));
  process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="false";
  delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.SECOND_SHELF_APP_ORIGIN="http://127.0.0.1:4397";
  const store=makeStore("owner-private-not-for-mcp");const campaign=store.campaigns[0];campaign.state="active";
  campaign.candidateSkus=store.books.map(b=>b.sku);await insertStore(store);
  const input={displayToken:campaign.token,interestIds:["fixture-film-miyazaki"],budgetMinor:2000,limit:5};
  const origin="http://127.0.0.1:4397";
  const http=(body:unknown,headers:Record<string,string>={},method="POST")=>handleMcpRequest(new Request(origin+"/mcp",{method,headers:{"content-type":"application/json",accept:"application/json, text/event-stream",...headers},body:method==="POST"?JSON.stringify(body):undefined}));
  await t.test("public display output cannot expose owner/session/export data",async()=>{
    const result=await inspectDisplay({displayToken:campaign.token});assert.equal(result.versionId,campaign.versionId);assert.equal(result.evidenceMode,"fixture");
    const text=JSON.stringify(result);for(const forbidden of [store.token,store.csrf,"ownerToken","memberships","shoppers","audit"])if(forbidden)assert.ok(!text.includes(forbidden));
    assert.deepEqual(Object.keys(result).sort(),["title","storeName","versionId","currency","dataMode","evidenceMode","observedAt","interpretation","retention","capabilities","limits"].sort());
  });
  await t.test("recommendations respect price, work rejection and unchanged business state",async()=>{
    const before=await getStore(store.id);const first=await recommendBooks(input);assert.ok(first.items.length>0);assert.ok(first.items.length<=5);
    assert.ok(first.items.every(b=>b.priceMinor<=2000&&campaign.candidateSkus.includes(b.sku)));assert.equal(first.evidenceMode,"fixture");
    const rejected=first.items[0].entityId!;const second=await recommendBooks({...input,excludedWorkIds:[rejected]});assert.ok(second.items.every(b=>b.entityId!==rejected));
    const empty=await recommendBooks({...input,budgetMinor:0});assert.deepEqual(empty.items,[]);assert.ok(empty.emptyReason);
    assert.deepEqual(await getStore(store.id),before,"No preferences, ledger, inventory, campaign or job mutation");
  });
  await t.test("strict inputs and unavailable private display fail closed",async()=>{
    await assert.rejects(recommendBooks({...input,limit:6}));await assert.rejects(recommendBooks({...input,budgetMinor:20.1}));
    await assert.rejects(recommendBooks({...input,ownerToken:"forbidden"}));await assert.rejects(inspectDisplay({displayToken:"http://evil.invalid/"}));
    await assert.rejects(inspectDisplay({displayToken:"nonexistent-token-123456"}),/unavailable/);
    const privateStore=makeStore("another-owner");await insertStore(privateStore);
    await assert.rejects(inspectDisplay({displayToken:privateStore.campaigns[0].token}),/unavailable/);
  });
  await t.test("actual SDK client initializes, lists only three tools and invokes discovery",async()=>{
    const client=new Client({name:"second-shelf-contract-client",version:"1.0.0"});
    const transport=new StreamableHTTPClientTransport(new URL(origin+"/mcp"),{fetch:async(url,init)=>handleMcpRequest(new Request(url,init))});
    await client.connect(transport);
    try{
      const listed=await client.listTools();assert.deepEqual(listed.tools.map(x=>x.name).sort(),["second_shelf_inspect_display","second_shelf_recommend_books","second_shelf_resolve_interest"]);
      assert.ok(listed.tools.every(x=>x.annotations?.readOnlyHint===true));
      const r=await client.callTool({name:"second_shelf_recommend_books",arguments:input});assert.ok(!r.isError);assert.ok(r.structuredContent);assert.equal((r.structuredContent as Record<string,unknown>).evidenceMode,"fixture");
      const denied=await client.callTool({name:"second_shelf_recommend_books",arguments:{...input,budgetMinor:-1}});assert.equal(denied.isError,true);
      await assert.rejects(client.callTool({name:"second_shelf_record_purchase",arguments:{}}),/not found/);
    }finally{await client.close();}
  });
  await t.test("incomplete body times out instead of accepting a partial JSON document",async()=>{
    const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{}'));}});
    const request=new Request(origin+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body,duplex:"half"} as RequestInit);
    assert.equal((await handleMcpRequest(request)).status,400);
  });
  await t.test("transport blocks wrong origin/host, oversized input and batch requests",async()=>{
    assert.equal((await http({}, {origin:"https://evil.invalid"})).status,403);
    assert.equal((await http({}, {host:"evil.invalid"})).status,403);
    assert.equal((await http({}, {"content-length":"20000"})).status,413);
    assert.equal((await http({payload:"x".repeat(17000)})).status,400);
    assert.equal((await http([])).status,400);
    assert.equal((await http({}, {"content-type":"text/plain"})).status,415);
    assert.equal((await http(null,{},"GET")).status,405);
    assert.equal((await http(null,{},"DELETE")).status,405);
    const internalUrl=new Request('http://localhost:4397/mcp',{method:'GET',headers:{host:'127.0.0.1:4397'}});
    assert.equal((await handleMcpRequest(internalUrl)).status,405,"framework internal URL may differ; exact configured Host remains required");
    delete process.env.SECOND_SHELF_APP_ORIGIN;process.env.VERCEL='1';
    try{assert.equal((await http({})).status,503);}finally{delete process.env.VERCEL;process.env.SECOND_SHELF_APP_ORIGIN=origin;}
  });
  await t.test("retired display is unreadable and read-only lookup does not delete expired stores",async()=>{
    const expired=makeStore("expired-preserved");expired.expiresAt=new Date(Date.now()-10000).toISOString();await insertStore(expired);
    await inspectDisplay({displayToken:campaign.token});
    const exists=await(await db()).query<{id:string}>("SELECT id FROM stores WHERE id=$1",[expired.id]);assert.equal(exists.rows.length,1);
    await mutateStore(store.id,s=>{s.campaigns[0].state="retired";});
    await assert.rejects(recommendBooks(input),/unavailable/);
    await mutateStore(store.id,s=>{s.campaigns[0].state="active";});
  });
  await t.test("live-provider contract retains Qloo order, fails without fallback, and rechecks after wait",async()=>{
    process.env.SECOND_SHELF_PROVIDER_MODE="live";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";process.env.QLOO_BASE_URL="https://hackathon.api.qloo.com";
    const realFetch=globalThis.fetch;let behavior="ok",calls=0;
    const ids=new Map(store.books.map(b=>[b.sku,randomUUID()]));const interest=randomUUID();
    await mutateStore(store.id,s=>{for(const b of s.books)b.entityId=ids.get(b.sku);});
    globalThis.fetch=async(url)=>{
      calls++;const u=new URL(String(url));assert.equal(u.hostname,"hackathon.api.qloo.com");
      if(behavior==="fail")return Response.json({error:"private upstream diagnostic"},{status:503});
      if(u.pathname==="/search")return Response.json({results:[{entity_id:interest,name:"Confirmed film"}]});
      assert.equal(u.pathname,"/v2/insights");assert.equal(u.searchParams.get("signal.interests.entities"),interest);
      const entities=u.searchParams.get("filter.results.entities")!.split(",").reverse();
      if(behavior==="retire")await mutateStore(store.id,s=>{s.campaigns[0].state="retired";});
      if(behavior==="stock")await mutateStore(store.id,s=>{for(const b of s.books)b.onHand=0;});
      return Response.json({results:{entities:entities.map(entity_id=>({entity_id}))}});
    };
    try{
      const search=await resolveInterests({displayToken:campaign.token,query:"Confirmed",type:"movie"});assert.equal(search.items[0].id,interest);assert.equal(search.evidenceMode,"live");
      const result=await recommendBooks({...input,interestIds:[interest]});assert.equal(result.evidenceMode,"live");assert.ok(result.items.length>0);
      const expected=store.books.filter(b=>b.priceMinor<=2000&&b.onHand>0&&b.mappingStatus==="confirmed").map(b=>ids.get(b.sku)).reverse().slice(0,5);
      assert.deepEqual(result.items.map(b=>b.entityId),expected);assert.ok(!result.items.some(b=>b.sku==="DUNE"||b.sku==="UNKNOWN"));
      behavior="fail";await assert.rejects(recommendBooks({...input,interestIds:[interest]}),/Qloo returned 503/);
      behavior="retire";await assert.rejects(recommendBooks({...input,interestIds:[interest]}),/unavailable/);
      await mutateStore(store.id,s=>{s.campaigns[0].state="active";});behavior="stock";
      assert.deepEqual((await recommendBooks({...input,interestIds:[interest]})).items,[]);
      assert.ok(calls>=5);
    }finally{globalThis.fetch=realFetch;process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="false";delete process.env.QLOO_API_KEY;
      await mutateStore(store.id,s=>{s.books=structuredClone(store.books);s.campaigns[0].state="active";});}
  });
  await t.test("two held discovery calls reject a third before another provider call",async()=>{
    process.env.SECOND_SHELF_PROVIDER_MODE="live";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="true";process.env.QLOO_API_KEY="TEST-ONLY-NEVER-SENT";
    const realFetch=globalThis.fetch;let arrivals=0,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    globalThis.fetch=async()=>{arrivals++;await gate;return Response.json({results:[]});};
    const query={displayToken:campaign.token,query:"Held film",type:"movie"};
    const first=resolveInterests(query),second=resolveInterests(query);
    try{
      for(let i=0;i<100&&arrivals<2;i++)await new Promise(r=>setTimeout(r,10));assert.equal(arrivals,2);
      await assert.rejects(resolveInterests(query),/Two MCP tasks/);assert.equal(arrivals,2);
    }finally{release();await Promise.all([first,second]);globalThis.fetch=realFetch;process.env.SECOND_SHELF_PROVIDER_MODE="fixture";process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED="false";delete process.env.QLOO_API_KEY;}
  });
  await t.test("exhausted persistent MCP admission rejects without touching business state",async()=>{
    const before=await getStore(store.id);await(await db()).query("UPDATE provider_call_budgets SET used=100 WHERE provider='mcp-discovery'");
    await assert.rejects(recommendBooks(input),/daily MCP/);assert.deepEqual(await getStore(store.id),before);
    // Display metadata remains available when discovery capacity is exhausted.
    assert.equal((await inspectDisplay({displayToken:campaign.token})).versionId,campaign.versionId);
  });
});
