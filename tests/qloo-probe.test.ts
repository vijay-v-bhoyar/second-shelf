import assert from "node:assert/strict";
import { test } from "node:test";
// Operator probe uses fetch injection; these tests never use a configured credential.
import { probeQloo } from "../scripts/qloo-live-check.mjs";

test("operator auth probe preserves rejection reason without exposing credentials", async()=>{
  const key="TEST-ONLY-OPERATOR-KEY";
  let calls=0;
  const transport:typeof fetch=async(input,options)=>{
    const url=input instanceof URL?input:new URL(typeof input==="string"?input:input.url);assert(options);
    calls++;assert.equal(url.pathname,"/search");assert.equal(url.searchParams.get("take"),"1");assert(!url.href.includes(key));
    assert.equal((options.headers as Record<string,string>)["X-Api-Key"],key);assert.equal(options.redirect,"error");assert(options.signal);
    return new Response(JSON.stringify({error:{reason:`API keys mismatch ${key}`}}),{status:401,headers:{"content-type":"text/plain"}});
  };
  const result=await probeQloo(key,"https://hackathon.api.qloo.com",transport);
  assert("status" in result);assert.equal(typeof result.upstreamReason,"string");assert.equal(typeof result.nextAction,"string");
  assert.equal(calls,1);assert.equal(result.status,401);assert.equal(result.verified,false);assert.match(result.upstreamReason!,/API keys mismatch/);assert(!JSON.stringify(result).includes(key));assert.match(result.nextAction!,/credential issuer/);
});
test("probe refuses unsafe origins before sending a credential",async()=>{
  let calls=0;const transport=async()=>{calls++;return new Response("{}");};
  for(const origin of ["bad URL containing TEST-KEY","http://api.qloo.com","https://api.qloo.com.evil.test","https://user:password@api.qloo.com","https://api.qloo.com/v2","https://api.qloo.com/?key=hidden"]){await assert.rejects(()=>probeQloo("TEST-KEY",origin,transport),/allowlisted Qloo origin/);}
  assert.equal(calls,0);
});
test("rate limiting and network errors do not trigger retries or secret logging",async()=>{
  const key="TEST-ONLY-OPERATOR-KEY";let calls=0;
  const limited=await probeQloo(key,"https://api.qloo.com",async()=>{calls++;return new Response("Rate limit exceeded",{status:429});});assert("status" in limited);assert.equal(limited.status,429);assert.equal(limited.verified,false);assert.equal(calls,1);
  const failed=await probeQloo(key,"https://api.qloo.com",async()=>{throw new Error(`Transport rejected ${key}`);});assert.equal(failed.verified,false);assert(!JSON.stringify(failed).includes(key));
});
test("only a successful typed search establishes probe readiness",async()=>{
  const valid=await probeQloo("TEST-KEY","https://api.qloo.com",async()=>new Response(JSON.stringify({results:{entities:[{entity_id:"sample-real-id",name:"Sample movie"}]}})));assert.equal(valid.verified,true);
  for(const body of [{},{results:{entities:[]}},{results:{entities:[{entity_id:12,name:null}]}}]){const empty=await probeQloo("TEST-KEY","https://api.qloo.com",async()=>new Response(JSON.stringify(body)));assert.equal(empty.verified,false);}
});
