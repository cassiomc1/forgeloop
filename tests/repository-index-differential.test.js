import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

import { searchRepository } from "../src/repository-index/search.js";
import { setupRepositoryIndex, stopRepositoryIndexServer } from "../src/repository-index/server.js";
import { createFixtureRepository, nativeOptions, requireNativeBinary, removeFixtureRepository } from "./helpers/repository-index.js";

const execFileAsync = promisify(execFile);

test("native search matches the ripgrep oracle for a controlled literal query", async (t) => {
  const binary = await requireNativeBinary(t);
  if (!binary) return;
  const target = await createFixtureRepository();
  const options = nativeOptions(binary);
  try {
    await setupRepositoryIndex(target, options);
    const query = { ...options, pattern: "sharedNeedle", fixedStrings: true };
    const indexed = await searchRepository(target, query);
    const oracle = await execFileAsync("rg", ["--json", "--fixed-strings", "sharedNeedle", "."], { cwd: target });
    const oracleMatches = oracle.stdout.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
      .filter((event) => event.type === "match")
      .map((event) => [event.data.path.text.replace(/^\.\//u, ""), event.data.line_number])
      .sort();
    const indexedMatches = indexed.matches.map((match) => [match.path, match.line]).sort();
    assert.deepEqual(indexedMatches, oracleMatches);
  } catch (error) {
    if (error.code === "ENOENT") t.skip("differential oracle requires rg");
    else throw error;
  } finally {
    await stopRepositoryIndexServer(target, options).catch(() => {});
    await removeFixtureRepository(target);
  }
});
