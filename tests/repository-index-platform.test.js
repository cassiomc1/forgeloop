import assert from "node:assert/strict";
import { test } from "node:test";

import { getRepositoryIndexPlatform } from "../src/repository-index/platform.js";
import { processCommandLine } from "../src/repository-index/status.js";

test("Repository Index platform mapping is deterministic for every pinned asset", () => {
  for (const [platform, arch, key] of [
    ["darwin", "arm64", "darwin-arm64"],
    ["darwin", "x64", "darwin-x64"],
    ["linux", "x64", "linux-x64"],
    ["win32", "x64", "windows-x64"],
  ]) {
    assert.deepEqual(getRepositoryIndexPlatform({ platform, arch }), { platform, arch, key });
  }
});

test("unsupported platform combinations fail closed without alias fallback", () => {
  for (const [platform, arch] of [["linux", "arm64"], ["win32", "arm64"], ["freebsd", "x64"], ["unknown", "unknown"]]) {
    assert.throws(
      () => getRepositoryIndexPlatform({ platform, arch }),
      (error) => error.code === "E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED",
    );
  }
});

test("Windows ownership inspection uses a bounded PowerShell command-line query", async () => {
  let observed;
  const commandLine = await processCommandLine(321, {
    platform: "win32",
    execFileImpl(file, args, options, callback) {
      observed = { file, args, options };
      callback(null, "C:\\tgrep.exe serve --index-path C:\\repo\\.forgeloop\\repository-index\\tgrep C:\\repo\n", "");
    },
  });
  assert.equal(commandLine, "C:\\tgrep.exe serve --index-path C:\\repo\\.forgeloop\\repository-index\\tgrep C:\\repo");
  assert.equal(observed.file, "powershell.exe");
  assert.deepEqual(observed.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.match(observed.args[3], /ProcessId = 321/u);
  assert.equal(observed.options.shell, false);
});
