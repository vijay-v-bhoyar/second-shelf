import assert from "node:assert/strict";
import test from "node:test";
import {exactGrant,exportLease,grantStatus,type MembershipView} from "../src/lib/access-view";
const now=Date.parse("2026-10-28T12:00:00Z"),future="2026-10-28T12:15:00Z";
const member:MembershipView={id:"grant",identityId:"Synthetic cashier",permissions:["outcome_verify"],status:"pending",expiresAt:future,inviteExpiresAt:future};
test("pending, consumed, expired, restored and unknown grants stay distinct",()=>{
  assert.equal(grantStatus(member,now),"Pending redemption");
  assert.match(grantStatus({...member,status:"active"},now),/consumed/);
  assert.match(grantStatus(member,Date.parse(future)),/Invitation expired/);
  assert.match(grantStatus({...member,status:"active"},Date.parse(future)),/Session expired/);
  assert.match(grantStatus({...member,status:"legacy_preview"},now),/No usable/);
  assert.match(grantStatus({...member,inviteExpiresAt:null},now),/unverified/);
});
test("grant readback requires exact identity and permissions",()=>{
  assert.equal(exactGrant(member,member),true);
  assert.equal(exactGrant(undefined,member),false);
  assert.equal(exactGrant({...member,identityId:"Other"},member),false);
  assert.equal(exactGrant({...member,permissions:["outcome_verify","review_read"]},member),false);
});
test("export requires correct kind, format, job, same origin and a future lease",()=>{
  const origin="http://127.0.0.1:3000",result={kind:"export",format:"json",downloadUrl:origin+"/api/v1/exports/one/download",expiresAt:future};
  assert.equal(exportLease(result,"one","json",origin,now).url,result.downloadUrl);
  for(const change of [{kind:"discovery"},{format:"csv"},{expiresAt:"invalid"},{expiresAt:new Date(now).toISOString()},{downloadUrl:"https://example.com/api/v1/exports/one/download"},{downloadUrl:origin+"/api/v1/exports/two/download"},{downloadUrl:result.downloadUrl+"?token=secret"},{downloadUrl:result.downloadUrl+"#secret"}])assert.throws(()=>exportLease({...result,...change},"one","json",origin,now));
});
