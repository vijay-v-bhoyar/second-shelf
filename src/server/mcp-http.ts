import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createDiscoveryMcpServer } from "./mcp-tools";

const maxBytes=16384;
function error(status:number,message:string){return Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});}
async function readBody(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new Error("missing body");
  const chunks:Uint8Array[]=[];let size=0,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},3000);
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new Error("body too large");chunks.push(part.value);}
    if(timedOut)throw new Error("body read deadline");
    const body=new Uint8Array(size);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body));
  }finally{clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function handleMcpRequest(request:Request):Promise<Response>{
  let expected:URL;
  try{const actual=new URL(request.url),configured=process.env.SECOND_SHELF_APP_ORIGIN;
    if(!configured&&(process.env.VERCEL||!["127.0.0.1","localhost","[::1]"].includes(actual.hostname)))return error(503,"An exact application origin is required for hosted MCP.");
    expected=new URL(configured??actual.origin);
    // Next may reconstruct request.url with its internal listening hostname.
    // Validate the received Host against the configured public authority;
    // never trust X-Forwarded-Host or a caller-supplied origin as configuration.
    if((request.headers.get("host")??actual.host)!==expected.host)return error(403,"Unexpected MCP host.");
    if(request.headers.has("origin")&&request.headers.get("origin")!==expected.origin)return error(403,"Unexpected MCP origin.");
  }catch{return error(400,"Invalid MCP origin configuration.");}
  if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return error(415,"MCP requires application/json.");
  if(Number(request.headers.get("content-length"))>maxBytes)return error(413,"MCP request exceeds 16 KiB.");
  let body:unknown;try{body=await readBody(request);}catch{return error(400,"Invalid or oversized MCP JSON body.");}
  if(!body||typeof body!=="object"||Array.isArray(body))return error(400,"Send one MCP JSON-RPC message per request.");
  const server=createDiscoveryMcpServer();const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{
    await server.connect(transport);
    const response=await transport.handleRequest(request,{parsedBody:body});
    response.headers.set("Cache-Control","no-store");response.headers.set("X-Content-Type-Options","nosniff");return response;
  }catch{return error(500,"MCP request failed without private diagnostic details.");}
  finally{await server.close();}
}
