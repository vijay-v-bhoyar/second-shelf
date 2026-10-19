import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIsbn, csvCell, effectiveQuantity, eligible, previewCsv, rulePass, sampleCsv, schemas } from "../src/server/domain";
import { makeStore } from "../src/server/fixtures";

test("eligibility excludes unresolved, unavailable, stale, wrong currency and over-budget editions",()=>{
  const s=makeStore("local-domain-test"),book=s.books[0];
  assert.equal(eligible(s,book,2500),true);
  assert.equal(eligible(s,{...book,mappingStatus:"unresolved"}),false);
  assert.equal(eligible(s,{...book,onHand:0}),false);
  assert.equal(eligible(s,{...book,observedAt:new Date(Date.now()-90000000).toISOString()}),false);
  assert.equal(eligible(s,{...book,currency:"EUR"}),false);
  assert.equal(eligible(s,book,100),false);
});
test("stock projection excludes verified sales after the snapshot; imports do not double-subtract",()=>{
  const s=makeStore("stock-test"),b=s.books[0];
  s.outcomes.push({id:"event",type:"purchase",sessionId:"s",sku:b.sku,quantity:1,amountMinor:b.priceMinor,currency:"USD",occurredAt:new Date(Date.now()+100).toISOString(),recordedAt:new Date().toISOString(),receiptDigest:"hash",dataMode:"demo"});
  assert.equal(effectiveQuantity(s,b),b.onHand-1);
  assert.equal(effectiveQuantity(s,{...b,observedAt:new Date(Date.now()+200).toISOString()}),b.onHand);
});
test("sample CSV validates every row and preserves ISBN check digits",()=>{
  const s=makeStore("csv-test");
  assert.ok(s.books.every(b=>checkIsbn(b.isbn13)),"sample ISBNs must pass check digits");
  const p=previewCsv(sampleCsv(s.books),s.books);assert.equal(p.errors.length,0);assert.equal(p.books.length,12);
});

test("stock timestamps with offsets subtract later sales chronologically",()=>{
  const s=makeStore("stock-offset-test"),b=s.books[0];b.onHand=2;b.observedAt="2026-10-13T02:00:00+02:00";
  s.outcomes.push({id:"later",type:"purchase",sessionId:"s",sku:b.sku,quantity:1,amountMinor:b.priceMinor,currency:"USD",occurredAt:"2026-10-13T00:30:00.000Z",recordedAt:"2026-10-13T00:30:00.000Z",receiptDigest:"sample",dataMode:"demo"});assert.equal(effectiveQuantity(s,b),1);
});

test("offset stock snapshots already include earlier and simultaneous sales",()=>{
  const s=makeStore("stock-offset-before"),b=s.books[0];b.onHand=2;b.observedAt="2026-10-13T00:00:00-02:00";
  s.outcomes.push({id:"earlier",type:"purchase",sessionId:"s",sku:b.sku,quantity:1,amountMinor:b.priceMinor,currency:"USD",occurredAt:"2026-10-13T01:00:00.000Z",recordedAt:"2026-10-13T01:00:00.000Z",receiptDigest:"sample",dataMode:"demo"},{id:"equal",type:"purchase",sessionId:"s",sku:b.sku,quantity:1,amountMinor:b.priceMinor,currency:"USD",occurredAt:"2026-10-13T02:00:00.000Z",recordedAt:"2026-10-13T02:00:00.000Z",receiptDigest:"sample-equal",dataMode:"demo"});assert.equal(effectiveQuantity(s,b),2);
});
test("CSV rejects invalid headers, oversized payloads, duplicate SKU and malformed numeric fields",()=>{
  const s=makeStore("bad-csv-test"),csv=sampleCsv(s.books);
  assert.throws(()=>previewCsv("wrong,headers\nx,y"),/Required columns/);
  assert.throws(()=>previewCsv("x".repeat(1048577)),/1 MiB/);
  const lines=csv.split("\n");const duplicate=previewCsv([lines[0],lines[1],lines[1]].join("\n"));assert.equal(duplicate.books.length,0);assert.equal(duplicate.errors.length,2);
  const numeric=previewCsv(csv.replace('"1700"','"NaN"'));assert.ok(numeric.errors.some(e=>e.field==="price_minor"));
});
test("sale corrections recalculate quantity while returns await stock confirmation",()=>{
  const s=makeStore("corrected-sale"),b=s.books[0],at=new Date(Date.now()+100).toISOString();
  const purchase={id:"purchase",type:"purchase" as const,sessionId:"visit",sku:b.sku,quantity:2,amountMinor:3400,currency:"USD",occurredAt:at,recordedAt:at,receiptDigest:"receipt",dataMode:"demo" as const};
  s.outcomes.push(purchase);s.outcomes.push({...purchase,id:"return",type:"return",quantity:1,parentEventId:"purchase"});assert.equal(effectiveQuantity(s,b),b.onHand-2);
  s.outcomes.push({...purchase,id:"correction",type:"correction",quantity:1,parentEventId:"purchase"});assert.equal(effectiveQuantity(s,b),b.onHand-1);
});
test("CSV exports neutralize spreadsheet formulas without executing text",()=>{assert.equal(csvCell("=SUM(A1)"),'"\'=SUM(A1)"');assert.equal(csvCell('A "title"'),'"A ""title"""');});
test("structured rules enforce exact SKU, language, format and price",()=>{
  const b=makeStore("rules").books[0];assert.equal(rulePass({type:"exclude_sku",operand:b.sku},b),false);assert.equal(rulePass({type:"require_language",operand:"en"},b),true);assert.equal(rulePass({type:"require_format",operand:"hardcover"},b),false);assert.equal(rulePass({type:"max_price_minor",operand:b.priceMinor-1},b),false);
});
test("recommendation contract rejects arm injection, empty inputs and negative budgets",()=>{
  assert.throws(()=>schemas.recommendation.parse({interestIds:[],budgetMinor:1000,excludedSkus:[]}));
  assert.throws(()=>schemas.recommendation.parse({interestIds:["a"],budgetMinor:-1,excludedSkus:[]}));
  assert.throws(()=>schemas.recommendation.parse({interestIds:["a"],budgetMinor:1000,excludedSkus:[],arm:"treatment"}));
});
