#!/usr/bin/env node
// ForgeLoop MCP package smoke: packs the core and the MCP package, installs
// both tarballs into a temp project, and drives the installed MCP server over
// stdio with the official MCP client. Verifies publication boundaries.
import { execFileSync } from "node:child_process";
import { installLockedMcp } from "./mcp-locked-install.mjs";
import { runNpm } from "./npm-command.mjs";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(repoRoot, "integrations", "mcp");

function pack(cwd) {
  const out = JSON.parse(runNpm(["pack", "--json"], { cwd, encoding: "utf8" }));
  return path.join(cwd, out[0].filename);
}

const coreTarball = pack(repoRoot);
const mcpTarball = pack(mcpDir);
const temp = mkdtempSync(path.join(repoRoot, ".mcp-smoke-"));

try {
  copyFileSync(coreTarball, path.join(temp, path.basename(coreTarball)));
  copyFileSync(mcpTarball, path.join(temp, path.basename(mcpTarball)));
  installLockedMcp({ target: temp, tarballs: [path.join(temp, path.basename(coreTarball)), path.join(temp, path.basename(mcpTarball))] });

  const smoke = `
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { executeForgeLoopCommand } from "@cassiomc1/forgeloop/integration";
import { access, readFile } from "node:fs/promises";

// No private database setup: the first ordinary installed write bootstraps it.
try { await access(".forgeloop/state.sqlite"); throw new Error("fresh package fixture unexpectedly has operational SQLite"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const init = await executeForgeLoopCommand({ command: "init", projectPath: process.cwd(), input: {} });
if (!init.ok) throw new Error("packed init failed: " + JSON.stringify(init.error));
await access(".forgeloop/state.sqlite");
const initializedMarker = JSON.parse(await readFile(".forgeloop/storage-version.json", "utf8"));
if (initializedMarker.phase !== "ACTIVE") throw new Error("packed init did not activate canonical storage");
const created = await executeForgeLoopCommand({ command: "task-create", projectPath: process.cwd(), input: { taskId: "packed-sqlite-task", claims: ["README.md"] } });
if (!created.ok) throw new Error("packed SQLite task creation failed: " + created.error?.code);
await access(".forgeloop/state.sqlite");
const marker = JSON.parse(await readFile(".forgeloop/storage-version.json", "utf8"));
if (marker.phase !== "ACTIVE") throw new Error("packed bootstrap did not activate storage marker");
try { await access(".forgeloop/task-state"); throw new Error("packed SQLite task created legacy namespace"); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.cwd() + "/node_modules/@cassiomc1/forgeloop-mcp/bin/forgeloop-mcp.js", "--project", process.cwd(), "--mode", "safe"],
});
const client = new Client({ name: "smoke-client", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
if (!names.includes("forgeloop_status")) throw new Error("status tool missing");
if (!names.includes("forgeloop_task_resume")) throw new Error("task-resume tool missing");
if (names.includes("forgeloop_task_recover")) throw new Error("recovery tool must be hidden in safe mode");

const info = await client.callTool({ name: "forgeloop_protocol_info", arguments: {} });
const parsed = JSON.parse(info.content[0].text);
if (!parsed.result.features.taskClaimRecovery.validatedClaimProjection) throw new Error("ownership features missing");
const capabilities = await client.callTool({ name: "forgeloop_capabilities", arguments: {} });
const installedCore = JSON.parse(await readFile("node_modules/@cassiomc1/forgeloop/package.json", "utf8"));
const installedMcp = JSON.parse(await readFile("node_modules/@cassiomc1/forgeloop-mcp/package.json", "utf8"));
if (capabilities.isError || capabilities.structuredContent?.packageVersion !== installedCore.version
  || capabilities.structuredContent?.server?.version !== installedMcp.version) throw new Error("packed capability identities differ from installed manifests");
if (JSON.stringify(capabilities.structuredContent).includes("projectRoot")) throw new Error("packed capabilities leaked projectRoot");

const tasks = await client.readResource({ uri: "forgeloop://project/tasks" });
const taskData = JSON.parse(tasks.contents[0].text);
if (taskData.count !== 1 || taskData.tasks[0]?.taskId !== "packed-sqlite-task" || taskData.tasks[0]?.healthy !== true) throw new Error("packed MCP resource did not read canonical SQLite task");
const actions = await client.readResource({ uri: "forgeloop://task/packed-sqlite-task/actions" });
if (JSON.parse(actions.contents[0].text).actions.length !== 0) throw new Error("new packed SQLite task unexpectedly has actions");

await client.close();
console.log("mcp package smoke passed");
`;
  writeFileSync(path.join(temp, "smoke.mjs"), smoke);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: temp, stdio: "inherit" });
  console.log("ForgeLoop MCP package smoke passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
  rmSync(coreTarball, { force: true });
  rmSync(mcpTarball, { force: true });
}
