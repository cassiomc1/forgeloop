#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installLockedMcp } from "./mcp-locked-install.mjs";
import { runMcpTests } from "./run-mcp-tests.mjs";
import { runNpm } from "./npm-command.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "forgeloop-mcp-clean-"));
try {
  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", temporary], { cwd: repositoryRoot, encoding: "utf8" }));
  const coreTarball = path.join(temporary, packed[0].filename);
  const root = path.join(temporary, "project");
  mkdirSync(root);
  execFileSync("tar", ["-xzf", coreTarball, "--strip-components=1", "-C", root]);
  const mcpRoot = path.join(root, "integrations/mcp");
  mkdirSync(mcpRoot, { recursive: true });
  for (const relative of ["src", "bin", "tests", "README.md", "LICENSE"]) cpSync(path.join(repositoryRoot, "integrations/mcp", relative), path.join(mcpRoot, relative), { recursive: true });
  for (const relative of ["tests/helpers", "tests/fixtures"]) cpSync(path.join(repositoryRoot, relative), path.join(root, relative), { recursive: true });
  installLockedMcp({ target: mcpRoot, tarballs: [coreTarball] });
  // Source fixtures and the installed package use the same locked external
  // dependencies without borrowing the user's existing node_modules.
  symlinkSync(path.join(mcpRoot, "node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  process.exitCode = await runMcpTests({ root: mcpRoot });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
