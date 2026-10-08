import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runNpm } from "./npm-command.mjs";
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../integrations/mcp");

function readTarballManifest(tarball) {
  return JSON.parse(execFileSync("tar", ["-xOf", `./${path.basename(tarball)}`, "package/package.json"],
    { cwd: path.dirname(path.resolve(tarball)), encoding: "utf8" }));
}

function replaceLocalPackage(target, tarball) {
  const manifest = readTarballManifest(tarball);
  if (!["@cassiomc1/forgeloop", "@cassiomc1/forgeloop-mcp"].includes(manifest.name)) {
    throw new Error(`Unexpected local package: ${manifest.name}`);
  }
  const destination = path.join(target, "node_modules", manifest.name);
  // npm ci has already installed the locked dependency graph. Extract only our
  // locally built packages without asking npm to resolve registry metadata again.
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", `./${path.basename(tarball)}`, "--strip-components=1", "-C", path.resolve(destination)],
    { cwd: path.dirname(path.resolve(tarball)) });
}

export function installLockedMcp({ target, tarballs }) {
  const lockBytes = readFileSync(path.join(source, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  if (path.resolve(target) !== source) {
    copyFileSync(path.join(source, "package.json"), path.join(target, "package.json"));
    copyFileSync(path.join(source, "package-lock.json"), path.join(target, "package-lock.json"));
    const manifest = JSON.parse(readFileSync(path.join(target, "package.json")));
    manifest.name = "forgeloop-mcp-smoke";
    const smokeLock = structuredClone(lock);
    smokeLock.name = manifest.name;
    smokeLock.packages[""].name = manifest.name;
    const coreTarball = tarballs.find(tarball => readTarballManifest(tarball).name === "@cassiomc1/forgeloop");
    if (!coreTarball) throw new Error("Clean MCP smoke requires the actual local core tarball");
    const coreManifest = readTarballManifest(coreTarball);
    const coreRecord = smokeLock.packages["node_modules/@cassiomc1/forgeloop"];
    if (coreManifest.version !== coreRecord.version) throw new Error("Local core tarball differs from the locked core version");
    const fileSpec = `file:${path.resolve(coreTarball)}`;
    manifest.devDependencies["@cassiomc1/forgeloop"] = fileSpec;
    smokeLock.packages[""].devDependencies["@cassiomc1/forgeloop"] = fileSpec;
    coreRecord.resolved = fileSpec;
    coreRecord.integrity = `sha512-${createHash("sha512").update(readFileSync(coreTarball)).digest("base64")}`;
    writeFileSync(path.join(target, "package.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(target, "package-lock.json"), JSON.stringify(smokeLock, null, 2));
  }
  runNpm(["ci", "--install-links", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: target, stdio: "pipe" });
  for (const tarball of tarballs) replaceLocalPackage(target, tarball);
  const installed = {};
  for (const [relative, record] of Object.entries(lock.packages)) {
    if (!relative || relative === "node_modules/@cassiomc1/forgeloop") continue;
    const current = JSON.parse(readFileSync(path.join(target, relative, "package.json")));
    if (current.version !== record.version) throw new Error(`MCP dependency drift: ${relative}: ${current.version} != ${record.version}`);
    installed[relative] = current.version;
  }
  const identity = {
    lockSha256: createHash("sha256").update(lockBytes).digest("hex"),
    coreVersion: JSON.parse(readFileSync(path.join(target, "node_modules/@cassiomc1/forgeloop/package.json"))).version,
    tarballs: tarballs.map(file => ({ name: path.basename(file), sha256: createHash("sha256").update(readFileSync(file)).digest("hex") })),
    dependencies: installed,
  };
  console.log(JSON.stringify(identity));
  return identity;
}
