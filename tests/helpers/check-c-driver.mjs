/**
 * Check C driver: measures what the default execution path actually resolves.
 *
 * Imports the canonical CLI/integration entry points, then runs one real
 * read-only command on a fresh project, then deliberately imports a prohibited target as a
 * positive control.
 *
 * Usage: node check-c-driver.mjs <outJson> <projectPath>
 */
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import "../../tests/helpers/module-resolution-hooks.mjs";
import { executeForgeLoopCommand } from "../../src/core/command-runtime.js";

const [outPath] = process.argv.slice(2);

const records = (globalThis.__FORGELOOP_MODULE_RESOLUTIONS__ ??= []);

// The default entry points are already imported above; dynamic imports reached
// during execution are equally covered by the hook.
const afterEntryPoints = records.length;

// A fresh readonly project must not allocate a store or load its driver.
const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-readonly-loading-"));
const indexBeforeCommand = records.length;

let commandRan = false;
try {
  // A representative read-only command on a fresh project, executed for real.
  const envelope = await executeForgeLoopCommand({ command: "task-list", projectPath: target });
  globalThis.__CHECK_C_ENVELOPE__ = { ok: envelope.ok, code: envelope.error?.code ?? null };
  commandRan = true;
} catch (error) {
  commandRan = false;
  globalThis.__CHECK_C_COMMAND_ERROR__ = error?.message ?? String(error);
}
const afterCommand = records.length;
const databaseAllocated = existsSync(path.join(target, ".forgeloop/state.sqlite"));
await rm(target, { recursive: true, force: true });

// Positive control: a deliberate import of a prohibited target.
await import("node:sqlite");
const afterControl = records.length;

writeFileSync(outPath, `${JSON.stringify({
  afterEntryPoints,
  indexBeforeCommand,
  afterCommand,
  afterControl,
  commandRan,
  databaseAllocated,
  commandError: globalThis.__CHECK_C_COMMAND_ERROR__ ?? null,
  commandEnvelope: globalThis.__CHECK_C_ENVELOPE__ ?? null,
  defaultPathResolved: records.slice(indexBeforeCommand, afterCommand).map((entry) => entry.url),
  controlDetected: records.slice(afterCommand, afterControl).some((entry) => entry.url === "node:sqlite"),
  nodeVersion: process.version,
  platform: `${process.platform} ${process.arch}`,
}, null, 2)}\n`);
