import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
const [endpoint,name,raw="{}"]=process.argv.slice(2);
if(!endpoint||!name)throw new Error('Usage: node scripts/mcp-agent-client.mjs <http://127.0.0.1:PORT/mcp> <list|tool_name> [JSON arguments]');
const url=new URL(endpoint);
const local=url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname);
if(!local&&(url.protocol!=="https:"||process.env.SECOND_SHELF_MCP_REMOTE_TEST_AUTHORIZED!=="true"))throw new Error("Remote MCP use requires explicit target/account authorization; default is loopback only.");
if(url.username||url.password||url.search||url.hash||url.pathname!=="/mcp")throw new Error("Use an exact /mcp endpoint without credentials, query or fragment.");
const client=new Client({name:"second-shelf-agent-review-client",version:"0.1.0"});
const transport=new StreamableHTTPClientTransport(url,{fetch:async(input,init)=>{
  if(new URL(String(input)).origin!==url.origin)throw new Error("Cross-origin MCP request blocked.");
  return fetch(input,{...init,redirect:"error"});
}});
try{await client.connect(transport);const result=name==="list"?await client.listTools():await client.callTool({name,arguments:JSON.parse(raw)});console.log(JSON.stringify(result,null,2));if(result.isError)process.exitCode=1;}
finally{await client.close();}
