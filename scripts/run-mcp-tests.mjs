#!/usr/bin/env node

import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpRoot = path.join(repositoryRoot, "integrations", "mcp");

export async function resolveMcpTestFiles(root = mcpRoot) {
  const entries = await readdir(path.join(root, "tests"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => path.join("tests", entry.name))
    .sort();
}

export async function checkMcpPrerequisites(root = mcpRoot) {
  const markers = [
    "node_modules/@modelcontextprotocol/server/package.json",
    "node_modules/@modelcontextprotocol/client/package.json",
  ];
  const missing = [];
  for (const marker of markers) {
    try {
      await access(path.join(root, marker), constants.R_OK);
    } catch {
      missing.push(marker);
    }
  }
  return { ok: missing.length === 0, missing };
}

export async function runMcpTests({ root = mcpRoot, spawnProcess = spawn } = {}) {
  const prerequisites = await checkMcpPrerequisites(root);
  if (!prerequisites.ok) {
    console.error("MCP dependencies are not installed.");
    console.error("Run: npm run mcp:setup");
    return 1;
  }
  const files = await resolveMcpTestFiles(root);
  const child = spawnProcess(process.execPath, ["--test", "--test-concurrency=2", ...files], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  return await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => resolve(typeof code === "number" ? code : signal ? 1 : 0));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMcpTests();
}
