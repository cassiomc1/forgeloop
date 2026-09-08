import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { searchViaPersistentTransport, getPersistentTransportStatus, shutdownPersistentSearchHost } from "../src/persistent-transport/client.js";
import { stopRepositoryIndexServer } from "../src/repository-index/server.js";
import { createFixtureRepository, nativeOptions, packageRoot, requireNativeBinary, removeFixtureRepository } from "./helpers/repository-index.js";

const execFileAsync = promisify(execFile);

test("persistent transport preserves native search results, shares one host, and recovers", async (t) => {
  const binary = await requireNativeBinary(t);
  if (!binary) return;
  const firstRepository = await createFixtureRepository();
  const secondRepository = await createFixtureRepository();
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-search-native-"));
  const cliHomeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-search-native-cli-"));
  const transportOptions = {
    ...nativeOptions(binary),
    homeDirectory,
    env: { FORGELOOP_TGREP_BINARY: binary },
    startupTimeoutMs: 30_000,
    requestTimeoutMs: 60_000,
    idleTimeoutMs: 60_000,
  };
  try {
    const parallel = await Promise.all(Array.from({ length: 50 }, () => searchViaPersistentTransport(firstRepository, { pattern: "alphaNeedle", fixedStrings: true, globs: ["src/**"] }, transportOptions)));
    assert.equal(parallel.length, 50);
    assert.ok(parallel.every((result) => result.matches.length === 1));
    const first = await searchViaPersistentTransport(firstRepository, { pattern: "alphaNeedle", fixedStrings: true, globs: ["src/**"] }, transportOptions);
    const warm = await searchViaPersistentTransport(firstRepository, { pattern: "alphaNeedle", fixedStrings: true, globs: ["src/**"] }, transportOptions);
    assert.deepEqual(first.matches.map(({ path: matchPath, line }) => [matchPath, line]), [["src/alpha.js", 1]]);
    assert.deepEqual(warm.matches.map(({ path: matchPath, line }) => [matchPath, line]), [["src/alpha.js", 1]]);
    assert.equal((await getPersistentTransportStatus({ homeDirectory })).status, "READY");

    const second = await searchViaPersistentTransport(secondRepository, { pattern: "betaNeedle", fixedStrings: true }, transportOptions);
    assert.deepEqual(second.matches.map(({ path: matchPath, line }) => [matchPath, line]), [["src/beta.js", 1]]);

    await shutdownPersistentSearchHost({ homeDirectory, timeoutMs: 5_000 });
    assert.equal((await getPersistentTransportStatus({ homeDirectory })).status, "NOT_RUNNING");
    const recovered = await searchViaPersistentTransport(firstRepository, { pattern: "alphaNeedle", fixedStrings: true, globs: ["src/**"] }, transportOptions);
    assert.equal(recovered.matches.length, 1);
    assert.equal((await getPersistentTransportStatus({ homeDirectory })).status, "READY");

    const cliEnvironment = { ...process.env, HOME: cliHomeDirectory, USERPROFILE: cliHomeDirectory, FORGELOOP_TGREP_BINARY: binary };
    const cliArguments = [path.join(packageRoot, "src", "cli.js"), "search", "alphaNeedle", "--fixed-strings", "--glob", "src/**", "--json", "--path", firstRepository];
    const coldCli = await execFileAsync(process.execPath, cliArguments, { cwd: packageRoot, env: cliEnvironment, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    const warmCli = await execFileAsync(process.execPath, cliArguments, { cwd: packageRoot, env: cliEnvironment, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(JSON.parse(coldCli.stdout).matches.length, 1);
    assert.equal(JSON.parse(warmCli.stdout).matches.length, 1);
  } finally {
    await shutdownPersistentSearchHost({ homeDirectory, timeoutMs: 2_000 }).catch(() => {});
    await stopRepositoryIndexServer(firstRepository, nativeOptions(binary, { homeDirectory })).catch(() => {});
    await stopRepositoryIndexServer(secondRepository, nativeOptions(binary, { homeDirectory })).catch(() => {});
    await removeFixtureRepository(firstRepository);
    await removeFixtureRepository(secondRepository);
    await rm(homeDirectory, { recursive: true, force: true });
    await rm(cliHomeDirectory, { recursive: true, force: true });
  }
});
