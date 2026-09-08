import os from "node:os";
import path from "node:path";

export const PERSISTENT_TRANSPORT_PROTOCOL_VERSION = 1;
export const PERSISTENT_TRANSPORT_SCHEMA_VERSION = 1;
export const PERSISTENT_TRANSPORT_DEFAULTS = Object.freeze({
  startupTimeoutMs: 15_000,
  requestTimeoutMs: 120_000,
  idleTimeoutMs: 10 * 60 * 1_000,
  maxRequestFrameBytes: 1 * 1024 * 1024,
  maxResponseFrameBytes: 16 * 1024 * 1024,
  maxPatternChars: 4_096,
});

export const PERSISTENT_TRANSPORT_METHODS = Object.freeze([
  "handshake",
  "repository.search",
  "transport.status",
  "transport.shutdown",
]);

export function getPersistentTransportRoot({ homeDirectory = os.homedir() } = {}) {
  return path.join(homeDirectory, ".forgeloop", "persistent-search");
}
