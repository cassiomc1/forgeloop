import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { removeTempTree } from "./helpers/rm-safe.js";
import { parseCapturedJsonArtifact, readPortableJsonArtifact } from "../src/core/artifacts.js";
import { getPackageRoot } from "../src/core/templates.js";
import { JSON_LIMITS } from "../src/core/json-safety.js";

const packageRoot = getPackageRoot();

test("portable and captured artifacts preserve valid value, path and fingerprint", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-artifact-parser-"));
  try {
    const bytes = await readFile(path.join(packageRoot, "tests/fixtures/schemas/policy-snapshot/valid.json"));
    await writeFile(path.join(target, "input.json"), bytes);
    assert.deepEqual(await readPortableJsonArtifact(target, "input.json", "policy-snapshot", packageRoot),
      await parseCapturedJsonArtifact(bytes.toString("utf8"), "input.json", "policy-snapshot", packageRoot));
  } finally { await removeTempTree(target); }
});

test("portable byte admission precedes UTF8 replacement and preserves error classification", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-artifact-byte-admission-"));
  try {
    const parts = Array.from({ length: 800 }, (_, index) => Buffer.concat([
      Buffer.from(`"k${index}":"`), Buffer.alloc(1000, 0xff), Buffer.from('"'),
    ]));
    const bytes = Buffer.concat([Buffer.from("{"), ...parts.flatMap((part, index) => index ? [Buffer.from(","), part] : [part]), Buffer.from("}")]);
    assert.ok(bytes.length < JSON_LIMITS.maxBytes);
    assert.ok(Buffer.byteLength(bytes.toString("utf8")) > JSON_LIMITS.maxBytes);
    const filename = path.join(target, "input.json");
    await writeFile(filename, bytes);
    await assert.rejects(readPortableJsonArtifact(target, "input.json", "config", packageRoot), { code: "ARTIFACT_INVALID" });
    await writeFile(filename, Buffer.alloc(JSON_LIMITS.maxBytes + 1, 0x20));
    await assert.rejects(readPortableJsonArtifact(target, "input.json", "config", packageRoot), { code: "JSON_LIMIT_EXCEEDED" });
    await assert.rejects(readPortableJsonArtifact(target, "missing.json", "config", packageRoot), { code: "ARTIFACT_MISSING" });
    await assert.rejects(readPortableJsonArtifact(target, "../outside.json", "config", packageRoot), { code: "ARTIFACT_PATH_INVALID" });
  } finally { await removeTempTree(target); }
});
