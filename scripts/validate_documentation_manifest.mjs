#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_DOCUMENT_FIELDS = ["path", "id", "class", "audience", "canonicalFor", "packaged"];
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdc"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

async function collectPackageDocuments(rootDir, currentDir, documents) {
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectPackageDocuments(rootDir, absolutePath, documents);
    } else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      documents.add(toPosix(path.relative(rootDir, absolutePath)));
    }
  }
}

async function packageDocuments(rootDir) {
  const packageJson = await readJson(path.join(rootDir, "package.json"));
  const documents = new Set();
  for (const entry of packageJson.files ?? []) {
    if (/[*?[\]]/u.test(entry)) continue;
    const relative = entry.replace(/^\.\//u, "");
    const absolutePath = path.join(rootDir, relative);
    let metadata;
    try {
      metadata = await stat(absolutePath);
    } catch {
      continue;
    }
    if (metadata.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(relative).toLowerCase())) documents.add(relative);
    if (metadata.isDirectory()) await collectPackageDocuments(rootDir, absolutePath, documents);
  }
  return documents;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function validateDocumentationManifest({ rootDir = repositoryRoot } = {}) {
  const errors = [];
  const manifest = await readJson(path.join(rootDir, "docs", "documentation-manifest.json"));
  const requirementMap = await readJson(path.join(rootDir, "docs", "protocol-requirements.json"));
  const packageDocs = await packageDocuments(rootDir);
  if (manifest.version !== 1 || !Array.isArray(manifest.documents)) errors.push("DOC_MANIFEST_INVALID: version 1 documents array is required");
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  const paths = new Set(); const ids = new Set(); const canonicalOwners = new Map();
  for (const doc of documents) {
    for (const field of REQUIRED_DOCUMENT_FIELDS) if (!(field in doc)) errors.push(`DOC_MANIFEST_FIELD_MISSING: ${doc.path ?? "<unknown>"} missing ${field}`);
    if (paths.has(doc.path)) errors.push(`DOC_MANIFEST_PATH_DUPLICATE: ${doc.path}`); paths.add(doc.path);
    if (ids.has(doc.id)) errors.push(`DOC_MANIFEST_ID_DUPLICATE: ${doc.id}`); ids.add(doc.id);
    if (!Array.isArray(doc.audience) || !Array.isArray(doc.canonicalFor)) errors.push(`DOC_MANIFEST_ARRAY_INVALID: ${doc.path}`);
    if (doc.class === "generated" && !doc.generator) errors.push(`DOC_MANIFEST_GENERATOR_REQUIRED: ${doc.path}`);
    if (doc.class === "deprecated" && (!doc.replacement || !doc.removalPolicy)) errors.push(`DOC_MANIFEST_DEPRECATION_REQUIRED: ${doc.path}`);
    for (const concept of doc.canonicalFor ?? []) {
      if (canonicalOwners.has(concept)) errors.push(`DOC_MANIFEST_CANONICAL_CONFLICT: ${concept} owned by ${canonicalOwners.get(concept)} and ${doc.path}`);
      canonicalOwners.set(concept, doc.path);
    }
    try { await access(path.join(rootDir, doc.path)); } catch { errors.push(`DOC_MANIFEST_DOCUMENT_MISSING: ${doc.path}`); }
  }
  for (const document of await packageDocuments(rootDir)) if (!paths.has(document)) errors.push(`DOC_MANIFEST_PACKAGED_DOCUMENT_MISSING: ${document}`);
  for (const document of documents) {
    if (document.packaged && !packageDocs.has(document.path)) errors.push(`DOC_MANIFEST_PACKAGE_FLAG_INVALID: ${document.path}`);
  }
  const mappedRequirements = new Map(Object.entries(requirementMap.requirements ?? {}));
  const discoveredRequirementIds = new Map();
  for (const doc of documents.filter((item) => item.class === "normative")) {
    let content;
    try { content = await readFile(path.join(rootDir, doc.path), "utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!/\bMUST(?: NOT)?\b/.test(lines[index])) continue;
      const nearby = lines.slice(Math.max(0, index - 1), index + 1).join("\n");
      const anchor = nearby.match(/id="(FL-[A-Z]+-\d{3})"/);
      if (!anchor) {
        errors.push(`DOC_REQUIREMENT_ID_MISSING: ${doc.path}:${index + 1}`);
        continue;
      }
      discoveredRequirementIds.set(anchor[1], doc.path);
    }
  }
  for (const [id, requirement] of mappedRequirements) {
    if (!/^FL-[A-Z]+-\d{3}$/.test(id)) errors.push(`DOC_REQUIREMENT_ID_INVALID: ${id}`);
    if (!requirement.source || !Array.isArray(requirement.tests) || !requirement.tests.length || !requirement.validator) errors.push(`DOC_REQUIREMENT_MAPPING_INCOMPLETE: ${id}`);
    const source = requirement.source ? path.join(rootDir, requirement.source) : null;
    try {
      const content = await readFile(source, "utf8");
      if (!content.includes(`id=\"${id}\"`)) errors.push(`DOC_REQUIREMENT_ANCHOR_MISSING: ${id}`);
      if (!content.includes("MUST") && !content.includes("MUST NOT")) errors.push(`DOC_REQUIREMENT_NORMATIVE_TEXT_MISSING: ${id}`);
    } catch { errors.push(`DOC_REQUIREMENT_SOURCE_MISSING: ${id}`); }
    for (const file of [...(requirement.tests ?? []), requirement.validator].filter(Boolean)) {
      try { await access(path.join(rootDir, file)); } catch { errors.push(`DOC_REQUIREMENT_MAPPING_FILE_MISSING: ${id}: ${file}`); }
    }
    if (!discoveredRequirementIds.has(id)) errors.push(`DOC_REQUIREMENT_UNUSED_MAPPING: ${id}`);
  }
  for (const [id, source] of discoveredRequirementIds) {
    if (!mappedRequirements.has(id)) errors.push(`DOC_REQUIREMENT_MAPPING_MISSING: ${id} in ${source}`);
  }
  return { valid: errors.length === 0, errors, summary: { documents: documents.length, requirements: mappedRequirements.size } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateDocumentationManifest();
  if (!result.valid) { for (const error of result.errors) console.error(error); process.exitCode = 1; }
  else console.log(`Documentation manifest valid (${result.summary.documents} documents; ${result.summary.requirements} normative requirements).`);
}
