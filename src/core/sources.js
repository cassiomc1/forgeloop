import { PROTOCOL_VERSION } from "./protocol.js";

export const SOURCE_REGISTRY_SCHEMA_VERSION = 1;
export const SOURCE_KINDS = Object.freeze([
  "user-request",
  "repository-fact",
  "observation",
  "command",
  "agent-decision",
  "inference",
  "unknown",
]);

export function createSourceRegistry(sources = {}) {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    throw new Error("Source registry must be an object");
  }
  return {
    schemaVersion: SOURCE_REGISTRY_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    sources: structuredClone(sources),
  };
}

export function assertSourceKind(kind, label = "source.kind") {
  if (!SOURCE_KINDS.includes(kind)) throw new Error(`${label} must be one of ${SOURCE_KINDS.join(", ")}`);
  return kind;
}

export function assertSourceRefs(registry, refs = []) {
  const ids = new Set(Object.keys(registry?.sources ?? {}));
  for (const ref of refs) {
    if (!ids.has(ref)) {
      const error = new Error(`Unknown source ID: ${ref}`);
      error.code = "E_PROFILE_SOURCE_UNKNOWN";
      throw error;
    }
  }
  return true;
}

export function assertSourceRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    const error = new Error("Source registry must be an object");
    error.code = "E_PROFILE_SOURCE_INVALID";
    throw error;
  }
  if (registry.schemaVersion !== SOURCE_REGISTRY_SCHEMA_VERSION || registry.protocolVersion !== PROTOCOL_VERSION) {
    const error = new Error("Source registry has an unsupported protocol version");
    error.code = "E_PROFILE_SOURCE_INVALID";
    throw error;
  }
  for (const [id, source] of Object.entries(registry.sources ?? {})) {
    if (!id || !source || typeof source !== "object" || Array.isArray(source)) {
      const error = new Error(`Invalid source entry: ${id}`);
      error.code = "E_PROFILE_SOURCE_INVALID";
      throw error;
    }
    assertSourceKind(source.kind, `sources.${id}.kind`);
    if (typeof source.summary !== "string" || source.summary.trim() === "") {
      const error = new Error(`Source summary is required: ${id}`);
      error.code = "E_PROFILE_SOURCE_INVALID";
      throw error;
    }
  }
  return registry;
}

export function assertSourceProvenance(registry, refs = [], { expectedKind } = {}) {
  assertSourceRegistry(registry);
  assertSourceRefs(registry, refs);
  const expectedKinds = expectedKind === undefined
    ? null
    : new Set(Array.isArray(expectedKind) ? expectedKind : [expectedKind]);
  if (expectedKinds) {
    for (const ref of refs) {
      const source = registry.sources[ref];
      if (!expectedKinds.has(source.kind)) {
        const error = new Error(`Source ${ref} has kind ${source.kind}, expected ${[...expectedKinds].join(", ")}`);
        error.code = "E_PROFILE_SOURCE_MISCLASSIFIED";
        throw error;
      }
    }
  }
  return true;
}

export function assertContractPresetRefs(refs = []) {
  for (const ref of refs) {
    if (typeof ref === "string" && ref.startsWith("contract-preset:")
      && !/^contract-preset:(documentation|bug|feature|release)$/.test(ref)) {
      const error = new Error(`Unknown built-in contract preset source: ${ref}`);
      error.code = "E_PROFILE_SOURCE_UNKNOWN";
      throw error;
    }
  }
  return true;
}

export function assertContractSourceProvenance(registry, refs = []) {
  assertContractPresetRefs(refs);
  const externalRefs = refs.filter((ref) => !/^contract-preset:(documentation|bug|feature|release)$/.test(ref));
  if (externalRefs.length === 0) return true;
  if (!registry) {
    const error = new Error("External contract source references require a source registry");
    error.code = "E_PROFILE_SOURCE_MISSING";
    throw error;
  }
  return assertSourceProvenance(registry, externalRefs);
}
