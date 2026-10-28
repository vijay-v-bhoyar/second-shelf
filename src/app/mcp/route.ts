import { handleMcpRequest } from "@/server/mcp-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
export {handleMcpRequest as POST,handleMcpRequest as GET,handleMcpRequest as DELETE};
