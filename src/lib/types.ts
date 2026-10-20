export type EvidenceMode = "fixture" | "live" | "simulation";
export interface Book {
  sku: string; isbn13: string; title: string; author: string; format: string; language: string;
  priceMinor: number; currency: string; onHand: number; shelf: string; observedAt: string;
  unitsSold90d: number; mappingId: string; mappingStatus: "unresolved" | "suggested" | "confirmed" | "excluded";
  entityId?: string; tags: string[]; color: string; revision: number;
}
export interface Interest { id: string; name: string; type: "movie" | "artist" | "book"; tags: string[] }
export type StaffPermission = "inventory_review" | "campaign_draft" | "outcome_verify" | "review_read";
export interface Membership { id:string; identityId:string; permissions:StaffPermission[]; inviteNonce?:string; inviteExpiresAt?:string; expiresAt?:string; redeemedAt?:string }
export interface StaffSession { id:string; membershipId:string; token:string; csrf:string; expiresAt:string }
export interface RuleCase { sku: string; language: string; format: string; priceMinor: number; expectedPass: boolean }
export interface Rule {
  id: string; revision: number; type: "exclude_sku" | "require_language" | "require_format" | "max_price_minor";
  operand: string | number; scope: "store" | "campaign"; campaignId?: string;
  example: RuleCase; counterexample: RuleCase; reviewAt: string; active: boolean;
  history?:{revision:number;active:boolean;reviewAt:string;changedAt:string}[];
}
export interface Campaign {
  id: string; versionId: string; revision: number; title: string; state: "draft" | "approved" | "active" | "superseded" | "retired";
  candidateSkus: string[]; ruleRevisionIds: string[]; inventoryImportId: string; token: string;
  dataMode: "demo"; plan?: string; evidenceRefs: string[]; approvedAt?: string;
}
export interface Assignment {
  id: string; sessionId: string; experimentId: string; arm: "treatment" | "control";
  at: string; candidateSkus: string[]; interests: string[]; budgetMinor: number;
}
export interface Shopper {
  id: string; campaignId: string; versionId: string; token: string; csrf: string; expiresAt: string;
  rejectedWorkIds?: string[];
  measurementOptIn: boolean; noticeVersion: string; rejected: string[]; code?: string; assignmentId?: string; closedAt?:string; privacyGroupId?:string; measurementAllowed?:boolean;
}
export interface Recommendation {
  sku: string; entityId: string; title: string; author: string; priceMinor: number; currency: string; shelf: string;
  rank: number; interpretation: string; evidenceRef: string; evidenceMode: EvidenceMode; inventoryObservedAt: string;
  color: string; tags: string[];
}
export interface Job {
  id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string; deadlineAt: string; sessionId?: string; result?: Record<string, unknown>;
  error?: {code: string; message: string; requestId: string; retryable: boolean};
}
export interface Outcome {
  id: string; type: "purchase" | "return" | "correction"; sessionId: string; sku: string;
  quantity: number; amountMinor: number; currency: string; occurredAt: string; recordedAt: string;
  receiptDigest: string; parentEventId?: string; reason?: string; dataMode: "demo"; bookTitle?:string;isbn13?:string;
}
export interface Experiment {
  id: string; revision: number; campaignVersionId: string; comparison: "qloo_vs_llm" | "policy_vs_policy";
  protocolVersion: string; modelVersion: string; policyVersionIds: string[]; plannedSampleSize: number;
  enrollmentClosesAt: string; state: "draft" | "frozen" | "ended"; endedAt?:string; endReason?:string;
}
export interface Policy { id: string; revision: number; campaignId: string; rationale: string; rankOffsets: {sku: string; positions: number}[]; trainingExperimentIds: string[]; evaluationExperimentId?: string; status: "proposed" | "insufficient_evidence" | "approved" }
export interface Store {
  id: string; name: string; token: string; csrf: string; expiresAt: string; revision: number; importId: string;
  books: Book[]; rules: Rule[]; campaigns: Campaign[]; shoppers: Shopper[]; jobs: Job[]; assignments: Assignment[];
  outcomes: Outcome[]; experiments: Experiment[]; policies: Policy[];
  feedback: {id: string; sessionId: string; runId: string; sku: string; type: string; at: string}[];
  reviews: {id: string; campaignId: string; decision: string; rationale: string; activeWorkSeconds: number; at: string; periodStart?:string;periodEnd?:string}[];
  imports: {id: string; status: string; baseRevision: number; books: Book[]; acceptedRowNumbers: number[]; errors: {row: number; field: string; message: string}[]; checksum: string}[];
  memberships: Membership[];
  staffSessions?: StaffSession[];
  privacyWithdrawals?: {shopperId:string;campaignId?:string;at:string}[];
  audit: {id: string; action: string; at: string; target: string}[];
  requests: Record<string, {hash: string; data: unknown; status: number}>;
}
