import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  detectProjectEvidence,
  parsePackageJson,
  PROJECT_DETECTION_LIMITS,
} from "../src/core/project-detection.js";
import { evaluateRoute } from "../src/core/router.js";

async function temporaryProject(prefix, callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function writePackage(target, relativePath, value) {
  const filePath = path.join(target, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("parsePackageJson recognizes runtime dependencies and direct node scripts only", () => {
  const parsed = parsePackageJson(JSON.stringify({
    dependencies: { express: "^5.0.0" },
    devDependencies: { "@types/node": "^24.0.0", typescript: "^7.0.0" },
    scripts: {
      build: "tsc",
      start: "NODE_ENV=production node --watch src/server.js",
      wrapper: "npx node src/server.js",
      prose: "echo node src/server.js",
      lookalike: "nodejs src/server.js",
    },
  }));

  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.backendDependencies, ["express"]);
  assert.deepEqual(parsed.backendDependencySignals, ["dependencies.express"]);
  assert.deepEqual(parsed.runtimeScripts, ["start"]);
  assert.deepEqual(parsed.supportingDependencies, ["@types/node", "typescript"]);
  assert.equal(parsePackageJson("{ trailing: false }").valid, false);
  assert.equal(parsePackageJson("[]").valid, false);
});

test("Express and Fastify runtime dependencies select the Node.js specialist", async () => {
  await temporaryProject("forgeloop-nodejs-framework-", async (target) => {
    await writePackage(target, "package.json", {
      name: "api",
      dependencies: { express: "^5.0.0", fastify: "^5.0.0" },
      engines: { node: ">=20" },
      type: "module",
      packageManager: "pnpm@10.0.0",
    });

    const evidence = await detectProjectEvidence(target);
    assert.equal(evidence.schemaVersion, 1);
    assert.deepEqual(evidence.frameworks, ["nodejs"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
    assert.ok(evidence.primarySignals.includes("package.json:dependencies.express"));
    assert.ok(evidence.primarySignals.includes("package.json:dependencies.fastify"));
    assert.ok(evidence.supportingSignals.includes("package.json:engines.node"));
    assert.ok(evidence.supportingSignals.includes("package.json:type"));
    assert.ok(evidence.supportingSignals.includes("package.json:packageManager"));

    const route = evaluateRoute({ workType: "backend", projectEvidence: evidence });
    assert.deepEqual(route.guides, ["nodejs", "clean", "test"]);
    assert.deepEqual(route.reasons.nodejs, ["PROJECT_NODEJS_BACKEND_FRAMEWORK"]);
  });
});

test("direct node scripts and raw HTTP server imports provide distinct routing reasons", async () => {
  await temporaryProject("forgeloop-nodejs-runtime-evidence-", async (target) => {
    await writePackage(target, "package.json", {
      name: "raw-http",
      scripts: { dev: "node --watch src/server.js" },
      type: "module",
    });
    await mkdir(path.join(target, "src"), { recursive: true });
    await writeFile(path.join(target, "src", "server.js"),
      "import { createServer } from \"node:http\";\ncreateServer().listen(3000);\n",
      "utf8");

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["nodejs"]);
    assert.ok(evidence.primarySignals.includes("package.json:scripts.dev=node"));
    assert.equal(evidence.primarySignals.some((signal) => signal.includes(":import=node:http")), false);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).reasons.nodejs, ["PROJECT_NODEJS_RUNTIME_SCRIPT"]);

    const sourceOnly = await temporaryProject("forgeloop-nodejs-source-only-", async (sourceTarget) => {
      await writePackage(sourceTarget, "package.json", { name: "source-only", type: "module" });
      await mkdir(path.join(sourceTarget, "src"), { recursive: true });
      await writeFile(path.join(sourceTarget, "src", "server.mjs"),
        "import https from \"node:https\";\nhttps.createServer().listen(443);\n",
        "utf8");
      return detectProjectEvidence(sourceTarget);
    });
    assert.deepEqual(sourceOnly.frameworks, ["nodejs"]);
    assert.ok(sourceOnly.primarySignals.includes("src/server.mjs:import=node:https"));

    const route = evaluateRoute({ workType: "code", projectEvidence: sourceOnly });
    assert.deepEqual(route.reasons.nodejs, ["PROJECT_NODEJS_SERVER_RUNTIME"]);
  });
});

test("supporting-only and frontend evidence never activates the Node.js specialist", async () => {
  const cases = [
    { name: "frontend", package: { dependencies: { react: "^19.0.0", vite: "^7.0.0" }, scripts: { dev: "vite" } } },
    { name: "engines", package: { engines: { node: ">=20" }, type: "module" } },
    { name: "types", package: { devDependencies: { "@types/node": "^24.0.0" } } },
    { name: "next-only", package: { dependencies: { next: "^16.0.0" }, scripts: { dev: "next dev" } } },
    { name: "dev-framework", package: { devDependencies: { express: "^5.0.0" } } },
  ];

  for (const item of cases) {
    await temporaryProject(`forgeloop-nodejs-negative-${item.name}-`, async (target) => {
      await writePackage(target, "package.json", item.package);
      const evidence = await detectProjectEvidence(target);
      assert.deepEqual(evidence.frameworks, [], item.name);
      assert.deepEqual(evidence.primarySignals, [], item.name);
      const route = evaluateRoute({ workType: "code", projectEvidence: evidence });
      assert.equal(route.guides.includes("nodejs"), false, item.name);
      assert.deepEqual(route.excluded.nodejs, ["NO_NODEJS_PRIMARY_EVIDENCE"], item.name);
    });
  }

  await temporaryProject("forgeloop-nodejs-lockfile-only-", async (target) => {
    await writeFile(path.join(target, "package-lock.json"), "{\"lockfileVersion\": 3}\n", "utf8");
    assert.equal(await detectProjectEvidence(target), null);
  });

  await temporaryProject("forgeloop-nodejs-docker-only-", async (target) => {
    await writeFile(path.join(target, "Dockerfile"), "FROM node:24\n", "utf8");
    await mkdir(path.join(target, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(target, ".github", "workflows", "ci.yml"), "uses: actions/setup-node@v4\n", "utf8");
    assert.equal(await detectProjectEvidence(target), null);
  });
});

test("malformed and oversized package manifests fail closed", async () => {
  assert.equal(parsePackageJson("{\"dependencies\": []}").valid, false);
  assert.equal(parsePackageJson("x".repeat(PROJECT_DETECTION_LIMITS.maxManifestBytes + 1)).valid, false);

  await temporaryProject("forgeloop-nodejs-malformed-", async (target) => {
    await writeFile(path.join(target, "package.json"), "{\"dependencies\": {\"express\": \"^5\"},}\n", "utf8");
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, []);
  });

  await temporaryProject("forgeloop-nodejs-oversized-", async (target) => {
    await writeFile(path.join(target, "package.json"), "x".repeat(PROJECT_DETECTION_LIMITS.maxManifestBytes + 1), "utf8");
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, []);
  });
});

test("nested workspace projects remain isolated and workspace-root claims include confirmed descendants", async () => {
  await temporaryProject("forgeloop-nodejs-nested-scope-", async (target) => {
    await writePackage(target, "package.json", { name: "workspace", workspaces: ["services/*"] });
    await writePackage(target, "services/api/package.json", {
      name: "api",
      dependencies: { "@nestjs/core": "^11.0.0" },
    });
    await writePackage(target, "apps/web/package.json", {
      name: "web",
      dependencies: { react: "^19.0.0" },
    });
    await writeFile(path.join(target, "package-lock.json"), "{\"lockfileVersion\": 3}\n", "utf8");

    const api = await detectProjectEvidence(target, { claims: ["services/api/src/controllers/users.ts"] });
    assert.equal(api.scope, "MATCH");
    assert.deepEqual(api.frameworks, ["nodejs"]);
    assert.deepEqual(api.projectRoots, ["services/api"]);

    const workspaceManifest = await detectProjectEvidence(target, { claims: ["package.json"] });
    assert.equal(workspaceManifest.scope, "MATCH");
    assert.deepEqual(workspaceManifest.frameworks, ["nodejs"]);
    assert.deepEqual(workspaceManifest.projectRoots, [".", "services/api"]);

    const lockfile = await detectProjectEvidence(target, { claims: ["package-lock.json"] });
    assert.equal(lockfile.scope, "MATCH");
    assert.deepEqual(lockfile.frameworks, ["nodejs"]);
    assert.deepEqual(lockfile.projectRoots, ["services/api"]);

    const unrelated = await detectProjectEvidence(target, { claims: ["README.md"] });
    assert.equal(unrelated.scope, "MATCH");
    assert.deepEqual(unrelated.frameworks, []);
  });
});

test("mixed Flutter, .NET, and Node.js repositories preserve all confirmed frameworks", async () => {
  await temporaryProject("forgeloop-nodejs-mixed-stack-", async (target) => {
    await writePackage(target, "services/api/package.json", {
      name: "api",
      scripts: { start: "node src/server.js" },
    });
    await mkdir(path.join(target, "services", "api", "src"), { recursive: true });
    await writeFile(path.join(target, "services", "api", "src", "server.js"),
      "const http = require(\"http\");\nhttp.createServer().listen(3000);\n",
      "utf8");
    await mkdir(path.join(target, "apps", "mobile"), { recursive: true });
    await writeFile(path.join(target, "apps", "mobile", "pubspec.yaml"),
      "name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n",
      "utf8");
    await mkdir(path.join(target, "services", "worker"), { recursive: true });
    await writeFile(path.join(target, "services", "worker", "Worker.csproj"),
      "<Project Sdk=\"Microsoft.NET.Sdk.Worker\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>\n",
      "utf8");

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["dotnet", "flutter", "nodejs"]);
    const route = evaluateRoute({ workType: "code", projectEvidence: evidence });
    assert.deepEqual(route.guides, ["flutter", "dotnet", "nodejs", "clean", "test"]);
  });
});

test("source detection skips symlinks and bounded traversal fails closed", async () => {
  await temporaryProject("forgeloop-nodejs-symlink-", async (target) => {
    await writePackage(target, "package.json", { name: "symlink-test", type: "module" });
    await mkdir(path.join(target, "src"), { recursive: true });
    const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-nodejs-symlink-target-"));
    try {
      await writeFile(path.join(outside, "outside.mjs"), "import http from \"node:http\";\n", "utf8");
      await symlink(path.join(outside, "outside.mjs"), path.join(target, "src", "server.mjs"));
      const evidence = await detectProjectEvidence(target);
      assert.deepEqual(evidence.frameworks, []);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  await temporaryProject("forgeloop-nodejs-budget-", async (target) => {
    await writePackage(target, "package.json", { name: "budget-test", type: "module" });
    await mkdir(path.join(target, "src"), { recursive: true });
    await writeFile(path.join(target, "src", "server.mjs"), "import http from \"node:http\";\n", "utf8");
    const evidence = await detectProjectEvidence(target, {
      limits: { maxVisitedDirectories: 1, maxVisitedEntries: PROJECT_DETECTION_LIMITS.maxVisitedEntries },
    });
    assert.equal(evidence, null);
  });
});

test("Node.js specialist is excluded from documentation, UI-copy, and mobile-only work", async () => {
  await temporaryProject("forgeloop-nodejs-work-context-", async (target) => {
    await writePackage(target, "package.json", { dependencies: { express: "^5.0.0" } });
    const evidence = await detectProjectEvidence(target);
    for (const workType of ["documentation", "ui-copy", "mobile-ui"]) {
      const route = evaluateRoute({ workType, surfaces: workType === "ui-copy" ? ["ui"] : [], projectEvidence: evidence });
      assert.equal(route.guides.includes("nodejs"), false, workType);
      assert.deepEqual(route.excluded.nodejs, ["NO_NODEJS_EXECUTABLE_WORK"], workType);
    }
  });
});
