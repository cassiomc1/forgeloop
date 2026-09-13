import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { COMMANDS, parseArgs } from "../src/cli.js";
import { ARTIFACT_REGISTRY } from "../src/core/artifact-registry.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { ALL_KNOWN_ERROR_CODES, PUBLIC_ERROR_CODES } from "../src/core/error-codes.js";
import { readSchema } from "../src/core/schema-validation.js";
import { getPackageRoot } from "../src/core/templates.js";
import { validateDocumentationConformance, validateCliExamples, validateCliMutationClaim } from "../scripts/validate_documentation_conformance.mjs";
import { validateDocumentationManifest } from "../scripts/validate_documentation_manifest.mjs";
import { validateDocumentationReviewMatrix } from "../scripts/validate_documentation_review_matrix.mjs";

const packageRoot = getPackageRoot();

/**
 * Mutation helper that fails if the requested mutation did not modify content.
 */
function mustReplace(content, matcher, replacement, label) {
  const result = content.replace(matcher, replacement);
  assert.notEqual(result, content, `Mutation did not modify the fixture: ${label}`);
  return result;
}

/**
 * Inserts `insertedContent` just before the named canonical generated region's
 * END marker, using EOL that matches the fixture under test. Anchoring on the
 * canonical region marker (rather than incidental option text) keeps the
 * mutation deterministic across platforms and independent of documentation
 * wording drift. Still fail-closed via mustReplace: if the region marker is
 * absent, the mutation does not apply.
 */
function insertBeforeGeneratedRegionEnd(content, region, insertedContent, eol, label) {
  const endMarker = `<!-- END FORGELOOP GENERATED: ${region} -->`;
  return mustReplace(
    content,
    endMarker,
    [insertedContent, "", endMarker].join(eol),
    label,
  );
}

async function copyDocsFixture(tempDir) {
  await cp("docs", path.join(tempDir, "docs"), { recursive: true });
  await cp("schemas", path.join(tempDir, "schemas"), { recursive: true });
  await cp("src", path.join(tempDir, "src"), { recursive: true });
  await cp("README.md", path.join(tempDir, "README.md"));
  await cp("AGENTS.md", path.join(tempDir, "AGENTS.md"));
  await cp("CLAUDE.md", path.join(tempDir, "CLAUDE.md"));
  await cp("LOOP_ENGINEERING.md", path.join(tempDir, "LOOP_ENGINEERING.md"));
  await cp("PROTOCOL_INTEGRATION.md", path.join(tempDir, "PROTOCOL_INTEGRATION.md"));
  await cp(".cursor", path.join(tempDir, ".cursor"), { recursive: true });
  await cp(".github", path.join(tempDir, ".github"), { recursive: true });
  await cp("LOOP_SYSTEM_DESIGN.md", path.join(tempDir, "LOOP_SYSTEM_DESIGN.md"));
  await cp("ORCHESTRATOR_INTEGRATION.md", path.join(tempDir, "ORCHESTRATOR_INTEGRATION.md"));
  await normalizeFixtureToLF(path.join(tempDir, "docs"));
  await normalizeFixtureToLF(path.join(tempDir, "schemas"));
  await normalizeFixtureToLF(path.join(tempDir, "src"));
  await normalizeFixtureToLF(path.join(tempDir, "README.md"));
  await normalizeFixtureToLF(path.join(tempDir, "AGENTS.md"));
  await normalizeFixtureToLF(path.join(tempDir, "CLAUDE.md"));
  await normalizeFixtureToLF(path.join(tempDir, "LOOP_ENGINEERING.md"));
  await normalizeFixtureToLF(path.join(tempDir, "PROTOCOL_INTEGRATION.md"));
  await normalizeFixtureToLF(path.join(tempDir, "LOOP_SYSTEM_DESIGN.md"));
  await normalizeFixtureToLF(path.join(tempDir, "ORCHESTRATOR_INTEGRATION.md"));
  return tempDir;
}

// Normalize every committed file in the fixture tree to canonical LF before
// mutation assertions. Git checkouts may be CRLF on Windows, which would break
// literal EOL-terminated matchers; the conformance validator normalizes
// internally too, so LF is the canonical form for mutation fixtures. This does
// NOT weaken validator CRLF handling — the LF/CRLF drift test still exercises
// both line-ending inputs directly.
async function normalizeFixtureToLF(target) {
  const stats = await stat(target);
  if (!stats.isDirectory()) {
    if (stats.isFile() && target.endsWith(".md")) {
      const original = await readFile(target, "utf8");
      const normalized = original.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (normalized !== original) {
        await writeFile(target, normalized, "utf8");
      }
    }
    return;
  }
  const entries = await readdir(target, { withFileTypes: true });
  for (const child of entries) {
    await normalizeFixtureToLF(path.join(target, child.name));
  }
}

test("validateDocumentationConformance passes on repository docs", async () => {
  const result = await validateDocumentationConformance();
  assert.equal(result.valid, true, `Expected valid documentation conformance, got errors: ${result.errors.join("\n")}`);
  assert.equal(result.errors.length, 0);
  assert.ok(result.summary.taggedArtifactsCount >= 13);
  assert.equal(result.summary.commandsCount, Object.keys(CLI_COMMAND_DEFINITIONS).length);
  assert.ok(result.summary.publicErrorCodesCount >= 13);
  assert.equal(result.summary.discoverySurfacesCount, 4);
});

test("documentation manifest classifies package documents and maps normative requirements", async () => {
  const result = await validateDocumentationManifest();
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.ok(result.summary.documents >= 28);
  assert.ok(result.summary.requirements >= 1);
});

test("documentation manifest rejects an unmapped normative requirement", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-manifest-test-"));
  try {
    await cp("docs", path.join(tempDir, "docs"), { recursive: true });
    await cp("src", path.join(tempDir, "src"), { recursive: true });
    await cp("tests", path.join(tempDir, "tests"), { recursive: true });
    await cp("LOOP_ENGINEERING.md", path.join(tempDir, "LOOP_ENGINEERING.md"));
    await cp("GUIDE_ROUTER.md", path.join(tempDir, "GUIDE_ROUTER.md"));
    await cp("TERMINOLOGY.md", path.join(tempDir, "TERMINOLOGY.md"));
    await cp("THREAT_MODEL.md", path.join(tempDir, "THREAT_MODEL.md"));
    const requirements = path.join(tempDir, "docs", "protocol-requirements.json");
    await writeFile(requirements, JSON.stringify({ version: 1, requirements: {} }, null, 2));
    const result = await validateDocumentationManifest({ rootDir: tempDir });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("DOC_REQUIREMENT_MAPPING_MISSING: FL-CONT-001")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("documentation review matrix covers every manifest document", async () => {
  const result = await validateDocumentationReviewMatrix();
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.summary.documents, result.summary.reviewed);
});

test("ARTIFACT_REGISTRY covers all public schemas and matches ARTIFACT_REFERENCE", async () => {
  for (const [key, artifact] of Object.entries(ARTIFACT_REGISTRY)) {
    assert.ok(artifact.key, `Artifact ${key} must have key`);
    assert.ok(artifact.path, `Artifact ${key} must have path`);
    assert.ok(artifact.schema || artifact.owner === "EXTERNAL_SIGNING_PROVIDER", `Artifact ${key} must have schema`);
    assert.ok(artifact.owner, `Artifact ${key} must have owner`);
    assert.ok(artifact.mutability, `Artifact ${key} must have mutability`);
    assert.ok(artifact.trustRole, `Artifact ${key} must have trustRole`);

    // Verify schema can be loaded
    if (artifact.schema) {
      const schema = await readSchema(artifact.schema, packageRoot);
      assert.ok(schema, `Schema ${artifact.schema} must load successfully`);
    }
  }
});

test("CLI_COMMAND_DEFINITIONS covers every declared command with valid options", () => {
  for (const command of COMMANDS) {
    const def = CLI_COMMAND_DEFINITIONS[command];
    assert.ok(def, `Command ${command} must exist in CLI_COMMAND_DEFINITIONS`);
    assert.equal(def.name, command);
    assert.ok(["lifecycle", "continuity", "verification", "policy-audit", "project-maintenance", "diagnostics", "actions", "task", "workspace", "scope", "attestation"].includes(def.category));
    assert.ok(["READ_ONLY", "MUTATING", "EXTERNAL_EXECUTION"].includes(def.mutation));
    assert.ok(Object.keys(def.options).includes("--help"));
    assert.ok(Object.keys(def.options).includes("--version"));
  }
});

test("CLI parser behavior matches CLI_COMMAND_DEFINITIONS options", () => {
  // Test init does NOT accept --adopt
  assert.throws(() => {
    parseArgs(["init", "--adopt", "foo"]);
  }, /Option --adopt is not valid for init/i);

  // Test doctor DOES accept --adopt
  const parsedDoctor = parseArgs(["doctor", "--adopt", "foo"]);
  assert.deepEqual(parsedDoctor.options.adopt, ["foo"]);

  // Test route accepts --work and flags
  const parsedRoute = parseArgs(["route", "--work", "code", "--behavior-change"]);
  assert.equal(parsedRoute.options.workType, "code");
  assert.equal(parsedRoute.options.behaviorChange, true);
});

test("PUBLIC_ERROR_CODES covers all documented stable codes", () => {
  for (const [key, errorMeta] of Object.entries(PUBLIC_ERROR_CODES)) {
    assert.equal(key, errorMeta.code);
    assert.equal(errorMeta.classification, "PUBLIC_STABLE");
    assert.ok(errorMeta.meaning);
    assert.ok(errorMeta.safeResolution);
    assert.ok(ALL_KNOWN_ERROR_CODES.has(errorMeta.code));
  }
});

test("negative fixtures & mutation tests: validateDocumentationConformance detects doc drift across LF and CRLF", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-doc-test-"));

  try {
    // Copy repository structure to tempDir
    await copyDocsFixture(tempDir);

    // Baseline check
    const baseline = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(baseline.valid, true);

    const docFile = path.join(tempDir, "docs", "ARTIFACT_REFERENCE.md");
    const cliDocFile = path.join(tempDir, "docs", "CLI_REFERENCE.md");

    for (const eol of ["\n", "\r\n"]) {
      // Setup files in target EOL mode
      const docContent = (await readFile(docFile, "utf8")).replace(/\r?\n/g, eol);
      const cliContent = (await readFile(cliDocFile, "utf8")).replace(/\r?\n/g, eol);

      // Mutation 1: execution.kind corrupted from COMMAND_EXECUTION to command
      const mutDoc1 = mustReplace(docContent, "COMMAND_EXECUTION", "command", `execution.kind (${eol === "\n" ? "LF" : "CRLF"})`);
      await writeFile(docFile, mutDoc1, "utf8");
      const mut1 = await validateDocumentationConformance({ rootDir: tempDir });
      assert.equal(mut1.valid, false);
      assert.ok(mut1.errors.some((e) => e.includes("DOC_EXECUTION_KIND_CONST_MISMATCH")));
      await writeFile(docFile, docContent, "utf8");

      // Mutation 2: execution.exitCode corrupted to integer only
      const mutDoc2 = mustReplace(docContent, "- `exitCode` *(integer or null, required)", "- `exitCode` *(integer, required)", `execution.exitCode (${eol === "\n" ? "LF" : "CRLF"})`);
      await writeFile(docFile, mutDoc2, "utf8");
      const mut2 = await validateDocumentationConformance({ rootDir: tempDir });
      assert.equal(mut2.valid, false);
      assert.ok(mut2.errors.some((e) => e.includes("DOC_EXECUTION_EXIT_CODE_TYPE_MISMATCH")));
      await writeFile(docFile, docContent, "utf8");

      // Mutation 3: init documented with --adopt
      const mutCli3 = insertBeforeGeneratedRegionEnd(
        cliContent,
        "cli:init:options",
        "- `--adopt <path>`: Adopt adapter.",
        eol,
        `init --adopt (${eol === "\n" ? "LF" : "CRLF"})`,
      );
      await writeFile(cliDocFile, mutCli3, "utf8");
      const mut3 = await validateDocumentationConformance({ rootDir: tempDir });
      assert.equal(mut3.valid, false);
      assert.ok(mut3.errors.some((e) => e.includes("DOC_INIT_ADOPT_EXTRA") || e.includes("DOC_CLI_OPTION_EXTRA")));
      await writeFile(cliDocFile, cliContent, "utf8");

      // Mutation 4: current-contract requirement id marked required
      const mutDoc4 = mustReplace(docContent, "- `id` *(string, optional", "- `id` *(string, required", `requirement.id (${eol === "\n" ? "LF" : "CRLF"})`);
      await writeFile(docFile, mutDoc4, "utf8");
      const mut4 = await validateDocumentationConformance({ rootDir: tempDir });
      assert.equal(mut4.valid, false);
      assert.ok(mut4.errors.some((e) => e.includes("DOC_CONTRACT_REQUIREMENT_ID_REQUIRED_MISMATCH")));
      await writeFile(docFile, docContent, "utf8");
    }

    // Mutation 5: Missing adapter task discovery rule
    const agentsFile = path.join(tempDir, "AGENTS.md");
    const agentsContent = await readFile(agentsFile, "utf8");
    const mutAgents5 = mustReplace(agentsContent, /forgeloop task-list/g, "forgeloop tasklist", "agents.md task discovery rule");
    await writeFile(agentsFile, mutAgents5, "utf8");
    const mut5 = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(mut5.valid, false);
    assert.ok(mut5.errors.some((e) => e.includes("DOC_ADAPTER_RESUME_RULE_MISSING")));
    await writeFile(agentsFile, agentsContent, "utf8");

    // Mutation 5b: Legacy singleton presented as the primary resume mechanism
    const mutAgents5b = mustReplace(
      agentsContent,
      /ForgeLoop applies regardless of model, provider/i,
      "ForgeLoop applies regardless of model, provider. If `.forgeloop/work-state.json` exists, resume it first.",
      "agents.md legacy-primary resume",
    );
    await writeFile(agentsFile, mutAgents5b, "utf8");
    const mut5b = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(mut5b.valid, false);
    assert.ok(mut5b.errors.some((e) => e.includes("DOC_ADAPTER_LEGACY_PRIMARY_RESUME")));
    await writeFile(agentsFile, agentsContent, "utf8");

    // Mutation 6: Legacy singleton path outside migration marker in docs/RECIPES.md
    const recipesFile = path.join(tempDir, "docs", "RECIPES.md");
    const recipesContent = await readFile(recipesFile, "utf8");
    const mutRecipes6 = recipesContent + "\n\nSee .forgeloop/current-contract.json directly.\n";
    await writeFile(recipesFile, mutRecipes6, "utf8");
    const mut6 = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(mut6.valid, false);
    assert.ok(mut6.errors.some((e) => e.includes("DOC_LEGACY_TASK_PATH_OUTSIDE_MIGRATION")));
    await writeFile(recipesFile, recipesContent, "utf8");

    // Mutation 7: Duplicate README topic
    const readmeFile = path.join(tempDir, "README.md");
    const readmeContent = await readFile(readmeFile, "utf8");
    const mutReadme7 = readmeContent + "\n\n## Cross-harness continuity\nDuplicate section\n";
    await writeFile(readmeFile, mutReadme7, "utf8");
    const mut7 = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(mut7.valid, false);
    assert.ok(mut7.errors.some((e) => e.includes("DOC_README_DUPLICATE_TOPIC")));
    await writeFile(readmeFile, readmeContent, "utf8");

    // Mutation 8: Invalid diagram reference
    const mutReadme8 = mustReplace(
      readmeContent,
      "forgeloop-lifecycle-animated.svg",
      "forgeloop-lifecycle-animated-missing.svg",
      "readme diagram reference",
    );
    await writeFile(readmeFile, mutReadme8, "utf8");
    const mut8 = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(mut8.valid, false);
    assert.ok(mut8.errors.some((e) => e.includes("DOC_README_DIAGRAM_REFERENCE_INVALID")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI example, mutation-claim, and legacy-path conformance regressions (DOC-CLI-*/DOC-MUT-*/DOC-PATH-*/DOC-COMP-*)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-doc-cli-"));
  try {
    await copyDocsFixture(tempDir);
    const baseline = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(baseline.valid, true, baseline.errors.join("\n"));

    const cliFile = path.join(tempDir, "docs", "CLI_REFERENCE.md");
    // Normalize to LF so mutations are EOL-safe on CRLF checkouts; the CRLF
    // baseline check below re-encodes explicitly.
    const cliContent = (await readFile(cliFile, "utf8")).replace(/\r\n/g, "\n");

    const runMutation = async (label, mutate, expectedCodes) => {
      const mutated = mutate(cliContent);
      assert.notEqual(mutated, cliContent, `Mutation did not modify fixture: ${label}`);
      await writeFile(cliFile, mutated, "utf8");
      const result = await validateDocumentationConformance({ rootDir: tempDir });
      assert.equal(result.valid, false, `Expected conformance failure for ${label}`);
      for (const code of expectedCodes) {
        assert.ok(
          result.errors.some((error) => error.includes(code)),
          `${label}: expected ${code}, got: ${result.errors.join("; ")}`,
        );
      }
      await writeFile(cliFile, cliContent, "utf8");
    };

    // DOC-CLI-1: activate does not accept --task
    await runMutation(
      "activate --task",
      (content) => mustReplace(
        content,
        "forgeloop activate --json",
        "forgeloop activate --task task-001 --json",
        "activate example",
      ),
      ["DOC_CLI_EXAMPLE_OPTION_UNSUPPORTED"],
    );

    // DOC-CLI-2 / DOC-CLI-3: task-create --id / --prompt are not real options
    await runMutation(
      "task-create --id/--prompt",
      (content) => mustReplace(
        content,
        "forgeloop task-create --task task-001 --claim src/auth --json",
        'forgeloop task-create --id task-001 --claim src/auth --prompt "Add auth module" --json',
        "task-create example",
      ),
      ["DOC_CLI_EXAMPLE_OPTION_UNSUPPORTED"],
    );

    // DOC-CLI-5 (invalid form): repeatable --claim must repeat the flag
    await runMutation(
      "task-scope single --claim with two values",
      (content) => mustReplace(
        content,
        "forgeloop task-scope --task task-001 --claim src/auth --claim tests/auth --json",
        "forgeloop task-scope --task task-001 --claim src/auth tests/auth --json",
        "task-scope example",
      ),
      ["DOC_CLI_EXAMPLE_POSITIONAL_UNEXPECTED"],
    );

    // DOC-CLI-6: PUBLICATION does not accept --status passed
    await runMutation(
      "record-terminal-result PUBLICATION passed",
      (content) => mustReplace(
        content,
        "--status published \\",
        "--status passed \\",
        "terminal result status",
      ),
      ["DOC_CLI_EXAMPLE_STATUS_INVALID"],
    );

    // DOC-MUT-1: profile-interview is READ_ONLY with writes=[]
    await runMutation(
      "profile-interview documented as mutating",
      (content) => mustReplace(
        content,
        "- **Mutation**: Read-only.\n- **Options**:\n\n<!-- BEGIN FORGELOOP GENERATED: cli:profile-interview:options -->",
        "- **Mutation**: Updates `PROJECT_PROFILE.md` if confirmed.\n- **Options**:\n\n<!-- BEGIN FORGELOOP GENERATED: cli:profile-interview:options -->",
        "profile-interview mutation",
      ),
      ["DOC_CLI_MUTATION_CLAIM_INVALID"],
    );

    // DOC-COMP-1: complete return status must list the full COMPLETION_STATUSES set
    await runMutation(
      "complete return status VALID only",
      (content) => mustReplace(
        content,
        "- **Return Status**: `VALID` or `REJECTED`.",
        "- **Return Status**: `VALID` only.",
        "complete return status",
      ),
      ["DOC_COMPLETION_RETURN_STATUS_MISMATCH"],
    );

    // DOC-CLI-CMD-1: example command must match the section command
    await runMutation(
      "task-create section contains forgeloop status",
      (content) => mustReplace(
        content,
        "forgeloop task-create --task task-001 --claim src/auth --json",
        "forgeloop status --json",
        "task-create section example",
      ),
      ["DOC_CLI_EXAMPLE_COMMAND_MISMATCH"],
    );

    // DOC-TERM-3: record-terminal-result --type SOMETHING is rejected
    await runMutation(
      "record-terminal-result unknown type",
      (content) => mustReplace(
        content,
        "--type PUBLICATION \\",
        "--type SOMETHING \\",
        "terminal result type",
      ),
      ["DOC_CLI_EXAMPLE_TYPE_INVALID"],
    );

    // DOC-TERM-4: valid type with invalid status is rejected (status set check)
    await runMutation(
      "record-terminal-result PUBLICATION passed",
      (content) => mustReplace(
        content,
        "--status published \\",
        "--status passed \\",
        "terminal result status",
      ),
      ["DOC_CLI_EXAMPLE_STATUS_INVALID"],
    );

    // DOC-COMP-EXACT-3: extra completion status must fail exact-set equality
    await runMutation(
      "complete return status with extra status",
      (content) => mustReplace(
        content,
        "- **Return Status**: `VALID` or `REJECTED`.",
        "- **Return Status**: `VALID` or `REJECTED` or `INVALID`.",
        "complete return status extra",
      ),
      ["DOC_COMPLETION_RETURN_STATUS_MISMATCH"],
    );

    // DOC-VERIFY-2: verificationStatus casing drift must fail
    await runMutation(
      "complete verificationStatus lower-case VALID",
      (content) => mustReplace(
        content,
      "- **Return Dimensions**: The evaluation result reports separate dimensions alongside the return status: `taskStatus` (`COMPLETE`/`INCOMPLETE`/`BLOCKED`), `verificationStatus` (`VALID`/`invalid`), `publicationStatus`, `productionReadiness`, and `errors[]` with the concrete rejection reasons.",
      "- **Return Dimensions**: The evaluation result reports separate dimensions alongside the return status: `taskStatus` (`COMPLETE`/`INCOMPLETE`/`BLOCKED`), `verificationStatus` (`valid`/`invalid`), `publicationStatus`, `productionReadiness`, and `errors[]` with the concrete rejection reasons.",
        "complete verificationStatus casing",
      ),
      ["DOC_COMPLETION_VERIFICATION_STATUS_MISMATCH"],
    );

    // DOC-MUT-2: conditional mutation claim on a READ_ONLY command is rejected
    await runMutation(
      "read-only command with conditional write claim",
      (content) => mustReplace(
        content,
        "- **Mutation**: Read-only.\n- **Options**:\n\n<!-- BEGIN FORGELOOP GENERATED: cli:progress:options -->",
        "- **Mutation**: Read-only by default; writes `.forgeloop/policy/discovery.json` only with `--write`.\n- **Options**:\n\n<!-- BEGIN FORGELOOP GENERATED: cli:progress:options -->",
        "progress conditional mutation",
      ),
      ["DOC_CLI_MUTATION_CLAIM_INVALID"],
    );

    // DOC-PATH-1: singleton task path in CLI_REFERENCE outside legacy markers
    await runMutation(
      "singleton path in CLI_REFERENCE",
      (content) => `${content}\n\nSee .forgeloop/work-state.json directly.\n`,
      ["DOC_LEGACY_TASK_PATH_OUTSIDE_MIGRATION"],
    );

    // DOC-PATH-2: singleton path inside explicit legacy markers is permitted
    const marked = `${cliContent}\n<!-- BEGIN FORGELOOP LEGACY LAYOUT EXAMPLE -->\nLegacy layouts store .forgeloop/execution-receipt.json at the repository root.\n<!-- END FORGELOOP LEGACY LAYOUT EXAMPLE -->\n`;
    await writeFile(cliFile, marked, "utf8");
    const withMarkers = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(withMarkers.valid, true, withMarkers.errors.join("\n"));
    await writeFile(cliFile, cliContent, "utf8");

    // EOL safety: the same CLI_REFERENCE with CRLF line endings (as checked out
    // on Windows CI) must also pass, including line-continuation examples.
    const crlfContent = cliContent.replace(/\r?\n/g, "\r\n");
    await writeFile(cliFile, crlfContent, "utf8");
    const crlfResult = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(crlfResult.valid, true, crlfResult.errors.join("\n"));
    await writeFile(cliFile, cliContent, "utf8");

    // DOC-CLI-4 / DOC-CLI-5 / DOC-CLI-7 valid examples and DOC-COMP-1 baseline stay valid
    const restored = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(restored.valid, true, restored.errors.join("\n"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("DOC-CLI-CMD-2 / DOC-TERM-1 / DOC-TERM-2 / DOC-COMP-EXACT-1 / DOC-VERIFY-1 positive conformance paths", () => {
  // DOC-CLI-CMD-2: section command matching its example command passes.
  const taskCreateDef = CLI_COMMAND_DEFINITIONS["task-create"];
  const matching = validateCliExamples(
    "### `task-create`\n\n```bash\nforgeloop task-create --task task-001 --json\n```\n",
    "task-create",
    taskCreateDef,
  );
  assert.deepEqual(matching, []);

  // Cross-command workflow examples are permitted when explicitly marked.
  const markedCrossCommand = validateCliExamples(
    "### `task-create`\n\n```bash\n# Cross-command workflow example: check state before creating the task\nforgeloop status --json\n```\n",
    "task-create",
    taskCreateDef,
  );
  assert.deepEqual(markedCrossCommand, []);

  // DOC-CLI-CMD-1: unmarked mismatch fails.
  const mismatched = validateCliExamples(
    "### `task-create`\n\n```bash\nforgeloop status --json\n```\n",
    "task-create",
    taskCreateDef,
  );
  assert.ok(mismatched.some((error) => error.includes("DOC_CLI_EXAMPLE_COMMAND_MISMATCH")));

  // DOC-TERM-1: PUBLICATION + published passes.
  const termDef = CLI_COMMAND_DEFINITIONS["record-terminal-result"];
  const publication = validateCliExamples(
    "```bash\nforgeloop record-terminal-result --requirement r1 --type PUBLICATION --status published --source s --result r\n```\n",
    "record-terminal-result",
    termDef,
  );
  assert.deepEqual(publication, []);

  // DOC-TERM-2: PRODUCTION_READINESS + ready passes.
  const productionReadiness = validateCliExamples(
    "```bash\nforgeloop record-terminal-result --requirement r1 --type PRODUCTION_READINESS --status ready --source s --result r\n```\n",
    "record-terminal-result",
    termDef,
  );
  assert.deepEqual(productionReadiness, []);

  // DOC-TERM-3: unsupported terminal type fails.
  const unknownType = validateCliExamples(
    "```bash\nforgeloop record-terminal-result --requirement r1 --type SOMETHING --status published --source s --result r\n```\n",
    "record-terminal-result",
    termDef,
  );
  assert.ok(unknownType.some((error) => error.includes("DOC_CLI_EXAMPLE_TYPE_INVALID")));

  // DOC-TERM-4: valid type with invalid status fails.
  const invalidStatus = validateCliExamples(
    "```bash\nforgeloop record-terminal-result --requirement r1 --type PUBLICATION --status passed --source s --result r\n```\n",
    "record-terminal-result",
    termDef,
  );
  assert.ok(invalidStatus.some((error) => error.includes("DOC_CLI_EXAMPLE_STATUS_INVALID")));

  // Conditional mutation claims are accepted on MUTATING commands with the
  // gating option (policy-discover), and rejected when the option is unknown.
  const policyDiscoverDef = CLI_COMMAND_DEFINITIONS["policy-discover"];
  const conditionalOk = validateCliMutationClaim(
    "- **Mutation**: Read-only by default; writes `.forgeloop/policy/discovery.json` and regenerates `.forgeloop/policy/policy.lock` only with `--write`.",
    "policy-discover",
    policyDiscoverDef,
  );
  assert.deepEqual(conditionalOk, []);

  const conditionalUnknownFlag = validateCliMutationClaim(
    "- **Mutation**: Read-only by default; writes `.forgeloop/policy/discovery.json` only with `--persist`.",
    "policy-discover",
    policyDiscoverDef,
  );
  assert.ok(conditionalUnknownFlag.some((error) => error.includes("DOC_CLI_MUTATION_CLAIM_INVALID")));
});

test("DOC-CROSS-1/2/3: cross-command examples validate positional args against the example command", () => {
  const taskCreateDef = CLI_COMMAND_DEFINITIONS["task-create"];
  const statusDef = CLI_COMMAND_DEFINITIONS["status"];

  // DOC-CROSS-1: `policy default --json` is valid inside a task-create section
  // when marked as a cross-command workflow example (policy accepts `<name>`).
  const crossValid = validateCliExamples(
    "### `task-create`\n\n```bash\n# Cross-command workflow example: apply policy then create the task\nforgeloop policy default --json\n```\n",
    "task-create",
    taskCreateDef,
  );
  assert.deepEqual(crossValid, []);

  // DOC-CROSS-2: `status` does not accept positional values, so a cross-command
  // example passing `unexpected-value` must fail.
  const crossInvalid = validateCliExamples(
    "### `policy`\n\n```bash\n# Cross-command workflow example: check status first\nforgeloop status unexpected-value --json\n```\n",
    "policy",
    statusDef,
  );
  assert.ok(crossInvalid.some((error) => error.includes("DOC_CLI_EXAMPLE_POSITIONAL_UNEXPECTED")));

  // DOC-CROSS-3: unmarked mismatches still fail with the section-match error.
  const unmarkedMismatch = validateCliExamples(
    "### `policy`\n\n```bash\nforgeloop status --json\n```\n",
    "policy",
    statusDef,
  );
  assert.ok(unmarkedMismatch.some((error) => error.includes("DOC_CLI_EXAMPLE_COMMAND_MISMATCH")));
});

test("DOC-LAYOUT-ARCH / DOC-TRANSITION / DOC-ADVANCE: architecture layout, canonical transitions, and advance prose conformance", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-arch-test-"));

  try {
    await copyDocsFixture(tempDir);

    const systemDesignFile = path.join(tempDir, "LOOP_SYSTEM_DESIGN.md");
    const orchestratorFile = path.join(tempDir, "ORCHESTRATOR_INTEGRATION.md");
    const cliReferenceFile = path.join(tempDir, "docs", "CLI_REFERENCE.md");

    // DOC-LAYOUT-ARCH-1 (PASS): current architecture documents the modern task-scoped layout
    const baseline = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(baseline.valid, true, `Baseline must be valid: ${baseline.errors.join("\n")}`);
    assert.ok((await readFile(systemDesignFile, "utf8")).includes(".forgeloop/task-state/"));

    // DOC-LAYOUT-ARCH-2 (FAIL): reintroducing a singleton task path as current architecture
    const systemDesign = await readFile(systemDesignFile, "utf8");
    const layoutMut = mustReplace(
      systemDesign,
      "and modern mutable task protocol state is isolated under `.forgeloop/task-state/<taskKey>/`.",
      "and mutable protocol artifacts remain directly under `.forgeloop/work-state.json`.",
      "DOC-LAYOUT-ARCH-2 singleton reintroduction",
    );
    await writeFile(systemDesignFile, layoutMut, "utf8");
    const layoutMutated = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(layoutMutated.valid, false);
    assert.ok(
      layoutMutated.errors.some((error) => error.includes("DOC_LEGACY_TASK_PATH_OUTSIDE_MIGRATION") && error.includes("LOOP_SYSTEM_DESIGN.md")),
      `Expected DOC_LEGACY_TASK_PATH_OUTSIDE_MIGRATION for LOOP_SYSTEM_DESIGN.md, got: ${layoutMutated.errors.join("\n")}`,
    );
    await writeFile(systemDesignFile, systemDesign, "utf8");

    // DOC-TRANSITION-1 (FAIL): removing REVIEWING -> CORRECTING from the documented table
    const orchestrator = await readFile(orchestratorFile, "utf8");
    const removeCorrecting = mustReplace(
      orchestrator,
      "| `REVIEWING` | an implementation or review finding requires correction | `CORRECTING` |\n",
      "",
      "DOC-TRANSITION-1 remove REVIEWING->CORRECTING",
    );
    await writeFile(orchestratorFile, removeCorrecting, "utf8");
    const removedEdge = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(removedEdge.valid, false);
    assert.ok(
      removedEdge.errors.some((error) => error.includes("DOC_TRANSITION_EDGE_MISSING") && error.includes("REVIEWING") && error.includes("CORRECTING")),
      `Expected DOC_TRANSITION_EDGE_MISSING for REVIEWING -> CORRECTING, got: ${removedEdge.errors.join("\n")}`,
    );

    // DOC-TRANSITION-2 (FAIL): adding an unsupported REVIEWING -> DESIGNING edge
    const mutatedOrchestrator = await readFile(orchestratorFile, "utf8");
    const addUnsupported = mustReplace(
      mutatedOrchestrator,
      "| `REVIEWING` | completion is rejected only for evidence | `VERIFYING` |",
      "| `REVIEWING` | completion is rejected only for evidence | `VERIFYING` |\n| `REVIEWING` | unsupported invention | `DESIGNING` |",
      "DOC-TRANSITION-2 add REVIEWING->DESIGNING",
    );
    await writeFile(orchestratorFile, addUnsupported, "utf8");
    const extraEdge = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(extraEdge.valid, false);
    assert.ok(
      extraEdge.errors.some((error) => error.includes("DOC_TRANSITION_EDGE_EXTRA") && error.includes("REVIEWING") && error.includes("DESIGNING")),
      `Expected DOC_TRANSITION_EDGE_EXTRA for REVIEWING -> DESIGNING, got: ${extraEdge.errors.join("\n")}`,
    );
    await writeFile(orchestratorFile, orchestrator, "utf8");

    // DOC-TRANSITION-3 (PASS): restored canonical set validates
    const restored = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(restored.valid, true, `Restored fixture must be valid: ${restored.errors.join("\n")}`);

    // DOC-ADVANCE-1 (PASS + FAIL mutation): advance Purpose must not publish a manual phase subset
    const cliReference = await readFile(cliReferenceFile, "utf8");
    assert.doesNotMatch(cliReference, /Purpose\*\*: Transitions between valid protocol phases/);
    const staleSubset = mustReplace(
      cliReference,
      "- **Purpose**: Transitions the task along a valid edge of the canonical ForgeLoop work-state machine. The destination is validated against the current phase and the canonical lifecycle transition rules.",
      "- **Purpose**: Transitions between valid protocol phases (`PLANNED`, `EXECUTING`, `VERIFYING`, `REVIEWING`).",
      "DOC-ADVANCE-1 stale phase subset",
    );
    await writeFile(cliReferenceFile, staleSubset, "utf8");
    const staleAdvance = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(staleAdvance.valid, false);
    assert.ok(
      staleAdvance.errors.some((error) => error.includes("DOC_ADVANCE_PHASE_SUBSET")),
      `Expected DOC_ADVANCE_PHASE_SUBSET, got: ${staleAdvance.errors.join("\n")}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
