// Display labels are explicit: an unknown configuration is never evidence of live use.
export function discoveryProviderNotice(mode: string) {
  if (mode === "fixture") return "These matches are illustrative samples. Qloo is not connected; no real purchase or taste prediction is claimed.";
  if (mode === "live") return "Live Qloo is configured. Each result labels its own source; simulated comparisons are separate. Stock and prices belong to a sample bookstore.";
  return "Qloo connection is not verified for this display. Do not treat these results as live Qloo evidence.";
}

export function discoveryEvidenceLabel(mode: string) {
  if (mode === "fixture") return "ILLUSTRATIVE MATCHES";
  if (mode === "simulation") return "SIMULATED COMPARISON";
  if (mode === "live") return "QLOO RANKED";
  return "UNVERIFIED SOURCE";
}

export function validDiscoveryBudget(value: string) {
  return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10000;
}
