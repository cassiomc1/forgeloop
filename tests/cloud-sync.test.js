import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runSyncPull } from "../src/commands/sync-pull.js";
import { runSyncPush } from "../src/commands/sync-push.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { repositoryFromRemoteUrl, resolveRemote } from "../src/core/sync/remote.js";
import { isSafeSnapshotPath, openSnapshot, sealSnapshot, unpackDirectory } from "../src/core/sync/snapshot.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const { Response } = globalThis;
const REPOSITORY = "acme/app";
const REMOTE = "https://sync.example.test/api/sync";
const packageRoot = getPackageRoot();

// In-memory sync remote with the forgeloop-site /api/sync semantics:
// create-only first push, ETag-conditional overwrites, 412 on conflicts.
function fakeRemote(token) {
  const store = new Map();
  let version = 0;
  const bodies = [];
  const fetchImpl = async (url, init = {}) => {
    const { searchParams } = new URL(url);
    if (init.headers.authorization !== `Bearer ${token}`) return Response.json({ error: "A valid sync token is required" }, { status: 401 });
    const repository = searchParams.get("repo");
    const current = store.get(repository);
    if (init.method === "GET") {
      // Like the hosting edge, reads may return a weak validator for the same version.
      return current ? new Response(current.body, { headers: { etag: `W/${current.etag}` } }) : Response.json({ error: "none" }, { status: 404 });
    }
    const ifMatch = init.headers["if-match"];
    if (init.headers["if-none-match"] === "*" ? current : current?.etag !== ifMatch) return Response.json({ error: "The remote snapshot changed since your last pull; pull before pushing again" }, { status: 412 });
    const etag = `"v${++version}"`;
    bodies.push(Buffer.from(init.body));
    store.set(repository, { body: Buffer.from(init.body), etag });
    return Response.json({ ok: true, etag });
  };
  return { store, bodies, fetchImpl };
}

async function setup() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sync-state-"));
  const env = { FORGELOOP_SYNC_TOKEN: "s".repeat(40), FORGELOOP_SYNC_KEY: "correct horse battery staple", FORGELOOP_SYNC_STATE_DIR: stateDir };
  return { stateDir, env, remote: fakeRemote(env.FORGELOOP_SYNC_TOKEN) };
}

const push = (target, env, fetchImpl) => withProjectStorage(target, () => runSyncPush({ target, packageRoot, remote: REMOTE, repository: REPOSITORY, env, fetchImpl }), { readOnly: true });
const pull = (target, env, fetchImpl, extra = {}) => runSyncPull({ target, packageRoot, remote: REMOTE, repository: REPOSITORY, writersQuiesced: true, env, fetchImpl, ...extra });

test("a pushed snapshot restores into a fresh project and stale pushes are refused", async () => {
  const { stateDir, env, remote } = await setup();
  const source = await buildDiagnosisProject();
  const fresh = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sync-target-"));
  try {
    const first = await push(source, env, remote.fetchImpl);
    assert.equal(first.status, "PUSHED");
    assert.equal(first.firstPush, true);
    assert.equal(first.etag, '"v1"');
    assert.ok(first.files >= 1);
    // The remote only ever sees ciphertext.
    assert.equal(remote.bodies[0].includes(Buffer.from(TEST_TASK_ID)), false);
    assert.equal((await readdir(path.join(source, ".forgeloop"))).some((name) => name.startsWith("sync-staging-")), false);

    const pulled = await pull(fresh, env, remote.fetchImpl);
    assert.equal(pulled.status, "PULLED");
    assert.equal(pulled.restore.active, true);
    assert.equal(pulled.etag, '"v1"');
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: fresh, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.match(JSON.stringify(listed.result), new RegExp(TEST_TASK_ID));

    // The pulling machine now pushes the next version...
    const next = await push(fresh, env, remote.fetchImpl);
    assert.equal(next.etag, '"v2"');
    assert.equal(next.firstPush, false);
    // ...so the original machine's push, based on v1, is refused.
    await assert.rejects(push(source, env, remote.fetchImpl), { code: "E_SYNC_CONFLICT" });
    assert.equal(remote.store.get(REPOSITORY).etag, '"v2"');
  } finally {
    await removeTempTree(source);
    await removeTempTree(fresh);
    await removeTempTree(stateDir);
  }
});

test("pull refuses a wrong key, tampering, another repository and unquiesced writers before restoring", async () => {
  const { stateDir, env, remote } = await setup();
  const source = await buildDiagnosisProject();
  const fresh = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sync-refused-"));
  try {
    await push(source, env, remote.fetchImpl);
    await assert.rejects(pull(fresh, { ...env, FORGELOOP_SYNC_KEY: "a different passphrase!" }, remote.fetchImpl), { code: "E_SYNC_SNAPSHOT_INVALID" });

    const stored = remote.store.get(REPOSITORY);
    const tampered = JSON.parse(stored.body.toString("utf8"));
    tampered.cipher.data = Buffer.from(tampered.cipher.data, "base64").map((byte, index) => (index === 10 ? byte ^ 1 : byte)).toString("base64");
    remote.store.set(REPOSITORY, { ...stored, body: Buffer.from(JSON.stringify(tampered)) });
    await assert.rejects(pull(fresh, env, remote.fetchImpl), { code: "E_SYNC_SNAPSHOT_INVALID" });

    const moved = JSON.parse(stored.body.toString("utf8"));
    moved.repository = "acme/other";
    remote.store.set(REPOSITORY, { ...stored, body: Buffer.from(JSON.stringify(moved)) });
    await assert.rejects(pull(fresh, env, remote.fetchImpl), { code: "E_SYNC_SNAPSHOT_INVALID" });

    remote.store.set(REPOSITORY, stored);
    await assert.rejects(pull(fresh, env, remote.fetchImpl, { writersQuiesced: false }), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    // Nothing was restored by any refused pull.
    assert.deepEqual(await readdir(fresh), []);
  } finally {
    await removeTempTree(source);
    await removeTempTree(fresh);
    await removeTempTree(stateDir);
  }
});

test("snapshots bind the repository, reject unsafe paths and require configuration", async () => {
  const sealed = sealSnapshot({ schemaVersion: 1, files: [] }, { passphrase: "p".repeat(16), repository: REPOSITORY });
  assert.deepEqual(openSnapshot(sealed, { passphrase: "p".repeat(16), repository: REPOSITORY }).payload, { schemaVersion: 1, files: [] });
  assert.throws(() => openSnapshot(sealed, { passphrase: "p".repeat(16), repository: "acme/other" }), { code: "E_SYNC_SNAPSHOT_INVALID" });
  assert.throws(() => sealSnapshot({}, { passphrase: "short", repository: REPOSITORY }), { code: "E_SYNC_CONFIG" });

  for (const unsafe of ["../x", "/etc/passwd", "a/../b", "a//b", "a\\b", ".", ""]) assert.equal(isSafeSnapshotPath(unsafe), false, unsafe);
  assert.equal(isSafeSnapshotPath("attachments/ab/cd.bin"), true);
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sync-unpack-"));
  try {
    await assert.rejects(unpackDirectory({ schemaVersion: 1, files: [{ path: "../escape", sha256: "0", data: "" }] }, directory), { code: "E_SYNC_SNAPSHOT_INVALID" });
    await assert.rejects(unpackDirectory({ schemaVersion: 1, files: [{ path: "state.sqlite", sha256: "0".repeat(64), data: "AAAA" }] }, directory), { code: "E_SYNC_SNAPSHOT_INVALID" });
  } finally { await removeTempTree(directory); }

  assert.equal(repositoryFromRemoteUrl("git@github.com:Acme/App.git"), REPOSITORY);
  assert.equal(repositoryFromRemoteUrl("https://github.com/acme/app"), REPOSITORY);
  assert.equal(repositoryFromRemoteUrl("https://gitlab.com/acme/app.git"), null);
  assert.throws(() => resolveRemote("http://sync.example.test/api/sync"), { code: "E_SYNC_CONFIG" });
  assert.equal(resolveRemote("http://localhost:8787/api/sync"), "http://localhost:8787/api/sync");
  assert.throws(() => resolveRemote("https://user:pass@sync.example.test/"), { code: "E_SYNC_CONFIG" });
  await assert.rejects(runSyncPull({ target: directory, writersQuiesced: true, env: {} }), { code: "E_SYNC_CONFIG" });
});
