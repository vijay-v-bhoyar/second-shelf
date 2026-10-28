import assert from "node:assert/strict";
import test from "node:test";
import { discoveryEvidenceLabel, discoveryProviderNotice, validDiscoveryBudget } from "../src/lib/discovery-view";

test("unknown and unconfigured providers do not claim live Qloo",()=>{
  for(const mode of ["unconfigured","", "LIVE", "other"]){
    assert.match(discoveryProviderNotice(mode),/not verified/);
    assert.equal(discoveryEvidenceLabel(mode),"UNVERIFIED SOURCE");
  }
});
test("fixture, live and simulated result provenance stay distinct",()=>{
  assert.equal(discoveryEvidenceLabel("fixture"),"ILLUSTRATIVE MATCHES");
  assert.equal(discoveryEvidenceLabel("simulation"),"SIMULATED COMPARISON");
  assert.equal(discoveryEvidenceLabel("live"),"QLOO RANKED");
  assert.match(discoveryProviderNotice("fixture"),/Qloo is not connected/);
  assert.match(discoveryProviderNotice("live"),/configured/);
  assert.doesNotMatch(discoveryProviderNotice("live"),/LLM|is connected/);
});
test("budget rejects empty, non-finite, negative and over-limit values",()=>{
  for(const value of ["", " ", "NaN", "Infinity", "-0.01", "10000.01", "1e99"])
    assert.equal(validDiscoveryBudget(value),false,value);
  for(const value of ["0", "0.01", "25", "10000"])
    assert.equal(validDiscoveryBudget(value),true,value);
});
