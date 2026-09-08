import assert from "node:assert/strict";
import { test } from "node:test";

import { getCanonicalRepositorySearchArgs } from "../src/repository-index/args.js";
import { normalizeTgrepJson } from "../src/repository-index/normalize-json.js";

const root = "/repo with spaces";

test("normalizes tgrep match, context, stats, unknown events, and relative paths", async () => {
  const output = [
    JSON.stringify({ type: "begin", data: { path: { text: `${root}/src/alpha.js` } } }),
    JSON.stringify({ type: "match", data: {
      path: { text: `${root}/src/alpha.js` },
      lines: { text: "const café = true" },
      line_number: 2,
      column: 7,
      absolute_offset: 8,
      submatches: [{ start: 6, end: 10, match: { text: "café" } }],
    } }),
    JSON.stringify({ type: "context", data: {
      path: { text: `${root}/src/alpha.js` },
      lines: { text: "before" },
      line_number: 1,
    } }),
    JSON.stringify({ type: "summary", data: { bytes_searched: 100, matched_lines: 1 } }),
    JSON.stringify({ type: "future-event", data: {} }),
  ].join("\n");
  const result = await normalizeTgrepJson(output, { repositoryRoot: root, realpathImpl: async (value) => value });
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0], {
    path: "src/alpha.js",
    line: 2,
    column: 7,
    offset: 8,
    text: "const café = true",
    submatches: [{ start: 6, end: 10, match: "café" }],
  });
  assert.equal(result.contexts[0].path, "src/alpha.js");
  assert.deepEqual(result.stats, { bytesSearched: 100, matchedLines: 1 });
  assert.equal(result.ignoredEvents, 1);
});

test("normalizes no-match file lists and Windows paths without leaking absolute paths", async () => {
  const files = await normalizeTgrepJson("C:\\\\repo\\src\\a.js\nC:\\\\repo\\src\\b.js\n", {
    repositoryRoot: "C:\\\\repo",
    filesWithMatches: true,
    realpathImpl: async (value) => value,
    pathStyle: "win32",
  });
  assert.deepEqual(files.files, ["src/a.js", "src/b.js"]);
  const empty = await normalizeTgrepJson("", { repositoryRoot: root, realpathImpl: async (value) => value });
  assert.deepEqual(empty.matches, []);
});

test("known malformed events and paths outside the repository fail closed", async () => {
  const malformed = JSON.stringify({ type: "match", data: { path: { text: `${root}/src/a.js` }, lines: { text: "x" } } });
  await assert.rejects(
    () => normalizeTgrepJson(malformed, { repositoryRoot: root, realpathImpl: async (value) => value }),
    (error) => error.code === "E_REPOSITORY_INDEX_OUTPUT_INVALID",
  );
  const escaped = JSON.stringify({ type: "match", data: { path: "/outside/a.js", lines: { text: "x" }, line_number: 1 } });
  await assert.rejects(
    () => normalizeTgrepJson(escaped, { repositoryRoot: root, realpathImpl: async (value) => value }),
    (error) => error.code === "E_REPOSITORY_INDEX_OUTPUT_INVALID",
  );
});

test("search argument construction keeps dangerous patterns and filters as exact argv values", () => {
  const dangerous = "$(touch injected) * \"quoted\"";
  const args = getCanonicalRepositorySearchArgs({
    indexPath: "/repo/.forgeloop/repository-index/tgrep",
    pattern: dangerous,
    options: { fixedStrings: true, stats: true },
  });
  assert.deepEqual(args.slice(0, 3), ["--regexp", dangerous, "--fixed-strings"]);
  assert.equal(args.includes("--no-index"), false);
  assert.equal(args.includes("--exclude"), false);
});
