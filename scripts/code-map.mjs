import {readFile,writeFile,access,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {sourceDigest} from "./evidence.mjs";

const raw=await readFile("graphify-out/graph.json","utf8"),graph=JSON.parse(raw);
const current=new Map();
for(const node of graph.nodes){
  const file=String(node.source_file??"").replaceAll("\\","/");
  if(!/^(src\/|scripts\/|tests\/|(?:next\.config|eslint\.config)\.)/.test(file))continue;
  try{await access(file);current.set(node.id,node);}catch{/* Retain only current on-disk source. */}
}
assert.ok(current.size>0,"No current-source graph nodes were found; use direct source navigation.");
const references=new Map(),links=[];
for(const edge of graph.links){
  if(!current.has(edge.source))continue;
  if(!current.has(edge.target))references.set(edge.target,{id:edge.target,label:String(edge.target),type:"unresolved_reference",resolution:"symbol or dependency not indexed",externalReference:true});
  links.push(edge);
}
const nodes=[...current.values(),...references.values()],ids=new Set(nodes.map(n=>n.id));
assert.ok(links.every(e=>ids.has(e.source)&&ids.has(e.target)),"Projection has a missing endpoint");
const metadata={at:new Date().toISOString(),sourceDigest:await sourceDigest(),rawGraphSha256:createHash("sha256").update(raw).digest("hex"),sourceNodes:current.size,unresolvedReferenceNodes:references.size,links:links.length,missingEndpoints:0,scope:"Current src/scripts/tests/config only; historical repair snapshots excluded. Missing extracted targets explicitly represented as unresolved reference nodes, not claimed resolved.",semanticCompleteness:"not qualified"};
await mkdir("output/verification",{recursive:true});
await writeFile("graphify-out/product-graph.json",JSON.stringify({nodes,links,directed:graph.directed,metadata},null,2));
await writeFile("output/verification/code-map.json",JSON.stringify(metadata,null,2));
const query=process.argv.slice(2).join(" ").toLowerCase();
console.log(JSON.stringify({...metadata,...query?{query,matches:nodes.filter(n=>!n.externalReference&&String(n.label).toLowerCase().includes(query)).slice(0,12).map(n=>({id:n.id,label:n.label,source:n.source_file,location:n.source_location}))}:{}},null,2));
