import type { Job } from "./types";
export class ApiError extends Error {
  constructor(message:string,public status:number){super(message);}
}
let merchantCsrf="",shopperCsrf="";
export function setCsrf(token:string,shopper=false){if(shopper)shopperCsrf=token;else merchantCsrf=token;}
export async function api<T>(path:string,body?:unknown,method="POST",shopper=false,options:{timeoutMs?:number;idempotencyKey?:string}={}):Promise<T>{
  const mutation=body!==undefined||method!=="GET";
  const headers:Record<string,string>={};
  if(shopper)headers["X-Second-Shelf-Session"]="shopper";
  if(mutation){headers["Idempotency-Key"]=options.idempotencyKey??crypto.randomUUID();if(!path.startsWith("public/")&&path!=="demo-sessions")headers["X-CSRF-Token"]=shopper?shopperCsrf:merchantCsrf;if(!(body instanceof FormData))headers["Content-Type"]="application/json";}
  try {
  const response=await fetch(`/api/v1/${path}`,{method:mutation?method:"GET",headers,body:mutation?(body instanceof FormData?body:JSON.stringify(body??{})):undefined,cache:"no-store",signal:AbortSignal.timeout(options.timeoutMs??15000)});
  const token=response.headers.get("X-CSRF-Token");if(token)setCsrf(token,true);
  const data=await response.json();
  if(!response.ok)throw new ApiError(data.message??`Request failed (${response.status}).`,response.status);
  return data as T;
  } catch(error) {
    if(error instanceof Error&&(error.name==="TimeoutError"||error.name==="AbortError"))throw new Error(path==="demo-sessions"||path.endsWith("workspace")?"Opening the bookstore took too long. Retry to resume the same bookstore.":"The request took too long. Reload to check whether it completed, then retry if needed.",{cause:error});
    throw error;
  }
}
export async function waitJob(initial:Job,shopper=false,prefix=""):Promise<Record<string,unknown>>{
  let job=initial;
  const serverDeadline=Date.parse(initial.deadlineAt);
  const deadline=Math.min(Date.now()+35000,Number.isFinite(serverDeadline)?serverDeadline+5000:Infinity);
  for(let i=0;i<80;i++){
    if(job.status==="succeeded")return job.result??{};
    if(job.status==="failed"||job.status==="cancelled")throw new Error(job.error?.message??"Task did not complete.");
    if(Date.now()>=deadline)break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(350,deadline-Date.now())));
    const remaining=deadline-Date.now();if(remaining<=0)break;
    job=await api<Job>(`${prefix}jobs/${job.id}`,undefined,"GET",shopper,{timeoutMs:Math.min(8000,remaining)});
  }
  throw new Error("The task is taking too long. Reload to check its status before trying again.");
}
