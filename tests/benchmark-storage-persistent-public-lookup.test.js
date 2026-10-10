/** Deferred behavioral probe: execute only after the owner releases the source freeze. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// Intended repository target: tests/benchmark-storage-persistent-public-lookup.test.js
const root = path.resolve(import.meta.dirname, '..');
const load = file => import(pathToFileURL(path.join(root, file)).href);
const boundFiles = ['src/core/actions.js', 'src/core/native-storage.js', 'src/core/runtime-context.js', 'src/core/storage-runtime-registry.js', 'src/storage/project-boundary.js', 'src/storage/operational-context.js', 'src/storage/connection-owner.js', 'scripts/benchmark-storage-idempotency.mjs'];
const manifest = async () => Object.fromEntries(await Promise.all(boundFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
test('public lookup retains the actual active storage connection across calls and closes it with owner', async () => {
  const sourceBefore = await manifest();
  const { buildCanonicalDiagnosisProject } = await load('tests/helpers/canonical-diagnosis-fixture.js');
  const { proposeAction, findActionByIdempotencyKey } = await load('src/core/actions.js');
  const { getPackageRoot } = await load('src/core/templates.js');
  const { createForgeLoopContext } = await load('src/core/runtime-context.js');
  const { withProjectStorage } = await load('src/storage/project-boundary.js');
  const { getOperationalStore } = await load('src/storage/operational-context.js');
  const taskId = 'persistent-lookup-probe';
  const fixture = await buildCanonicalDiagnosisProject({ taskId });
  const context = createForgeLoopContext({ persistentStorage: true });
  let connection;
  const evidence = [];
  try {
    for (let index = 0; index < 3; index++) await proposeAction(fixture.target, { packageRoot: getPackageRoot(), taskId, input: {
      actionId: `action-probe-${index}`, effectClass: 'EXTERNAL_PUBLICATION', capability: 'repository.push',
      operation: 'push branch', target: `origin/probe-${index}`, idempotencyKey: `probe-key-${index}`,
      requiredForCompletion: false, provenance: 'HOST_REPORTED',
    } });
    connection = await withProjectStorage(fixture.target, async () => {
      const activeConnection = getOperationalStore(fixture.target).db;
      const nestedConnection = await withProjectStorage(fixture.target, () => getOperationalStore(fixture.target).db, { readOnly: true });
      assert.equal(nestedConnection, activeConnection);
      return activeConnection;
    }, { runtimeContext: context, readOnly: true });
    assert.ok(connection);
    const keys = ['probe-key-0', 'probe-key-1', 'probe-key-2', 'probe-key-missing'];
    for (let sample = 0; sample < 2; sample++) {
      for (const key of keys) await withProjectStorage(fixture.target, async () => {
        assert.equal(getOperationalStore(fixture.target).db, connection);
        const value = await findActionByIdempotencyKey(fixture.target, { taskId, idempotencyKey: key });
        assert.equal(getOperationalStore(fixture.target).db, connection);
        if (key.endsWith('missing')) assert.equal(value, null);
        else assert.equal(value.idempotencyKey, key);
        evidence.push({ sample, key, matchedActiveConnection: true, found: value !== null });
      }, { runtimeContext: context, readOnly: true });
    }
    assert.equal(evidence.length, 8);
    await context.close();
    assert.throws(() => connection.prepare('SELECT 1'));
    const sourceAfter = await manifest();
    assert.deepEqual(sourceAfter, sourceBefore);
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});
