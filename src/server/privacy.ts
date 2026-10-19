import type { Store } from "@/lib/types";
export interface ShopperTombstone {storeId:string;shopperId:string;at?:string}
export function purgeShopperPreferences(store:Store,shopperId:string){
  store.shoppers=store.shoppers.filter(x=>x.id!==shopperId);
  store.assignments=store.assignments.filter(x=>x.sessionId!==shopperId);
  store.feedback=store.feedback.filter(x=>x.sessionId!==shopperId);
  store.jobs=store.jobs.filter(x=>x.sessionId!==shopperId);
  for(const key of Object.keys(store.requests))if(key.startsWith(`shopper:${shopperId}:`))delete store.requests[key];
  // Keep the cashier's original transaction ledger and stock projection.
  // Remove taste choices, bearer session, counter code and measurement assignment.
}
