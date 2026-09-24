#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function validateDocumentationReviewMatrix({ rootDir = repositoryRoot } = {}) {
  const errors = [];
  const root = path.resolve(rootDir);
  let manifest;
  let matrix;
  try {
    manifest = JSON.parse(await readFile(path.join(root, "docs", "documentation-manifest.json"), "utf8"));
    matrix = JSON.parse(await readFile(path.join(root, "docs", "documentation-review-matrix.json"), "utf8"));
  } catch (error) {
    return { valid: false, errors: [`DOC_REVIEW_MATRIX_READ_FAILED: ${error.message}`], summary: { documents: 0 } };
  }

  if (matrix.version !== 1 || !Array.isArray(matrix.documents)) {
    errors.push("DOC_REVIEW_MATRIX_INVALID: version 1 documents array is required");
  }
  if (!matrix.diagramMigration || !Array.isArray(matrix.diagramMigration.activeMermaidArtifacts) || matrix.diagramMigration.activeMermaidArtifacts.length !== 0) {
    errors.push("DOC_REVIEW_MATRIX_DIAGRAM_MIGRATION_INVALID: activeMermaidArtifacts must be an empty array");
  }
  const manifestPaths = new Set((manifest.documents ?? []).map((document) => document.path));
  const manifestByPath = new Map((manifest.documents ?? []).map((document) => [document.path, document]));
  const matrixEntries = matrix.documents ?? [];
  const matrixPaths = new Set();
  for (const entry of matrixEntries) {
    if (!entry.path || matrixPaths.has(entry.path)) errors.push(`DOC_REVIEW_MATRIX_PATH_INVALID: ${entry.path ?? "<missing>"}`);
    matrixPaths.add(entry.path);
    if (entry.status !== "reviewed") errors.push(`DOC_REVIEW_MATRIX_STATUS_INVALID: ${entry.path}`);
    if (!['unchanged', 'updated', 'new'].includes(entry.action)) errors.push(`DOC_REVIEW_MATRIX_ACTION_INVALID: ${entry.path}`);
    if (!Array.isArray(entry.sourceOfTruth) || entry.sourceOfTruth.length === 0) errors.push(`DOC_REVIEW_MATRIX_SOURCE_MISSING: ${entry.path}`);
    if (!Array.isArray(entry.canonicalSources) || entry.canonicalSources.length === 0) errors.push(`DOC_REVIEW_MATRIX_CANONICAL_SOURCES_MISSING: ${entry.path}`);
    if (!['generated', 'handwritten'].includes(entry.origin)) errors.push(`DOC_REVIEW_MATRIX_ORIGIN_INVALID: ${entry.path}`);
    if (!['current', 'historical'].includes(entry.currency)) errors.push(`DOC_REVIEW_MATRIX_CURRENCY_INVALID: ${entry.path}`);
    if (!['npm', 'repository-only'].includes(entry.packageInclusion)) errors.push(`DOC_REVIEW_MATRIX_PACKAGE_INCLUSION_INVALID: ${entry.path}`);
    const source = manifestByPath.get(entry.path);
    if (source && entry.origin !== (source.class === "generated" ? "generated" : "handwritten")) errors.push(`DOC_REVIEW_MATRIX_ORIGIN_MISMATCH: ${entry.path}`);
    if (source && entry.packageInclusion !== (source.packaged ? "npm" : "repository-only")) errors.push(`DOC_REVIEW_MATRIX_PACKAGE_INCLUSION_MISMATCH: ${entry.path}`);
    try { await access(path.join(root, entry.path)); } catch { errors.push(`DOC_REVIEW_MATRIX_DOCUMENT_MISSING: ${entry.path}`); }
    for (const source of entry.sourceOfTruth ?? []) {
      try { await access(path.join(root, source)); } catch { errors.push(`DOC_REVIEW_MATRIX_SOURCE_INVALID: ${entry.path} -> ${source}`); }
    }
  }
  for (const manifestPath of manifestPaths) if (!matrixPaths.has(manifestPath)) errors.push(`DOC_REVIEW_MATRIX_ENTRY_MISSING: ${manifestPath}`);
  for (const matrixPath of matrixPaths) if (!manifestPaths.has(matrixPath)) errors.push(`DOC_REVIEW_MATRIX_ENTRY_ORPHAN: ${matrixPath}`);

  return { valid: errors.length === 0, errors, summary: { documents: manifestPaths.size, reviewed: matrixEntries.length } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateDocumentationReviewMatrix();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Documentation review matrix valid (${result.summary.reviewed} documents reviewed).`);
  }
}

