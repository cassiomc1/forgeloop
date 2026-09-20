import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEmulatedServicesProvider,
  EMULATED_SERVICES_ERROR_CODES,
  EMULATED_SERVICES_SUPPORTED_VERSION,
} from "../src/adapters/emulated-services/index.js";
import { spawnManagedEmulatedServicesProcess } from "../src/adapters/emulated-services/process.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    process.nextTick(() => child.emit("close", 0, "SIGTERM"));
    return true;
  };
  return child;
}

function fakeSpawn(calls, { version = "emulate v0.11.2", output = "" } = {}) {
  return (_executable, args, options) => {
    calls.push({ args: [...args], options: { ...options } });
    const child = fakeChild();
    if (args[0] === "--version") {
      process.nextTick(() => {
        child.stdout.end(version);
        child.emit("close", 0, null);
      });
    } else if (output) {
      process.nextTick(() => child.stdout.write(output));
    }
    return child;
  };
}

function providerFor(calls, overrides = {}) {
  const { version, output, ...providerOverrides } = overrides;
  return createEmulatedServicesProvider({
    executablePath: process.execPath,
    expectedVersion: EMULATED_SERVICES_SUPPORTED_VERSION,
    tempRoot: path.join(os.tmpdir(), "forgeloop-emulated-services-test"),
    targetRoot: path.join(os.tmpdir(), "forgeloop-target-test"),
    spawnImpl: fakeSpawn(calls, { version, output }),
    mkdtempImpl: async () => path.join(os.tmpdir(), "forgeloop-emulated-services-test-state"),
    rmImpl: async () => {},
    fetchImpl: async () => ({ status: 200, ok: true }),
    sleepImpl: async () => {},
    ...providerOverrides,
  });
}

test("provider construction is lazy and does not discover PATH or spawn", () => {
  const calls = [];
  const provider = providerFor(calls);
  assert.equal(provider.id, "emulated-services");
  assert.equal(provider.version, "0.11.2");
  assert.equal(calls.length, 0);
});

test("provider qualifies the host executable, uses argv-only execution, observes loopback, and cleans up", async () => {
  const calls = [];
  const removed = [];
  const provider = createEmulatedServicesProvider({
    executablePath: process.execPath,
    tempRoot: path.join(os.tmpdir(), "forgeloop-emulated-services-test"),
    targetRoot: path.join(os.tmpdir(), "forgeloop-target-test"),
    spawnImpl: fakeSpawn(calls),
    mkdtempImpl: async () => path.join(os.tmpdir(), "forgeloop-emulated-services-test-state"),
    rmImpl: async (value, options) => removed.push({ value, options }),
    fetchImpl: async (url) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/u);
      return { status: 200, ok: true };
    },
    sleepImpl: async () => {},
  });

  const result = await provider.start({
    services: ["vercel", "github"],
    basePort: 4100,
    timeoutMs: 1000,
  });

  assert.deepEqual(result.services, [
    { id: "vercel", endpoint: "http://127.0.0.1:4100" },
    { id: "github", endpoint: "http://127.0.0.1:4101" },
  ]);
  assert.equal(result.status, "READY");
  assert.equal(result.authority, "OBSERVATION");
  assert.equal(result.evidenceAuthority, "NONE");
  assert.equal(result.lifecycleAuthority, false);
  assert.equal(result.completionAuthority, false);
  assert.equal(result.persisted, false);
  assert.deepEqual(result.cleanup, { status: "COMPLETED" });
  assert.deepEqual(calls.map((call) => call.args), [
    ["--version"],
    ["--service", "vercel,github", "--port", "4100"],
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[1].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.ok(path.isAbsolute(calls[1].options.cwd));
  assert.equal(Object.hasOwn(calls[1].options.env, "AWS_ACCESS_KEY_ID"), false);
  assert.deepEqual(removed, [{
    value: path.join(os.tmpdir(), "forgeloop-emulated-services-test-state"),
    options: { recursive: true, force: true },
  }]);
});

test("seed configuration is passed as one argv value and never becomes shell syntax", async () => {
  const calls = [];
  const seedPath = path.join(os.tmpdir(), "emulate-seed.yaml");
  const provider = createEmulatedServicesProvider({
    executablePath: process.execPath,
    tempRoot: path.join(os.tmpdir(), "forgeloop-emulated-services-test"),
    spawnImpl: fakeSpawn(calls),
    mkdtempImpl: async () => path.join(os.tmpdir(), "forgeloop-emulated-services-test-state"),
    rmImpl: async () => {},
    fetchImpl: async () => ({ status: 200 }),
    sleepImpl: async () => {},
    fsImpl: { lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }) },
  });
  await provider.start({ services: ["github"], seedPath: seedPath, timeoutMs: 1000 });
  assert.deepEqual(calls[1].args, ["--service", "github", "--port", "4000", "--seed", seedPath]);
});

test("version mismatch and malformed output fail closed before service startup", async () => {
  const mismatchCalls = [];
  await assert.rejects(
    () => providerFor(mismatchCalls, { version: "emulate v0.11.1" }).start({ services: ["vercel"] }),
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.VERSION_UNSUPPORTED,
  );
  assert.deepEqual(mismatchCalls.map((call) => call.args), [["--version"]]);

  const malformedCalls = [];
  await assert.rejects(
    () => providerFor(malformedCalls, { version: "unexpected output" }).start({ services: ["vercel"] }),
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.OUTPUT_INVALID,
  );
  assert.deepEqual(malformedCalls.map((call) => call.args), [["--version"]]);
});

test("invalid configuration, target overlap, and cancellation fail closed", () => {
  assert.throws(
    () => createEmulatedServicesProvider({ executablePath: "emulate" }),
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID,
  );
  assert.throws(
    () => createEmulatedServicesProvider({
      executablePath: process.execPath,
      tempRoot: "/tmp/project/.state",
      targetRoot: "/tmp/project",
    }),
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID,
  );
  assert.throws(
    () => createEmulatedServicesProvider({ executablePath: process.execPath, unsupported: true }),
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.CONFIG_INVALID,
  );
  const controller = new AbortController();
  controller.abort();
  return assert.rejects(
    () => providerFor([]).start({ services: ["vercel"], signal: controller.signal }),
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.CANCELLED,
  );
});

test("child output limits terminate the process and do not expose raw output", async () => {
  const spawnImpl = (_executable, _args, options) => {
    const child = fakeChild();
    process.nextTick(() => child.stdout.write("x".repeat(20)));
    return child;
  };
  const managed = spawnManagedEmulatedServicesProcess(process.execPath, ["--version"], {
    cwd: os.tmpdir(),
    spawnImpl,
    maxStdoutBytes: 8,
  });
  await assert.rejects(
    async () => {
      await managed.closed;
      const failure = managed.failure();
      if (failure) throw failure;
    },
    (error) => error.code === EMULATED_SERVICES_ERROR_CODES.OUTPUT_LIMIT
      && !error.message.includes("x".repeat(20)),
  );
});
