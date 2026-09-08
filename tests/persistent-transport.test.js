import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PERSISTENT_TRANSPORT_DEFAULTS } from "../src/persistent-transport/constants.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "../src/persistent-transport/errors.js";
import { encodeFrame, FrameDecoder, parseFrame } from "../src/persistent-transport/framing.js";
import { getPersistentTransportStatus, pingPersistentSearchHost, shutdownPersistentSearchHost } from "../src/persistent-transport/client.js";
import { inspectPersistentTransport, startPersistentSearchHost } from "../src/persistent-transport/lifecycle.js";
import { terminateOwnedPersistentTransport } from "../src/persistent-transport/ownership.js";
import { readPersistentTransportState } from "../src/persistent-transport/state.js";
import { assertSearchParams, createRequest, validateRequest } from "../src/persistent-transport/protocol.js";

async function waitForHost(homeDirectory) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await pingPersistentSearchHost({ homeDirectory, timeoutMs: 500 });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

test("persistent transport framing accepts partial and multiple frames", () => {
  const first = encodeFrame({ id: "one" });
  const second = encodeFrame({ id: "two" });
  const decoder = new FrameDecoder({ maxFrameBytes: 256 });
  assert.deepEqual(decoder.push(first.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(2), second])), [Buffer.from(JSON.stringify({ id: "one" })), Buffer.from(JSON.stringify({ id: "two" }))]);
  assert.deepEqual(parseFrame(encodeFrame({ ready: true }).subarray(4)), { ready: true });
  decoder.end();
});

test("persistent transport framing rejects invalid, oversized, and truncated frames", () => {
  const invalidJson = new FrameDecoder({ maxFrameBytes: 128 });
  assert.throws(() => parseFrame(Buffer.from("{")), { code: PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_INVALID });
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32BE(129, 0);
  assert.throws(() => invalidJson.push(oversized), { code: PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_TOO_LARGE });
  const truncated = new FrameDecoder({ maxFrameBytes: 128 });
  const frame = encodeFrame({ value: true });
  truncated.push(frame.subarray(0, frame.length - 1));
  assert.throws(() => truncated.end(), { code: PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_INVALID });
});

test("persistent transport protocol rejects unknown methods and malformed search parameters", () => {
  assert.throws(() => validateRequest(createRequest("unknown.method")), { code: PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST });
  assert.throws(() => assertSearchParams({ repository: "/repo", query: {} }), { code: PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST });
  assert.throws(() => assertSearchParams({ repository: "/repo", query: { pattern: "needle", binaryPath: "/tmp/untrusted" } }), { code: PERSISTENT_TRANSPORT_ERROR_CODES.INVALID_REQUEST });
  assert.throws(() => validateRequest({ protocolVersion: 99, id: "one", method: "handshake", params: {} }), { code: PERSISTENT_TRANSPORT_ERROR_CODES.PROTOCOL_MISMATCH });
});

test("persistent transport host publishes bounded status and shuts down through its nonce", async () => {
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-host-"));
  try {
    await startPersistentSearchHost({ homeDirectory, idleTimeoutMs: 5_000 });
    const handshake = await waitForHost(homeDirectory);
    assert.equal(handshake.protocolVersion, 1);
    assert.equal(handshake.scopeId.startsWith("user-"), true);
    const status = await getPersistentTransportStatus({ homeDirectory });
    assert.equal(status.status, "READY");
    assert.equal(status.running, true);
    assert.equal(Object.hasOwn(status, "endpoint"), false);
    assert.equal(Object.hasOwn(status, "entrypoint"), false);
    await shutdownPersistentSearchHost({ homeDirectory, timeoutMs: 5_000 });
    assert.equal((await getPersistentTransportStatus({ homeDirectory })).status, "NOT_RUNNING");
  } finally {
    await shutdownPersistentSearchHost({ homeDirectory, timeoutMs: 1_000 }).catch(() => {});
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("persistent transport can verify a live host through its authenticated endpoint", async () => {
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-endpoint-"));
  try {
    await startPersistentSearchHost({ homeDirectory, idleTimeoutMs: 5_000 });
    await waitForHost(homeDirectory);
    const inspection = await inspectPersistentTransport({
      homeDirectory,
      processInspector: { isAlive: () => true, commandLine: async () => null },
    });
    assert.equal(inspection.status, "READY");
    assert.equal(inspection.owned, true);
    assert.equal(inspection.ownershipMode, "ENDPOINT_HANDSHAKE");
  } finally {
    await shutdownPersistentSearchHost({ homeDirectory, timeoutMs: 1_000 }).catch(() => {});
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("endpoint-authenticated cleanup shuts down the verified host without killing a PID", async () => {
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-cleanup-"));
  try {
    const { paths } = await startPersistentSearchHost({ homeDirectory, idleTimeoutMs: 5_000 });
    await waitForHost(homeDirectory);
    const { state } = await readPersistentTransportState(paths.statePath);
    let killCount = 0;
    const result = await terminateOwnedPersistentTransport(state, {
      expectedEndpoint: paths.endpoint,
      processApi: { kill: () => { killCount += 1; } },
      processInspector: { isAlive: () => true, commandLine: async () => null },
    });
    assert.equal(result.termination, "ENDPOINT_SHUTDOWN");
    assert.equal(killCount, 0);
  } finally {
    await shutdownPersistentSearchHost({ homeDirectory, timeoutMs: 1_000 }).catch(() => {});
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("persistent transport does not claim ownership of an unrelated live process", async () => {
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-ownership-"));
  try {
    const { writePersistentTransportState } = await import("../src/persistent-transport/state.js");
    const { getPersistentTransportPaths } = await import("../src/persistent-transport/paths.js");
    const paths = getPersistentTransportPaths({ homeDirectory });
    await writePersistentTransportState(paths.statePath, {
      pid: process.pid,
      protocolVersion: 1,
      forgeLoopVersion: "1.10.2",
      scopeId: paths.scopeId,
      nonce: "unrelated-live-process",
      endpoint: paths.endpoint,
      entrypoint: "/not-the-forgeloop-host.js",
      startedAt: new Date().toISOString(),
    });
    const status = await getPersistentTransportStatus({ homeDirectory });
    assert.equal(status.status, "OWNERSHIP_UNVERIFIED");
    assert.equal(status.owned, false);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("persistent transport constants keep bounded defaults explicit", () => {
  assert.equal(PERSISTENT_TRANSPORT_DEFAULTS.maxRequestFrameBytes, 1 * 1024 * 1024);
  assert.equal(PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes, 16 * 1024 * 1024);
  assert.throws(() => { throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.TIMEOUT, "bounded"); }, { code: PERSISTENT_TRANSPORT_ERROR_CODES.TIMEOUT });
});
