import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { sourceDigest } from "./evidence.mjs";
const stamp=new Date().toISOString().replaceAll(":","-");const dir=`output/verification/${stamp}`;await mkdir(dir,{recursive:true});
const subject=await sourceDigest(),results=[];
const npmCli=process.env.npm_execpath;
for(const [name,args] of [["typecheck",["run","typecheck"]],["lint",["run","lint"]],["unit-api",["run","test"]],["contract",["run","verify:contract"]],["restore",["run","test:restore"]],["audit",["audit","--json"]],["build",["run","build"]]]){
  const start=Date.now();let log="";
  const child=npmCli?spawn(process.execPath,[npmCli,...args],{stdio:["ignore","pipe","pipe"]}):spawn(process.platform==="win32"?"npm.cmd":"npm",args,{shell:process.platform==="win32"});
  child.stdout.on("data",c=>{log+=c;});child.stderr.on("data",c=>{log+=c;});
  const exitCode=await new Promise(resolve=>{child.once("error",e=>{log+=e.stack;resolve(1);});child.once("exit",resolve);});
  await writeFile(`${dir}/${name}.log`,log);results.push({name,exitCode,status:exitCode===0?"PASS":"FAIL",durationMs:Date.now()-start,log:`${dir}/${name}.log`});
  console.log(`${name}: ${exitCode===0?"PASS":"FAIL"} (exit ${exitCode}); log ${dir}/${name}.log`);
  if(exitCode!==0){console.error(log.slice(-4000));process.exitCode=1;}
}
await writeFile(`${dir}/results.json`,JSON.stringify({at:new Date().toISOString(),subject,results},null,2));
await writeFile("output/verification/latest.json",JSON.stringify({directory:dir,subject,results},null,2));
