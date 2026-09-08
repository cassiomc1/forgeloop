import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const execFileAsync = promisify(execFile);
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const fixtureRoot = path.join(packageRoot, "tests", "fixtures", "repository-index", "sample-repo");

export function explicitNativeBinary() {
  const value = process.env.FORGELOOP_TGREP_BINARY;
  return typeof value === "string" && path.isAbsolute(value) ? value : null;
}

export async function requireNativeBinary(t) {
  const binary = explicitNativeBinary();
  if (!binary) {
    t.skip("native Repository Index tests require an explicit FORGELOOP_TGREP_BINARY");
    return null;
  }
  try {
    await access(binary);
  } catch {
    t.skip(`configured native binary is unavailable: ${binary}`);
    return null;
  }
  return binary;
}

export function nativeOptions(binary, extra = {}) {
  return {
    packageRoot,
    binaryPath: binary,
    startupTimeoutMs: 30_000,
    commandTimeoutMs: 60_000,
    stopTimeoutMs: 10_000,
    ...extra,
  };
}

export async function createFixtureRepository() {
  const target = await mkdtemp(path.join(os.tmpdir(), "ForgeLoop Repository Index Test "));
  await cp(fixtureRoot, target, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", target]);
  await execFileAsync("git", ["-C", target, "add", "."]);
  return target;
}

export async function removeFixtureRepository(target) {
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error.code) || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}
