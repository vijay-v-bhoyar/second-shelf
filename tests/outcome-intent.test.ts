import test from "node:test";
import assert from "node:assert/strict";
import { makeOutcomeIntent, readOutcomeIntent, confirmedOutcome, type OutcomeBody } from "../src/lib/outcome-intent";
import type { Outcome } from "../src/lib/types";
const body:OutcomeBody={type:"purchase",sku:"SAMPLE",quantity:2,amountMinor:1001,currency:"USD",occurredAt:"2026-10-28T12:00:00.000Z",receiptReference:"SAMPLE-RECEIPT",sessionCode:"SAMPLE-CODE"};
test("recovery retains the original key, timestamp and exact body across serialization",()=>{
  const intent=makeOutcomeIntent(body);assert.deepEqual(readOutcomeIntent(JSON.stringify(intent)),intent);
  assert.notEqual(makeOutcomeIntent(body).key,intent.key);
  assert.throws(()=>readOutcomeIntent('{"version":1}'));
  assert.throws(()=>readOutcomeIntent(JSON.stringify({...intent,body:{...body,quantity:-1}})));
  assert.throws(()=>readOutcomeIntent(JSON.stringify({...intent,body:{...body,extra:"unapproved"}})));
});
test("success requires the exact returned ledger event and semantic amounts",()=>{
  const id=crypto.randomUUID(),intent={...makeOutcomeIntent(body),eventId:id};
  const event={...body,id,sessionId:"sample",recordedAt:body.occurredAt,receiptDigest:"sample",dataMode:"demo"} as Outcome;
  assert.equal(confirmedOutcome([event],intent),event);
  for(const changed of [{id:crypto.randomUUID()},{quantity:1},{amountMinor:1000},{sku:"OTHER"},{type:"return"},{currency:"EUR"},{reason:"changed"}])
    assert.throws(()=>confirmedOutcome([{...event,...changed} as Outcome],intent),/does not match/);
  assert.throws(()=>confirmedOutcome([],intent),/does not match/);
});
test("adjustment confirmation preserves its original purchase and reason",()=>{
  const parentEventId=crypto.randomUUID(),id=crypto.randomUUID();
  const intent={...makeOutcomeIntent({...body,type:"return",sessionCode:undefined,parentEventId,reason:"Sample return"}),eventId:id};
  const event:Outcome={...intent.body,id,sessionId:"sample",recordedAt:body.occurredAt,receiptDigest:"sample",dataMode:"demo"};
  assert.equal(confirmedOutcome([event],intent).parentEventId,parentEventId);
  assert.throws(()=>confirmedOutcome([{...event,parentEventId:crypto.randomUUID()}],intent),/does not match/);
});
