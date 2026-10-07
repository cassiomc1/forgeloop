import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, rm, symlink, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readStorageMetadataJson, STORAGE_CATALOG_LIMITS } from "../src/storage/metadata-json.js";
import { importProjectState } from "../src/storage/importer.js";
import { restoreProjectStorageBackup } from "../src/storage/project-backup.js";
import { JSON_LIMITS } from "../src/core/json-safety.js";

test("storage catalog reads reject oversized files, invalid encoding and excessive structure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-metadata-"));
  try {
    assert.equal(await readStorageMetadataJson(root, "absent.json", { optional: true }), null);
    await assert.rejects(readStorageMetadataJson(root, "absent.json"), { code: "ENOENT" });
    const filename = path.join(root, "catalog.json");
    await writeFile(filename, JSON.stringify({ attachments: [], sessions: [{ id: "retained" }] }));
    assert.deepEqual(await readStorageMetadataJson(root, "catalog.json"), { attachments: [], sessions: [{ id: "retained" }] });
    await assert.rejects(readStorageMetadataJson(root, "catalog.json", { limits: { ...JSON_LIMITS, maxBytes: 4 } }), { code: "JSON_LIMIT_EXCEEDED" });
    await writeFile(filename, Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
    await assert.rejects(readStorageMetadataJson(root, "catalog.json"), { code: "E_STORAGE_METADATA_INVALID" });
    await writeFile(filename, JSON.stringify({ values: [1, 2, 3] }));
    await assert.rejects(readStorageMetadataJson(root, "catalog.json", { limits: { ...JSON_LIMITS, maxArrayLength: 2 } }), { code: "JSON_LIMIT_EXCEEDED" });
    await writeFile(filename, "{");
    await assert.rejects(readStorageMetadataJson(root, "catalog.json"), SyntaxError);
    await symlink(filename, path.join(root, "linked.json"));
    await assert.rejects(readStorageMetadataJson(root, "linked.json", { optional: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("portable import rejects an oversized sparse catalog before creating a native database", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-metadata-import-"));
  try {
    const file = await open(path.join(root, "export-index.json"), "wx");
    try { await file.truncate(STORAGE_CATALOG_LIMITS.maxBytes + 1); } finally { await file.close(); }
    const destination = path.join(root, "refused.sqlite");
    await assert.rejects(importProjectState(root, destination), error => {
      assert.equal(error.code, "E_STORAGE_IMPORT_ABORTED");
      assert.equal(error.report.errors[0].code, "JSON_LIMIT_EXCEEDED");
      return true;
    });
    assert.equal((await stat(destination)).size, 0);
    assert.equal((await stat(path.join(root, "export-index.json"))).size, STORAGE_CATALOG_LIMITS.maxBytes + 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("backup restore refuses an oversized manifest without allocating a destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-metadata-backup-"));
  try {
    const file = await open(path.join(root, "backup-manifest.json"), "wx");
    try { await file.truncate(JSON_LIMITS.maxBytes + 1); } finally { await file.close(); }
    const destination = path.join(root, "refused-restore");
    await assert.rejects(restoreProjectStorageBackup(root, destination), { code: "JSON_LIMIT_EXCEEDED" });
    await assert.rejects(stat(destination), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
