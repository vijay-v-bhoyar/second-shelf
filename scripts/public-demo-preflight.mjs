// Secret-safe configuration inspection only; no network calls or deployment.
import { mkdir, writeFile } from "node:fs/promises";
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=="--config")) {
  console.error("Usage: node scripts/public-demo-preflight.mjs [--config <local-path>]");
  process.exit(2);
}
if(args.length) {
  try { process.loadEnvFile(args[1]); }
  catch { console.error("Could not load the specified environment file. Contents were not printed."); process.exit(2); }
}
const env=process.env;
let originValid=false,hostValid=false;
try {
  const origin=new URL(env.SECOND_SHELF_APP_ORIGIN??"");
  originValid=origin.protocol==="https:" && !origin.username && !origin.password && !origin.port && origin.pathname==="/" && !origin.search && !origin.hash && !/^(localhost|127\.|\[?::1\]?)/i.test(origin.hostname);
} catch { /* Missing/malformed origins fail the check. */ }
try {
  const base=new URL(env.QLOO_BASE_URL??"https://hackathon.api.qloo.com");
  hostValid=base.protocol==="https:" && ["hackathon.api.qloo.com","api.qloo.com"].includes(base.hostname) && !base.username && !base.password && !base.port && !base.search && !base.hash && base.pathname==="/";
} catch { /* Missing/malformed provider origins fail the check. */ }
const budget=Number(env.SECOND_SHELF_QLOO_DAILY_CALL_LIMIT??"100");
const checks={explicitLiveMode:env.SECOND_SHELF_PROVIDER_MODE==="live",qlooKeyPresent:!!env.QLOO_API_KEY?.trim(),liveCallsAuthorized:env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED==="true",publicHttpsOriginConfigured:originValid,qlooOriginAllowlisted:hostValid,positiveIntegerDailyCallLimit:Number.isSafeInteger(budget)&&budget>0};
const configurationReady=Object.values(checks).every(Boolean);
const receipt={at:new Date().toISOString(),scope:"Local configuration only; no network or deployment",configurationReady,checks,publicDemoReady:false,liveQlooVerified:false,remaining:["Named hosting target/account", "Durable storage and job recovery", "Real catalog mappings and cultural interests", "Bounded live search/rank and error verification", "Reachable HTTPS and phone/persona journeys", "Persistent shared call allowance and public abuse controls"]};
await mkdir("output/verification",{recursive:true});
await writeFile("output/verification/public-demo-preflight.json",JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
process.exitCode=configurationReady?0:1;
