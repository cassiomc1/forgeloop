import { collectAssessmentFacts } from "../core/assessment/facts.js";
import { buildReviewPlan } from "../core/assessment/plan.js";

export const ASSESSMENT_SCHEMA_VERSION = 1;

export async function runAssess({ target = process.cwd() } = {}) {
  const facts = await collectAssessmentFacts(target);
  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    kind: "repository-assessment-plan",
    authority: "DISCOVERY_ONLY",
    evidenceAuthority: "NONE",
    facts,
    reviewPlan: buildReviewPlan(facts),
  };
}

export function formatAssessResult(result) {
  const { facts, reviewPlan } = result;
  const lines = [
    "FORGELOOP REPOSITORY ASSESSMENT (discovery only, nothing executed):",
    `Stack: ${facts.stack.status === "DETECTED" ? facts.stack.frameworks.join(", ") || "none" : "not determined"}`,
    `Tests discovered: ${facts.tests.total} in ${facts.tests.files} files`,
    "Areas:",
  ];
  for (const area of reviewPlan.areas) lines.push(`  - ${area.area}: ${area.guides.map((guide) => guide.id).join(", ")}`);
  if (reviewPlan.areas.length === 0) lines.push("  - none detected");
  lines.push("Candidate checks (NOT_EXECUTED):");
  for (const check of reviewPlan.candidateChecks) lines.push(`  - ${check.argv.join(" ")} [${check.purpose}; ${check.source}]`);
  if (reviewPlan.candidateChecks.length === 0) lines.push("  - none detected");
  lines.push("Observed gaps:");
  for (const gap of reviewPlan.gaps) lines.push(`  - ${gap.code}: ${gap.message}`);
  if (reviewPlan.gaps.length === 0) lines.push("  - none");
  lines.push("Next steps:", ...reviewPlan.nextSteps.map((step) => `  - ${step}`));
  return `${lines.join("\n")}\n`;
}
