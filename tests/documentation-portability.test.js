import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { processGeneratedDocumentation } from "../scripts/generate_documentation_reference.mjs";
import { validateDocumentationConformance } from "../scripts/validate_documentation_conformance.mjs";
import { checkDocumentationDiagrams } from "../scripts/check-documentation-diagrams.mjs";

const EXPECTED_DIAGRAM_IDS = [
  "forgeloop-engineering-flow",
  "forgeloop-verification-trust-flow",
  "forgeloop-code-attestation-flow",
];

async function copyDiagramFixture(rootDir) {
  await cp("docs", path.join(rootDir, "docs"), {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith(".archify-"),
  });
  await cp("vendor", path.join(rootDir, "vendor"), { recursive: true });
  for (const file of ["README.md", "DOCS_INDEX.md", "LOOP_SYSTEM_DESIGN.md", "QUALITY_SCORECARD.md"]) {
    await cp(file, path.join(rootDir, file));
  }
}

test("documentation reference generator is deterministic and idempotent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-portability-"));

  try {
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
    await cp("ORCHESTRATOR_INTEGRATION.md", path.join(tempDir, "ORCHESTRATOR_INTEGRATION.md"));

    // First run --write
    const firstRun = await processGeneratedDocumentation({ rootDir: tempDir, write: true });
    assert.equal(
      firstRun.valid,
      true,
      `first generation failed: ${JSON.stringify(firstRun.errors, null, 2)}`,
    );

    const firstArtifactDoc = await readFile(path.join(tempDir, "docs", "ARTIFACT_REFERENCE.md"), "utf8");
    const firstCliDoc = await readFile(path.join(tempDir, "docs", "CLI_REFERENCE.md"), "utf8");
    const firstTroubleDoc = await readFile(path.join(tempDir, "docs", "TROUBLESHOOTING.md"), "utf8");

    // Second run --write
    const secondRun = await processGeneratedDocumentation({ rootDir: tempDir, write: true });
    assert.equal(
      secondRun.valid,
      true,
      `second generation failed: ${JSON.stringify(secondRun.errors, null, 2)}`,
    );
    assert.equal(secondRun.updatedFiles.length, 0, "Second generation must be a zero-diff no-op");

    const secondArtifactDoc = await readFile(path.join(tempDir, "docs", "ARTIFACT_REFERENCE.md"), "utf8");
    const secondCliDoc = await readFile(path.join(tempDir, "docs", "CLI_REFERENCE.md"), "utf8");
    const secondTroubleDoc = await readFile(path.join(tempDir, "docs", "TROUBLESHOOTING.md"), "utf8");

    assert.equal(secondArtifactDoc, firstArtifactDoc);
    assert.equal(secondCliDoc, firstCliDoc);
    assert.equal(secondTroubleDoc, firstTroubleDoc);

    // Check mode
    const checkRun = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(
      checkRun.valid,
      true,
      `check mode failed: ${JSON.stringify(checkRun.errors, null, 2)}`,
    );
    assert.equal(checkRun.errors.length, 0);
  } finally {
    await removeTempTree(tempDir);
  }
});

test("documentation generation and validation succeed in directory paths containing spaces", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop portability space-"));

  try {
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
    await cp("ORCHESTRATOR_INTEGRATION.md", path.join(tempDir, "ORCHESTRATOR_INTEGRATION.md"));

    const genResult = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(
      genResult.valid,
      true,
      `documentation generation failed: ${JSON.stringify(genResult.errors, null, 2)}`,
    );

    const confResult = await validateDocumentationConformance({ rootDir: tempDir });
    assert.equal(
      confResult.valid,
      true,
      `documentation validation failed: ${JSON.stringify(confResult.errors, null, 2)}`,
    );
  } finally {
    await removeTempTree(tempDir);
  }
});

test("Archify diagram check validates generated outputs and reproducibility", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diagram-check-"));
  try {
    await copyDiagramFixture(tempDir);
    const report = await checkDocumentationDiagrams({ rootDir: tempDir, reproducible: true });
    assert.equal(report.renderer.version, "2.15.0");
    assert.equal(report.renderer.commit, "e1ac748f19cf805e44bf74fb93c796662152e273");
    assert.equal(report.inventory.activeMermaid, false);
    assert.deepEqual(report.inventory.unreferencedVisualAssets, []);
    assert.deepEqual(report.diagrams.map((diagram) => diagram.id), EXPECTED_DIAGRAM_IDS);
    assert.ok(report.diagrams.every((diagram) => diagram.composition === "pass"));
  } finally {
    await removeTempTree(tempDir);
  }
});

test("generated documentation generator fails closed on missing, duplicate, invalid, or unknown regions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gen-mutation-"));

  try {
    await cp("docs", path.join(tempDir, "docs"), { recursive: true });
    await cp("schemas", path.join(tempDir, "schemas"), { recursive: true });
    await cp("src", path.join(tempDir, "src"), { recursive: true });
    await cp("ORCHESTRATOR_INTEGRATION.md", path.join(tempDir, "ORCHESTRATOR_INTEGRATION.md"));

    const cliDocPath = path.join(tempDir, "docs", "CLI_REFERENCE.md");
    const originalCliDoc = await readFile(cliDocPath, "utf8");

    // 1. Missing region marker -> DOC_GENERATED_REGION_MISSING
    const missingRegionDoc = originalCliDoc.replace(
      /<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->[\s\S]*?<!-- END FORGELOOP GENERATED: cli:init:options -->/,
      "- `--dry-run`: manual text",
    );
    await writeFile(cliDocPath, missingRegionDoc, "utf8");
    const missingRes = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(missingRes.valid, false);
    assert.ok(missingRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_MISSING") && e.includes("cli:init:options")));

    // 2. Duplicate BEGIN marker -> DOC_GENERATED_REGION_DUPLICATE
    const dupRegionDoc = originalCliDoc.replace(
      "<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->",
      "<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->\n<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->",
    );
    await writeFile(cliDocPath, dupRegionDoc, "utf8");
    const dupRes = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(dupRes.valid, false);
    assert.ok(dupRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_DUPLICATE") && e.includes("cli:init:options")));

    // 3. Missing END marker -> DOC_GENERATED_REGION_INVALID
    const invalidRegionDoc = originalCliDoc.replace(
      "<!-- END FORGELOOP GENERATED: cli:init:options -->",
      "",
    );
    await writeFile(cliDocPath, invalidRegionDoc, "utf8");
    const invalidRes = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(invalidRes.valid, false);
    assert.ok(invalidRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_INVALID") && e.includes("cli:init:options")));

    // 4. Unknown region marker -> DOC_GENERATED_REGION_UNKNOWN
    const unknownRegionDoc = originalCliDoc + "\n<!-- BEGIN FORGELOOP GENERATED: non-existent-region -->\nfoo\n<!-- END FORGELOOP GENERATED: non-existent-region -->\n";
    await writeFile(cliDocPath, unknownRegionDoc, "utf8");
    const unknownRes = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(unknownRes.valid, false);
    assert.ok(unknownRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_UNKNOWN") && e.includes("non-existent-region")));

    // 5. Stale region in check mode -> DOC_GENERATED_REGION_STALE
    const staleRegionDoc = originalCliDoc.replace(
      /<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->[\s\S]*?<!-- END FORGELOOP GENERATED: cli:init:options -->/,
      "<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->\n\n- `--stale-flag`: completely stale\n\n<!-- END FORGELOOP GENERATED: cli:init:options -->",
    );
    await writeFile(cliDocPath, staleRegionDoc, "utf8");
    const staleRes = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(staleRes.valid, false);
    assert.ok(staleRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_STALE") && e.includes("cli:init:options")));

    // 6. Write mode repairs stale region -> subsequent check passes
    const repairRes = await processGeneratedDocumentation({ rootDir: tempDir, write: true });
    assert.equal(repairRes.valid, true);
    assert.ok(repairRes.updatedFiles.includes("docs/CLI_REFERENCE.md"));

    // 7. Write mode performs ZERO writes when any structural error exists
    const brokenCliDoc = originalCliDoc
      .replace(
        /<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->[\s\S]*?<!-- END FORGELOOP GENERATED: cli:init:options -->/,
        "<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->\n\n- `--stale`: stale\n\n<!-- END FORGELOOP GENERATED: cli:init:options -->",
      )
      .replace("<!-- END FORGELOOP GENERATED: cli:doctor:options -->", "");
    await writeFile(cliDocPath, brokenCliDoc, "utf8");
    const snapshotBefore = await readFile(cliDocPath, "utf8");

    const failWriteRes = await processGeneratedDocumentation({ rootDir: tempDir, write: true });
    assert.equal(failWriteRes.valid, false);
    assert.deepEqual(failWriteRes.updatedFiles, []);

    const snapshotAfter = await readFile(cliDocPath, "utf8");
    assert.equal(snapshotAfter, snapshotBefore, "write mode must not modify files when validation fails");

    // 8. Nested region -> DOC_GENERATED_REGION_NESTED
    const doctorMatch = originalCliDoc.match(/<!-- BEGIN FORGELOOP GENERATED: cli:doctor:options -->[\s\S]*?<!-- END FORGELOOP GENERATED: cli:doctor:options -->/);
    const docWithoutDoctor = originalCliDoc.replace(doctorMatch[0], "");
    const nestedDoc = docWithoutDoctor.replace(
      "<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->",
      `<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->\n${doctorMatch[0]}`,
    );
    await writeFile(cliDocPath, nestedDoc, "utf8");
    const nestedRes = await processGeneratedDocumentation({ rootDir: tempDir, write: false });
    assert.equal(nestedRes.valid, false);
    assert.ok(nestedRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_NESTED")));
  } finally {
    await removeTempTree(tempDir);
  }
});
