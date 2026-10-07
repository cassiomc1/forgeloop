import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

test("semantic preload propagates to child processes through a repository path containing spaces", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-loader-"));
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const alias = path.join(directory, "repository with spaces");
  try {
    await mkdir(path.join(alias, "scripts"), { recursive: true });
    await mkdir(path.join(alias, "src/core/decision"), { recursive: true });
    await writeFile(path.join(alias, "package.json"), JSON.stringify({ type: "module" }));
    for (const relative of ["scripts/test-semantic-provider-loader.mjs", "src/core/decision/test-provider.js"]) {
      await copyFile(path.join(repository, relative), path.join(alias, relative));
    }
    const loader = pathToFileURL(path.join(alias, "scripts/test-semantic-provider-loader.mjs")).href;
    const provider = pathToFileURL(path.join(alias, "src/core/decision/test-provider.js")).href;
    const child = `const { getTestSemanticProvider } = await import(${JSON.stringify(provider)}); if (getTestSemanticProvider()?.id !== 'typesafe-jev') throw new Error('Child provider missing');`;
    const parent = `import { execFileSync } from 'node:child_process'; execFileSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(child)}], { stdio: 'pipe' }); console.log('CHILD_PRELOAD_OK');`;
    const output = execFileSync(process.execPath, ["--import", loader, "--input-type=module", "-e", parent], {
      env: { ...process.env, NODE_OPTIONS: "" }, encoding: "utf8",
    });
    assert.equal(output.trim(), "CHILD_PRELOAD_OK");
  } finally { await removeTempTree(directory); }
});
