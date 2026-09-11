#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ARTIFACT_REGISTRY } from "../src/core/artifact-registry.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { PUBLIC_ERROR_REGISTRY } from "../src/core/error-codes.js";
import { PROJECT_DETECTION_LIMITS, PROJECT_EVIDENCE_SCHEMA_VERSION } from "../src/core/project-detection.js";
import { GUIDE_REGISTRY } from "../src/core/guide-registry.js";
import { protocolInfo } from "../src/core/protocol-info.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repositoryRoot, "docs", "AGENT_PROTOCOL_SUMMARY.md");

function cell(value) {
  const normalized = String(value ?? "");
  return (normalized || "n/a").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function table(headers, rows) {
  const lines = [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

function commandCatalog() {
  const groups = new Map();
  for (const command of Object.values(CLI_COMMAND_DEFINITIONS).sort((left, right) => left.name.localeCompare(right.name))) {
    const commands = groups.get(command.category) ?? [];
    commands.push(command);
    groups.set(command.category, commands);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, commands]) => [
      `### ${category}`,
      table(["Command", "Mutation", "Purpose"], commands.map((command) => [command.name, command.mutation, command.description])),
    ])
    .flat()
    .join("\n\n");
}

function guideCatalog() {
  const rows = Object.entries(GUIDE_REGISTRY)
    .map(([id, definition]) => [id, definition.path, definition.install ? "yes" : "no"]);
  return `## Guide registry\n\n${table(["Guide", "Path", "Installable"], rows)}`;
}

async function render() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const info = protocolInfo({ packageVersion: packageJson.version });
  const features = Object.entries(info.features)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, feature]) => [name, feature.version ?? "n/a", feature.supported === false ? "no" : "yes"]);
  const handoffs = info.features.canonicalHandoffs;
  const advisory = info.features.advisoryContextProviders;
  const capabilityContracts = `## Capability contracts

- \`canonicalHandoffs\` v${handoffs.version}: immutable, supported, and
  ledger-backed for exactly-once operational acceptance through
  \`${handoffs.acceptanceCommand}\`. Acceptance statuses are
  \`${handoffs.acceptanceStatuses.join("\` / \`")}\`; it creates no claims,
  evidence, or lifecycle authority.
- \`advisoryContextProviders\` v${advisory.version}: provider-neutral,
  Integration-API-only, lazy, and opt-in. Provider results are not persisted by
  ForgeLoop and are never lifecycle state, evidence, authority, or executable
  instructions.

Protocol v1, schema v1, and Integration API v1 remain independent of these
capability-family versions.`;
  const artifacts = Object.values(ARTIFACT_REGISTRY)
    .filter((artifact) => artifact.isPublic)
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((artifact) => [artifact.key, artifact.scope, artifact.path, artifact.schema, artifact.trustRole]);
  const errors = Object.values(PUBLIC_ERROR_REGISTRY)
    .filter((error) => /^(E_(CLI|WORKSPACE|HANDOFF|RESPONSIBILITY|VERIFICATION_SCOPE|REVISION|ATTESTATION)_)/u.test(error.code))
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((error) => [error.code, error.meaning]);

  return `# ForgeLoop Agent Protocol Summary

> Generated from the ForgeLoop protocol registries. This file is a concise navigation aid; the normative documents, schemas, and CLI implementation remain authoritative.

## Scope

ForgeLoop is a portable protocol and support CLI for verifiable engineering workflows. It records and validates task state, contracts, routing, checks, evidence, continuity, and optional code attestations. It does not become an agent scheduler, delegation service, source-control authority, or secret manager.

Protocol version: ${info.protocolVersion}
Package version: ${packageJson.version}

## Canonical loop

1. Discover existing work with forgeloop task-list --json.
2. Select or create one task, then run forgeloop next --task <id> --json.
3. Persist the contract, route, gates, and source registry; require forgeloop preflight to return READY.
4. Execute bounded checks through the canonical CLI and preserve execution provenance.
5. Reconcile continuity, inspect evidence, and advance through VERIFYING and REVIEWING.
6. Run forgeloop complete; accept completion only when the validator returns VALID.
7. Run forgeloop next again and follow the returned lifecycle action to a terminal state or an explicit blocker.

## Project evidence and guide routing

- The canonical guide registry is \`src/config/guides.json\`; the .NET
  specialist has guide ID \`dotnet\` and resolves to
  \`ENG/dotnet-aspnetcore-development-eng.md\`.
- Project evidence schema v${PROJECT_EVIDENCE_SCHEMA_VERSION} recognizes
  structurally parsed Flutter and SDK-style .NET project roots. ASP.NET Core
  and ABP are conditional overlays recorded as reasons on \`dotnet\`; they
  are not standalone guide IDs, and route validation requires each overlay to
  include \`dotnet\`.
- Project detection is bounded by ${PROJECT_DETECTION_LIMITS.maxManifests}
  manifests, ${PROJECT_DETECTION_LIMITS.maxSolutionFiles} solution files,
  ${PROJECT_DETECTION_LIMITS.maxManifestBytes} bytes per manifest,
  ${PROJECT_DETECTION_LIMITS.maxSourceFiles} supporting source files,
  ${PROJECT_DETECTION_LIMITS.maxSourceBytes} bytes per source file,
  ${PROJECT_DETECTION_LIMITS.maxVisitedDirectories} visited directories, and
  ${PROJECT_DETECTION_LIMITS.maxVisitedEntries} visited entries. It skips
  symlinks and configured generated/vendor directories; exhausted budgets fail
  closed rather than producing unbounded discovery.
- Task ownership discovery is a separate exhaustive operation. Task-list
  filters and pagination project the validated discovery result and do not
  remove ledger or recovery evidence. See \`GUIDE_ROUTER.md\` and
  \`docs/CLI_REFERENCE.md\` for the operator-facing contracts.

## Adaptive execution profiles

\`complianceMode\` controls how strongly project policy is enforced. The
orthogonal \`executionProfile\` controls process and context depth: \`auto\`
resolves deterministically to \`light\`, \`balanced\`, or \`full\` from route,
contract, and task metadata. CLI requests take precedence over project
configuration, but a safety floor always wins. Profiles never remove required
contracts, gates, verification, provenance, lifecycle phases, or validated
completion. Protocol-v1 routes without the field project to \`balanced\` for
compatibility without rewriting historical artifacts.

For \`light\` tasks, hosts should use \`next --compact\` or \`task-show --compact\`,
load only relevant guide sections, keep plans concise, and avoid optional
reflection, trajectory evaluation, handoff, attestation, and continuity
artifacts unless requested, required, or needed for recovery. The lifecycle
chronology remains unchanged.

The read-only \`task/context\` integration resource provides the canonical
profile-aware projection: objective, deliverables, constraints, selected guide
IDs, phase, next action, verification requirements, and context policy. A
profile changes presentation and optional context only; it never permits a
phase or required gate to be skipped.

Usage telemetry is provider or host reported when available, actor-reported
only through the explicit \`usage-record\` fallback, and \`UNKNOWN\` otherwise.
ForgeLoop never estimates tokens or treats usage as verification evidence.
\`efficiency --task\` is read-only and returns \`NOT_COMPARABLE\` unless a
project-local baseline has matching metadata.

Measured execution-profile benchmarks are observational. The reproducible
runner accepts provider or host usage, records actual timing, requires PASS
verification and matching metadata for comparisons, and reports \`NOT_MEASURED\`
or \`NOT_COMPARABLE\` when evidence is absent or incompatible. See
\`docs/EXECUTION_PROFILE_BENCHMARKS.md\` for the runner and schemas.

## Authority boundaries

- Protocol-derived facts outrank actor-provided labels, free-form summaries, and guessed identities.
- Optional artifacts are reported as NOT_APPLICABLE when absent; malformed active security artifacts fail closed.
- Workspace binding confirms an explicit Git worktree identity but is not a portability requirement for attestation.
- Handoff envelopes record immutable intent and state snapshots; they do not delegate work or grant completion authority.
- Responsibility contracts constrain paths, checks, and frozen inputs; they do not prove identity or authorship.
- Verification scope describes planned verification breadth. Attestation coverage proves content for a concrete revision. These are separate claims.
- Attestation manifests exclude ForgeLoop protocol metadata and bind to the completion receipt and append-only ledger without circular references.
- Verification commands are read-only. Signing is external; private keys and credentials are never persisted by ForgeLoop.

## Lifecycle

Phases: ${info.lifecycle.phases.join(", ")}

## Feature registry

${table(["Feature", "Version", "Supported"], features)}

${capabilityContracts}

${guideCatalog()}

## Public artifact registry

${table(["Key", "Scope", "Path", "Schema", "Trust role"], artifacts)}

## Command catalog

${commandCatalog()}

## Stable boundary and attestation errors

${table(["Code", "Meaning"], errors)}

## Authoritative implementation surfaces

- Normative protocol: LOOP_ENGINEERING.md and PROTOCOL_INTEGRATION.md.
- Artifact contracts: schemas/.
- Lifecycle and command behavior: src/core/ and src/cli.js.
- Integration surface: src/integration.js, src/integration.d.ts, and integrations/.
- User-facing command and artifact references: docs/CLI_REFERENCE.md and docs/ARTIFACT_REFERENCE.md.
`;
}

const check = process.argv.includes("--check");
const content = await render();
let current = null;
try {
  current = await readFile(outputPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (check) {
  if (current !== content) {
    console.error(`Generated agent summary is stale: ${path.relative(repositoryRoot, outputPath)}`);
    process.exit(1);
  }
  console.log(`Generated agent summary is current: ${path.relative(repositoryRoot, outputPath)}`);
} else {
  await writeFile(outputPath, content, "utf8");
  console.log(`Generated ${path.relative(repositoryRoot, outputPath)}`);
}
