/* global AbortSignal */
import {parseEnv} from "node:util";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL,URLSearchParams} from "node:url";

export async function probeQloo(key,origin,fetchImpl=fetch){
  if(typeof key!=="string"||!key.trim())throw Error("Qloo key missing");
  if(!URL.canParse(origin))throw Error("Supply an allowlisted Qloo origin");
  const base=new URL(origin);
  if(base.protocol!=="https:"||!["hackathon.api.qloo.com","api.qloo.com"].includes(base.hostname)||base.username||base.password||base.port||base.pathname!=="/"||base.search||base.hash)throw Error("Supply an allowlisted Qloo origin without a path, query or credentials");
  const redact=value=>String(value).replaceAll(key,"[REDACTED]").replaceAll(key.trim(),"[REDACTED]");
  const url=new URL("/search",base);url.search=new URLSearchParams({query:"Spirited Away",types:"urn:entity:movie",take:"1"}).toString();
  const start=Date.now();
  try{
    const response=await fetchImpl(url,{headers:{"X-Api-Key":key.trim(),Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(12000)});
    const raw=await response.text();let json;try{json=JSON.parse(raw);}catch{/* Error bodies may be plain text. */}
    const rows=Array.isArray(json?.results)?json.results:json?.results?.entities??json?.entities;
    const items=response.ok&&Array.isArray(rows)?rows.filter(x=>x&&typeof x==="object"&&typeof(x.entity_id??x.id)==="string"&&typeof x.name==="string").map(x=>({id:redact(x.entity_id??x.id),name:redact(x.name)})).filter(x=>x.id&&x.name):[];
    return{at:new Date().toISOString(),origin:base.origin,status:response.status,durationMs:Date.now()-start,items,calls:1,verified:response.ok&&items.length>0,...response.ok?{}:{upstreamReason:redact(json?.error?.reason??json?.error?.message??raw).slice(0,400)},...(response.status===401||response.status===403)?{nextAction:"Ask the credential issuer to confirm activation, expiry, host scope and endpoint access. Do not blindly retry."}:{}};
  }catch(error){return{at:new Date().toISOString(),origin:base.origin,durationMs:Date.now()-start,items:[],calls:1,verified:false,networkError:redact(error.message).slice(0,400)};}
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const env=parseEnv(await readFile(".env","utf8"));
  const args=process.argv.slice(2);if(args.length&&(args.length!==2||args[0]!=="--origin"))throw Error("Use --origin <allowlisted Qloo origin>");
  const receipt=await probeQloo(env.QLOO_API_KEY,args[1]||env.QLOO_BASE_URL||"https://hackathon.api.qloo.com");
  await writeFile("output/verification/qloo-live-search.json",JSON.stringify({...receipt,credentialFingerprint:createHash("sha256").update(env.QLOO_API_KEY).digest("hex")},null,2));console.log(JSON.stringify(receipt));
  if(!receipt.verified)process.exitCode=1;
}
