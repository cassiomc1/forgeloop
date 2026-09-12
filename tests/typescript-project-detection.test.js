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
    assert.deepEqual((await detectProjectEvidence(target)).frameworks, []);

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
