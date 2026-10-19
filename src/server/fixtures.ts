import type { Book, Interest, Store } from "@/lib/types";
import { hash, id, now, secret } from "./domain";

export const interests: Interest[] = [
  {id:"fixture-film-anderson",name:"Wes Anderson films",type:"movie",tags:["quirky","literary","nostalgia"]},
  {id:"fixture-film-miyazaki",name:"Spirited Away",type:"movie",tags:["wonder","nature","fantasy"]},
  {id:"fixture-film-interstellar",name:"Interstellar",type:"movie",tags:["science","space","humanity"]},
  {id:"fixture-film-gerwig",name:"Little Women",type:"movie",tags:["family","literary","relationships"]},
  {id:"fixture-artist-radiohead",name:"Radiohead",type:"artist",tags:["introspective","science","humanity"]},
  {id:"fixture-artist-phoebe",name:"Phoebe Bridgers",type:"artist",tags:["introspective","relationships","literary"]},
  {id:"fixture-artist-taylor",name:"Taylor Swift",type:"artist",tags:["relationships","family","nostalgia"]},
  {id:"fixture-artist-kendrick",name:"Kendrick Lamar",type:"artist",tags:["humanity","community","identity"]},
  {id:"fixture-artist-boniver",name:"Bon Iver",type:"artist",tags:["nature","introspective","wonder"]}
];
const seed: [string,string,string,string,number,string[],string][] = [
  ["PIRANESI","9781635575637","Piranesi","Susanna Clarke",1700,["wonder","fantasy","introspective"],"#315851"],
  ["TINY","9780143110439","A Gentleman in Moscow","Amor Towles",1900,["literary","nostalgia","quirky"],"#a8583a"],
  ["SEA","9780593321447","Sea of Tranquility","Emily St. John Mandel",1800,["science","space","humanity"],"#345569"],
  ["BRAID","9781571313560","Braiding Sweetgrass","Robin Wall Kimmerer",2000,["nature","community","wonder"],"#727950"],
  ["BEAR","9781101885956","The Bear and the Nightingale","Katherine Arden",1800,["fantasy","nature","family"],"#273d65"],
  ["NIGHT","9780385534635","The Night Circus","Erin Morgenstern",1800,["fantasy","wonder","relationships"],"#8d363c"],
  ["NORMAL","9781984822185","Normal People","Sally Rooney",1700,["relationships","introspective","literary"],"#bca354"],
  ["SULA","9781400033430","Sula","Toni Morrison",1600,["community","identity","humanity"],"#9b493b"],
  ["PSALM","9781250236210","A Psalm for the Wild-Built","Becky Chambers",1600,["nature","science","humanity"],"#688679"],
  ["LITTLE","9780147514011","Little Women","Louisa May Alcott",1400,["family","relationships","literary"],"#864b65"],
  ["DUNE","9780441172719","Dune","Frank Herbert",1200,["science","space","identity"],"#b88044"],
  ["UNKNOWN","9780143110439","A Gentleman in Moscow — review edition","Amor Towles",2100,["literary","nostalgia"],"#59646b"]
];
export function makeBooks(): Book[] {
  return seed.map((b,i) => ({sku:b[0],isbn13:b[1],title:b[2],author:b[3],priceMinor:b[4],tags:b[5],color:b[6],
    format:"paperback",language:"en",currency:"USD",onHand:i===10?0:3+i%4,shelf:`${["Fiction","Worlds","Nature","Fiction"][i%4]} · ${String.fromCharCode(65+i%4)}${i+1}`,
    observedAt:now(),unitsSold90d:i===9?5:0,mappingId:id(),mappingStatus:i===11?"unresolved":"confirmed",
    entityId:i===11?undefined:`fixture-book-${b[0]}`,revision:1}));
}
export function makeStore(rawToken: string,fixtureIdentities=true): Store {
  const store: Store = {id:id(),name:"Juniper & Ink",token:hash(rawToken),csrf:secret(),expiresAt:new Date(Date.now()+86400000).toISOString(),revision:1,importId:id(),books:makeBooks(),
    rules:[],campaigns:[],shoppers:[],jobs:[],assignments:[],outcomes:[],experiments:[],policies:[],feedback:[],reviews:[],imports:[],memberships:[],audit:[],requests:{}};
  if(!fixtureIdentities)for(const book of store.books){book.mappingStatus="unresolved";book.entityId=undefined;}
  const campaign = {id:id(),versionId:id(),revision:1,title:"Between worlds",state:"draft" as const,candidateSkus:store.books.filter(b=>b.mappingStatus==="confirmed" && b.onHand>0 && b.unitsSold90d===0).map(b=>b.sku),ruleRevisionIds:[],inventoryImportId:store.importId,token:secret().slice(0,32),dataMode:"demo" as const,evidenceRefs:[]};
  store.campaigns.push(campaign);
  return store;
}
