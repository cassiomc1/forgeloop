import { ARTIFACT_PATHS, readJsonArtifact } from "./artifacts.js";
import { readContract } from "./contract.js";
import { readGateIfPresent, validateGateArtifacts } from "./gate-artifact.js";
import { requiredGatesForGuides } from "./guide-metadata.js";
import { assertContractPresetRefs, assertContractSourceProvenance } from "./sources.js";
import { readPersistedRoute } from "./route-artifact.js";
import { ensureWithin, readBytes } from "./filesystem.js";
import { sha256 } from "./manifest.js";
import { findProfilePath } from "./profile.js";
import { issue } from "./preflight-model.js";
import { taskGatePath, taskArtifactPath } from "./task-paths.js";

export async function readProfile(target) {
  const relativePath = await findProfilePath(target);
  if (!relativePath) return { status: "missing", fingerprint: null };
  const filePath = ensureWithin(target, relativePath);
  const bytes = await readBytes(filePath);
  const text = bytes.toString("utf8");
  const mode = text.match(/^profile-mode:\s*([^\s]+)\s*$/m)?.[1] ?? null;
  const status = text.match(/^profile-status:\s*([^\s]+)\s*$/m)?.[1] ?? null;
  return {
    status: status === "verified" && mode !== "template" ? "verified" : "unverified",
    mode,
    profileStatus: status,
    fingerprint: sha256(bytes),
  };
}

export async function optionalConfig(target, packageRoot, errors) {
  try {
    const artifact = await readJsonArtifact(target, ARTIFACT_PATHS.config, "config", packageRoot);
    return artifact.value;
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return { schemaVersion: 1, protocolVersion: 1, complianceMode: "standard" };
    errors.push(issue("E_CONFIG_INVALID", error.message, [ARTIFACT_PATHS.config]));
    return { schemaVersion: 1, protocolVersion: 1, complianceMode: "standard" };
  }
}

export async function loadContract(target, packageRoot, errors, options = {}) {
  try {
    return await readContract(target, packageRoot, options);
  } catch (error) {
    const path = options.contractPath ?? (options.taskId ? taskArtifactPath(options.taskId, "contract") : ARTIFACT_PATHS.contract);
    errors.push(issue(error.code === "ARTIFACT_MISSING" ? "E_CONTRACT_MISSING" : "E_CONTRACT_INVALID", error.message, [path]));
    return null;
  }
}

export async function loadRoute(target, packageRoot, errors, options = {}) {
  try {
    return await readPersistedRoute(target, packageRoot, options);
  } catch (error) {
    const path = options.routePath ?? (options.taskId ? taskArtifactPath(options.taskId, "route") : ARTIFACT_PATHS.route);
    const code = error.code === "ARTIFACT_MISSING"
      ? "E_ROUTE_MISSING"
      : ["E_ROUTE_REASON_MISSING", "E_ROUTE_INVALID"].includes(error.code) ? error.code : "E_ROUTE_INVALID";
    errors.push(issue(code, error.message, [path]));
    return null;
  }
}

export async function loadSources(target, contract, packageRoot, errors) {
  if (!contract?.value?.sourceRefs?.length) return null;
  try {
    assertContractPresetRefs(contract.value.sourceRefs);
  } catch (error) {
    errors.push(issue(error.code ?? "E_PROFILE_SOURCE_UNKNOWN", error.message, [ARTIFACT_PATHS.sources]));
    return null;
  }
  const externalRefs = contract.value.sourceRefs.filter((ref) => !/^contract-preset:(documentation|bug|feature|release)$/.test(ref));
  let registry;
  if (externalRefs.length > 0) {
    try {
      registry = (await readJsonArtifact(target, ARTIFACT_PATHS.sources, "source-registry", packageRoot)).value;
    } catch (error) {
      errors.push(issue(error.code === "ARTIFACT_MISSING" ? "E_PROFILE_SOURCE_MISSING" : "E_PROFILE_SOURCE_UNKNOWN", error.message, [ARTIFACT_PATHS.sources]));
      return null;
    }
  }
  try {
    assertContractSourceProvenance(registry, contract.value.sourceRefs);
  } catch (error) {
    errors.push(issue(error.code ?? "E_PROFILE_SOURCE_UNKNOWN", error.message, [ARTIFACT_PATHS.sources]));
  }
  return registry;
}

export async function inspectGates(target, contract, route, packageRoot, errors, config = {}, options = {}) {
  if (!route) return { required: [], satisfied: [], records: {} };
  const guideGates = await requiredGatesForGuides(route.value.guides, packageRoot);
  const required = [...new Set([...guideGates, ...(config.requiredGates ?? [])])].sort();
  const satisfied = [];
  const records = {};
  const taskId = options.taskId ?? null;
  for (const gate of required) {
    let artifact;
    const defaultGateRel = taskId ? taskGatePath(taskId, gate) : `${ARTIFACT_PATHS.gates}/${gate}.json`;
    try {
      artifact = await readGateIfPresent(target, gate, packageRoot, { ...options, taskId });
    } catch (error) {
      errors.push(issue(error.code === "ARTIFACT_MISSING" ? "E_GATE_UNVERIFIED" : "E_GATE_INVALID", error.message, [defaultGateRel], { gate }));
      continue;
    }
    if (!artifact) {
      errors.push(issue("E_GATE_UNVERIFIED", `Required gate is missing or unverified: ${gate}`, [defaultGateRel], { gate }));
      continue;
    }
    records[gate] = artifact;
    if (artifact.value.taskId !== contract?.value?.taskId) {
      errors.push(issue("E_GATE_TASK_MISMATCH", `Gate ${gate} belongs to a different task`, [artifact.path], { gate }));
      continue;
    }
    if (artifact.value.status !== "satisfied") {
      errors.push(issue("E_GATE_UNVERIFIED", `Required gate is ${artifact.value.status}: ${gate}`, [artifact.path], { gate }));
      continue;
    }
    const stale = await validateGateArtifacts(target, artifact.value, packageRoot);
    if (stale.length > 0) {
      errors.push(issue("E_GATE_STALE", `Gate ${gate} references stale artifacts`, [artifact.path], { gate, stale }));
      continue;
    }
    satisfied.push(gate);
  }
  return { required, satisfied: satisfied.sort(), records };
}
