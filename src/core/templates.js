import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isNativeAdapterPath,
  legacyPathForSource,
  targetPathForSource,
} from "./target-layout.js";
import { nativeShim } from "./native-adapters.js";
import { GUIDE_TEMPLATE_PATHS } from "./guide-registry.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TEMPLATE_SOURCE_PATHS = Object.freeze({
  ".forgeloop/.gitignore": ".forgeloop/forgeloop.gitignore",
});

export const TEMPLATE_PATHS = [
  ".forgeloop/.gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/project-loop.mdc",
  ".github/copilot-instructions.md",
  "LOOP_ENGINEERING.md",
  "GUIDE_ROUTER.md",
  "PROJECT_PROFILE.md",
  "LOOP_SYSTEM_DESIGN.md",
  "QUALITY_SCORECARD.md",
  "TERMINOLOGY.md",
  "EXECUTION_STATE.md",
  "DELEGATION_PROTOCOL.md",
  "ORCHESTRATOR_INTEGRATION.md",
  "THREAT_MODEL.md",
  "CONTRACT_COVERAGE.md",
  "PROTOCOL_INTEGRATION.md",
  "AGENT_COMPATIBILITY.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
  "LICENSE-DOCS.md",
  ...GUIDE_TEMPLATE_PATHS,
  "schemas/routing-input.schema.json",
  "schemas/routing-result.schema.json",
  "schemas/work-state.schema.json",
  "schemas/continuity.schema.json",
  "schemas/execution-receipt.schema.json",
  "schemas/task-brief.schema.json",
  "schemas/delegated-result.schema.json",
  "schemas/evidence.schema.json",
  "schemas/current-contract.schema.json",
  "schemas/gate.schema.json",
  "schemas/source-registry.schema.json",
  "schemas/config.schema.json",
  "schemas/preflight.schema.json",
  "schemas/check.schema.json",
  "schemas/execution.schema.json",
  "schemas/evidence-coverage.schema.json",
  "schemas/event.schema.json",
  "schemas/activation.schema.json",
  "schemas/policy.schema.json",
  "schemas/policy-rules.schema.json",
  "schemas/policy-discovery.schema.json",
  "schemas/policy-baseline.schema.json",
  "schemas/policy-lock.schema.json",
  "schemas/policy-snapshot.schema.json",
  "schemas/task-bundle.schema.json",
  "schemas/authority.schema.json",
  "schemas/task-descriptor.schema.json",
  "schemas/task-recovery.schema.json",
  "schemas/diagnostic-case.schema.json",
  "schemas/intervention.schema.json",
  "schemas/hypothesis-disposition.schema.json",
  "schemas/action.schema.json",
  "schemas/approval.schema.json",
  "schemas/capability-policy.schema.json",
  "schemas/trajectory-evaluation.schema.json",
  "schemas/trajectory-scenario.schema.json",
  "schemas/workspace-binding.schema.json",
  "schemas/handoff-envelope.schema.json",
  "schemas/responsibility.schema.json",
  "schemas/verification-scope.schema.json",
  "schemas/code-manifest.schema.json",
  "schemas/code-attestation.schema.json",
  "schemas/attestation-verification-result.schema.json",
  "schemas/in-toto-statement.schema.json",
  "schemas/usage.schema.json",
  "schemas/execution-profile-benchmark-scenario.schema.json",
  "schemas/execution-profile-benchmark-run.schema.json",
  "schemas/execution-profile-benchmark-aggregate.schema.json",
  "schemas/structural-quality.schema.json",
  "schemas/semantic-decision.schema.json",
  "schemas/context-plan.schema.json",
  "schemas/test-utility.schema.json",
];

export function getPackageRoot() {
  return PACKAGE_ROOT;
}

export async function readTemplateEntries(packageRoot = PACKAGE_ROOT) {
  return Promise.all(
    TEMPLATE_PATHS.map(async (relativePath) => {
      const sourcePath = TEMPLATE_SOURCE_PATHS[relativePath] ?? relativePath;
      return {
        relativePath: targetPathForSource(relativePath),
        sourcePath,
        legacyRelativePath: legacyPathForSource(sourcePath),
        bytes: Buffer.from(isNativeAdapterPath(relativePath)
          ? nativeShim(relativePath)
          : await readFile(path.join(packageRoot, sourcePath))),
      };
    }),
  );
}
