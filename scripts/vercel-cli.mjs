import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
export async function vercel(args,input){
  let cli;
  for(const name of await readdir("output/npm-cache/_npx")){
    const folder=path.resolve("output/npm-cache/_npx",name,"node_modules/vercel");
    try{const pkg=JSON.parse(await readFile(path.join(folder,"package.json"),"utf8"));cli=path.join(folder,pkg.bin.vercel);break;}catch{/* Another cached package. */}
  }
  if(!cli)throw Error("Vercel CLI cache missing");
  const child=spawn(process.execPath,[cli,...args],{windowsHide:true,stdio:["pipe","pipe","pipe"]});let output="";
  child.stdout.on("data",data=>output+=data);child.stderr.on("data",data=>output+=data);child.stdin.on("error",()=>{});child.stdin.end(input);
  const exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  return{exitCode,output};
}
