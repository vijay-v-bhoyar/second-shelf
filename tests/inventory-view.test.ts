import assert from "node:assert/strict";
import test from "node:test";
import { inventoryState, inventoryTimestamp, type InventoryRow } from "../src/lib/inventory-view";

const now = Date.parse("2026-10-27T12:00:00Z");
const row: InventoryRow = {sku:"SYNTHETIC",isbn13:"9781635575637",title:"Synthetic work",author:"Test author",format:"paperback",language:"en",priceMinor:1200,currency:"USD",onHand:4,shelf:"Test",observedAt:new Date(now).toISOString(),unitsSold90d:0,mappingId:"test",mappingStatus:"confirmed",entityId:"fixture-work",tags:[],color:"#355e59",revision:1,effectiveQuantity:4,eligible:true};

test("inventory states never upgrade a server-ineligible row",()=>{
  assert.equal(inventoryState(row,now),"Eligible at last refresh");
  assert.equal(inventoryState({...row,eligible:false},now),"Unavailable — review bookseller rules");
  assert.equal(inventoryState({...row,eligible:false,currency:"EUR"},now),"Unsupported currency");
});
test("identity and zero-quantity states remain explicit",()=>{
  for(const mappingStatus of ["unresolved","suggested"] as const)assert.equal(inventoryState({...row,mappingStatus,eligible:false},now),"Needs identity review");
  assert.equal(inventoryState({...row,mappingStatus:"excluded",eligible:false},now),"Excluded");
  assert.equal(inventoryState({...row,entityId:undefined,eligible:false},now),"Identity missing");
  assert.equal(inventoryState({...row,effectiveQuantity:0,eligible:false},now),"Out of stock");
});
test("exact 24-hour and five-minute boundaries match frozen freshness policy",()=>{
  const at=(delta:number)=>({...row,observedAt:new Date(now+delta).toISOString()});
  assert.equal(inventoryState(at(-86400000),now),"Eligible at last refresh");
  assert.equal(inventoryState(at(-86400001),now),"Stale snapshot — confirm stock");
  assert.equal(inventoryState(at(300000),now),"Eligible at last refresh");
  assert.equal(inventoryState(at(300001),now),"Future snapshot — check time");
  assert.equal(inventoryState({...row,observedAt:""},now),"Snapshot time missing");
});
test("timestamps retain year, UTC and individual row time; missing is never now",()=>{
  assert.equal(inventoryTimestamp("2020-01-01T12:00:00-05:00"),"2020-01-01T17:00:00.000Z");
  assert.equal(inventoryTimestamp(""),"Unknown snapshot time");
});
