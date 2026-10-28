import {z} from "zod";
const count=z.number().int().nonnegative();
const schema=z.object({campaignId:z.string(),periodStart:z.string().datetime(),periodEnd:z.string().datetime(),periodBasis:z.literal("activity_window"),evidenceStatus:z.literal("simulation"),dataMode:z.literal("demo"),assigned:count,served:count,failed:count,generationRuns:count,verifiedPurchases:count,withdrawnVisits:count,missingOutcomes:count,differencePercentagePoints:z.null(),intervalLower:z.null(),intervalUpper:z.null()});
export type ActivityReview=z.infer<typeof schema>;
export type ReviewDecision={id:string;campaignId:string;decision:string;rationale:string;at:string;periodStart?:string;periodEnd?:string};
export function readActivityReview(value:unknown,campaignId:string,periodStart:string,periodEnd:string){
  const parsed=schema.safeParse(value);
  if(!parsed.success)throw new Error("Review data is incomplete or unsupported. No current activity measurements are available.");
  const data=parsed.data;
  if(data.campaignId!==campaignId||data.periodStart!==periodStart||data.periodEnd!==periodEnd)throw new Error("Review response does not match the requested campaign and UTC period.");
  return data;
}
export const activityMetrics=[
  {key:"assigned",label:"Assignment records",definition:"Assignment rows created in this window; simulated assignment mechanics."},
  {key:"served",label:"Served sessions",definition:"Distinct campaign sessions with successful jobs requested in this window; retries collapse."},
  {key:"failed",label:"Failed sessions",definition:"Distinct campaign sessions with failed jobs requested in this window. A session can also be served."},
  {key:"generationRuns",label:"Successful generation runs",definition:"Successful job rows requested in this window, including retries; not impressions."},
  {key:"verifiedPurchases",label:"Verified purchase events",definition:"Purchase-event rows for campaign sessions by occurrence time; not buyers, copies or net sales."},
  {key:"withdrawnVisits",label:"Withdrawal records",definition:"Campaign privacy-withdrawal records by recorded time."}
] as const;
export function confirmReviewDecision(reviews:ReviewDecision[],id:string,expected:{campaignId:string;periodStart:string;periodEnd:string;decision:string;rationale:string}){
  const saved=reviews.find(r=>r.id===id);
  if(!saved||Object.entries(expected).some(([k,v])=>saved[k as keyof ReviewDecision]!==v))throw new Error("The returned decision does not match the applied period and rationale in saved history. Keep this intent pending.");
  return saved;
}
