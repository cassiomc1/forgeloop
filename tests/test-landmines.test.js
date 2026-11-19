import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { compareWithAllowlist, countLandmines, scanRepository } from "../scripts/check-test-landmines.mjs";
import { removeTempTree } from "./helpers/rm-safe.js";

// Samples are assembled from parts so this file does not contain the
// patterns it checks.
const sleep = ["await new Promise((resolve) => set", "Timeout(resolve, 50));"].join("");
const awaitedDelay = ["await de", "lay(10);"].join("");
const raisedTimeout = ["te", "st(\"slow\", { time", "out: 60000 }, async () => {});"].join("");
const retries = ["it(\"flaky\", { retr", "ies: 3 }, () => {});"].join("");
const retriesData = ["const metrics = { retr", "ies: 1 };"].join("");
const moduleMock = ["mock.mod", "ule(\"node:fs\", {});"].join("");
const patchedGlobal = ["globalThis.fe", "tch = async () => null;"].join("");
const patchedClock = ["Date.n", "ow = () => 0;"].join("");
const timers = ["t.mock.tim", "ers.enable({ apis: [\"setTimeout\"] });"].join("");

test("each rule counts its patterns and allows controlled timers", () => {
  assert.deepEqual(countLandmines(`${sleep}\n${awaitedDelay}`), { "no-fixed-sleep": 2 });
  assert.deepEqual(countLandmines(`${raisedTimeout}\n${retries}`), { "no-flake-masking": 2 });
  assert.deepEqual(countLandmines(`${moduleMock}\n${patchedGlobal}\n${patchedClock}`), { "no-test-doubles": 3 });
  assert.deepEqual(countLandmines(retriesData), {}, "a data field named retries is not a retry option");
  assert.deepEqual(countLandmines(timers), {});
  assert.deepEqual(countLandmines(["globalThis.fetch ", "=== undefined"].join("")), {});
});

test("new occurrences and stale allowances both fail, so the list only shrinks", () => {
  const found = { "no-fixed-sleep": { "tests/a.test.js": 2 } };
  assert.deepEqual(compareWithAllowlist(found, { "no-fixed-sleep": { "tests/a.test.js": 2 } }), []);
  const added = compareWithAllowlist(found, { "no-fixed-sleep": { "tests/a.test.js": 1 } });
  assert.deepEqual(added.map((problem) => problem.kind), ["NEW"]);
  assert.match(added[0].message, /Await the operation/u);
  const stale = compareWithAllowlist({}, { "no-fixed-sleep": { "tests/a.test.js": 1 } });
  assert.deepEqual(stale.map((problem) => [problem.kind, problem.file]), [["STALE", "tests/a.test.js"]]);
});

test("the scan covers nested test files and skips fixtures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-landmines-"));
  try {
    await mkdir(path.join(root, "tests", "nested"), { recursive: true });
    await mkdir(path.join(root, "tests", "fixtures"), { recursive: true });
    await writeFile(path.join(root, "tests", "nested", "x.test.js"), `${sleep}\n`);
    await writeFile(path.join(root, "tests", "fixtures", "y.test.js"), `${sleep}\n`);
    await writeFile(path.join(root, "tests", "helper.js"), `${sleep}\n`);
    assert.deepEqual(await scanRepository(root), { "no-fixed-sleep": { "tests/nested/x.test.js": 1 } });
  } finally { await removeTempTree(root); }
});

test("the repository matches its landmine allowlist", async () => {
  const { readFile } = await import("node:fs/promises");
  const allowlist = JSON.parse(await readFile("scripts/test-landmines-allowlist.json", "utf8"));
  assert.deepEqual(compareWithAllowlist(await scanRepository(process.cwd()), allowlist), []);
});
