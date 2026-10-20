import type { Book, Interest, Store } from "@/lib/types";
import { interests } from "./fixtures";
import { AppError, requireThat } from "./domain";
import { reserveProviderCall } from "./repository";
import { selectEditions } from "./book-selection";

export function providerMode(): "live"|"fixture"|"unconfigured" {
  const mode=process.env.SECOND_SHELF_PROVIDER_MODE??"fixture";
  if(mode==="fixture")return "fixture";
  return mode==="live"&&process.env.QLOO_API_KEY?.trim()&&process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED==="true" ? "live":"unconfigured";
}
async function qloo(route:string,params:Record<string,string>) {
  requireThat(providerMode()==="live","CONFIGURATION_NOT_READY","Live Qloo needs an authorized account and configured key.",503);
  const base=process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
  const url=new URL(route,base);
  requireThat(url.protocol==="https:" && ["hackathon.api.qloo.com","api.qloo.com"].includes(url.hostname)&&!url.username&&!url.password&&!url.port,"CONFIGURATION_NOT_READY","Qloo host is not allowlisted.",503);
  const limit=Number(process.env.SECOND_SHELF_QLOO_DAILY_CALL_LIMIT ?? "100");
  requireThat(await reserveProviderCall("qloo",limit),"BUDGET_EXHAUSTED","The authorized Qloo call allowance is exhausted for this UTC day.",429);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{headers:{"X-Api-Key":process.env.QLOO_API_KEY!},signal:AbortSignal.timeout(12000),cache:"no-store"});
  if(!response.ok)throw new AppError(response.status===429?"RATE_LIMITED":"PROVIDER_UNAVAILABLE",`Qloo returned ${response.status}. No sample fallback was substituted.`,response.status===429?429:502,response.status===429||response.status>=500);
  return await response.json() as Record<string,unknown>;
}
function normalize(raw:Record<string,unknown>):Record<string,unknown>[] {
  const results=raw.results;
  const list=Array.isArray(results)?results:results && typeof results==="object"?(results as Record<string,unknown>).entities:raw.entities;
  if(!Array.isArray(list))throw new AppError("PROVIDER_UNAVAILABLE","Qloo response did not contain a supported entity list.",502);
  return list.filter(x=>x && typeof x==="object");
}
export async function searchEntities(query:string,type:"movie"|"artist"|"book",store:Store):Promise<Interest[]> {
  if(providerMode()==="fixture") {
    const values=type==="book"?store.books.map(b=>({id:b.entityId ?? `fixture-book-${b.sku}`,name:`${b.title} — ${b.author}`,type:"book" as const,tags:b.tags})):interests;
    return values.filter(x=>x.type===type && x.name.toLowerCase().includes(query.toLowerCase())).slice(0,20);
  }
  const rows=normalize(await qloo("/search",{query,types:`urn:entity:${type}`}));
  return rows.slice(0,20).map(x=>({id:String(x.entity_id??x.id??""),name:String(x.name??""),type,tags:[]})).filter(x=>x.id&&x.name);
}
export async function rankBooks(pool:Book[],interestIds:string[]) {
  if(providerMode()==="fixture") {
    requireThat(interestIds.every(i=>interests.some(x=>x.id===i)),"INVALID_INPUT","Select a supported sample film or musician.",400);
    const tags=interestIds.flatMap(i=>interests.find(x=>x.id===i)!.tags);
    return selectEditions(pool).sort((a,b)=>b.tags.filter(t=>tags.includes(t)).length-a.tags.filter(t=>tags.includes(t)).length||a.sku.localeCompare(b.sku));
  }
  requireThat(pool.length<=50,"INVALID_INPUT","For verified live ranking, limit this campaign to 50 mapped books until account limits are measured.",422);
  requireThat(pool.every(b=>b.entityId && !b.entityId.startsWith("fixture-")) && interestIds.every(i=>!i.startsWith("fixture-")),"INVALID_INPUT","Resolve real Qloo identities before using live ranking.",422);
  // Eligibility is authoritative: nothing can be ranked when the store has no matches.
  if(!pool.length)return [];
  const editions=selectEditions(pool);
  const rows=normalize(await qloo("/v2/insights",{"filter.type":"urn:entity:book","signal.interests.entities":interestIds.join(","),"filter.results.entities":editions.map(b=>b.entityId).join(","),take:String(editions.length)}));
  const byId=new Map(editions.map(b=>[b.entityId,b]));
  const ranked=rows.map(x=>byId.get(String(x.entity_id??x.id??""))).filter((x):x is Book=>!!x);
  requireThat(ranked.length===rows.length,"PROVIDER_UNAVAILABLE","Qloo returned an entity outside the eligible bookstore catalog.",502);
  return [...new Map(ranked.map(b=>[b.entityId,b])).values()];
}
