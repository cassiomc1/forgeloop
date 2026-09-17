#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwardedArgs = process.argv.slice(2);

const steps = [
  {
    name: "Archify Diagram Verification",
    script: "scripts/check-documentation-diagrams.mjs",
    args: forwardedArgs,
  },
  {
    name: "Documentation Diagram Inventory",
    script: "scripts/documentation-diagram-inventory.mjs",
    args: ["--check"],
  },
  {
    name: "Generated Documentation Freshness",
    script: "scripts/generate_documentation_reference.mjs",
    args: ["--check"],
  },
  {
    name: "Generated Agent Summary Freshness",
    script: "scripts/generate-agent-protocol-summary.mjs",
    args: ["--check"],
  },
  {
    name: "Generated ForgeLoop Agent Skill Freshness",
    script: "scripts/generate-forgeloop-skill.mjs",
    args: ["--check"],
  },
  {
    name: "Documentation Conformance Validation",
    script: "scripts/validate_documentation_conformance.mjs",
    args: [],
  },
  {
    name: "Executable Documentation Examples",
    script: "scripts/validate_documentation_examples.mjs",
    args: [],
  },
  {
    name: "Documentation Manifest Validation",
    script: "scripts/validate_documentation_manifest.mjs",
    args: [],
  },
  {
    name: "Documentation Review Matrix Validation",
    script: "scripts/validate_documentation_review_matrix.mjs",
    args: [],
  },
];

console.log("Running ForgeLoop documentation check suite...\n");

for (const step of steps) {
  console.log(`▶ Running ${step.name}...`);
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, step.script), ...(step.args || [])], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`\n❌ Step failed: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n✅ All documentation checks passed successfully.");
