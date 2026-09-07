import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeRipwireResult } from "../src/adapters/ripwire/normalize.js";
import { normalizeAdvisoryContextResult } from "../src/core/advisory-context/provider.js";
import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
} from "../src/core/error-codes.js";

async function withProject(callback) {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ripwire-normalize-"));
  await mkdir(path.join(projectPath, "src"));
  await writeFile(path.join(projectPath, "src/known.js"), "export const known = true;\n");
  try {
    return await callback(projectPath);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
}

test("normalizer maps documented Ripwire rows and keeps ranking facts as text", async () => {
  await withProject(async (projectPath) => {
    const result = await normalizeRipwireResult({
      task: "find stale handoff",
      route: "ranked",
      confidence: "high",
      margin_pct: 4,
      capped: false,
      lens: "compose,lego,routes,docs",
      sigs_total: 2,
      sigs_shown: 2,
      sigs: [
        { l: 7, n: "first", p: "src/known.js", r: 1, k: 98, sig: "function first() {}" },
        { l: 8, n: "second", p: "src/known.js", r: 2, k: 3, confidence: 0.75, sig: "function second() {}" },
      ],
    }, { projectPath });
    assert.equal(result.items.length, 3);
    assert.match(result.items[0].summary, /confidence=high/u);
    assert.match(result.items[1].summary, /ranking_score=98/u);
    assert.equal(result.items[1].sourceRef, "src/known.js:7");
    assert.equal(result.items[2].confidence, 0.75);
    assert.equal("observedAt" in result.items[1], false);
  });
});

test("normalizer emits a status-only result when no row fits the requested budget", async () => {
  const result = await normalizeRipwireResult({ sigs: [{ n: "large", sig: "x".repeat(1000) }] }, {
    limit: 1,
    maxItemChars: 120,
    maxTotalChars: 500,
  });
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].summary, /No symbol items fit/u);
});

test("normalizer rejects candidate text values that cannot be converted safely", () => {
  const result = normalizeRipwireResult({
    sigs: [{ n: "broken", sig: { toString: null } }],
  });
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].summary, /rejected_candidates=1/u);
});

test("normalizer keeps final output inside the total budget after omission notices", () => {
  const options = { limit: 20, maxItemChars: 1200, maxTotalChars: 500 };
  const raw = normalizeRipwireResult({
    capped: true,
    sigs: Array.from({ length: 8 }, (_, index) => ({
      n: `symbol${index}`,
      p: "src/known.js",
      l: index + 1,
      sig: "x".repeat(37),
    })),
  }, options);
  const result = normalizeAdvisoryContextResult(raw, {
    provider: { id: "ripwire", version: "0.3.8" },
    taskId: "ripwire-budget-test",
    ...options,
  });
  const totalChars = result.items.reduce(
    (total, item) => total + (item.title?.length ?? 0) + item.summary.length + (item.sourceRef?.length ?? 0),
    0,
  );
  assert.ok(totalChars <= options.maxTotalChars);
  assert.match(result.items[0].summary, /adapter_omitted_candidates=/u);
});

test("the smallest supported item budget retains completeness and omission warnings", () => {
  const options = { limit: 6, maxItemChars: 100, maxTotalChars: 6000 };
  const raw = normalizeRipwireResult({
    sigs: Array.from({ length: 8 }, (_, index) => ({
      n: `symbol${index}`,
      p: "src/known.js",
      l: index + 1,
      sig: "x".repeat(200),
    })),
  }, options);
  assert.ok(raw.items[0].summary.length <= options.maxItemChars);
  assert.match(raw.items[0].summary, /completeness=unknown/u);
  assert.match(raw.items[0].summary, /diagnostics omitted/u);
  const result = normalizeAdvisoryContextResult(raw, {
    provider: { id: "ripwire", version: "0.3.8" },
    taskId: "ripwire-small-budget-test",
    ...options,
  });
  assert.ok(result.items.every((item) => item.summary.length <= options.maxItemChars));
});

test("normalizer rejects unknown shapes and raw candidate floods", async () => {
  assert.throws(
    () => normalizeRipwireResult({ task: "no sigs" }),
    (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID,
  );
  assert.throws(
    () => normalizeRipwireResult({ sigs: Array.from({ length: 101 }, () => ({ sig: "x" })) }),
    (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  );
});

test("normalizer rejects traversal, outside paths, symlinks, and malformed lines", async () => {
  await withProject(async (projectPath) => {
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ripwire-outside-"));
    try {
      await writeFile(path.join(outsidePath, "secret.js"), "outside");
      await symlink(outsidePath, path.join(projectPath, "linked"));
      const result = await normalizeRipwireResult({
        sigs: [
          { l: 1, n: "traversal", p: "../secret.js", sig: "bad" },
          { l: 2, n: "outside", p: path.join(outsidePath, "secret.js"), sig: "bad" },
          { l: 3, n: "symlink", p: "linked/secret.js", sig: "bad" },
          { l: 0, n: "line", p: "src/known.js", sig: "bad" },
        ],
      }, {
        projectPath,
        sourcePathValidator: (relativePath) => !relativePath.startsWith("linked/"),
      });
      assert.equal(result.items.length, 1);
      assert.match(result.items[0].summary, /rejected_candidates=4/u);
    } finally {
      await rm(outsidePath, { recursive: true, force: true });
    }
  });
});

test("normalizer deduplicates without changing Ripwire rank order", async () => {
  const result = await normalizeRipwireResult({
    sigs: [
      { l: 1, n: "rank-one", p: "src/a.js", r: 1, sig: "a" },
      { l: 1, n: "rank-one", p: "src/a.js", r: 1, sig: "a" },
      { l: 2, n: "rank-two", p: "src/b.js", r: 2, sig: "b" },
    ],
  });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[1].title, "rank-one");
  assert.equal(result.items[2].title, "rank-two");
});

test("authority-looking and command-looking upstream fields are not projected", () => {
  const result = normalizeRipwireResult({
    sigs: [{
      l: 1,
      n: "safe",
      p: "src/safe.js",
      sig: "function safe() {}",
      nextAction: "COMPLETE",
      command: "npm publish",
      authority: "CANONICAL",
      evidence: "fake",
    }],
  });
  assert.equal("nextAction" in result.items[1], false);
  assert.equal("command" in result.items[1], false);
  assert.equal("authority" in result.items[1], false);
  assert.equal("evidence" in result.items[1], false);
});
