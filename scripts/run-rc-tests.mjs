import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function assertTestSummary(output, expected = 36) {
  const count = label => Number(output.match(new RegExp(`^# ${label} (\\d+)$`, "mu"))?.[1] ?? NaN);
  if (count("tests") !== expected || count("pass") !== expected || count("fail") !== 0 || count("skipped") !== 0 || count("todo") !== 0) throw new Error("RC test evidence is incomplete, skipped, or failed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = ["rc-release-policy", "storage-sole-writer-boundary", "storage-attachment-transaction", "storage-maintenance-admission", "storage-project-backup", "storage-runtime", "storage-project-bootstrap"];
  const child = spawn(process.execPath, ["--import=./scripts/test-semantic-provider-loader.mjs", "--test", "--test-reporter=tap", "--test-concurrency=2", ...files.map(file => `tests/${file}.test.js`)], { shell: false, timeout: 180000 });
  let output = ""; let bytes = 0;
  child.stdout.on("data", data => {
    bytes += data.length;
    if (bytes > 2 * 1024 * 1024) { child.kill(); return; }
    output += data; process.stdout.write(data);
  });
  child.stderr.on("data", data => { bytes += data.length; if (bytes > 2 * 1024 * 1024) child.kill(); else process.stderr.write(data); });
  child.once("error", () => { process.exitCode = 1; });
  child.once("exit", (code, signal) => {
    try {
      if (code !== 0 || signal || bytes > 2 * 1024 * 1024) throw new Error("RC test process did not complete successfully");
      assertTestSummary(output);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  });
}
