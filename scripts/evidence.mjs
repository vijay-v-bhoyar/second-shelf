import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
export async function sourceDigest(){
  const hash=createHash("sha256");
  async function walk(directory){for(const e of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(directory,e.name);if(e.isDirectory())await walk(p);else{hash.update(p.replaceAll("\\","/"));hash.update(await readFile(p));}}}
  await walk("src");for(const p of ["package.json","package-lock.json","next.config.ts","tsconfig.json","eslint.config.mjs"])hash.update(await readFile(p));
  return hash.digest("hex");
}
