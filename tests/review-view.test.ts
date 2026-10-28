import test from "node:test";
import assert from "node:assert/strict";
import {readActivityReview,confirmReviewDecision,activityMetrics} from "../src/lib/review-view";
const start="2026-10-20T00:00:00.000Z",end="2026-10-21T00:00:00.000Z";
const d01={campaignId:"c",periodStart:start,periodEnd:end,periodBasis:"activity_window",evidenceStatus:"simulation",dataMode:"demo",assigned:1,served:2,failed:1,generationRuns:3,verifiedPurchases:2,withdrawnVisits:0,missingOutcomes:1,differencePercentagePoints:null,intervalLower:null,intervalUpper:null,ownerActiveWorkSeconds:0};
test("S4-D01 presentation preserves distinct populations and excludes effort/effect metrics",()=>{
  const data=readActivityReview(d01,"c",start,end);assert.deepEqual(activityMetrics.map(m=>data[m.key]),[1,2,1,3,2,0]);assert.equal(data.missingOutcomes,1);assert.equal("ownerActiveWorkSeconds" in data,false);
});
test("S4-D02 real zero requires complete values; S4-D03 missing/invalid response never becomes zero",()=>{
  const zero={...d01,...Object.fromEntries(activityMetrics.map(m=>[m.key,0])),missingOutcomes:0};assert.equal(readActivityReview(zero,"c",start,end).served,0);
  for(const data of [undefined,null,{}, {...zero,served:undefined},{...zero,served:null},{...zero,failed:-1},{...zero,assigned:1.5},{...zero,differencePercentagePoints:10},{...zero,evidenceStatus:"pilot"}])assert.throws(()=>readActivityReview(data,"c",start,end),/incomplete/);
});
test("wrong campaign or returned window cannot be applied",()=>{
  for(const data of [{...d01,campaignId:"other"},{...d01,periodStart:end},{...d01,periodEnd:start}])assert.throws(()=>readActivityReview(data,"c",start,end),/does not match/);
});
test("decision confirmation requires returned ID, campaign, exact applied period and rationale",()=>{
  const expected={campaignId:"c",periodStart:start,periodEnd:end,decision:"keep",rationale:"Synthetic rationale"},saved={...expected,id:"r",at:start};assert.equal(confirmReviewDecision([saved],"r",expected),saved);
  for(const changed of [{id:"other"},{campaignId:"other"},{periodStart:end},{periodEnd:start},{decision:"retire"},{rationale:"Different"}])assert.throws(()=>confirmReviewDecision([{...saved,...changed}],"r",expected),/does not match/);
  assert.throws(()=>confirmReviewDecision([],"r",expected),/does not match/);
});
