#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "../src/cli.js";
import { ARTIFACT_REGISTRY } from "../src/core/artifact-registry.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { PUBLIC_ERROR_REGISTRY } from "../src/core/error-codes.js";
import { WORK_PHASES, WORK_TRANSITIONS } from "../src/core/protocol.js";
import { readSchema } from "../src/core/schema-validation.js";
import { getPackageRoot } from "../src/core/templates.js";

import { validateGeneratedRegions } from "./lib/generated-regions.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = getPackageRoot();

/**
 * Deterministically generates the markdown artifact registry summary table.
 */
export function generateArtifactRegistryTable() {
  const rows = [
    "| Logical Identity | Canonical Storage | Export Path | Schema | Ownership | Mutability | Trust Role |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const artifact of Object.values(ARTIFACT_REGISTRY)) {
    if (!artifact.isPublic) continue;
    const fileCol = artifact.logicalPath;
    const schemaCol = `\`${artifact.schema}\``;
    const ownerCol = artifact.owner.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const mutabilityCol = artifact.mutability.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const trustRoleCol = artifact.trustRole.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

    const storage = artifact.canonicalStorage;
    const storageCol = `${storage.path}${storage.table ? ` :: ${storage.table}${storage.kind ? ` (${storage.kind})` : ""}${storage.column ? `.${storage.column}` : ""}` : ""}`;
    const exportCol = artifact.exportPath ?? "Copied separately";
    rows.push(`| \`${fileCol}\` | \`${storageCol}\` | \`${exportCol}\` | ${schemaCol} | ${ownerCol} | ${mutabilityCol} | ${trustRoleCol} |`);
  }

  return rows.join("\n");
}

/**
 * Resolves a local JSON schema $ref pointer.
 */
function resolveLocalRef(rootSchema, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported external schema reference: ${ref}`);
  }
  const segments = ref.slice(2).split("/");
  let current = rootSchema;
  for (const segment of segments) {
    current = current?.[decodeURIComponent(segment.replace(/~1/g, "/").replace(/~0/g, "~"))];
    if (current === undefined) {
      throw new Error(`Schema reference not found: ${ref}`);
    }
  }
  return current;
}

/**
 * Describes the type of a schema node as a human-readable string.
 */
function describeSchemaType(node, rootSchema) {
  if (!node) return "unknown";

  // Resolve $ref first
  if (node.$ref) {
    const resolved = resolveLocalRef(rootSchema, node.$ref);
    const refName = node.$ref.split("/").pop();
    // For referenced objects, use the ref name as the type
    if (resolved.type === "object") return refName;
    return describeSchemaType(resolved, rootSchema);
  }

  if (node.oneOf) {
    const parts = node.oneOf.map((sub) => {
      if (sub.$ref) {
        return sub.$ref.split("/").pop();
      }
      if (sub.type) return sub.type;
      if (sub.const !== undefined) return JSON.stringify(sub.const);
      return "object";
    });
    return parts.join(" or ");
  }

  if (node.type === "array") {
    if (node.items) {
      const itemType = describeSchemaType(node.items, rootSchema);
      return `array<${itemType}>`;
    }
    return "array";
  }

  if (node.type) return node.type;

  // Infer type from const value
  if (node.const !== undefined) return typeof node.const;

  // Infer type from enum values
  if (node.enum && node.enum.length > 0) return typeof node.enum[0];

  return "unknown";
}

/**
 * Renders constraint annotations for a schema node.
 */
function renderConstraints(node) {
  const constraints = [];
  if (node.const !== undefined) {
    constraints.push(`const: ${typeof node.const === "string" ? `\`${node.const}\`` : node.const}`);
  }
  if (node.enum) {
    constraints.push(`enum: ${node.enum.map((e) => `\`${e}\``).join(", ")}`);
  }
  if (node.pattern) {
    constraints.push(`pattern: \`${node.pattern}\``);
  }
  if (node.minimum !== undefined) constraints.push(`minimum: ${node.minimum}`);
  if (node.maximum !== undefined) constraints.push(`maximum: ${node.maximum}`);
  if (node.minLength !== undefined) constraints.push(`minLength: ${node.minLength}`);
  if (node.maxLength !== undefined) constraints.push(`maxLength: ${node.maxLength}`);
  if (node.minItems !== undefined) constraints.push(`minItems: ${node.minItems}`);
  if (node.maxItems !== undefined) constraints.push(`maxItems: ${node.maxItems}`);
  return constraints;
}

/**
 * Renders a single schema property as a Markdown bullet point.
 */
function renderSchemaProperty(propName, propDef, isRequired, rootSchema, indent, visitedRefs, depth) {
  const MAX_DEPTH = 4;

  // Resolve $ref if present
  let resolved = propDef;
  let refPath = null;
  if (propDef.$ref) {
    refPath = propDef.$ref;
    if (visitedRefs.has(refPath) || depth >= MAX_DEPTH) {
      const refName = refPath.split("/").pop();
      const reqLabel = isRequired ? "required" : "optional";
      return `${indent}- \`${propName}\` *(${refName}, ${reqLabel})*: Nested ${refName} objects using the same ${refName} definition.`;
    }
    resolved = resolveLocalRef(rootSchema, refPath);
  }

  const typeStr = describeSchemaType(propDef, rootSchema);
  const reqLabel = isRequired ? "required" : "optional";
  const constraints = renderConstraints(resolved);

  const modifiers = [typeStr, reqLabel, ...constraints];
  const line = `${indent}- \`${propName}\` *(${modifiers.join(", ")})*`;

  // For nested objects with properties, render sub-properties
  if (resolved.type === "object" && resolved.properties && depth < MAX_DEPTH) {
    const newVisited = refPath ? new Set([...visitedRefs, refPath]) : visitedRefs;
    const subLines = renderSchemaObject(resolved, rootSchema, indent + "  ", newVisited, depth + 1);
    return subLines ? `${line}\n${subLines}` : line;
  }

  // For arrays with object items, render item properties
  if (resolved.type === "array" && resolved.items && depth < MAX_DEPTH) {
    let itemDef = resolved.items;
    if (itemDef.$ref) {
      const itemRefPath = itemDef.$ref;
      if (visitedRefs.has(itemRefPath) || depth + 1 >= MAX_DEPTH) {
        const refName = itemRefPath.split("/").pop();
        return `${line}: Nested ${refName} objects using the same ${refName} definition.`;
      }
      itemDef = resolveLocalRef(rootSchema, itemRefPath);
    }
    if (itemDef.type === "object" && itemDef.properties) {
      const newVisited = itemDef.$ref ? new Set([...visitedRefs, itemDef.$ref]) : visitedRefs;
      const subLines = renderSchemaObject(itemDef, rootSchema, indent + "  ", newVisited, depth + 1);
      return subLines ? `${line}\n${subLines}` : line;
    }
    // oneOf items with $ref
    if (itemDef.oneOf) {
      for (const alt of itemDef.oneOf) {
        if (alt.$ref) {
          const altRefPath = alt.$ref;
          if (!visitedRefs.has(altRefPath) && depth + 1 < MAX_DEPTH) {
            const altResolved = resolveLocalRef(rootSchema, altRefPath);
            if (altResolved.type === "object" && altResolved.properties) {
              const refName = altRefPath.split("/").pop();
              const newVisited = new Set([...visitedRefs, altRefPath]);
              const subLines = renderSchemaObject(altResolved, rootSchema, indent + "  ", newVisited, depth + 1);
              return subLines ? `${line}\n${indent}  *${refName} items:*\n${subLines}` : line;
            }
          }
        }
      }
    }
  }

  return line;
}

/**
 * Renders all properties of an object schema as Markdown bullets.
 */
function renderSchemaObject(schema, rootSchema, indent = "", visitedRefs = new Set(), depth = 0) {
  if (!schema.properties) return "";

  const requiredProps = new Set(schema.required ?? []);
  const lines = [];

  for (const [propName, propDef] of Object.entries(schema.properties)) {
    const isRequired = requiredProps.has(propName);
    lines.push(renderSchemaProperty(propName, propDef, isRequired, rootSchema, indent, visitedRefs, depth));
  }

  return lines.join("\n");
}

/**
 * Deterministically generates canonical fields for a JSON schema.
 */
export async function generateCanonicalFieldsForSchema(schemaName) {
  const schema = await readSchema(schemaName, packageRoot);
  if (!schema.properties) return "";

  return renderSchemaObject(schema, schema);
}

/**
 * Deterministically generates the CLI command index table.
 */
export function generateCliCommandIndexTable() {
  const categoryMap = new Map();
  const categoryTitles = {
    "project-maintenance": "Setup & Maintenance",
    lifecycle: "Lifecycle & State",
    continuity: "Cross-Harness Continuity",
    verification: "Verification & Completion",
    diagnostics: "Inspection & Diagnostics",
    actions: "Durable Actions & Approvals",
    "policy-audit": "Policy & Auditing",
  };

  for (const [cmdName, def] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    const title = categoryTitles[def.category] ?? def.category;
    if (!categoryMap.has(title)) {
      categoryMap.set(title, []);
    }
    categoryMap.get(title).push(`[\`${cmdName}\`](#${cmdName})`);
  }

  const rows = [
    "| Category | Commands |",
    "| --- | --- |",
  ];

  for (const [catTitle, cmds] of categoryMap.entries()) {
    rows.push(`| **${catTitle}** | ${cmds.join(", ")} |`);
  }

  return rows.join("\n");
}

/**
 * Deterministically generates the CLI options list for a command.
 */
export function generateCliOptionsForCommand(commandName) {
  const def = CLI_COMMAND_DEFINITIONS[commandName];
  if (!def || !def.options) return "";

  const lines = [];
  for (const [optName, optDef] of Object.entries(def.options)) {
    if (optName === "--help" || optName === "--version") continue;
    let label = optName;
    if (optDef.valueName) {
      // Strip angle brackets from valueName if present (renderer owns formatting)
      const cleanValue = optDef.valueName.replace(/^</, "").replace(/>$/, "");
      label = optName === "--" ? `-- <${cleanValue}>` : `${optName} <${cleanValue}>`;
    }
    const repeatableSuffix = optDef.repeatable ? " (repeatable)" : "";
    if (optDef.isPositional) {
      const raw = optDef.valueName ?? optName;
      const clean = raw.replace(/^<+|>+$/g, "");
      lines.push(`- \`<${clean}>\`: ${optDef.description}${repeatableSuffix}`);
    } else {
      lines.push(`- \`${label}\`: ${optDef.description}${repeatableSuffix}`);
    }
  }

  return lines.join("\n");
}

/**
 * Deterministically generates the public error codes table for TROUBLESHOOTING.md.
 */
export function generatePublicErrorCodesTable() {
  const rows = [
    "| Code | Meaning | Safe Resolution |",
    "| --- | --- | --- |",
  ];

  for (const err of Object.values(PUBLIC_ERROR_REGISTRY)) {
    rows.push(`| \`${escapeMarkdownTableCell(err.code)}\` | ${escapeMarkdownTableCell(err.meaning)} | ${escapeMarkdownTableCell(err.safeResolution)} |`);
  }

  return rows.join("\n");
}

/**
 * Deterministically generates the common CLI options section.
 * Computes intersection of options across all 43 commands (excluding --help and --version).
 */
export function generateCommonOptionsSection() {
  // Compute intersection of options across all commands
  const allCommandDefs = Object.values(CLI_COMMAND_DEFINITIONS);
  let commonOptions = null;

  for (const def of allCommandDefs) {
    const optNames = new Set(Object.keys(def.options));
    if (commonOptions === null) {
      commonOptions = optNames;
    } else {
      commonOptions = new Set([...commonOptions].filter((o) => optNames.has(o)));
    }
  }

  const lines = [];
  for (const optName of commonOptions ?? []) {
    const optDef = allCommandDefs[0].options[optName];
    if (!optDef) continue;
    let label = optName;
    if (optDef.valueName) {
      const cleanValue = optDef.valueName.replace(/^</, "").replace(/>$/, "");
      label = `${optName} <${cleanValue}>`;
    }
    lines.push(`- \`${label}\`: ${optDef.description}`);
  }

  lines.push("");
  lines.push("Commands that support structured machine-readable output document `--json` in their command-specific option list.");

  return lines.join("\n");
}

/**
 * Escapes a value for use in a Markdown table cell.
 */
export function escapeMarkdownTableCell(value) {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

/**
 * Generates the exact canonical work-state transition edge inventory.
 * Rows are emitted deterministically in WORK_PHASES order with destinations
 * in WORK_TRANSITIONS order. The special BLOCKED wildcard edge is documented
 * separately in prose because it is not part of the WORK_TRANSITIONS table.
 */
export function generateWorkTransitionsTable() {
  const rows = ["| From | To |", "| --- | --- |"];
  for (const from of WORK_PHASES) {
    for (const to of WORK_TRANSITIONS[from] ?? []) {
      rows.push(`| \`${from}\` | \`${to}\` |`);
    }
  }
  return rows.join("\n");
}

/**
 * Registry of all deterministic documentation generation targets.
 */
export function getDocumentationGenerationTargets() {
  const targets = [
    {
      file: "docs/ARTIFACT_REFERENCE.md",
      region: "artifact-registry",
      generate: () => generateArtifactRegistryTable(),
    },
    {
      file: "docs/CLI_REFERENCE.md",
      region: "cli-command-index",
      generate: () => generateCliCommandIndexTable(),
    },
    {
      file: "docs/CLI_REFERENCE.md",
      region: "cli-common-options",
      generate: () => generateCommonOptionsSection(),
    },
    {
      file: "docs/TROUBLESHOOTING.md",
      region: "public-error-codes",
      generate: () => generatePublicErrorCodesTable(),
    },
    {
      file: "ORCHESTRATOR_INTEGRATION.md",
      region: "work-transitions",
      generate: () => generateWorkTransitionsTable(),
    },
  ];

  // Schema field regions for artifacts
  for (const artifact of Object.values(ARTIFACT_REGISTRY)) {
    if (!artifact.isPublic || !artifact.schema) continue;
    targets.push({
      file: "docs/ARTIFACT_REFERENCE.md",
      region: `schema:${artifact.schema}`,
      generate: () => generateCanonicalFieldsForSchema(artifact.schema),
    });
  }

  // CLI command option regions
  for (const cmd of COMMANDS) {
    targets.push({
      file: "docs/CLI_REFERENCE.md",
      region: `cli:${cmd}:options`,
      generate: () => generateCliOptionsForCommand(cmd),
    });
  }

  return targets;
}

/**
 * Atomic file write using temp file + rename.
 */
async function atomicWriteFile(targetPath, content) {
  const tempPath = `${targetPath}.forgeloop-tmp-${process.pid}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, targetPath);
  } catch (err) {
    // Cleanup temp file on failure
    try {
      const { rm } = await import("node:fs/promises");
      await rm(tempPath, { force: true });
    } catch {
      // Best effort cleanup
    }
    throw err;
  }
}

/**
 * Known invalid patterns in generated output bodies.
 */
export const INVALID_GENERATED_PATTERNS = Object.freeze([
  {
    code: "DOC_GENERATED_OUTPUT_UNDEFINED",
    pattern: /(^|[\s:=(,])undefined([\s,);]|$)/,
    message: "contains undefined value",
  },
  {
    code: "DOC_GENERATED_OUTPUT_OBJECT_STRING",
    pattern: /\[object Object\]/,
    message: "contains object stringification ([object Object])",
  },
  {
    code: "DOC_GENERATED_OUTPUT_NAN",
    pattern: /\bNaN\b/,
    message: "contains NaN",
  },
  {
    code: "DOC_GENERATED_OUTPUT_DOUBLE_VALUE_MARKER",
    pattern: /<<[^>]+>>/,
    message: "contains malformed double value marker (<<...>>)",
  },
  {
    code: "DOC_GENERATED_OUTPUT_DUPLICATE_REPEATABLE",
    pattern: /\(repeatable\)\s+\(repeatable\)/i,
    message: "contains duplicate (repeatable) marker",
  },
]);

/**
 * Validates a generated region body before insertion.
 * Scoped strictly to generated output, avoiding false positives in human prose.
 * @param {Object} options
 * @param {string} options.body - The generated region body text
 * @param {string} options.relPath - Target relative file path
 * @param {string} options.region - Region identifier
 * @returns {string[]} Error messages
 */
export function validateGeneratedRegionBody({ body, relPath, region }) {
  const errors = [];
  for (const { code, pattern, message } of INVALID_GENERATED_PATTERNS) {
    if (pattern.test(body)) {
      errors.push(`DOC_GENERATED_OUTPUT_INVALID: Generated region "${region}" in "${relPath}" ${message} [${code}]`);
    }
  }
  return errors;
}

/**
 * Replaces or checks generated regions in target markdown files.
 * @param {Object} options
 * @param {string} options.rootDir - Base repository directory
 * @param {boolean} options.write - True to rewrite files; false to check freshness only
 * @returns {Promise<{ valid: boolean, errors: string[], updatedFiles: string[] }>}
 */
export async function processGeneratedDocumentation({ rootDir = repositoryRoot, write = false } = {}) {
  const targets = getDocumentationGenerationTargets();
  const filesMap = new Map();
  const errors = [];
  const updatedFiles = [];

  // Group targets by relative file path
  for (const target of targets) {
    if (!filesMap.has(target.file)) {
      filesMap.set(target.file, []);
    }
    filesMap.get(target.file).push(target);
  }

  // Phase 1: Read all files, generate all content, validate all markers
  const fileOutputs = new Map();

  for (const [relPath, fileTargets] of filesMap.entries()) {
    // Path safety: ensure target is inside repository
    const fullPath = path.join(rootDir, relPath);
    const resolved = path.resolve(rootDir, relPath);
    const relative = path.relative(rootDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`DOC_GENERATED_PATH_ESCAPE: Generated documentation target escapes repository: ${relPath}`);
      continue;
    }

    let originalContent;
    try {
      originalContent = await readFile(fullPath, "utf8");
    } catch (err) {
      errors.push(`DOC_GENERATED_TARGET_MISSING: Cannot read target file "${relPath}": ${err.message}`);
      continue;
    }

    const normalizedOriginalContent = originalContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const expectedRegions = fileTargets.map((t) => t.region);
    const structuralValidation = validateGeneratedRegions({
      content: normalizedOriginalContent,
      relPath,
      expectedRegions,
    });

    if (!structuralValidation.valid) {
      errors.push(...structuralValidation.errors);
      continue;
    }

    let modifiedContent = normalizedOriginalContent;

    for (const target of fileTargets) {
      const beginMarker = `<!-- BEGIN FORGELOOP GENERATED: ${target.region} -->`;
      const endMarker = `<!-- END FORGELOOP GENERATED: ${target.region} -->`;

      const beginIndex = modifiedContent.indexOf(beginMarker);
      const endIndex = modifiedContent.indexOf(endMarker, beginIndex + beginMarker.length);

      const generatedText = await target.generate();
      const bodyErrors = validateGeneratedRegionBody({
        body: generatedText,
        relPath,
        region: target.region,
      });

      if (bodyErrors.length > 0) {
        errors.push(...bodyErrors);
        continue;
      }

      const newRegionContent = `${beginMarker}\n\n${generatedText.trim()}\n\n${endMarker}`;
      const existingRegionContent = modifiedContent.slice(beginIndex, endIndex + endMarker.length);

      if (existingRegionContent !== newRegionContent) {
        if (!write) {
          errors.push(
            `DOC_GENERATED_REGION_STALE: In "${relPath}", generated region "${target.region}" is stale. Run 'npm run docs:generate' to update.`,
          );
        }
        modifiedContent = modifiedContent.slice(0, beginIndex) + newRegionContent + modifiedContent.slice(endIndex + endMarker.length);
      }
    }

    if (modifiedContent !== normalizedOriginalContent) {
      fileOutputs.set(fullPath, { relPath, content: modifiedContent });
    }
  }

  // Phase 2: Only write when ALL validations across ALL files pass with zero errors (fail closed)
  if (write) {
    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        updatedFiles: [],
      };
    }

    for (const [fullPath, { relPath, content }] of fileOutputs.entries()) {
      await atomicWriteFile(fullPath, content);
      updatedFiles.push(relPath);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    updatedFiles,
  };
}

// CLI runner
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isCheck = process.argv.includes("--check");
  const isWrite = process.argv.includes("--write") || !isCheck;

  try {
    const result = await processGeneratedDocumentation({ write: isWrite });
    if (!result.valid) {
      console.error("\n❌ DOCUMENTATION GENERATION / FRESHNESS FAILURES:");
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }

    if (isWrite) {
      if (result.updatedFiles.length > 0) {
        console.log(`✅ Successfully updated generated documentation regions in: ${result.updatedFiles.join(", ")}`);
      } else {
        console.log("✅ Generated documentation regions are up to date (no files modified).");
      }
    } else {
      console.log("✅ All generated documentation regions are fresh and match canonical definitions.");
    }
  } catch (error) {
    console.error(`Documentation generation crashed: ${error.message}`);
    process.exit(1);
  }
}
