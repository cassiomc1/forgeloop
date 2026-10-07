import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

test("CLI version/help admit no command implementations", async () => {
  const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-presentation-"));
  try {
    const hook = path.join(target, "admission.mjs");
    const commands = pathToFileURL(`${path.join(root, "src/commands")}${path.sep}`).href;
    await writeFile(hook, `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith(${JSON.stringify(commands)})) throw new Error("Presentation loaded a command implementation");
  return result;
} });\n`);
    for (const flag of ["--version", "--help"]) {
      const result = spawnSync(process.execPath, [`--import=${pathToFileURL(hook).href}`, path.join(root, "src/cli.js"), flag], {
        cwd: target, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" },
      });
      assert.equal(result.status, 0, result.stderr);
      if (flag === "--version") assert.equal(result.stdout.trim(), JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version);
      else assert.match(result.stdout, /^Usage: forgeloop/u);
    }
  } finally { await rm(target, { recursive: true, force: true }); }
});
