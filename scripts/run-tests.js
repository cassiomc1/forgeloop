#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { discoverTests, selectTests } from "./test-selection.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testDirectory = path.join(repositoryRoot, "tests");
const testFiles = await discoverTests(testDirectory);
const selectionArgs = process.argv.slice(2);
if (process.env.FORGELOOP_TEST_SHARD && !selectionArgs.some((argument) => argument === "--shard" || argument.startsWith("--shard="))) {
  selectionArgs.push("--shard", process.env.FORGELOOP_TEST_SHARD);
}
const argv = selectTests(testFiles, selectionArgs, repositoryRoot);

const result = spawnSync(process.execPath, argv, {
  cwd: repositoryRoot,
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;
