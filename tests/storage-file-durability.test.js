import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const supportsModuleMocks = typeof mock.module === "function";
let importSequence = 0;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

async function invokeSyncDirectory({ openError = null, syncError = null, closeError = null, options } = {}) {
  const fsPromises = await import("node:fs/promises");
  const events = [];
  const open = async () => {
    events.push("open");
    if (openError) throw openError;
    return {
      sync: async () => {
        events.push("sync");
        if (syncError) throw syncError;
      },
      close: async () => {
        events.push("close");
        if (closeError) throw closeError;
      },
    };
  };
  const mockedFs = { ...fsPromises, open };
  try {
    const major = Number(process.versions.node.split(".", 1)[0]);
    mock.module("node:fs/promises", major >= 26 ? { exports: mockedFs } : { namedExports: mockedFs });
    const { syncDirectory } = await import(`../src/storage/file-durability.js?durability-error-${++importSequence}`);
    await syncDirectory("/virtual/storage-directory", options);
    return { events, error: null };
  } catch (error) {
    return { events, error };
  } finally {
    mock.restoreAll();
  }
}

const mockTestOptions = { concurrency: false };

if (!supportsModuleMocks) {
  test("storage durability error contracts run in an isolated module-mock process", () => {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const output = execFileSync(process.execPath, ["--experimental-test-module-mocks", "--test", fileURLToPath(import.meta.url)], {
      encoding: "utf8",
      timeout: 30_000,
      env: environment,
    });
    assert.match(output, /tests 4/u);
    assert.match(output, /pass 4/u);
    assert.match(output, /fail 0/u);
  });
} else {

test("storage durability default mode preserves tolerated open, sync, and close errors", mockTestOptions, async () => {
  const openIgnored = await invokeSyncDirectory({ openError: failure("EISDIR") });
  assert.equal(openIgnored.error, null);
  assert.deepEqual(openIgnored.events, ["open"]);

  const openFailure = failure("EIO");
  const openRejected = await invokeSyncDirectory({ openError: openFailure });
  assert.equal(openRejected.error, openFailure);
  assert.deepEqual(openRejected.events, ["open"]);

  const syncIgnored = await invokeSyncDirectory({ syncError: failure("EINVAL") });
  assert.equal(syncIgnored.error, null);
  assert.deepEqual(syncIgnored.events, ["open", "sync", "close"]);

  const syncFailure = failure("EIO");
  const syncRejected = await invokeSyncDirectory({ syncError: syncFailure });
  assert.equal(syncRejected.error, syncFailure);
  assert.deepEqual(syncRejected.events, ["open", "sync", "close"]);

  const closeIgnored = await invokeSyncDirectory({ closeError: failure("EPERM") });
  assert.equal(closeIgnored.error, null);
  assert.deepEqual(closeIgnored.events, ["open", "sync", "close"]);
});

test("storage durability default mode preserves close-error precedence over a sync failure", mockTestOptions, async () => {
  const result = await invokeSyncDirectory({
    syncError: failure("EIO"),
    closeError: failure("EISDIR"),
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.events, ["open", "sync", "close"]);

  const closeFailure = failure("EIO");
  const nonIgnoredClose = await invokeSyncDirectory({ closeError: closeFailure });
  assert.equal(nonIgnoredClose.error, closeFailure);
  assert.deepEqual(nonIgnoredClose.events, ["open", "sync", "close"]);
});

test("storage durability propagates unexpected open and sync errors by identity", mockTestOptions, async () => {
  for (const options of [undefined, { catchOpenErrors: false, catchCloseErrors: false }]) {
    const openError = failure("EIO");
    const opened = await invokeSyncDirectory({ openError, options });
    assert.equal(opened.error, openError);
    assert.deepEqual(opened.events, ["open"]);

    const syncError = failure("EIO");
    const synced = await invokeSyncDirectory({ syncError, options });
    assert.equal(synced.error, syncError);
    assert.deepEqual(synced.events, ["open", "sync", "close"]);
  }
});

test("storage durability strict mode propagates open and close failures while tolerating sync failures", mockTestOptions, async () => {
  const options = { catchOpenErrors: false, catchCloseErrors: false };

  const strictOpenFailure = failure("EISDIR");
  const openFailure = await invokeSyncDirectory({ openError: strictOpenFailure, options });
  assert.equal(openFailure.error, strictOpenFailure);
  assert.deepEqual(openFailure.events, ["open"]);

  const strictUnallowlistedOpen = failure("EIO");
  const openRejected = await invokeSyncDirectory({ openError: strictUnallowlistedOpen, options });
  assert.equal(openRejected.error, strictUnallowlistedOpen);
  assert.deepEqual(openRejected.events, ["open"]);

  const toleratedSync = await invokeSyncDirectory({ syncError: failure("EINVAL"), options });
  assert.equal(toleratedSync.error, null);
  assert.deepEqual(toleratedSync.events, ["open", "sync", "close"]);

  const strictSyncFailure = failure("EIO");
  const syncRejected = await invokeSyncDirectory({ syncError: strictSyncFailure, options });
  assert.equal(syncRejected.error, strictSyncFailure);
  assert.deepEqual(syncRejected.events, ["open", "sync", "close"]);

  const closeFailure = await invokeSyncDirectory({ syncError: failure("EINVAL"), closeError: failure("EISDIR"), options });
  assert.equal(closeFailure.error?.code, "EISDIR");
  assert.deepEqual(closeFailure.events, ["open", "sync", "close"]);

  const strictPrecedence = await invokeSyncDirectory({ syncError: failure("EIO"), closeError: failure("EISDIR"), options });
  assert.equal(strictPrecedence.error?.code, "EISDIR");
  assert.deepEqual(strictPrecedence.events, ["open", "sync", "close"]);
});
}
