import { spawn } from "node:child_process";
import { runNpm } from "./npm-command.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const python = process.platform === "win32" ? "py" : "python3";
const groups = [
  ["node", ["scripts/check-rc-release.mjs"]],
  ["node", ["scripts/storage-writer-inventory.mjs"]],
  ["node", ["scripts/run-rc-tests.mjs"]],
  ...["lint", "dependency:policy", "docs:check", "pack:check", "pack:smoke", "mcp:pack:check", "repository:hygiene"].map(script => [npm, ["run", script]]),
  [python, [...(process.platform === "win32" ? ["-3"] : []), "scripts/scan_secrets.py"]],
];

for (const [command, args] of groups) {
  const started = Date.now();
  const result = await new Promise(resolve => {
    if (command === npm) {
      try { runNpm(args, { timeout: 180000, stdio: "inherit" }); resolve(0); }
      catch { resolve(1); }
      return;
    }
    const child = spawn(command, args, { shell: false, stdio: "inherit", timeout: 180000 });
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  console.log(JSON.stringify({ group: [command, ...args], elapsedMs: Date.now() - started, exitCode: result }));
  if (result !== 0) { process.exitCode = result; break; }
}
