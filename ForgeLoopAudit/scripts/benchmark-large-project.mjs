import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scenario = process.argv.includes('--scenario') ? process.argv[process.argv.indexOf('--scenario') + 1] : 'build';
const start = performance.now();
if (scenario === 'ledger') {
  // Benchmark output is ephemeral: never write generated fixtures into the repository.
  const root = mkdtempSync(join(tmpdir(), 'forgeloop-ledger-benchmark-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/generate-large-ledger-fixture.mjs', '--events', '100000', '--output', join(root, 'events.ndjson')],
      { stdio: 'ignore' },
    );
    if (result.error) throw result.error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const durationMs = Math.round(performance.now() - start);
const result = { scenario: scenario === 'ledger' ? 'ledger-100000-events' : scenario, durationMs, peakRssBytes: process.memoryUsage().rss };
console.log(JSON.stringify(result));
