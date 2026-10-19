import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { db, reserveProviderCall } from "../src/server/repository";

// Run the two stages in separate OS processes against a disposable database.
const stage=process.argv[2];
if(stage){
  const results=await Promise.all(Array.from({length:5},()=>reserveProviderCall("restart-test",3,new Date("2026-10-13T12:00:00Z"))));
  assert.equal(results.filter(Boolean).length,stage==="first"?3:0);
  await(await db()).close();console.log(`PASS ${stage}`);
}else{
  const directory=await mkdtemp(path.join(tmpdir(),"second-shelf-budget-restart-")),stages=[];
  for(const stage of ["first","reopened"]){
    let log="";const child=spawn(process.execPath,["--import","tsx","scripts/provider-budget-restart-check.ts",stage],{env:{...process.env,SECOND_SHELF_DATA_DIR:directory},stdio:["ignore","pipe","pipe"],windowsHide:true});
    child.stdout.on("data",data=>log+=data);child.stderr.on("data",data=>log+=data);
    const exitCode=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
    stages.push({stage,exitCode,log});assert.equal(exitCode,0,log);
  }
  await mkdir("output/verification",{recursive:true});
  const inputs:Record<string,string>={};for(const file of ["src/server/providers.ts","src/server/repository.ts","scripts/provider-budget-restart-check.ts"])inputs[file]=createHash("sha256").update(await readFile(file)).digest("hex");
  await writeFile("output/verification/provider-budget-restart.json",JSON.stringify({at:new Date().toISOString(),scope:"Disposable local database; separate OS processes; no real provider calls",inputs,stages,status:"PASS"},null,2));console.log("PASS: exhausted allowance survives process exit/reopen");
}
