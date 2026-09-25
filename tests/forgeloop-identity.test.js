import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { TEMPLATE_PATHS } from "../src/core/templates.js";
import { WORK_STATE_PATH } from "../src/core/work-state.js";

const repoRoot = new URL("../", import.meta.url);
async function filesUnder(relativeRoot) {
  const files = [];

  async function visit(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await visit(new URL(`${entry.name}/`, directory), `${relativePath}/`);
      } else {
        files.push(relativePath);
      }
    }
  }

  await visit(new URL(`${relativeRoot}/`, repoRoot), "");
  return files;
}

async function readPackage() {
  return JSON.parse(await readFile(new URL("package.json", repoRoot), "utf8"));
}

test("package identity is ForgeLoop", async () => {
  const packageJson = await readPackage();

  assert.equal(packageJson.name, "@cassiomc1/forgeloop");
  assert.equal(packageJson.bin?.forgeloop, "src/cli.js");
  assert.equal(packageJson.bin?.mdfiles, undefined);
  assert.equal(
    packageJson.repository?.url,
    "git+https://github.com/cassiomc1/forgeloop.git",
  );
  assert.equal(
    packageJson.homepage,
    "https://github.com/cassiomc1/forgeloop#readme",
  );
});

test("runtime paths use the ForgeLoop namespace", () => {
  assert.ok(TEMPLATE_PATHS.includes(".forgeloop/.gitignore"));
  assert.equal(TEMPLATE_PATHS.some((path) => path.startsWith(".mdfiles/")), false);
  assert.equal(WORK_STATE_PATH, ".forgeloop/work-state.json");
});

test("CLI help presents the ForgeLoop executable", () => {
  const result = spawnSync(process.execPath, ["src/cli.js", "--help"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: forgeloop/m);
});

test("architecture diagram is canonical and discoverable", async () => {
  const design = await readFile(new URL("LOOP_SYSTEM_DESIGN.md", repoRoot), "utf8");
  const readme = await readFile(new URL("README.md", repoRoot), "utf8");

  for (const marker of [
    "FORGELOOP",
    "CONTRACT",
    "ROUTE",
    "EVIDENCE",
    "PREFLIGHT_READY",
    "work-state",
    "event ledger",
    "AUDIT / COMPLETE / VALIDATE-PROTOCOL",
    "VALID / INCOMPLETE / STALE / INCONSISTENT / INVALID",
    "compatible harness",
  ]) {
    assert.match(design, new RegExp(marker.replaceAll("/", "\\/")));
  }
  assert.match(readme, /LOOP_SYSTEM_DESIGN\.md/);
  for (const marker of [
    "forgeloop-engineering-flow.svg",
    "PREFLIGHT_READY",
    "append-only event ledger",
    ".forgeloop/kit/",
    "VALID",
    "INCOMPLETE",
    "STALE",
    "INCONSISTENT",
    "INVALID",
  ]) {
    assert.match(readme, new RegExp(marker.replaceAll("/", "\\/")));
  }
});

test("active shipped surfaces use the ForgeLoop identity", async () => {
  const runtimeFiles = await filesUnder("src");
  const files = [
    "package.json",
    "README.md",
    ...TEMPLATE_PATHS,
    ...runtimeFiles.map((relativePath) => `src/${relativePath}`),
  ];

  for (const relativePath of new Set(files)) {
    const text = await readFile(new URL(relativePath, repoRoot), "utf8");
    for (const line of text.split("\n")) {
      const intentionalMigration = relativePath === "README.md"
        && (line.includes("mv .mdfiles .forgeloop") || line.includes("`.mdfiles` directory"));
      if (intentionalMigration) continue;
      assert.doesNotMatch(
        line,
        /@cassiomc1\/mdfiles|mdfiles:\/\/|["']title["']:\s*["']mdfiles\b|\.mdfiles(?:[\/]|`|$)|\bmdfiles\s+(?:init|doctor|update|route|inspect|status|validate|clear)/i,
        `${relativePath}: ${line}`,
      );
    }
  }
});
