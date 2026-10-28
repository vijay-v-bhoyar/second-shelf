import test from "node:test";
import assert from "node:assert/strict";
import {reviewDateQuery} from "../src/lib/review-period";
test("review date inputs reject nonexistent, reversed, equal and oversized UTC windows",()=>{
  for(const [start,end] of [["2026-02-30","2026-03-02"],["2026-10-21","2026-10-20"],["2026-10-20","2026-10-20"],["2024-01-01","2026-01-01"]])assert.throws(()=>reviewDateQuery(start,end));
  assert.equal(new URLSearchParams(reviewDateQuery("2026-10-20","2026-10-21")).get("periodEnd"),"2026-10-21T00:00:00.000Z");
});
