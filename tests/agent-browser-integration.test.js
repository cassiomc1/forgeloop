import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentBrowserVerificationProvider } from "../src/integration.js";
import { createForgeLoopContext } from "../src/integration.js";

test("public Agent Browser integration does not mutate ForgeLoop protocol artifacts", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "forgeloop-agent-browser-integration-"));
  const executable = path.join(project, "agent-browser");
  await writeFile(executable, "fixture\n");
  const state = path.join(project, "protocol-state.json");
  await writeFile(state, '{"events":[]}\n');
  const before = await readFile(state, "utf8");
  const provider = createAgentBrowserVerificationProvider({ executablePath: executable });
  const context = createForgeLoopContext({ browserVerificationProviders: { "agent-browser": provider } });
  assert.equal(typeof context.browserVerificationProviders["agent-browser"].verify, "function");
  assert.equal(await readFile(state, "utf8"), before);
  await rm(project, { recursive: true, force: true });
});
