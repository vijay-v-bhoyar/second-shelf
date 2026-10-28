import test from "node:test";
import assert from "node:assert/strict";
import { adjustmentValues } from "../src/lib/outcome-adjustment";
import type { Outcome } from "../src/lib/types";

test("adjustment preview rejects units beyond the remaining original purchase",()=>{
  const original={id:"p",type:"purchase",quantity:3,amountMinor:1001} as Outcome;
  const returned={id:"r",type:"return",parentEventId:"p",quantity:2,amountMinor:666} as Outcome;
  assert.throws(()=>adjustmentValues([original,returned],"p",2),/remaining/);
  assert.equal(adjustmentValues([original,returned],"p",1).amountMinor,335);
  assert.throws(()=>adjustmentValues([original,{...returned,quantity:3,amountMinor:1001}],"p",1),/remaining/);
});
