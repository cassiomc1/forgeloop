import { spawn, spawnSync } from "node:child_process";
import { runNpm } from "./npm-command.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pythonCandidates = process.platform === "win32"
  ? [["python3", []], ["python", []], ["py", ["-3"]]]
  : [["python3", []]];
const python = pythonCandidates.find(([command, args]) => {
  const probe = spawnSync(command, [...args, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"], {
    shell: false, timeout: 5000, stdio: "ignore",
  });
  return !probe.error && probe.status === 0;
});
if (!python) throw new Error("An existing Python 3.9+ interpreter is required for the RC secret scan; no tool is installed automatically.");
const groups = [
  ["node", ["scripts/check-rc-release.mjs"]],
  ["node", ["scripts/storage-writer-inventory.mjs"]],
  ["node", ["scripts/run-rc-tests.mjs"]],
  ...["lint", "dependency:policy", "docs:check", "pack:check", "pack:smoke", "mcp:pack:check", "repository:hygiene"].map(script => [npm, ["run", script]]),
  [python[0], [...python[1], "scripts/scan_secrets.py"]],
];

for (const [command, args] of groups) {
  const started = Date.now();
  const result = await new Promise(resolve => {
    if (command === npm) {
      try { runNpm(args, { timeout: 180000, stdio: "inherit" }); resolve(0); }
      catch { resolve(1); }
      return;
    }
    const child = spawn(command, args, { shell: false, stdio: "inherit" });
    const timer = setTimeout(() => { child.kill(); resolve(1); }, 180000);
    child.once("error", () => { clearTimeout(timer); resolve(1); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve(signal ? 1 : code ?? 1); });
  });
  console.log(JSON.stringify({ group: [command, ...args], elapsedMs: Date.now() - started, exitCode: result }));
  if (result !== 0) { process.exitCode = result; break; }
}
