import type { StaffPermission } from "./types";

export type MembershipView = {id:string;identityId:string;permissions:StaffPermission[];status:"active"|"pending"|"legacy_preview";expiresAt:string|null;inviteExpiresAt:string|null};
export const permissionLabels:Record<StaffPermission,string>={inventory_review:"Inventory review",campaign_draft:"Draft displays",outcome_verify:"Verify outcomes",review_read:"Read reviews"};
export function grantStatus(member:MembershipView,now=Date.now()){
  if(member.status==="legacy_preview")return "No usable invitation or session; revoke and issue a new grant";
  const expiry=Date.parse((member.status==="pending"?member.inviteExpiresAt:member.expiresAt)??"");
  if(!Number.isFinite(expiry))return "Expiry unverified; refresh access status";
  return expiry<=now?(member.status==="pending"?"Invitation expired; revoke and issue a new grant":"Session expired; revoke and issue a new grant"):(member.status==="pending"?"Pending redemption":"Active grant; invitation consumed");
}
export function exactGrant(member:MembershipView|undefined,intent:{identityId:string;permissions:StaffPermission[]}){
  return !!member&&member.identityId===intent.identityId&&member.permissions.length===intent.permissions.length&&[...member.permissions].sort().join() === [...intent.permissions].sort().join();
}
export function exportLease(result:Record<string,unknown>,jobId:string,format:"json"|"csv",origin:string,now=Date.now()){
  const expires=typeof result.expiresAt==="string"?Date.parse(result.expiresAt):NaN;
  const url=typeof result.downloadUrl==="string"?new URL(result.downloadUrl,origin):null;
  if(result.kind!=="export"||result.format!==format||!url||url.origin!==origin||url.pathname!==`/api/v1/exports/${jobId}/download`||url.search||url.hash||url.username||url.password||!Number.isFinite(expires)||expires<=now)throw new Error("Export link is expired or does not match this request. Prepare a new export after checking its status.");
  return {url:url.href,expiresAt:result.expiresAt as string};
}
