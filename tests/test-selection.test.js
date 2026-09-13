import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverTests, selectTests } from "../scripts/test-selection.mjs";
import { removeTempTree } from "./helpers/rm-safe.js";

test("test discovery includes nested suites and excludes fixture/helper trees", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "test-selection-"));
  t.after(() => removeTempTree(root));
  for (const folder of ["nested", "helpers", "fixtures", "node_modules"]) {
    await mkdir(path.join(root, folder));
    await writeFile(path.join(root, folder, "example.test.js"), "");
  }
  assert.deepEqual(await discoverTests(root), [path.join(root, "nested/example.test.js")]);
});

test("test selection forwards approved options and never silently broadens an empty selection", () => {
  const root = path.resolve("tests");
  const files = [path.join(root, "one.test.js"), path.join(root, "nested/two.test.js")];
  assert.deepEqual(selectTests(files, ["--test-name-pattern", "specific case", "nested"], root), ["--test", "--test-name-pattern", "specific case", files[1]]);
  assert.throws(() => selectTests(files, ["missing.test.js"], root), /No tests match/u);
  assert.throws(() => selectTests(files, ["--eval=bad"], root), /Unsupported/u);
  assert.throws(() => selectTests(files, ["--test-name-pattern"], root), /Missing value/u);
});

test("test selection supports watch mode without relaxing file boundaries", () => {
  const root = path.resolve("tests");
  const files = [path.join(root, "one.test.js"), path.join(root, "nested/two.test.js")];
  assert.deepEqual(
    selectTests(files, ["--watch", "--watch-path", "nested"], root),
    ["--test", "--watch", "--watch-path", "nested", ...files],
  );
});

test("test selection partitions the complete discovered set deterministically", () => {
  const root = path.resolve("tests");
  const files = [
    path.join(root, "one.test.js"),
    path.join(root, "nested/two.test.js"),
    path.join(root, "three.test.js"),
    path.join(root, "nested/four.test.js"),
  ];
  const shardOne = selectTests(files, ["--shard=1/2"], root).slice(1);
  const shardTwo = selectTests(files, ["--shard", "2/2"], root).slice(1);
  assert.deepEqual(shardOne, [files[0], files[2]]);
  assert.deepEqual(shardTwo, [files[1], files[3]]);
  assert.deepEqual([...shardOne, ...shardTwo].sort(), files.sort());
  assert.throws(() => selectTests(files, ["--shard=3/2"], root), /Invalid shard/u);
});
