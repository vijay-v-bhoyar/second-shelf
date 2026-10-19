import { dispatch } from "@/server/service";
import { after } from "next/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
type Context={params:Promise<{path:string[]}>};
async function route(request:Request,context:Context){return dispatch(request,(await context.params).path,task=>after(task));}
export {route as GET,route as POST,route as PATCH,route as DELETE};
