import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ARCHIFY_COMMIT,
  ARCHIFY_PIN_SCHEMA_VERSION,
  ARCHIFY_SOURCE,
  ARCHIFY_VERSION,
  inspectArchifyToolchain,
  requireArchify,
  validateArchifyPin,
  validateArchifyInvocation,
} from "../scripts/archify-toolchain.mjs";
import {
  computeVendorTreeIntegrity,
  verifyVendorTreeIntegrity,
} from "../scripts/vendor-tree-integrity.mjs";

async function createFixture(order) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-vendor-integrity-"));
  await mkdir(path.join(root, "nested"), { recursive: true });
  const files = {
    "zeta.mjs": "export const zeta = true;\n",
    "nested/alpha.json": "{\"alpha\":true}\n",
    "nested/beta.txt": "beta\n",
  };
  for (const relativePath of order) {
    await writeFile(path.join(root, relativePath), files[relativePath], "utf8");
  }
  return root;
}

async function expectIntegrityError(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function validArchifyPin(overrides = {}) {
  return {
    schemaVersion: ARCHIFY_PIN_SCHEMA_VERSION,
    name: "archify",
    version: ARCHIFY_VERSION,
    sourceCommit: ARCHIFY_COMMIT,
    source: ARCHIFY_SOURCE,
    license: "MIT",
    directory: "archify",
    integrity: {
      algorithm: "sha256",
      treeSha256: "a".repeat(64),
      fileCount: 1,
      files: {
        "entry.txt": "b".repeat(64),
      },
    },
    ...overrides,
  };
}

test("Archify PIN requires schemaVersion 2", () => {
  const pin = validArchifyPin();
  delete pin.schemaVersion;

  assert.throws(
    () => validateArchifyPin(pin),
    (error) => {
      assert.equal(error.code, "E_VENDOR_INTEGRITY_PIN_INVALID");
      assert.match(error.message, /schemaVersion/);
      return true;
    },
  );
});

test("Archify PIN rejects unsupported schema versions without coercion", () => {
  for (const schemaVersion of [1, 3, 0, -1, "2", null]) {
    const pin = validArchifyPin({ schemaVersion });
    assert.throws(
      () => validateArchifyPin(pin),
      (error) => error.code === "E_VENDOR_INTEGRITY_PIN_INVALID",
    );
  }
});

test("Archify toolchain is locally pinned to the reviewed release", async () => {
  const report = await inspectArchifyToolchain();
  assert.equal(report.name, "archify");
  assert.equal(report.version, ARCHIFY_VERSION);
  assert.equal(report.commit, ARCHIFY_COMMIT);
  assert.equal(report.pinSchemaVersion, 2);
  assert.equal(report.license, "MIT");
  assert.equal(report.integrityVerified, true);
  assert.match(report.treeSha256, /^[a-f0-9]{64}$/);
  assert.match(report.root.split(path.sep).join("/"), /vendor\/archify\/v2\.15\.0\/archify$/);
});

test("schema version metadata does not affect vendor tree integrity", async () => {
  const root = await createFixture(["zeta.mjs", "nested/alpha.json", "nested/beta.txt"]);
  try {
    const integrity = await computeVendorTreeIntegrity(root);
    const pin = validArchifyPin({ integrity });
    assert.doesNotThrow(() => validateArchifyPin(pin));
    assert.deepEqual(await verifyVendorTreeIntegrity(root, pin.integrity), integrity);
  } finally {
    await removeTempTree(root);
  }
});

test("malformed integrity still fails closed after schema validation", async () => {
  const root = await createFixture(["zeta.mjs", "nested/alpha.json", "nested/beta.txt"]);
  try {
    const pin = validArchifyPin({ integrity: await computeVendorTreeIntegrity(root) });
    pin.integrity.treeSha256 = "not-a-hash";
    await expectIntegrityError(
      () => verifyVendorTreeIntegrity(root, pin.integrity),
      "E_VENDOR_INTEGRITY_PIN_INVALID",
    );
  } finally {
    await removeTempTree(root);
  }
});

test("pinned Archify doctor command passes without installing dependencies", async () => {
  const result = requireArchify(["doctor"]);
  assert.match(result.stdout, /Archify is ready\./);
});

test("vendor integrity digest is deterministic across creation order", async () => {
  const first = await createFixture(["zeta.mjs", "nested/beta.txt", "nested/alpha.json"]);
  const second = await createFixture(["nested/alpha.json", "zeta.mjs", "nested/beta.txt"]);
  try {
    const firstIntegrity = await computeVendorTreeIntegrity(first);
    const secondIntegrity = await computeVendorTreeIntegrity(second);
    assert.deepEqual(firstIntegrity, secondIntegrity);
    assert.equal(firstIntegrity.algorithm, "sha256");
    assert.equal(firstIntegrity.fileCount, 3);
    assert.deepEqual(Object.keys(firstIntegrity.files), ["nested/alpha.json", "nested/beta.txt", "zeta.mjs"]);
    assert.deepEqual(await verifyVendorTreeIntegrity(first, firstIntegrity), firstIntegrity);
  } finally {
    await removeTempTree(first);
    await removeTempTree(second);
  }
});

test("vendor integrity fails closed on modified, extra, missing, and renamed files", async () => {
  const root = await createFixture(["zeta.mjs", "nested/alpha.json", "nested/beta.txt"]);
  try {
    const expected = await computeVendorTreeIntegrity(root);

    await writeFile(path.join(root, "zeta.mjs"), "export const zeta = false;\n", "utf8");
    await expectIntegrityError(() => verifyVendorTreeIntegrity(root, expected), "E_VENDOR_INTEGRITY_FILE_HASH");
    await writeFile(path.join(root, "zeta.mjs"), "export const zeta = true;\n", "utf8");

    await writeFile(path.join(root, "extra.mjs"), "export const extra = true;\n", "utf8");
    await expectIntegrityError(() => verifyVendorTreeIntegrity(root, expected), "E_VENDOR_INTEGRITY_FILE_SET");
    await unlink(path.join(root, "extra.mjs"));

    await unlink(path.join(root, "nested", "beta.txt"));
    await expectIntegrityError(() => verifyVendorTreeIntegrity(root, expected), "E_VENDOR_INTEGRITY_FILE_SET");
    await writeFile(path.join(root, "nested", "beta.txt"), "beta\n", "utf8");

    await rename(path.join(root, "nested", "alpha.json"), path.join(root, "nested", "renamed.json"));
    await expectIntegrityError(() => verifyVendorTreeIntegrity(root, expected), "E_VENDOR_INTEGRITY_FILE_SET");
  } finally {
    await removeTempTree(root);
  }
});

test("vendor integrity rejects symlinked entries", async (t) => {
  const root = await createFixture(["zeta.mjs", "nested/alpha.json", "nested/beta.txt"]);
  try {
    try {
      await symlink(path.join(root, "zeta.mjs"), path.join(root, "nested", "escape.mjs"));
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error.code)) {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await expectIntegrityError(
      () => computeVendorTreeIntegrity(root),
      "E_VENDOR_INTEGRITY_SYMLINK",
    );
  } finally {
    await removeTempTree(root);
  }
});

test("vendor integrity ignores only .DS_Store and preserves all other files", async () => {
  const root = await createFixture(["zeta.mjs", "nested/alpha.json", "nested/beta.txt"]);
  try {
    await writeFile(path.join(root, ".DS_Store"), "machine metadata\n", "utf8");
    const integrity = await computeVendorTreeIntegrity(root);
    assert.equal(integrity.fileCount, 3);
    assert.equal(Object.hasOwn(integrity.files, ".DS_Store"), false);
    await verifyVendorTreeIntegrity(root, integrity);
    assert.match(await readFile(path.join(root, "zeta.mjs"), "utf8"), /zeta/);
  } finally {
    await removeTempTree(root);
  }
});

test("Archify wrapper accepts a valid documentation-scoped invocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-archify-paths-"));
  try {
    await mkdir(path.join(root, "docs", "diagrams"), { recursive: true });
    await mkdir(path.join(root, "docs", "assets", "diagrams"), { recursive: true });
    await writeFile(path.join(root, "docs", "diagrams", "flow.workflow.json"), "{}\n", "utf8");
    const args = ["workflow", "docs/diagrams/flow.workflow.json", "--quality", "showcase"];
    assert.deepEqual(await validateArchifyInvocation("validate", args, { rootDir: root }), args);
    const deliverArgs = ["workflow", "docs/diagrams/flow.workflow.json", "docs/assets/diagrams/flow.html", "--json"];
    assert.deepEqual(await validateArchifyInvocation("deliver", deliverArgs, { rootDir: root }), deliverArgs);
    assert.deepEqual(await validateArchifyInvocation("doctor", [], { rootDir: root }), []);
  } finally {
    await removeTempTree(root);
  }
});

test("Archify wrapper rejects malformed and out-of-bound paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-archify-paths-"));
  try {
    await mkdir(path.join(root, "docs", "diagrams"), { recursive: true });
    await mkdir(path.join(root, "docs", "assets", "diagrams"), { recursive: true });
    await writeFile(path.join(root, "docs", "diagrams", "flow.workflow.json"), "{}\n", "utf8");
    await writeFile(path.join(root, "outside.json"), "{}\n", "utf8");
    await expectIntegrityError(
      () => validateArchifyInvocation("validate", ["workflow", "../outside.json"], { rootDir: root }),
      "E_ARCHIFY_PATH_SOURCE",
    );
    await expectIntegrityError(
      () => validateArchifyInvocation("validate", ["workflow", path.join(root, "outside.json")], { rootDir: root }),
      "E_ARCHIFY_PATH_SOURCE",
    );
    await expectIntegrityError(
      () => validateArchifyInvocation("deliver", ["workflow", "docs/diagrams/flow.workflow.json", "README.md"], { rootDir: root }),
      "E_ARCHIFY_PATH_OUTPUT",
    );
    await expectIntegrityError(
      () => validateArchifyInvocation("validate", ["workflow"], { rootDir: root }),
      "E_ARCHIFY_INVOCATION",
    );
    await expectIntegrityError(
      () => validateArchifyInvocation("deliver", ["workflow", "docs/diagrams/flow.workflow.json"], { rootDir: root }),
      "E_ARCHIFY_INVOCATION",
    );
    await expectIntegrityError(
      () => validateArchifyInvocation("doctor", ["unexpected"], { rootDir: root }),
      "E_ARCHIFY_INVOCATION",
    );
  } finally {
    await removeTempTree(root);
  }
});

test("Archify wrapper rejects source and output symlink escapes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-archify-paths-"));
  try {
    await mkdir(path.join(root, "docs", "diagrams"), { recursive: true });
    await mkdir(path.join(root, "docs", "assets", "diagrams"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}\n", "utf8");
    let symlinksAvailable = true;
    try {
      await symlink(root, path.join(root, "docs", "diagrams", "escape"));
      await symlink(root, path.join(root, "docs", "assets", "diagrams", "escape"));
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error.code)) {
        symlinksAvailable = false;
        t.skip(`symlink creation unavailable: ${error.code}`);
      } else {
        throw error;
      }
    }
    if (!symlinksAvailable) return;
    await expectIntegrityError(
      () => validateArchifyInvocation("validate", ["workflow", "docs/diagrams/escape/package.json"], { rootDir: root }),
      "E_ARCHIFY_PATH_SYMLINK",
    );
    await expectIntegrityError(
      () => validateArchifyInvocation("deliver", ["workflow", "docs/diagrams/escape/package.json", "docs/assets/diagrams/escape/out.html"], { rootDir: root }),
      "E_ARCHIFY_PATH_SYMLINK",
    );
  } finally {
    await removeTempTree(root);
  }
});
