import { createHmac } from "node:crypto";
import type { Membership, StaffPermission, Store } from "@/lib/types";
import { requireThat } from "./domain";
export function bootstrapOwnerToken(key:string){
  const secret=process.env.SECOND_SHELF_BOOTSTRAP_SECRET;
  if(!secret){requireThat(!process.env.VERCEL,"CONFIGURATION_NOT_READY","A stable demo session secret is required on Vercel.",503);return undefined;}
  requireThat(secret.length>=32,"CONFIGURATION_NOT_READY","The demo session secret is too short.",503);
  return createHmac("sha256",secret).update(`second-shelf-demo-owner:${key}`).digest("base64url");
}

export function invitationToken(store:Store,member:Membership){
  return createHmac("sha256",store.token).update(`staff-invite:${store.id}:${member.id}:${member.inviteNonce}`).digest("hex");
}
export function staffAuthority(store:Store,sessionId:string){
  const session=store.staffSessions?.find(x=>x.id===sessionId&&Date.parse(x.expiresAt)>Date.now());
  const member=session&&store.memberships.find(x=>x.id===session.membershipId&&x.redeemedAt&&x.expiresAt&&Date.parse(x.expiresAt)>Date.now());
  requireThat(session&&member,"UNAUTHENTICATED","This staff access expired or was revoked. Ask the owner for a new sample invitation.",401);
  return{session,member};
}
export function staffCan(store:Store,sessionId:string,permission:StaffPermission){return staffAuthority(store,sessionId).member.permissions.includes(permission);}
export const membershipWire=(member:Membership)=>({id:member.id,identityId:member.identityId,permissions:member.permissions,expiresAt:member.expiresAt??null,inviteExpiresAt:member.inviteExpiresAt??null,status:member.redeemedAt?"active":member.inviteNonce?"pending":"legacy_preview"});
