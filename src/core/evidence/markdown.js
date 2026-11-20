// Markdown projection of an evidence verification for CI step summaries and
// pull-request check runs. It never adds facts beyond the verification result.

const STATUS_LABEL = Object.freeze({
  ATTESTED: "Verified and signed",
  INTEGRITY_ONLY: "Consistent, unsigned",
  NONE: "Not verified",
});

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

function bundleRows(result) {
  if (result.bundles.length === 0) return ["No evidence bundles changed in this range."];
  return [
    "| Task | Integrity | Signature | Matching entries |",
    "| --- | --- | --- | --- |",
    ...result.bundles.map((bundle) => `| \`${escapeCell(bundle.taskId)}\` | ${bundle.integrity} | ${bundle.signature.status} | ${bundle.matchingEntries}/${bundle.entries} |`),
  ];
}

function listSection(title, items) {
  if (items.length === 0) return [];
  return ["", `### ${title}`, "", ...items.map((item) => `- ${item}`)];
}

export function formatEvidenceMarkdown(result) {
  const icon = result.status === "VALID" ? "✅" : "❌";
  return [
    `## ${icon} ForgeLoop evidence: ${STATUS_LABEL[result.level] ?? result.level}`,
    "",
    `Status \`${result.status}\`, level \`${result.level}\`${result.assurance && result.assurance !== "UNKNOWN" ? `, execution assurance \`${result.assurance}\`` : ""}: ${result.coveredPaths}/${result.changedPaths} changed paths covered.`,
    "",
    ...bundleRows(result),
    ...listSection("Uncovered paths", result.uncoveredPaths.map((value) => `\`${escapeCell(value)}\``)),
    ...listSection("Superseded entries", result.superseded.map((item) => `\`${escapeCell(item.path)}\` from \`${item.taskId}\`, covered by ${item.supersededBy.map((id) => `\`${id}\``).join(", ")}`)),
    ...listSection("Errors", result.errors.map((error) => `\`${error.code}\`: ${escapeCell(error.message)}`)),
    ...listSection("Warnings", result.warnings),
    "",
  ].join("\n");
}
