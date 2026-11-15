import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAssess, formatAssessResult } from "../src/commands/assess.js";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "forgeloop-assess-"));
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

function snapshot(root) {
  const entries = [];
  (function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const stat = statSync(full);
      entries.push(`${path.relative(root, full)}:${stat.isDirectory() ? "dir" : stat.size}:${stat.mtimeMs}`);
      if (stat.isDirectory()) walk(full);
    }
  })(root);
  return entries;
}

const fullStack = {
  "package.json": {
    name: "shop", version: "1.0.0", type: "module",
    scripts: { test: "node --test", lint: "eslint .", build: "vite build" },
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", express: "^5.0.0", pg: "^8.0.0" },
    devDependencies: { eslint: "^9.0.0" },
  },
  "package-lock.json": { lockfileVersion: 3 },
  ".github/workflows/ci.yml": "on: push\njobs: {}\n",
  "src/server.js": "import express from 'express';\nexport const app = express();\n",
  "src/App.jsx": "export function App() { return null; }\n",
  "tests/server.test.js": "import test from 'node:test';\ntest('server starts', () => {});\n",
};

test("assess maps a full-stack repository to areas, guides, checks and no gaps", async () => {
  const root = fixture(fullStack);
  try {
    const result = await runAssess({ target: root });
    assert.equal(result.kind, "repository-assessment-plan");
    assert.equal(result.evidenceAuthority, "NONE");
    assert.deepEqual(Object.keys(result.facts.areas), ["backend", "database", "frontend", "infrastructure"]);
    assert.ok(result.facts.areas.frontend.includes("package.json:dependency=react"));
    assert.ok(result.facts.areas.backend.includes("package.json:dependency=express"));
    assert.ok(result.facts.areas.database.includes("package.json:dependency=pg"));
    const frontend = result.reviewPlan.areas.find((area) => area.area === "frontend");
    assert.ok(frontend.guides.some((guide) => guide.id === "design" && guide.path.startsWith("ENG/")));
    const backend = result.reviewPlan.areas.find((area) => area.area === "backend");
    assert.ok(backend.guides.some((guide) => guide.id === "security"));
    const argv = result.reviewPlan.candidateChecks.map((check) => check.argv.join(" "));
    assert.ok(argv.includes("npm test") && argv.includes("npm run lint") && argv.includes("npm run build"));
    assert.equal(new Set(argv).size, argv.length, "candidate checks are deduplicated");
    assert.ok(result.reviewPlan.candidateChecks.every((check) => check.status === "NOT_EXECUTED"));
    assert.deepEqual(result.reviewPlan.gaps, []);
    assert.ok(result.reviewPlan.findingContract.required.includes("evidence"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assess reports observed gaps and an undetermined stack instead of guessing", async () => {
  const root = fixture({ "README.md": "# notes\n" });
  try {
    const result = await runAssess({ target: root });
    assert.equal(result.facts.stack.status, "NOT_DETERMINED");
    assert.deepEqual(result.reviewPlan.areas, []);
    const codes = result.reviewPlan.gaps.map((gap) => gap.code);
    for (const code of ["STACK_NOT_DETERMINED", "TESTS_NOT_DETECTED", "TEST_COMMAND_NOT_DETECTED", "LINT_COMMAND_NOT_DETECTED", "CI_NOT_DETECTED"]) {
      assert.ok(codes.includes(code), code);
    }
    assert.match(formatAssessResult(result), /Stack: not determined/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assess flags TypeScript without typecheck and Node.js without a lockfile", async () => {
  const root = fixture({
    "package.json": { name: "lib", version: "1.0.0", scripts: { test: "vitest" }, devDependencies: { typescript: "^5.0.0", vitest: "^3.0.0" } },
    "tsconfig.json": { compilerOptions: { strict: true } },
    "src/index.ts": "export const value: number = 1;\n",
  });
  try {
    const codes = (await runAssess({ target: root })).reviewPlan.gaps.map((gap) => gap.code);
    assert.ok(codes.includes("TYPECHECK_COMMAND_NOT_DETECTED"));
    assert.ok(codes.includes("LOCKFILE_NOT_DETECTED"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assess routes a Go service to the backend with conventional checks", async () => {
  const root = fixture({ "go.mod": "module example.com/api\n\ngo 1.23\n", "main.go": "package main\n\nfunc main() {}\n" });
  try {
    const result = await runAssess({ target: root });
    assert.ok(result.facts.areas.backend.includes("framework=go"));
    const argv = result.reviewPlan.candidateChecks.map((check) => check.argv.join(" "));
    assert.ok(argv.includes("go test ./...") && argv.includes("go vet ./..."));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assess CLI is read-only, deterministic and never leaks the absolute target path", () => {
  const root = fixture(fullStack);
  try {
    const before = snapshot(root);
    const run = () => execFileSync(process.execPath, [cli, "assess", "--path", root, "--json"], { encoding: "utf8" });
    const first = run();
    const second = run();
    assert.deepEqual(snapshot(root), before, "assess must not create or modify files");
    assert.equal(first, second);
    assert.equal(first.includes(root), false);
    assert.equal(JSON.parse(first).schemaVersion, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
