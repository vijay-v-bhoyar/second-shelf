import {readFile,writeFile,appendFile} from "node:fs/promises";
import {parseEnv} from "node:util";
import {randomBytes,createHash} from "node:crypto";
import {vercel} from "./vercel-cli.mjs";
const env=parseEnv(await readFile(".env","utf8"));
if(!env.SECOND_SHELF_BOOTSTRAP_SECRET){env.SECOND_SHELF_BOOTSTRAP_SECRET=randomBytes(32).toString("hex");await appendFile(".env",`\nSECOND_SHELF_BOOTSTRAP_SECRET=${env.SECOND_SHELF_BOOTSTRAP_SECRET}\n`);}
const credentialFingerprint=createHash("sha256").update(env.QLOO_API_KEY||"").digest("hex");
let proof;try{proof=JSON.parse(await readFile("output/verification/qloo-live-search.json","utf8"));}catch{/* Unverified configurations remain disabled. */}
const providerAuthorized=proof?.verified===true&&proof.credentialFingerprint===credentialFingerprint&&Date.now()-Date.parse(proof.at)<3600000;
const vars={SECOND_SHELF_BOOTSTRAP_SECRET:env.SECOND_SHELF_BOOTSTRAP_SECRET,SECOND_SHELF_PROVIDER_MODE:"live",SECOND_SHELF_LIVE_CALLS_AUTHORIZED:String(providerAuthorized),SECOND_SHELF_QLOO_DAILY_CALL_LIMIT:"100",SECOND_SHELF_DEMO_STORES_PER_DAY:"100",QLOO_BASE_URL:providerAuthorized?proof.origin:env.QLOO_BASE_URL||"https://hackathon.api.qloo.com",QLOO_API_KEY:env.QLOO_API_KEY};
const results=[];
for(const [name,value]of Object.entries(vars)){
  if(!value)throw Error(`Missing ${name}`);
  const r=await vercel(["env","add",name,"production","--force","--sensitive","--non-interactive"],value);
  results.push({name,exitCode:r.exitCode});console.log(`${name}: ${r.exitCode===0?"configured":"failed"}`);
  if(r.exitCode!==0){let safe=r.output;for(const secret of Object.values(vars))if(secret)safe=safe.replaceAll(secret,"[REDACTED]");await writeFile("output/verification/vercel-env-error.log",safe);throw Error(`Vercel rejected ${name}; see redacted diagnostic`);}
}
await writeFile("output/verification/vercel-env-config.json",JSON.stringify({at:new Date().toISOString(),results,providerAuthorized,reason:providerAuthorized?"Recent matching credential probe passed":"Awaiting verified provider access",credentialFingerprint},null,2));
