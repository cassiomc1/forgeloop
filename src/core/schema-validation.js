import { readFile } from "node:fs/promises";
import path from "node:path";

import { getPackageRoot } from "./templates.js";
import { assertJsonBytes, assertJsonLimits } from "./json-safety.js";
import { createEvidence } from "./evidence.js";

export const SHIPPED_SCHEMA_NAMES = Object.freeze([
  "routing-input",
  "routing-result",
  "work-state",
  "continuity",
  "execution-receipt",
  "task-brief",
  "delegated-result",
  "evidence",
  "current-contract",
  "gate",
  "source-registry",
  "config",
  "preflight",
  "check",
  "evidence-coverage",
  "event",
  "activation",
  "policy",
  "policy-rules",
  "policy-discovery",
  "policy-baseline",
  "policy-lock",
  "policy-snapshot",
  "task-bundle",
  "execution",
  "authority",
  "task-descriptor",
  "task-recovery",
  "diagnostic-case",
  "intervention",
  "hypothesis-disposition",
  "action",
  "approval",
  "capability-policy",
  "trajectory-evaluation",
  "trajectory-scenario",
  "workspace-binding",
  "handoff-envelope",
  "responsibility",
  "verification-scope",
  "code-manifest",
  "code-attestation",
  "attestation-verification-result",
  "in-toto-statement",
  "usage",
  "execution-profile-benchmark-scenario",
  "execution-profile-benchmark-run",
  "execution-profile-benchmark-aggregate",
  "structural-quality",
  "semantic-decision",
]);

export class SchemaValidationError extends Error {
  constructor(errors, label = "value") {
    const normalized = errors.length > 0 ? errors : [`${label}: schema validation failed`];
    super(normalized.join("; "));
    this.name = "SchemaValidationError";
    this.errors = normalized;
  }
}

function typeMatches(value, type) {
  if (Array.isArray(type)) return type.some((t) => typeMatches(value, t));
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function display(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function resolveRef(ref, rootSchema) {
  if (typeof ref !== "string" || !rootSchema) return null;
  if (ref.startsWith("#/")) {
    const parts = ref.slice(2).split("/");
    let target = rootSchema;
    for (const part of parts) {
      target = target?.[part];
    }
    return target ?? null;
  }
  return null;
}

function validate(value, schema, location, errors, rootSchema = schema) {
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, rootSchema);
    if (target) {
      validate(value, target, location, errors, rootSchema);
      return;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${location}: expected ${display(schema.const)}`);
    return;
  }

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${location}: expected one of ${schema.enum.map(display).join(", ")}`);
    return;
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validate(value, candidate, location, candidateErrors, rootSchema);
      return candidateErrors.length === 0;
    });
    if (matches.length !== 1) errors.push(`${location}: expected exactly one matching schema`);
    return;
  }

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${location}: expected type ${schema.type}`);
    return;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: must contain at least ${schema.minLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${location}: does not match the required pattern`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${location}: must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validate(item, schema.items, `${location}[${index}]`, errors, rootSchema));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${location}.${key}: is required`);
      }
    }

    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validate(value[key], child, `${location}.${key}`, errors, rootSchema);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${location}.${key}: additional property is not allowed`);
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          validate(value[key], schema.additionalProperties, `${location}.${key}`, errors, rootSchema);
        }
      }
    }
  }
}

export function validateSchema(value, schema, { label = "$" } = {}) {
  assertJsonLimits(value, label);
  const errors = [];
  validate(value, schema, label, errors, schema);
  return errors;
}

export function assertSchema(value, schema, label = "value") {
  const errors = validateSchema(value, schema, { label });
  if (errors.length > 0) throw new SchemaValidationError(errors, label);
  return value;
}

const SCHEMA_CACHE = new Map();

export function clearSchemaCache() {
  SCHEMA_CACHE.clear();
}

export async function readSchema(name, packageRoot = getPackageRoot()) {
  const filename = name.endsWith(".schema.json") ? name : `${name}.schema.json`;
  const schemaPath = path.join(packageRoot, "schemas", filename);
  const cacheKey = `${packageRoot}:${filename}`;
  if (SCHEMA_CACHE.has(cacheKey)) {
    return SCHEMA_CACHE.get(cacheKey);
  }
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  SCHEMA_CACHE.set(cacheKey, schema);
  return schema;
}

export async function inspectSchemaHealth(packageRoot = getPackageRoot()) {
  const schemas = [];
  for (const name of SHIPPED_SCHEMA_NAMES) {
    const filename = `${name}.schema.json`;
    const schemaPath = path.join(packageRoot, "schemas", filename);
    try {
      const bytes = await readFile(schemaPath);
      assertJsonBytes(bytes, filename);
      const schema = JSON.parse(bytes.toString("utf8"));
      assertJsonLimits(schema, filename);
      const version = schema?.properties?.schemaVersion?.const ?? null;
      let status = "valid";
      let error = null;
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        status = "invalid";
        error = "schema root must be an object";
      } else if (version !== 1) {
        status = "unsupported-version";
        error = `schemaVersion ${version ?? "missing"} is not supported`;
      }
      schemas.push({ name, version, status, error });
    } catch (caught) {
      const status = caught.code === "ENOENT" ? "missing" : "invalid";
      schemas.push({ name, version: null, status, error: caught.message });
    }
  }
  const status = schemas.some((schema) => schema.status === "invalid")
    ? "invalid"
    : schemas.some((schema) => schema.status === "missing")
      ? "missing"
      : schemas.some((schema) => schema.status === "unsupported-version")
        ? "unsupported-version"
        : "valid";
  return {
    version: 1,
    status,
    schemas,
    evidence: [createEvidence({
      kind: status === "valid" ? "OBSERVED" : status === "missing" ? "NOT_VERIFIED" : "BLOCKED",
      source: "shipped target schemas",
      result: status,
    })],
  };
}
