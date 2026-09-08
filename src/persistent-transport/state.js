import { lstat, readFile, unlink } from "node:fs/promises";

import { writeFileAtomic } from "../core/filesystem.js";
import { PERSISTENT_TRANSPORT_SCHEMA_VERSION } from "./constants.js";

export async function readPersistentTransportState(statePath) {
  try {
    const info = await lstat(statePath);
    if (!info.isFile() || info.isSymbolicLink()) return { state: null, invalid: true };
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (!state || typeof state !== "object" || state.schemaVersion !== PERSISTENT_TRANSPORT_SCHEMA_VERSION) return { state: null, invalid: true };
    return { state, invalid: false };
  } catch (error) {
    if (error.code === "ENOENT") return { state: null, invalid: false };
    if (error instanceof SyntaxError) return { state: null, invalid: true };
    throw error;
  }
}

export async function writePersistentTransportState(statePath, state) {
  const record = {
    schemaVersion: PERSISTENT_TRANSPORT_SCHEMA_VERSION,
    pid: state.pid,
    protocolVersion: state.protocolVersion,
    forgeLoopVersion: state.forgeLoopVersion,
    scopeId: state.scopeId,
    nonce: state.nonce,
    endpoint: state.endpoint,
    entrypoint: state.entrypoint,
    startedAt: state.startedAt,
    lastActivityAt: state.lastActivityAt ?? state.startedAt,
  };
  await writeFileAtomic(statePath, `${JSON.stringify(record)}\n`);
  return record;
}

export async function removePersistentTransportState(statePath, expectedNonce = null) {
  if (expectedNonce !== null) {
    const current = await readPersistentTransportState(statePath);
    if (current.state?.nonce !== expectedNonce) return false;
  }
  try {
    await unlink(statePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
