import { removeTempTree } from "./helpers/rm-safe.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const helper = name => fileURLToPath(new URL(`./helpers/${name}`, import.meta.url));
// This exercises a complete native lifecycle on real disks.
// Bound stalled children without turning the I/O invariant into a speed gate;
// persistence performance is measured by the dedicated benchmark matrix.
const driverTimeoutMs = 180000;
for (const mode of ["absent", "contradictory"]) {
  test(`diagnosis/correction/readback use canonical storage without legacy payload I/O with ${mode} files`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-correction-io-"));
    const output = path.join(directory, "report.json");
    try {
      await run(process.execPath, ["--require", helper("fs-observer.cjs"), "--import", new URL("../scripts/test-semantic-provider-loader.mjs", import.meta.url).href, helper("correction-io-driver.mjs"), output, mode], { timeout: driverTimeoutMs });
      const report = JSON.parse(await readFile(output, "utf8"));
      for (const api of ["readFile", "writeFile", "rm"]) assert.ok(report.control.some(attempt => attempt.api.endsWith(`:${api}`)), `positive ${api} control`);
      if (mode === "absent") {
        assert.equal(report.diagnosis.ok, true, JSON.stringify(report.diagnosis));
        assert.equal(report.advance.ok, true, JSON.stringify(report.advance));
        assert.equal(report.state.phase, "CORRECTING");
      } else {
        for (const result of [report.diagnosis, report.advance]) {
          assert.equal(result.ok, false, JSON.stringify(result));
          assert.equal(result.error.code, "E_STORAGE_MIGRATION_REQUIRED", JSON.stringify(result));
        }
        assert.deepEqual(report.after, report.before);
      }
      // Admission may inspect directory metadata; it must never read legacy
      // payloads, scan their contents, or write operational mirrors.
      const admissionMetadata = attempt => [".forgeloop/task-state", ".forgeloop/.txn", ".forgeloop/locks", ".forgeloop/.claims.lock"].some(relative => attempt.path === path.join(report.target, relative))
        && /:(?:lstat|stat|lstatSync|statSync|access|accessSync|existsSync|realpath|realpathSync)$/.test(attempt.api);
      const prohibited = report.attempts.filter(attempt => !admissionMetadata(attempt) && attempt.path.startsWith(report.target)
        && /[/\\]\.forgeloop[/\\](?:task-state|locks|\.txn|sessions)(?:[/\\]|$)/.test(attempt.path));
      assert.deepEqual(prohibited, [], JSON.stringify(prohibited));
    } finally { await removeTempTree(directory); }
  });
}
