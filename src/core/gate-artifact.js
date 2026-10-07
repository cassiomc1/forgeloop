import { assertSafePath, ensureWithin, fileExists, isPathWithin, realpathWithTransientWindowsRetry } from "./filesystem.js";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { ARTIFACT_PATHS, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { sha256 } from "./manifest.js";
import { taskGatePath } from "./task-paths.js";
import { getOperationalStore, operationalArtifactExists, readOperationalText } from "../storage/operational-context.js";
import { createHash } from "node:crypto";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";

function gateName(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    const error = new Error(`Invalid gate name: ${value}`);
    error.code = "E_GATE_INVALID";
    throw error;
  }
  return value;
}

export function gatePath(gate, options = {}) {
  const name = gateName(gate);
  if (options?.taskId) {
    return taskGatePath(options.taskId, name);
  }
  return `${ARTIFACT_PATHS.gates ?? ".forgeloop/gates"}/${name}.json`;
}

export async function persistGate(target, gate, packageRoot, options = {}) {
  const relativePath = options?.gatePath ?? (options?.taskId ? taskGatePath(options.taskId, gate.gate) : gatePath(gate.gate, options));
  return writeJsonArtifact(target, relativePath, gate, "gate", packageRoot, options);
}

export async function readGate(target, gate, packageRoot, options = {}) {
  const relativePath = options?.gatePath ?? (options?.taskId ? taskGatePath(options.taskId, gate) : gatePath(gate, options));
  return readJsonArtifact(target, relativePath, "gate", packageRoot);
}

export async function readGateIfPresent(target, gate, packageRoot, options = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readGateIfPresent(target, gate, packageRoot, options), { readOnly: true });
  }
  const relativePath = options?.gatePath ?? (options?.taskId ? taskGatePath(options.taskId, gate) : gatePath(gate, options));
  await assertSafePath(target, relativePath);
  const selected = operationalArtifactExists(target, relativePath);
  if (selected !== null) return selected ? readJsonArtifact(target, relativePath, "gate", packageRoot) : null;
  const filePath = ensureWithin(target, relativePath);
  if (!(await fileExists(filePath))) return null;
  return readJsonArtifact(target, relativePath, "gate", packageRoot);
}

/** Hash selected bytes through the operational read set, including missing rows. */
export function readCanonicalGateArtifactBinding(target, relativePath) {
  const store = getOperationalStore(target);
  if (store?.recognizes(relativePath) && relativePath.replaceAll("\\", "/").endsWith("/events.ndjson")) {
    if (!operationalArtifactExists(target, relativePath)) return { path: relativePath, sha256: null, byteLength: 0 };
    const digest = createHash("sha256");
    let byteLength = 0;
    for (const event of store.iterateEvents(relativePath)) {
      const bytes = `${JSON.stringify(event)}\n`;
      byteLength += Buffer.byteLength(bytes);
      digest.update(bytes);
    }
    return { path: relativePath, sha256: digest.digest("hex"), byteLength };
  }
  const source = readOperationalText(target, relativePath);
  if (!source.selected) return null;
  return { path: relativePath, sha256: source.text === null ? null : sha256(source.text), byteLength: source.text === null ? 0 : Buffer.byteLength(source.text) };
}

/** Admit one regular external evidence handle before reading any bytes. */
async function withGateFile(target, relativePath, maxBytes, callback) {
  const filename = await assertSafePath(target, relativePath);
  const root = await realpathWithTransientWindowsRetry(target);
  const resolved = await realpathWithTransientWindowsRetry(filename);
  if (!isPathWithin(root, resolved)) throw new Error("Gate artifact resolves outside the project");
  const file = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    const current = await lstat(resolved);
    if (!info.isFile() || !current.isFile() || current.isSymbolicLink()
      || info.dev !== current.dev || info.ino !== current.ino
      || !isPathWithin(root, await realpathWithTransientWindowsRetry(resolved))) throw new Error("Gate artifact changed during file admission");
    if (info.size > maxBytes) throw new Error(`Gate artifact exceeds the maximum size of ${maxBytes} bytes`);
    return await callback(file);
  } finally { await file.close(); }
}

async function* gateFileChunks(file, maxBytes) {
  let byteLength = 0;
  for await (const bytes of file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
    byteLength += bytes.length;
    if (byteLength > maxBytes) throw new Error(`Gate artifact exceeds the maximum size of ${maxBytes} bytes`);
    yield bytes;
  }
}

/** Hash external evidence from one verified handle, with bounded streaming memory. */
export async function hashGateFile(target, relativePath, { maxBytes = Infinity } = {}) {
  return withGateFile(target, relativePath, maxBytes, async file => {
    const digest = createHash("sha256");
    let byteLength = 0;
    for await (const bytes of gateFileChunks(file, maxBytes)) {
      byteLength += bytes.length;
      digest.update(bytes);
    }
    return { path: relativePath, sha256: digest.digest("hex"), byteLength };
  });
}

/** Explicit JSON gate input remains file-owned and allocation-bounded. */
export async function readGateFileJson(target, relativePath, { maxBytes } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Gate evidence requires a finite byte limit");
  return withGateFile(target, relativePath, maxBytes, async file => {
    const chunks = [];
    for await (const bytes of gateFileChunks(file, maxBytes)) chunks.push(bytes);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  });
}

export async function validateGateArtifacts(target, gateValue, packageRoot) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => validateGateArtifacts(target, gateValue, packageRoot), { readOnly: true });
  }
  const schema = await readSchema("gate", packageRoot);
  assertSchema(gateValue, schema, "gate");
  const stale = [];
  for (const artifact of gateValue.artifacts ?? []) {
    await assertSafePath(target, artifact.path);
    const canonical = readCanonicalGateArtifactBinding(target, artifact.path);
    if (canonical) {
      if (canonical.sha256 === null) stale.push({ path: artifact.path, status: "missing" });
      else if (canonical.sha256 !== artifact.sha256) stale.push({ path: artifact.path, status: "changed" });
      continue;
    }
    const artifactPath = ensureWithin(target, artifact.path);
    if (!(await fileExists(artifactPath))) {
      stale.push({ path: artifact.path, status: "missing" });
      continue;
    }
    const binding = await hashGateFile(target, artifact.path);
    if (binding.sha256 !== artifact.sha256) stale.push({ path: artifact.path, status: "changed" });
  }
  return stale;
}
