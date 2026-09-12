import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { parseJsonc, parseTypeScriptConfig } from "../src/core/typescript-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("TypeScript config parsing accepts bounded JSONC but fails closed for malformed values", () => {
  assert.deepEqual(parseJsonc("{ // comment\n \"references\": [{\"path\": \"packages/core\"}],\n}\n").references, [{ path: "packages/core" }]);
  assert.equal(parseTypeScriptConfig("{\"references\":{}}", "tsconfig.json").valid, false);
  assert.equal(parseTypeScriptConfig("{\"extends\": 42}", "tsconfig.json").valid, false);
  assert.deepEqual(parseTypeScriptConfig("{\"extends\": [\"./base.json\", \"./strict.json\"]}").extends, ["./base.json", "./strict.json"]);
  assert.deepEqual(parseTypeScriptConfig("{\"extends\": \"./base.json\"}").extends, ["./base.json"]);
  assert.equal(parseTypeScriptConfig("{\"extends\": [\"./base.json\", 42]}").valid, false);
  assert.equal(parseTypeScriptConfig("{\"files\": 42}", "tsconfig.json").valid, false);
  assert.equal(parseTypeScriptConfig("{/* unterminated", "tsconfig.json").valid, false);
  assert.equal(parseTypeScriptConfig("{}", "jsconfig.json").valid, true);
});

test("tsconfig roots activate TypeScript and jsconfig alone does not", async () => {
  await temporaryProject("forgeloop-typescript-detection-", async (target) => {
    await writeFiles(target, {
      "tsconfig.json": "{\n  // project config\n  \"compilerOptions\": { \"strict\": true, },\n  \"references\": [{ \"path\": \"packages/core\" }],\n}\n",
      "packages/core/tsconfig.json": "{\"compilerOptions\": {\"composite\": true}}\n",
      "packages/core/src/index.ts": "export const value: number = 1;\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["typescript"]);
    assert.deepEqual(evidence.projectRoots, [".", "packages/core"]);
    const route = evaluateRoute({ workType: "code", projectEvidence: evidence });
    assert.deepEqual(route.guides.slice(0, 3), ["typescript", "clean", "test"]);
  });

  await temporaryProject("forgeloop-jsconfig-negative-", async (target) => {
    await writeFiles(target, {
      "jsconfig.json": "{\"compilerOptions\": {\"checkJs\": true}}\n",
      "index.js": "console.log('plain JavaScript');\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
  });
});

test("custom TypeScript configs need a reference or direct task claim", async () => {
  await temporaryProject("forgeloop-typescript-custom-config-", async (target) => {
    await writeFiles(target, {
      "tsconfig.build.json": "{\"compilerOptions\": {\"composite\": true}}\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.projectRoots, []);

    await writeFiles(target, { "tsconfig.json": "{\"references\": [{\"path\": \".\/tsconfig.build.json\"}]}\n" });
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, ["typescript"]);
    const claimed = await detectProjectEvidence(target, { claims: ["tsconfig.build.json"] });
    assert.deepEqual(claimed.frameworks, ["typescript"]);
  });
});

test("TypeScript source and declaration-only files do not create project identity", async () => {
  await temporaryProject("forgeloop-typescript-source-negative-", async (target) => {
    await writeFiles(target, {
      "src/index.ts": "export const value = 1;\n",
      "types/index.d.ts": "export declare const value: number;\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.ok(evidence === null || evidence.frameworks.length === 0);
  });
});

test("Node and TypeScript co-locate without changing the public schema", async () => {
  await temporaryProject("forgeloop-node-typescript-composition-", async (target) => {
    await writeFiles(target, {
      "package.json": "{\"name\":\"api\",\"scripts\":{\"start\":\"node src/server.js\"}}\n",
      "tsconfig.json": "{}\n",
      "src/server.js": "console.log('runtime');\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["nodejs", "typescript"]);
    assert.equal(evidence.schemaVersion, 1);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 4), ["nodejs", "typescript", "clean", "test"]);
  });
});

test("TypeScript references and local extends are order-independent and bounded", async () => {
  await temporaryProject("forgeloop-typescript-cross-root-", async (target) => {
    await writeFiles(target, {
      "tsconfig.json": "{\"files\":[],\"references\":[{\"path\":\"packages/core/tsconfig.build.json\"}]}\n",
      "packages/core/tsconfig.build.json": "{\"compilerOptions\":{\"composite\":true},\"include\":[\"src\"]}\n",
      "packages/core/src/index.ts": "export {};\n",
      "configs/base.json": "{}\n",
      "app/tsconfig.json": "{\"extends\":\"../configs/base.json\"}\n",
    });
    const sourceEvidence = await detectProjectEvidence(target, { claims: ["packages/core/src/index.ts"] });
    assert.deepEqual(sourceEvidence.frameworks, ["typescript"]);
    assert.ok(sourceEvidence.projectRoots.includes("packages/core"));
    const baseEvidence = await detectProjectEvidence(target, { claims: ["configs/base.json"] });
    assert.deepEqual(baseEvidence.frameworks, ["typescript"]);
    assert.deepEqual(baseEvidence.projectRoots, ["app"]);
    assert.ok(baseEvidence.primarySignals.includes("app/tsconfig.json:tsconfig"));
  });
});

test("TypeScript extends arrays resolve conservatively without making shared configs ownership roots", async () => {
  await temporaryProject("forgeloop-typescript-extends-array-", async (target) => {
    await writeFiles(target, {
      "tsconfig.json": "{\"extends\": [\"./app/tsconfig.json\"]}\n",
      "app/tsconfig.json": "{\"extends\": [\"@tsconfig/strictest/tsconfig.json\", \"../configs/base.json\", \"../configs/strict.json\"]}\n",
      "configs/base.json": "{}\n",
      "configs/strict.json": "{}\n",
    });
    const defaultEvidence = await detectProjectEvidence(target);
    assert.deepEqual(defaultEvidence.frameworks, ["typescript"]);
    assert.deepEqual(defaultEvidence.projectRoots, [".", "app"]);

    const claimedEvidence = await detectProjectEvidence(target, { claims: ["app/tsconfig.json"] });
    assert.deepEqual(claimedEvidence.frameworks, ["typescript"]);
    assert.deepEqual(claimedEvidence.projectRoots, ["app"]);
    assert.equal(claimedEvidence.projectRoots.includes("configs"), false);
  });
});

test("a claimed shared TypeScript base selects every discovered consumer", async () => {
  await temporaryProject("forgeloop-typescript-shared-base-", async (target) => {
    await writeFiles(target, {
      "configs/tsconfig.base.json": "{\"compilerOptions\":{\"strict\":true}}\n",
      "apps/api/tsconfig.json": "{\"extends\":\"../../configs/tsconfig.base.json\"}\n",
      "apps/web/tsconfig.json": "{\"extends\":[\"../../configs/tsconfig.base.json\"]}\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["configs/tsconfig.base.json"] });
    assert.deepEqual(evidence.frameworks, ["typescript"]);
    assert.deepEqual(evidence.projectRoots, ["apps/api", "apps/web"]);
    assert.equal(evidence.projectRoots.includes("configs"), false);
  });
});

test("TypeScript external extends remain unresolved without filesystem escape", async () => {
  await temporaryProject("forgeloop-typescript-external-extends-", async (target) => {
    await writeFiles(target, {
      "tsconfig.json": "{\"extends\": [\"../../../outside/tsconfig.json\", \"@tsconfig/node22/tsconfig.json\"]}\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["typescript"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });
});

test("TypeScript config graph cycles terminate within discovered files", async () => {
  await temporaryProject("forgeloop-typescript-extends-cycle-", async (target) => {
    await writeFiles(target, {
      "tsconfig.json": "{\"extends\": \"./configs/a.json\"}\n",
      "configs/a.json": "{\"extends\": \"../tsconfig.json\"}\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["typescript"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
  });
});
