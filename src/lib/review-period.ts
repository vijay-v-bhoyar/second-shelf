export function defaultReviewDates(){
  const today=new Date();today.setUTCHours(0,0,0,0);
  return{start:new Date(today.getTime()-6*86400000).toISOString().slice(0,10),end:new Date(today.getTime()+86400000).toISOString().slice(0,10)};
}
export function reviewDateQuery(start:string,end:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw new Error("Choose review start and end dates.");
  return new URLSearchParams({periodStart:`${start}T00:00:00.000Z`,periodEnd:`${end}T00:00:00.000Z`}).toString();
}
