import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { parseGoMod, parseGoWork } from "../src/core/go-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("Go module parsing requires one valid module directive", () => {
  assert.equal(parseGoMod("module example.com/app\ngo 1.27\n").valid, true);
  assert.equal(parseGoMod("module example.com/app\ngo 1.27\nrequire (\n  example.com/dependency v1.0.0\n)\ngodebug default=go1.27\ntool example.com/tool\n").valid, true);
  assert.equal(parseGoMod("go 1.27\n").valid, false);
  assert.equal(parseGoMod("module a\nmodule b\n").valid, false);
  assert.equal(parseGoMod("module example.com/app\nrequire garbage\n").valid, false);
  assert.equal(parseGoWork("go 1.27\nuse ./app\n").valid, true);
  assert.equal(parseGoWork("go 1.27\ntoolchain go1.27.1\ngodebug default=go1.27\nuse ./app\n").valid, true);
});

test("valid go.mod activates the Go specialist and go.sum alone does not", async () => {
  await temporaryProject("forgeloop-go-detection-", async (target) => {
    await writeFiles(target, {
      "go.mod": "module example.com/app\ngo 1.27\n",
      "go.sum": "example.com/dependency v1.0.0 h1:ignored\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["go"]);
    assert.deepEqual(evidence.projectRoots, ["."]);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 3), ["go", "clean", "test"]);
  });

  await temporaryProject("forgeloop-go-sum-only-", async (target) => {
    await writeFiles(target, { "go.sum": "example.com/dependency v1.0.0 h1:ignored\n" });
    assert.equal(await detectProjectEvidence(target), null);
  });
});

test("go.work connects only to discovered local modules", async () => {
  await temporaryProject("forgeloop-go-workspace-", async (target) => {
    await writeFiles(target, {
      "go.work": "go 1.27\nuse (\n  ./services/api\n)\n",
      "services/api/go.mod": "module example.com/api\ngo 1.27\n",
      "tools/go.mod": "module example.com/tools\ngo 1.27\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["go"]);
    assert.deepEqual(evidence.projectRoots, [".", "services/api", "tools"]);
    const api = await detectProjectEvidence(target, { claims: ["services/api/go.mod"] });
    assert.deepEqual(api.projectRoots, ["services/api"]);
    assert.deepEqual(api.frameworks, ["go"]);
  });
});

test("Go source and toolchain-only files remain negative", async () => {
  await temporaryProject("forgeloop-go-negative-", async (target) => {
    await writeFiles(target, {
      "main.go": "package main\nfunc main() {}\n",
      "go.work.sum": "metadata\n",
      "rust-toolchain.toml": "channel = \"stable\"\n",
    });
    assert.equal(await detectProjectEvidence(target), null);
  });
});

test("go.work fails closed when its discovered module is malformed", async () => {
  await temporaryProject("forgeloop-go-invalid-workspace-", async (target) => {
    await writeFiles(target, {
      "go.work": "go 1.27\nuse ./broken\n",
      "broken/go.mod": "not a module\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
  });
});
