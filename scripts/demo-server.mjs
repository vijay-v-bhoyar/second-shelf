import { spawn } from "node:child_process";
const port=process.env.PORT??"4397";
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",port],{stdio:"inherit",env:process.env});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>process.exit(code??1));
