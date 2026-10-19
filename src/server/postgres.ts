import { Pool } from "pg";
import { AppError } from "./domain";

export interface DatabaseSession {
  query<T>(sql:string,params?:unknown[]):Promise<{rows:T[]}>;
  exec(sql:string):Promise<unknown>;
}
export interface Database extends DatabaseSession {
  transaction<T>(fn:(tx:DatabaseSession)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
export function hostedDatabase(connectionString:string):Database {
  let url:URL;
  try{url=new URL(connectionString);}catch{throw new AppError("CONFIGURATION_NOT_READY","The hosted database URL is invalid.",503);}
  if(!["postgres:","postgresql:"].includes(url.protocol))throw new AppError("CONFIGURATION_NOT_READY","Use a PostgreSQL connection URL.",503);
  // Keep certificate validation enabled; connection-string SSL flags must not weaken it.
  for(const field of ["sslmode","sslcert","sslkey","sslrootcert"])url.searchParams.delete(field);
  const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,application_name:"second-shelf"});
  pool.on("error",()=>console.warn("A database pool connection ended; a later operation can reconnect."));
  const session=(client:{query:(sql:string,params?:unknown[])=>Promise<{rows:unknown[]}>}):DatabaseSession=>({
    async query<T>(sql:string,params?:unknown[]){return{rows:(await client.query(sql,params)).rows as T[]};},
    async exec(sql:string){await client.query(sql);},
  });
  return {...session(pool),
    async transaction<T>(fn:(tx:DatabaseSession)=>Promise<T>){
      const client=await pool.connect();let unusable=false;
      try{await client.query("BEGIN");const value=await fn(session(client));await client.query("COMMIT");return value;}
      catch(error){try{await client.query("ROLLBACK");}catch{unusable=true;}throw error;}
      finally{client.release(unusable);}
    },
    async close(){await pool.end();},
  };
}
