import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOCUMENTS,
  parseDocumentedExamples,
  runDocumentedExample,
} from "../scripts/validate_documentation_examples.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("documentation examples require an explicit expectation marker", () => {
  assert.throws(
    () => parseDocumentedExamples("README.md", "<!-- FORGELOOP EXAMPLE: missing -->\n```bash\nforgeloop protocol-info --json\n```\n<!-- END FORGELOOP EXAMPLE -->"),
    /DOC_EXAMPLE_EXPECTATION_MISSING/,
  );
});

test("documentation examples run in a disposable fixture and assert JSON paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-doc-example-"));
  try {
    const document = path.join(directory, "example.md");
    await writeFile(document, [
      "<!-- FORGELOOP EXAMPLE: compatibility | exit=0 | json.protocolVersion=1 -->",
      "```bash",
      "forgeloop protocol-info --json",
      "```",
      "<!-- END FORGELOOP EXAMPLE -->",
    ].join("\n"));
    const [example] = parseDocumentedExamples("example.md", await readFile(document, "utf8"));
    const result = await runDocumentedExample(example);
    assert.equal(result.exitCode, 0);
    assert.equal(result.json.protocolVersion, 1);
  } finally {
    await removeTempTree(directory);
  }
});

test("documentation examples can create a task fixture before a resumability command", async () => {
  const [example] = parseDocumentedExamples("continuity.md", [
    "<!-- FORGELOOP EXAMPLE: continuity:status | fixture=task:auth-feature | exit=0 | json.taskId=auth-feature -->",
    "```bash",
    "forgeloop status --task auth-feature --json",
    "```",
    "<!-- END FORGELOOP EXAMPLE -->",
  ].join("\n"));
  const result = await runDocumentedExample(example);
  assert.equal(result.exitCode, 0);
  assert.equal(result.json.taskId, "auth-feature");
});

test("each operational document has at least one executable example", async () => {
  for (const relativePath of DOCUMENTS) {
    const examples = parseDocumentedExamples(relativePath, await readFile(path.join(root, relativePath), "utf8"));
    assert.ok(examples.length > 0, `${relativePath} needs a tagged executable example`);
  }
});
