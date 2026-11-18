import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { putArtifact } from "../src/storage/repository.js";
import { withOperationalStore, withOperationalTransaction } from "../src/storage/unit-of-work.js";
import { iterateAttachmentReferences } from "../src/storage/attachment-references.js";
import { taskAttestationBundlePath, taskAttestationStatementPath } from "../src/core/task-paths.js";
import { resolveAttestationBundlePath } from "../src/core/attachment-paths.js";
import { signatureReferenceId } from "../src/core/signing/bundle-reference.js";
import { readOperationalText } from "../src/storage/operational-context.js";
import { createSigstoreSigningProvider } from "../src/core/signing/sigstore.js";
import { verifyAttestation } from "../src/core/attestation-verifier.js";
import { resolveAttestationStatus } from "../src/core/attestation.js";

// cosign 3 verifies the DSSE envelope and the in-toto subject digest; the
// provider then requires the signed payload to be the statement itself, so the
// fixtures are in-toto statements and Sigstore-shaped DSSE bundles.
const SUBJECT = "a".repeat(64);
const inToto = (marker) => ({ _type: "https://in-toto.io/Statement/v1", subject: [{ name: "fixture", digest: { sha256: SUBJECT } }], predicateType: "fixture", predicate: { marker } });
const dsseBundle = (statement, signature = "sig") => JSON.stringify({
  mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
  dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload: Buffer.from(JSON.stringify(statement)).toString("base64"), signatures: [{ sig: signature }] },
});

test("statement signature lookup accepts duplicate byte bindings and rejects corrupt bindings", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  const statementPath = taskAttestationStatementPath(TEST_TASK_ID);
  putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: { marker: "canonical" } });
  try {
    await withOperationalStore({ db, target }, async () => {
      const source = readOperationalText(target, statementPath).text;
      let attachment;
      await withOperationalTransaction({ target, taskId: TEST_TASK_ID, operation: "same-signature-bytes" }, async transaction => {
        for (let index = 0; index < 3; index += 1) {
          attachment = await transaction.stageAttachment({ referenceId: signatureReferenceId(source), readable: Readable.from(["same signature bytes"]) });
        }
        assert.equal(resolveAttestationBundlePath(target, TEST_TASK_ID), attachment.path);
      });
      assert.equal([...iterateAttachmentReferences(db)].length, 3);
      assert.equal(resolveAttestationBundlePath(target, TEST_TASK_ID), attachment.path);
      db.prepare("UPDATE attachment_references SET sha256 = ? WHERE task_id = ?").run("0".repeat(64), TEST_TASK_ID);
      assert.throws(() => resolveAttestationBundlePath(target, TEST_TASK_ID), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    });
  } finally { db.close(); await removeTempTree(target); }
});

test("SQLite Sigstore signing stages immutable bundles, cleans temporary files, and rolls back bindings", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  const statementPath = taskAttestationStatementPath(TEST_TASK_ID);
  const canonical = inToto("canonical");
  putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: canonical });
  const signatureBytes = (index) => dsseBundle(canonical, `signature ${index}`);
  let temporary;
  let calls = 0;
  const provider = createSigstoreSigningProvider({ execFileImpl: async (_command, args) => {
    calls += 1;
    temporary = args[args.indexOf("--bundle") + 1];
    assert.equal(db.isTransaction, false);
    assert.equal(temporary.startsWith(`${target}${path.sep}`), false);
    assert.deepEqual(JSON.parse(await readFile(args[args.indexOf("--statement") + 1], "utf8")), canonical);
    await writeFile(temporary, signatureBytes(calls));
  } });
  try {
    await withOperationalStore({ db, target }, async () => {
      const options = { target, taskId: TEST_TASK_ID, operation: "signing-test", recordCommitEvent: true };
      const input = { target, statementPath, bundlePath: "signature.json" };
      assert.equal((await provider.sign(input)).status, "INVALID");
      assert.equal(calls, 0);
      const beforeEvents = db.prepare("SELECT COUNT(*) AS count FROM events").get().count;
      let signed;
      await withOperationalTransaction(options, async () => {
        signed = await provider.sign(input);
        assert.equal(signed.status, "VALID");
        assert.equal([...iterateAttachmentReferences(db)].length, 0);
        assert.equal(resolveAttestationBundlePath(target, TEST_TASK_ID), signed.path);
        const stagedVerifier = createSigstoreSigningProvider({ execFileImpl: async (_command, args) => {
          assert.equal(db.isTransaction, false);
          assert.equal(await readFile(args[args.indexOf("--bundle") + 1], "utf8"), signatureBytes(1));
        } });
        assert.equal((await stagedVerifier.verify({ target, statementPath, bundlePath: signed.path })).status, "VALID");
        await assert.rejects(readFile(temporary), { code: "ENOENT" });
      });
      assert.deepEqual([...iterateAttachmentReferences(db)], [signed.attachment]);
      assert.equal(resolveAttestationBundlePath(target, TEST_TASK_ID, taskAttestationBundlePath(TEST_TASK_ID)), signed.path);
      assert.equal(await readFile(path.join(target, signed.path), "utf8"), signatureBytes(1));
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events").get().count, beforeEvents + 1);
      let rolledBack;
      await assert.rejects(withOperationalTransaction(options, async () => {
        rolledBack = await provider.sign(input);
        assert.equal(rolledBack.status, "VALID");
        assert.notEqual(rolledBack.attachment.referenceId, signed.attachment.referenceId);
        assert.throws(() => resolveAttestationBundlePath(target, TEST_TASK_ID), { code: "E_ATTESTATION_SIGNATURE_INVALID" });
        throw new Error("abort signing preparation");
      }), /abort signing preparation/u);
      assert.deepEqual([...iterateAttachmentReferences(db)], [signed.attachment]);
      assert.equal(resolveAttestationBundlePath(target, TEST_TASK_ID), signed.path);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events").get().count, beforeEvents + 1);
      assert.equal(await readFile(path.join(target, rolledBack.path), "utf8"), signatureBytes(2));
      await assert.rejects(readFile(temporary), { code: "ENOENT" });
      await assert.rejects(readFile(path.join(target, "signature.json")), { code: "ENOENT" });
      await assert.rejects(withOperationalTransaction(options, async () => {
        const missing = createSigstoreSigningProvider({ execFileImpl: async () => ({}) });
        assert.equal((await missing.sign(input)).code, "E_ATTESTATION_SIGNATURE_INVALID");
        throw new Error("abort missing bundle");
      }), /abort missing bundle/u);
      assert.deepEqual([...iterateAttachmentReferences(db)], [signed.attachment]);
      let verificationCalls = 0;
      let privateBundle;
      const verify = createSigstoreSigningProvider({ execFileImpl: async (_command, args) => {
        verificationCalls += 1;
        privateBundle = args[args.indexOf("--bundle") + 1];
        assert.notEqual(privateBundle, path.join(target, signed.path));
        assert.equal(await readFile(privateBundle, "utf8"), signatureBytes(1));
      } });
      assert.equal((await verify.verify({ target, statementPath, bundlePath: resolveAttestationBundlePath(target, TEST_TASK_ID) })).status, "VALID");
      await assert.rejects(readFile(privateBundle), { code: "ENOENT" });
      await writeFile(path.join(target, signed.path), "signature bytes 9");
      assert.equal((await verify.verify({ target, statementPath, bundlePath: signed.path })).code, "E_ATTESTATION_SIGNATURE_INVALID");
      assert.equal(verificationCalls, 1);
      await rm(path.join(target, signed.path));
      assert.equal((await verify.verify({ target, statementPath, bundlePath: signed.path })).code, "E_ATTESTATION_SIGNATURE_INVALID");
      assert.equal(verificationCalls, 1);
      await writeFile(path.join(target, signed.path), signatureBytes(1));
      let additional;
      await withOperationalTransaction(options, async () => { additional = await provider.sign(input); });
      assert.equal(additional.status, "VALID");
      assert.throws(() => resolveAttestationBundlePath(target, TEST_TASK_ID), { code: "E_ATTESTATION_SIGNATURE_INVALID" });
      for (const verifyStatus of [verifyAttestation, resolveAttestationStatus]) {
        const result = await verifyStatus({ target, taskId: TEST_TASK_ID, requireSignature: true });
        assert.equal(result.status, "INVALID");
        assert.equal(result.errors[0].code, "E_ATTESTATION_SIGNATURE_INVALID");
      }
      assert.equal(resolveAttestationBundlePath(target, TEST_TASK_ID, signed.path), signed.path);
      putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: inToto("new statement") });
      assert.notEqual(resolveAttestationBundlePath(target, TEST_TASK_ID), signed.path);
      assert.notEqual(resolveAttestationBundlePath(target, TEST_TASK_ID), additional.path);
    });
  } finally { db.close(); await removeTempTree(target); }
});

test("SQLite Sigstore verification binds the subject digest and the signed payload to the private statement", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  const statementPath = taskAttestationStatementPath(TEST_TASK_ID);
  const statement = inToto("verify");
  putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: statement });
  await writeFile(path.join(target, "signature.json"), dsseBundle(statement));
  const calls = [];
  try {
    const provider = createSigstoreSigningProvider({ execFileImpl: async (_command, args) => {
      calls.push(args);
      assert.equal(args.includes("--statement"), false, "cosign 3 has no --statement flag");
      assert.deepEqual(args.slice(0, 1), ["verify-blob-attestation"]);
      assert.equal(args[args.indexOf("--type") + 1], "fixture");
      assert.equal(args[args.indexOf("--digest") + 1], SUBJECT);
      assert.equal(args[args.indexOf("--digestAlg") + 1], "sha256");
      assert.equal(args.some((value) => value === path.join(target, statementPath)), false);
      assert.equal(db.isTransaction, false);
      return {};
    } });
    await withOperationalStore({ db, target }, async () => {
      assert.equal((await provider.verify({ target, statementPath, bundlePath: "signature.json" })).status, "VALID");
      await writeFile(path.join(target, "signature.json"), dsseBundle(inToto("another statement")));
      const mismatch = await provider.verify({ target, statementPath, bundlePath: "signature.json" });
      assert.deepEqual([mismatch.status, mismatch.code], ["INVALID", "E_ATTESTATION_SIGNATURE_INVALID"]);
      assert.match(mismatch.message, /different statement/u);
      await writeFile(path.join(target, "signature.json"), "not a bundle");
      assert.equal((await provider.verify({ target, statementPath, bundlePath: "signature.json" })).status, "INVALID");
      assert.equal(calls.length, 3);
      const failure = createSigstoreSigningProvider({ execFileImpl: async () => { throw new Error("verification failed"); } });
      assert.equal((await failure.verify({ target, statementPath, bundlePath: "signature.json" })).status, "INVALID");
    });
    await assert.rejects(readFile(path.join(target, statementPath)), { code: "ENOENT" });
  } finally { db.close(); await removeTempTree(target); }
});

test("SQLite signing refuses linked output and removes failed signer temporary files", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  const statementPath = taskAttestationStatementPath(TEST_TASK_ID);
  putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: { marker: "canonical" } });
  const external = path.join(target, "existing-signature.json");
  await writeFile(external, "preserve existing bytes");
  try {
    await withOperationalStore({ db, target }, async () => {
      for (const mode of ["linked", "failed"]) {
        let temporary;
        const provider = createSigstoreSigningProvider({ execFileImpl: async (_command, args) => {
          temporary = args[args.indexOf("--bundle") + 1];
          if (mode === "linked") await symlink(external, temporary);
          else { await writeFile(temporary, "partial output"); throw new Error("signer failed"); }
        } });
        await withOperationalTransaction({ target, taskId: TEST_TASK_ID, operation: "failed-signing" }, async () => {
          assert.equal((await provider.sign({ target, statementPath, bundlePath: "signature.json" })).code, "E_ATTESTATION_SIGNATURE_INVALID");
          await assert.rejects(readFile(temporary), { code: "ENOENT" });
        });
        assert.equal([...iterateAttachmentReferences(db)].length, 0);
        assert.equal(await readFile(external, "utf8"), "preserve existing bytes");
      }
    });
  } finally { db.close(); await removeTempTree(target); }
});

test("SQLite signer refuses changed canonical statements and active writer transactions", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(target, path.join(target, "state.sqlite"));
  const statementPath = taskAttestationStatementPath(TEST_TASK_ID);
  putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: inToto("before") });
  await writeFile(path.join(target, "signature.json"), dsseBundle(inToto("before")));
  let calls = 0;
  try {
    const provider = createSigstoreSigningProvider({ execFileImpl: async () => {
      calls += 1;
      putArtifact(db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: inToto("after") });
      return {};
    } });
    await withOperationalStore({ db, target }, async () => {
      const changed = await provider.verify({ target, statementPath, bundlePath: "signature.json" });
      assert.equal(changed.status, "INVALID");
      assert.equal(calls, 1);
      db.exec("BEGIN IMMEDIATE");
      try {
        assert.equal((await provider.verify({ target, statementPath, bundlePath: "signature.json" })).status, "INVALID");
        assert.equal(calls, 1);
      } finally { db.exec("ROLLBACK"); }
    });
  } finally { db.close(); await removeTempTree(target); }
});


test("direct native signer verification binds private statement and attachment bytes without legacy aliases", async () => {
  const target = await buildDiagnosisProject();
  const { withProjectStorage } = await import("../src/storage/project-boundary.js");
  const { withOperationalAttachmentFile } = await import("../src/storage/operational-attachments.js");
  const statementPath = taskAttestationStatementPath(TEST_TASK_ID);
  const statement = inToto("direct");
  let signature;
  let calls = 0;
  let privateBundle;
  const provider = createSigstoreSigningProvider({ execFileImpl: async (_command, args) => {
    calls += 1;
    if (args[0] === "attest-blob") {
      await writeFile(args[args.indexOf("--bundle") + 1], dsseBundle(statement));
    } else {
      privateBundle = args[args.indexOf("--bundle") + 1];
      assert.notEqual(privateBundle, path.join(target, signature.path));
      assert.equal(args[args.indexOf("--digest") + 1], SUBJECT);
      assert.equal(await readFile(privateBundle, "utf8"), dsseBundle(statement));
    }
  } });
  try {
    await withProjectStorage(target, async store => {
      putArtifact(store.db, { taskId: TEST_TASK_ID, kind: "attestation", artifactId: "statement", payload: statement });
      await withOperationalTransaction({ target, taskId: TEST_TASK_ID, operation: "direct-signature" }, async () => {
        signature = await provider.sign({ target, statementPath, bundlePath: "portable/signature.json" });
        assert.equal(signature.status, "VALID");
      });
    });
    assert.equal((await provider.sign({ target, statementPath, bundlePath: taskAttestationBundlePath(TEST_TASK_ID) })).status, "INVALID");
    assert.equal(calls, 1, "unprepared native signing cannot invoke an external signer");
    assert.equal((await provider.verify({ target, statementPath, bundlePath: signature.path })).status, "VALID");
    assert.equal(calls, 2);
    await assert.rejects(readFile(privateBundle), { code: "ENOENT" });
    let consumed = false;
    await assert.rejects(withOperationalAttachmentFile(target, signature.path, "foreign-task", () => { consumed = true; }), { code: "E_STORAGE_ATTACHMENT_INVALID" });
    assert.equal(consumed, false);
    await writeFile(path.join(target, signature.path), "changed signature");
    assert.equal((await provider.verify({ target, statementPath, bundlePath: signature.path })).status, "INVALID");
    assert.equal(calls, 2, "corrupt native bytes cannot reach the verifier");
    await assert.rejects(readFile(path.join(target, statementPath)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(target, taskAttestationBundlePath(TEST_TASK_ID))), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});


test("legacy operational bundle publication is refused without altering source or invoking signer", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  const { withSigningBundleFile } = await import("../src/core/signing/bundle-file.js");
  const { taskArtifactPath } = await import("../src/core/task-paths.js");
  const eventsPath = path.join(target, taskArtifactPath(TEST_TASK_ID, "events"));
  let called = false;
  try {
    const before = await readFile(eventsPath, "utf8");
    await assert.rejects(withSigningBundleFile(target, taskAttestationBundlePath(TEST_TASK_ID), taskAttestationStatementPath(TEST_TASK_ID), () => { called = true; }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    assert.equal(called, false);
    assert.equal(await readFile(eventsPath, "utf8"), before);
    await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(target, taskAttestationBundlePath(TEST_TASK_ID))), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});
