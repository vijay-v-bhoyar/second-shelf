import type { Book, Campaign, Rule, RuleCase } from "./types";
import type { InventoryRow } from "./inventory-view";

export function rulePass(rule: Pick<Rule, "type" | "operand">, item: Pick<Book, "sku" | "language" | "format" | "priceMinor"> | RuleCase): boolean {
  switch (rule.type) {
    case "exclude_sku": return item.sku !== rule.operand;
    case "require_language": return item.language === rule.operand;
    case "require_format": return item.format === rule.operand;
    case "max_price_minor": return item.priceMinor <= Number(rule.operand);
  }
}

export function displayReadiness(campaign: Campaign | undefined, title: string, selected: string[], books: InventoryRow[], rules: Rule[], now = Date.now()) {
  const same = campaign && [...selected].sort().join("\0") === [...campaign.candidateSkus].sort().join("\0");
  const dirty = !campaign || title.trim() !== campaign.title || !same;
  const applicable = rules.filter(r => r.active && (r.scope === "store" || r.campaignId === campaign?.id));
  const expired = applicable.filter(r => !(Date.parse(r.reviewAt) > now));
  const blocked = selected.filter(sku => {
    const book = books.find(b => b.sku === sku);
    return !book || !book.eligible || applicable.some(r => !rulePass(r, book));
  });
  return { dirty, blocked, expired, ready: !!campaign && !dirty && !!title.trim() && selected.length > 0 && !blocked.length && !expired.length };
}

export function ruleExamples(type: Rule["type"], operand: string | number): {example: RuleCase; counterexample: RuleCase} {
  const example: RuleCase = {sku:type === "exclude_sku" ? String(operand) === "EXAMPLE-ALLOWED" ? "EXAMPLE-OTHER" : "EXAMPLE-ALLOWED" : "EXAMPLE-EDITION",language:type === "require_language" ? String(operand) : "en",format:type === "require_format" ? String(operand) : "paperback",priceMinor:type === "max_price_minor" ? Number(operand) : 1000,expectedPass:true};
  const counterexample = {...example,expectedPass:false};
  if(type === "exclude_sku")counterexample.sku=String(operand);
  if(type === "require_language")counterexample.language=String(operand) === "not-allowed" ? "other-language" : "not-allowed";
  if(type === "require_format")counterexample.format=String(operand) === "not-allowed" ? "other-format" : "not-allowed";
  if(type === "max_price_minor")counterexample.priceMinor=Number(operand)+1;
  return {example,counterexample};
}
