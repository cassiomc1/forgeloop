import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { demoHasDrift } from '../generate-demo-project.mjs';
import { generateDemoFiles } from '../demo/write-demo-project.mjs';
import { verifyDemoProject } from '../demo/verifier.mjs';
import { taskKeyFor } from '../demo/fixtures.mjs';
import { resolveHandoffAcceptance } from '@cassiomc1/forgeloop/integration';

const DEMO_ROOT = join(process.cwd(), 'demo');

test('demo generation is deterministic', () => {
  const first = generateDemoFiles();
  const second = generateDemoFiles();
  assert.equal(first.files.size, second.files.size);
  for (const [path, content] of first.files) {
    assert.ok(second.files.has(path), `second generation is missing ${path}`);
    assert.equal(second.files.get(path), content, `generation drift at ${path}`);
  }
});

test('demo executions include current ForgeLoop isolation provenance', () => {
  const { files } = generateDemoFiles();
  const executions = [...files.entries()]
    .filter(([path]) => /\/executions\/exec-.*\.json$/u.test(path))
    .map(([, content]) => JSON.parse(content));

  assert.ok(executions.some((execution) => (
    execution.executionIsolation === 'NATIVE_PROJECT'
    && execution.isolation?.mode === 'NATIVE_PROJECT'
  )));
  assert.ok(executions.some((execution) => (
    execution.executionIsolation === 'PROJECT_ISOLATED'
    && execution.isolation?.mode === 'PROJECT_ISOLATED'
  )));
});

test('demo includes representative canonical boundary artifacts without fake trust', () => {
  const { files } = generateDemoFiles();
  const paths = [...files.keys()];
  assert.ok(paths.some((path) => path.endsWith('/workspace-binding.json')));
  assert.ok(paths.some((path) => path.endsWith('/responsibility.json')));
  assert.ok(paths.some((path) => path.endsWith('/verification-scope.json')));
  assert.ok(paths.some((path) => path.includes('/handoffs/handoff-')));
  assert.ok(paths.some((path) => path.endsWith('/attestations/code-manifest.json')));
  assert.ok(paths.some((path) => path.endsWith('/attestations/statement.json')));
  const config = JSON.parse(files.get('.forgeloop/config.json'));
  assert.equal(config.verification.checkers[0].scopeMode, 'PATH_ARGUMENTS');
  assert.equal(config.attestation.mode, 'off');
  assert.equal(config.attestation.signing.provider, 'none');
});

test('demo handoff showcase carries canonical acceptance without promoting it to evidence', () => {
  const { files } = generateDemoFiles();
  const taskKey = taskKeyFor('TASK-004');
  assert.ok(files.has(`.forgeloop/task-state/${taskKey}/handoffs/handoff-harness-a-to-b.json`), 'generated demo is missing the canonical handoff');
  const eventsPath = `.forgeloop/task-state/${taskKey}/events.ndjson`;
  const events = files.get(eventsPath).trim().split('\n').map((line) => JSON.parse(line));
  const accepted = events.find((event) => event.event === 'HANDOFF_ACCEPTED');
  assert.deepEqual(accepted?.details, {
    handoffId: 'handoff-harness-a-to-b',
    handoffDigest: JSON.parse(files.get(`.forgeloop/task-state/${taskKey}/handoffs/handoff-harness-a-to-b.json`)).artifactDigest,
    consumerId: 'consumer-forgeshop-harness-b',
    harness: 'harness-b',
  });
  const handoff = JSON.parse(files.get(`.forgeloop/task-state/${taskKey}/handoffs/handoff-harness-a-to-b.json`));
  assert.equal(handoff.evidence.acceptance, undefined);
  const projection = resolveHandoffAcceptance({ events, handoff, ledgerValid: true });
  assert.equal(projection.status, 'ACCEPTED');
  assert.equal(projection.consumerId, 'consumer-forgeshop-harness-b');
});

test('committed demo matches generator output exactly', () => {
  const result = demoHasDrift();
  assert.equal(result.drift, false, `committed demo/ has drifted from the generator: ${result.reason}`);
});

test('demo passes full protocol verification', () => {
  const result = verifyDemoProject(DEMO_ROOT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.stats.tasks, 8);
  assert.ok(result.stats.events >= 40 && result.stats.events <= 100, `expected 40-100 events, found ${result.stats.events}`);
  for (const phase of ['COMPLETE', 'VERIFYING', 'EXECUTING', 'BLOCKED', 'PLANNED', 'ROUTED']) {
    assert.ok(result.stats.phases.includes(phase), `expected phase ${phase} to be represented`);
  }
  assert.equal(result.stats.sessions, 2);
});

test('canonical demo contains no INVALID artifacts', () => {
  const result = verifyDemoProject(DEMO_ROOT);
  for (const error of result.errors) {
    assert.doesNotMatch(error, /INVALID|invalid JSON|schema/, error);
  }
});

test('demo represents every registered artifact category (29/29)', () => {
  const result = verifyDemoProject(DEMO_ROOT);
  const coverage = result.stats.artifactCoverage;
  assert.ok(coverage, 'verifier did not report artifact coverage');
  assert.deepEqual(coverage.missing, [], `demo is missing registered artifact categories: ${coverage.missing.join(', ')}`);
  assert.equal(coverage.represented, coverage.total, `expected ${coverage.total}/${coverage.total} artifact categories represented`);
});

test('runtime artifact registry and demo schema mapping share one source of truth', async () => {
  const { SCHEMA_FILES } = await import('../demo/fixtures.mjs');
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'main', 'core', 'protocol', 'artifact-registry.json'), 'utf8'),
  );
  assert.deepEqual(SCHEMA_FILES, registry);
});
