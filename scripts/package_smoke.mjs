#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmOptions = process.platform === "win32" ? { shell: true } : {};
const root = process.cwd();
let tarball = null;
let target = null;

async function assertInstalledFile(installedRoot, relativePath) {
  await access(path.join(installedRoot, relativePath));
}

async function runInstalledCli(installedRoot, args, cwd = target) {
  return run(process.execPath, [path.join(installedRoot, "src", "cli.js"), ...args, "--path", cwd], {
    cwd,
    env: { ...process.env, PATH: path.dirname(process.execPath) },
  });
}

try {
  const { stdout } = await run(npm, ["pack", "--json"], { cwd: root, ...npmOptions });
  const packed = JSON.parse(stdout);
  tarball = path.resolve(root, packed[0].filename);
  target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-package-smoke-"));
  await writeFile(path.join(target, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run(npm, ["install", "--ignore-scripts", "--no-package-lock", tarball], { cwd: target, ...npmOptions });
  const expectedPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const packageName = expectedPackage.name;
  const installedRoot = path.join(target, "node_modules", ...packageName.split("/"));
  const installedPackage = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
  if (installedPackage.name !== "@cassiomc1/forgeloop"
    || installedPackage.version !== expectedPackage.version
    || installedPackage.engines?.node !== expectedPackage.engines?.node
    || installedPackage.engines?.node !== ">=24.19.0") {
    throw new Error("Installed package identity or Node engine did not match the release manifest");
  }
  const { stdout: version } = await runInstalledCli(installedRoot, ["--version"]);
  if (version.trim() !== expectedPackage.version) throw new Error("Installed CLI returned the wrong version");
  const { stdout: info } = await runInstalledCli(installedRoot, ["protocol-info", "--json"]);
  const parsed = JSON.parse(info);
  if (parsed.protocolVersion !== 1
    || !Array.isArray(parsed.commands)
    || parsed.features?.structuralQuality?.resource !== "task/structural-quality"
    || parsed.features?.taskClaimRecovery?.validatedClaimProjection !== true
    || !parsed.readsSchemaVersions?.["task-recovery"]?.includes(1)) {
    throw new Error("Installed package did not return a valid ForgeLoop protocol handshake");
  }

  const integrationProbe = await run(process.execPath, [
    "--input-type=module",
    "-e",
    "import { getForgeLoopPackageVersion, getForgeLoopCapabilities, createForgeLoopContext } from '@cassiomc1/forgeloop/integration'; const capabilities = getForgeLoopCapabilities(); const context = createForgeLoopContext(); if (getForgeLoopPackageVersion() !== process.env.FORGELOOP_EXPECTED_VERSION || !capabilities.resources.some((resource) => resource.name === 'task/structural-quality') || !context || typeof context !== 'object') process.exit(1);",
  ], {
    cwd: target,
    env: {
      ...process.env,
      FORGELOOP_EXPECTED_VERSION: expectedPackage.version,
      NODE_PATH: "",
      PATH: path.dirname(process.execPath),
    },
  });
  if (integrationProbe.stdout !== "") throw new Error("Public Integration API probe unexpectedly wrote to stdout");

  const projectTarget = await mkdtemp(path.join(target, "project-"));
  await runInstalledCli(installedRoot, ["init"], projectTarget);
  const managedManifest = path.join(projectTarget, ".forgeloop", "manifest.json");
  if (!(await stat(managedManifest)).isFile()) throw new Error("Installed init did not create a ForgeLoop manifest");
  const generatedGitignore = await readFile(path.join(projectTarget, ".forgeloop", ".gitignore"), "utf8");
  const expectedGitignore = "# Local resumable task state is untrusted, target-specific data.\nwork-state.json\nstate.sqlite\nstate.sqlite-*\nstorage-version.json\nexecutions/\nrepository-index/\n";
  if (generatedGitignore !== expectedGitignore) throw new Error("Installed init generated an unexpected .forgeloop/.gitignore");
  await runInstalledCli(installedRoot, ["doctor", "--json"], projectTarget);
  await runInstalledCli(installedRoot, ["task-create", "--task", "package-smoke-task", "--json"], projectTarget);
  // Package smoke exercises deterministic local provider injection, never an
  // optional paid network request. This fixture is not model certification.
  const providerLoader = path.join(target, "package-smoke-provider.mjs");
  await writeFile(providerLoader, `import { installTestSemanticProvider } from ${JSON.stringify(pathToFileURL(path.join(installedRoot, "src/core/decision/test-provider.js")).href)}; installTestSemanticProvider();`);
  await run(process.execPath, ["--import", pathToFileURL(providerLoader).href, path.join(installedRoot, "src", "cli.js"),
    "route", "--task", "package-smoke-task", "--work", "documentation", "--surface", "documentation", "--json", "--path", projectTarget],
  { cwd: projectTarget, env: { ...process.env, PATH: path.dirname(process.execPath) } });
  await runInstalledCli(installedRoot, ["status", "--task", "package-smoke-task", "--json"], projectTarget);
  const { stdout: qualityStatus } = await runInstalledCli(installedRoot, ["quality-status", "--task", "package-smoke-task", "--json"], projectTarget);
  const quality = JSON.parse(qualityStatus);
  if (quality.status === "PASS" || quality.qualitySignal === "PASS") {
    throw new Error("Provider-absent clean-room smoke emitted a fake Structural Quality PASS");
  }
  await assertInstalledFile(installedRoot, "schemas/structural-quality.schema.json");
  await assertInstalledFile(installedRoot, "docs/STRUCTURAL_QUALITY.md");
  const structuralQualityDoc = await readFile(path.join(installedRoot, "docs", "STRUCTURAL_QUALITY.md"), "utf8");
  for (const reference of structuralQualityDoc.matchAll(/docs\/assets\/diagrams\/([\w-]+\.(?:svg|html))/g)) {
    await assertInstalledFile(installedRoot, path.join("docs", "assets", "diagrams", reference[1]));
  }
  console.log(`package smoke passed: ${packed[0].filename}`);
} finally {
  if (target) await rm(target, { recursive: true, force: true });
  if (tarball) await rm(tarball, { force: true });
}
