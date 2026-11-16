import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("the evidence GitHub Action passes inputs through env and pins the ForgeLoop version", async () => {
  const action = await readFile(path.resolve("integrations/github-action/action.yml"), "utf8");
  const run = action.slice(action.indexOf("run: |"));
  assert.doesNotMatch(run, /\$\{\{/u, "run script must not interpolate expressions (script injection)");
  assert.match(action, /evidence-verify/u);
  assert.match(action, /--format markdown/u);
  assert.match(action, /GITHUB_STEP_SUMMARY/u);
  assert.match(action, /forgeloop-version must be an exact version/u);
  assert.match(action, /require-signature needs identity and issuer/u);
  assert.match(action, /exit "\$status"/u);
});
