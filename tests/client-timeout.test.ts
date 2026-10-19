import assert from "node:assert/strict";
import {test} from "node:test";
import {api,waitJob} from "../src/lib/client";

test("ordinary requests abort and expose actionable recovery without automatic retries",async t=>{
  const nativeTimeout=AbortSignal.timeout;let calls=0,budget=0;
  t.mock.method(AbortSignal,"timeout",(ms:number)=>{budget=ms;return nativeTimeout(5);});
  t.mock.method(globalThis,"fetch",async(_url:unknown,options:RequestInit)=>{
    calls++;return new Promise<Response>((_resolve,reject)=>{options.signal!.addEventListener("abort",()=>reject(options.signal!.reason),{once:true});});
  });
  // Keep this isolated test alive while AbortSignal's unref'ed timer fires.
  const keepAlive=setTimeout(()=>{},1000);
  try{await assert.rejects(()=>api("entities?query=Film&type=movie",undefined,"GET"),/Reload to check whether it completed/);assert.equal(calls,1);assert.equal(budget,15000);}finally{clearTimeout(keepAlive);}
});

test("explicit startup deadline retains same-store recovery instructions",async t=>{
  const nativeTimeout=AbortSignal.timeout;let budget=0;
  t.mock.method(AbortSignal,"timeout",(ms:number)=>{budget=ms;return nativeTimeout(5);});
  t.mock.method(globalThis,"fetch",async(_url:unknown,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{options.signal!.addEventListener("abort",()=>reject(options.signal!.reason),{once:true});}));
  const keepAlive=setTimeout(()=>{},1000);
  try{await assert.rejects(()=>api("demo-sessions",{},"POST",false,{timeoutMs:8000}),/Retry to resume the same bookstore/);assert.equal(budget,8000);}finally{clearTimeout(keepAlive);}
});

test("expired pending job exits without polling; completed job remains readable",async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",()=>{calls++;throw Error("Should not poll");});
  const initial={id:"expired-job",status:"queued" as const,createdAt:new Date(0).toISOString(),deadlineAt:new Date(0).toISOString()};
  await assert.rejects(()=>waitJob(initial),/Reload to check its status/);assert.equal(calls,0);
  assert.deepEqual(await waitJob({...initial,status:"succeeded",result:{answer:"completed"}}),{answer:"completed"});
});

test("job polls carry a deadline and do not continue after a failed task",async t=>{
  const nativeTimeout=AbortSignal.timeout;let budget=0,calls=0;
  t.mock.method(AbortSignal,"timeout",(ms:number)=>{budget=ms;return nativeTimeout(ms);});
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({id:"job",status:"failed",error:{message:"Provider unavailable; no substitute"}});});
  await assert.rejects(()=>waitJob({id:"job",status:"queued",createdAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+30000).toISOString()}),/Provider unavailable; no substitute/);
  assert.equal(calls,1);assert.ok(budget>0&&budget<=8000);
});
