import type { Book, Shopper, Store } from "@/lib/types";

/** The caller supplies eligible editions only. Never broaden approved inventory. */
export function selectEditions(pool:Book[]):Book[] {
  const works=new Map<string,Book>();
  for(const book of pool){
    const key=book.entityId?`work:${book.entityId}`:`sku:${book.sku}`,prior=works.get(key);
    if(!prior||book.priceMinor<prior.priceMinor||(book.priceMinor===prior.priceMinor&&book.sku<prior.sku))works.set(key,book);
  }
  return [...works.values()];
}

/** Read legacy evidence without rewriting any saved answer or recommendation. */
export function rejectedWorks(store:Store,shopper:Shopper):Set<string> {
  const works=new Set(shopper.rejectedWorkIds??[]);
  for(const sku of shopper.rejected){
    const events=store.feedback.filter(e=>e.sessionId===shopper.id&&e.sku===sku&&e.type==="reject");
    const identities=new Set<string>();
    for(const job of store.jobs){
      if(job.sessionId!==shopper.id||job.status!=="succeeded"||job.result?.kind!=="recommendations")continue;
      if(events.length&&!events.some(e=>e.runId===job.id))continue;
      const items=job.result.items;
      if(!Array.isArray(items))continue;
      for(const item of items)if(item.sku===sku&&typeof item.entityId==="string"&&item.entityId)identities.add(item.entityId);
    }
    // Exact rejection events establish identity. Without them, ambiguous history
    // cannot prove which work was rejected; keep the original SKU exclusion.
    if(events.length||identities.size===1)for(const identity of identities)works.add(identity);
  }
  return works;
}

export function isRejected(shopper:Shopper,works:Set<string>,book:Pick<Book,"sku"|"entityId">):boolean {
  return shopper.rejected.includes(book.sku)||!!book.entityId&&works.has(book.entityId);
}
