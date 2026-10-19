import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse } from "yaml";
const api=parse(await readFile("docs/prebuild/openapi.yaml","utf8"));
const ids=new Set<string>();let operations=0,refs=0;
function walk(value:unknown){
  if(Array.isArray(value)){for(const v of value)walk(v);return;}
  if(value&&typeof value==="object"){
    const o=value as Record<string,unknown>;
    if(typeof o.$ref==="string"){let target:unknown=api;for(const key of o.$ref.replace(/^#\//,"").split("/")){assert.ok(target&&typeof target==="object");target=(target as Record<string,unknown>)[key];assert.notEqual(target,undefined);}refs++;}
    for(const v of Object.values(o))walk(v);
  }
}
for(const [route,methods] of Object.entries(api.paths)){
  for(const operation of Object.values(methods as Record<string,Record<string,unknown>>)){
    assert.ok(operation.operationId&&!ids.has(String(operation.operationId)));ids.add(String(operation.operationId));operations++;
    assert.ok(operation.responses&&operation["x-required-role"]);
    const parameters=(operation.parameters??[]) as {in?:string;name?:string}[];
    assert.deepEqual(parameters.filter(p=>p.in==="path").map(p=>p.name).sort(),[...route.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]).sort());
  }
}
walk(api);assert.equal(api.openapi,"3.1.0");assert.ok(operations>=35);
console.log(`PASS: ${operations} unique API operations; ${refs} resolvable references; role/path contracts valid. Live adapter compatibility remains unverified.`);
