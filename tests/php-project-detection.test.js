import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { parseComposerJson } from "../src/core/php-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("Composer parsing is strict and PHP source requires an executable tag", () => {
  assert.equal(parseComposerJson("{\"name\":\"acme/app\",\"autoload\":{}}\n").valid, true);
  assert.equal(parseComposerJson("{}\n").valid, false);
  assert.equal(parseComposerJson("{\"require\": []}\n").valid, false);
});

test("composer.json activates PHP while composer.lock and prose do not", async () => {
  await temporaryProject("forgeloop-php-detection-", async (target) => {
    await writeFiles(target, {
      "composer.json": "{\"name\":\"acme/app\",\"require\":{\"php\":\"^8.3\"},\"autoload\":{\"psr-4\":{\"Acme\\\\\":\"src/\"}}}\n",
      "composer.lock": "{\"packages\": []}\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["php"]);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 3), ["php", "clean", "test"]);
  });

  await temporaryProject("forgeloop-php-lock-negative-", async (target) => {
    await writeFiles(target, { "composer.lock": "{\"packages\": []}\n", README: "PHP is mentioned here.\n" });
    assert.equal(await detectProjectEvidence(target), null);
  });
});

test("a directly claimed PHP file can provide conservative source evidence", async () => {
  await temporaryProject("forgeloop-php-source-", async (target) => {
    await writeFiles(target, { "public/index.php": "<?php\n echo 'ok';\n" });
    const evidence = await detectProjectEvidence(target, { claims: ["public/index.php"] });
    assert.deepEqual(evidence.frameworks, ["php"]);
    assert.deepEqual(evidence.projectRoots, []);
  });
});
