import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  OPENSRC_SEARCH_LIMITS,
  searchSourceRoot,
} from "../src/adapters/opensrc/search.js";
import { removeTempTree } from "./helpers/rm-safe.js";

async function withSourceRoot(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-search-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, content);
    }
    return await run(root);
  } finally {
    await removeTempTree(root);
  }
}

const BASE_FILES = {
  "src/types.ts": "// parse error handling entrypoint\nexport function parseErrorHandling(input: string): void {\n  throw new Error(input);\n}\n",
  "src/helpers.ts": "export function tokenizeError(value: string): string[] {\n  return value.split(' ');\n}\n",
  "README.md": "Error handling notes for parse routines.\n",
};

test("exact phrase outranks token overlap with stable ordering", async () => {
  await withSourceRoot(BASE_FILES, async (root) => {
    const matches = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "parse error handling",
    });
    assert.ok(matches.length >= 2);
    assert.equal(matches[0].relativePath, "src/types.ts");
    assert.equal(matches[0].fullMatch, true);
    assert.equal(matches[0].line, 1);
    assert.ok(matches[0].snippet.includes("parseErrorHandling"));
  });
});

test("repeated searches are byte-identical", async () => {
  await withSourceRoot(BASE_FILES, async (root) => {
    const input = { sourceRoot: root, sourceSpec: "zod", sourceIndex: 0, query: "error" };
    const first = await searchSourceRoot(input);
    const second = await searchSourceRoot(input);
    assert.deepEqual(second, first);
  });
});

test("binary content and oversized files are skipped", async () => {
  await withSourceRoot(
    {
      "src/ok.ts": "parse the error here\n",
      "assets/logo.png": "parse the error here",
      "src/huge.ts": `parse the error here\n${"x".repeat(300 * 1024)}`,
    },
    async (root) => {
      const matches = await searchSourceRoot({
        sourceRoot: root,
        sourceSpec: "zod",
        sourceIndex: 0,
        query: "parse the error here",
        limits: { ...OPENSRC_SEARCH_LIMITS, maxFileBytes: 1024 },
      });
      assert.deepEqual(matches.map((match) => match.relativePath), ["src/ok.ts"]);
    },
  );
});

test("generated directories and directory symlinks are skipped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-search-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/real.ts"), "unique marker one\n");
    await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
    await writeFile(path.join(root, "node_modules/pkg/hidden.ts"), "unique marker two\n");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git/hidden.ts"), "unique marker three\n");
    const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-outside-"));
    try {
      await writeFile(path.join(outside, "linked.ts"), "unique marker four\n");
      await symlink(outside, path.join(root, "linked-dir"));
      const matches = await searchSourceRoot({
        sourceRoot: root,
        sourceSpec: "zod",
        sourceIndex: 0,
        query: "unique marker",
      });
      assert.deepEqual(matches.map((match) => match.relativePath), ["src/real.ts"]);
    } finally {
      await removeTempTree(outside);
    }
  } finally {
    await removeTempTree(root);
  }
});

test("file symlink escape is rejected while contained links resolve", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-search-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-outside-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/inner.ts"), "escape probe content\n");
    await writeFile(path.join(outside, "outer.ts"), "escape probe content\n");
    await symlink(path.join(outside, "outer.ts"), path.join(root, "src/evil.ts"));
    await symlink(path.join(root, "src/inner.ts"), path.join(root, "src/ok-link.ts"));
    const matches = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "escape probe",
    });
    const paths = matches.map((match) => match.relativePath).sort();
    assert.ok(paths.includes("src/inner.ts"));
    assert.ok(paths.includes("src/ok-link.ts"));
    assert.ok(!paths.includes("src/evil.ts"));
  } finally {
    await removeTempTree(root);
    await removeTempTree(outside);
  }
});

test("file count and byte budgets bound scanning", async () => {
  const files = {};
  for (let index = 0; index < 10; index += 1) {
    files[`src/file-${index}.ts`] = "budget probe line\n";
  }
  await withSourceRoot(files, async (root) => {
    const matches = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "budget probe",
      limits: { ...OPENSRC_SEARCH_LIMITS, maxFilesPerSource: 3, maxMatchesPerSource: 100 },
    });
    assert.ok(matches.length <= 3);
    const byteCapped = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "budget probe",
      limits: { ...OPENSRC_SEARCH_LIMITS, maxTotalReadBytes: 40, maxMatchesPerSource: 100 },
    });
    assert.ok(byteCapped.length <= 2);
  });
});

test("match count cap and snippet line ranges hold", async () => {
  const lines = Array.from({ length: 30 }, (_, index) => `filler line ${index}`);
  lines[15] = "needle match here";
  await withSourceRoot({ "src/big.ts": `${lines.join("\n")}\n` }, async (root) => {
    const matches = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "needle match here",
      limits: { ...OPENSRC_SEARCH_LIMITS, maxMatchesPerSource: 5 },
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 16);
    assert.ok(matches[0].snippetStartLine <= 16 && matches[0].snippetEndLine >= 16);
    assert.ok(matches[0].snippetEndLine - matches[0].snippetStartLine + 1 <= OPENSRC_SEARCH_LIMITS.maxSnippetLines);
  });
});

test("generated directories are skipped at any depth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-search-"));
  try {
    const nested = [
      "packages/foo/node_modules/pkg/hidden.ts",
      "examples/app/dist/hidden.ts",
      "crates/foo/target/hidden.ts",
      "src/build/hidden.ts",
      "nested/coverage/hidden.ts",
    ];
    for (const relative of nested) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, "deep generated marker\n");
    }
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/visible.ts"), "deep generated marker\n");
    const matches = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "deep generated marker",
    });
    assert.deepEqual(matches.map((match) => match.relativePath), ["src/visible.ts"]);
  } finally {
    await removeTempTree(root);
  }
});

test("traversal entry ceiling bounds pathological trees", async () => {
  const files = {};
  for (let index = 0; index < 20; index += 1) {
    files[`src/file-${String(index).padStart(2, "0")}.ts`] = "ceiling probe line\n";
  }
  await withSourceRoot(files, async (root) => {
    const matches = await searchSourceRoot({
      sourceRoot: root,
      sourceSpec: "zod",
      sourceIndex: 0,
      query: "ceiling probe",
      limits: { ...OPENSRC_SEARCH_LIMITS, maxEntriesPerSource: 5, maxMatchesPerSource: 100 },
    });
    assert.ok(matches.length < 20);
  });
});

test("skipped entries still consume the traversal ceiling", async () => {
  await withSourceRoot(
    {
      "src/z1.bin.png": "ceiling skip probe",
      "src/z2.bin.png": "ceiling skip probe",
      "src/z3.bin.png": "ceiling skip probe",
      "src/z4.bin.png": "ceiling skip probe",
      "src/aaa-visible.ts": "ceiling skip probe\n",
    },
    async (root) => {
      const matches = await searchSourceRoot({
        sourceRoot: root,
        sourceSpec: "zod",
        sourceIndex: 0,
        query: "ceiling skip probe",
        limits: { ...OPENSRC_SEARCH_LIMITS, maxEntriesPerSource: 4, maxMatchesPerSource: 100 },
      });
      assert.equal(matches.length, 0);
    },
  );
});

test("expired deadline aborts traversal", async () => {
  await withSourceRoot(BASE_FILES, async (root) => {
    await assert.rejects(
      searchSourceRoot({
        sourceRoot: root,
        sourceSpec: "zod",
        sourceIndex: 0,
        query: "error",
        deadline: Date.now() - 1000,
      }),
      (error) => error.code === "E_ADVISORY_CONTEXT_TIMEOUT",
    );
  });
});

test("deadline is enforced during traversal via injected clock", async () => {
  const files = {};
  for (let index = 0; index < 30; index += 1) {
    files[`src/file-${String(index).padStart(2, "0")}.ts`] = "clock probe line\n";
  }
  await withSourceRoot(files, async (root) => {
    const start = Date.now();
    let calls = 0;
    const clockImpl = () => {
      calls += 1;
      return calls <= 2 ? start : start + 3600000;
    };
    await assert.rejects(
      searchSourceRoot({
        sourceRoot: root,
        sourceSpec: "zod",
        sourceIndex: 0,
        query: "clock probe",
        deadline: start + 60000,
        clockImpl,
      }),
      (error) => error.code === "E_ADVISORY_CONTEXT_TIMEOUT",
    );
    assert.ok(calls > 2);
  });
});

test("read budget is shared across invocations", async () => {
  await withSourceRoot({ "src/a.ts": "shared budget line abcdefgh\n" }, async (rootA) => {
    await withSourceRoot({ "src/b.ts": "shared budget line abcdefgh\n" }, async (rootB) => {
      const budget = { remainingReadBytes: 40 };
      const first = await searchSourceRoot({
        sourceRoot: rootA, sourceSpec: "a", sourceIndex: 0, query: "shared budget", budget,
      });
      assert.equal(first.length, 1);
      const second = await searchSourceRoot({
        sourceRoot: rootB, sourceSpec: "b", sourceIndex: 1, query: "shared budget", budget,
      });
      assert.equal(second.length, 0);
    });
  });
});

test("search limits stay bounded", () => {
  assert.equal(OPENSRC_SEARCH_LIMITS.maxSources, 8);
  assert.equal(OPENSRC_SEARCH_LIMITS.maxFilesPerSource, 2000);
  assert.equal(OPENSRC_SEARCH_LIMITS.maxEntriesPerSource, 5000);
  assert.equal(OPENSRC_SEARCH_LIMITS.maxFileBytes, 256 * 1024);
  assert.equal(OPENSRC_SEARCH_LIMITS.maxTotalReadBytes, 8 * 1024 * 1024);
  assert.equal(OPENSRC_SEARCH_LIMITS.maxMatchesPerSource, 32);
  assert.equal(OPENSRC_SEARCH_LIMITS.maxSnippetLines, 7);
});
