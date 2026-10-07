import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkDocumentationDiagrams } from "../scripts/check-documentation-diagrams.mjs";
import { validateDiagramReview } from "../scripts/documentation-diagram-review.mjs";
import { generateDocumentationDiagrams } from "../scripts/generate-documentation-diagrams.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRelativePath = "docs/diagrams/forgeloop-engineering-flow.workflow.json";
const svgRelativePath = "docs/assets/diagrams/forgeloop-engineering-flow.svg";
const reviewRelativePath = "docs/diagrams/reviews/forgeloop-engineering-flow.review.json";

const expected = {
  diagramId: "flow",
  sourceSha256: "a".repeat(64),
  svgSha256: "b".repeat(64),
};

function validReview() {
  return {
    version: 1,
    diagramId: "flow",
    status: "approved",
    binding: {
      sourceSha256: expected.sourceSha256,
      svgSha256: expected.svgSha256,
    },
    checks: {
      darkThemeLegible: true,
      noOverlap: true,
      labelsReadable: true,
      trustBoundariesClear: true,
      mobilePreviewAcceptable: true,
      textFallbackEquivalent: true,
      accessibleMetadataPresent: true,
    },
    reviewedBy: "repository-maintainer",
    reviewedAt: "2026-08-26",
  };
}

function assertReviewError(mutator, code) {
  const review = validReview();
  mutator(review);
  assert.throws(
    () => validateDiagramReview(review, expected),
    (error) => error.code === code && error.message.includes(code),
  );
}

async function copyDocumentationFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-documentation-diagrams-"));
  await cp(path.join(repositoryRoot, "docs"), path.join(rootDir, "docs"), {
    recursive: true,
    filter: (src) => !path.basename(src).startsWith(".archify-"),
  });
  await cp(path.join(repositoryRoot, "vendor"), path.join(rootDir, "vendor"), { recursive: true });
  await cp(path.join(repositoryRoot, "README.md"), path.join(rootDir, "README.md"));
  await cp(path.join(repositoryRoot, "DOCS_INDEX.md"), path.join(rootDir, "DOCS_INDEX.md"));
  await cp(path.join(repositoryRoot, "LOOP_SYSTEM_DESIGN.md"), path.join(rootDir, "LOOP_SYSTEM_DESIGN.md"));
  await cp(path.join(repositoryRoot, "QUALITY_SCORECARD.md"), path.join(rootDir, "QUALITY_SCORECARD.md"));
  return rootDir;
}

test("visual review accepts exact approved source and SVG binding", () => {
  assert.doesNotThrow(() => validateDiagramReview(validReview(), expected));
});

test("visual review rejects non-approved status", () => {
  assertReviewError((review) => { review.status = "pending"; }, "E_DIAGRAM_REVIEW_NOT_APPROVED");
});

test("visual review rejects invalid identity and bindings", () => {
  assertReviewError((review) => { review.diagramId = "other"; }, "E_DIAGRAM_REVIEW_INVALID");
  assertReviewError((review) => { delete review.binding.sourceSha256; }, "E_DIAGRAM_REVIEW_INVALID");
  assertReviewError((review) => { review.reviewedBy = ""; }, "E_DIAGRAM_REVIEW_INVALID");
  assertReviewError((review) => { review.reviewedAt = "26-08-2026"; }, "E_DIAGRAM_REVIEW_INVALID");
});

test("visual review rejects stale source and SVG fingerprints", () => {
  assertReviewError((review) => { review.binding.sourceSha256 = "c".repeat(64); }, "E_DIAGRAM_REVIEW_SOURCE_STALE");
  assertReviewError((review) => { review.binding.svgSha256 = "c".repeat(64); }, "E_DIAGRAM_REVIEW_SVG_STALE");
});

test("visual review rejects every incomplete required check", () => {
  for (const check of Object.keys(validReview().checks)) {
    assertReviewError((review) => { review.checks[check] = false; }, "E_DIAGRAM_REVIEW_CHECK_INCOMPLETE");
    assertReviewError((review) => { delete review.checks[check]; }, "E_DIAGRAM_REVIEW_CHECK_INCOMPLETE");
  }
});

test("generation preserves the human-owned review and emits no review state in receipts", async () => {
  const rootDir = await copyDocumentationFixture();
  try {
    const reviewPath = path.join(rootDir, reviewRelativePath);
    const receiptPath = path.join(rootDir, "docs/assets/diagrams/forgeloop-engineering-flow.receipt.json");
    const before = await readFile(reviewPath);
    await generateDocumentationDiagrams({ rootDir });
    const after = await readFile(reviewPath);
    assert.deepEqual(after, before);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(receiptPath, "utf8")), "visualReview"), false);
    await checkDocumentationDiagrams({ rootDir, reproducible: false });
  } finally {
    await removeTempTree(rootDir);
  }
});

test("diagram checking fails closed when one review is missing among multiple diagrams", async () => {
  const rootDir = await copyDocumentationFixture();
  try {
    await rm(path.join(rootDir, "docs/diagrams/reviews/forgeloop-verification-trust-flow.review.json"));
    await assert.rejects(
      () => checkDocumentationDiagrams({ rootDir, reproducible: false }),
      (error) => error.code === "E_DIAGRAM_REVIEW_MISSING"
        && error.message.includes("forgeloop-verification-trust-flow.review.json"),
    );
  } finally {
    await removeTempTree(rootDir);
  }
});

test("source drift invalidates the persisted visual approval after regeneration", async () => {
  const rootDir = await copyDocumentationFixture();
  try {
    await generateDocumentationDiagrams({ rootDir });
    const sourcePath = path.join(rootDir, sourceRelativePath);
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\n`, "utf8");
    await generateDocumentationDiagrams({ rootDir });
    await assert.rejects(
      () => checkDocumentationDiagrams({ rootDir, reproducible: false }),
      (error) => error.code === "E_DIAGRAM_REVIEW_SOURCE_STALE",
    );
  } finally {
    await removeTempTree(rootDir);
  }
});

test("SVG drift invalidates the persisted visual approval before freshness checks", async () => {
  const rootDir = await copyDocumentationFixture();
  try {
    await generateDocumentationDiagrams({ rootDir });
    const svgPath = path.join(rootDir, svgRelativePath);
    await writeFile(svgPath, `${await readFile(svgPath, "utf8")}\n`, "utf8");
    await assert.rejects(
      () => checkDocumentationDiagrams({ rootDir, reproducible: false }),
      (error) => error.code === "E_DIAGRAM_REVIEW_SVG_STALE",
    );
  } finally {
    await removeTempTree(rootDir);
  }
});

test("generation delegates governed but unimplemented types to the canonical renderer error", async () => {
  const rootDir = await copyDocumentationFixture();
  try {
    const manifestPath = path.join(rootDir, "docs/diagrams/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.diagrams[0].type = "architecture";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => generateDocumentationDiagrams({ rootDir }),
      (error) => {
        assert.equal(error.code, "E_DIAGRAM_RENDERER_NOT_IMPLEMENTED");
        assert.match(error.message, /architecture/);
        return true;
      },
    );
  } finally {
    await removeTempTree(rootDir);
  }
});
