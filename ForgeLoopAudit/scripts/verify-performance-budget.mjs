import { spawnSync } from 'node:child_process';

const budgets = {
  'ledger-100000-events': Number(process.env.FORGELOOP_LEDGER_BUDGET_MS || 1500),
};
for (const [scenario, budgetMs] of Object.entries(budgets)) {
  const result = spawnSync(process.execPath, ['scripts/benchmark-large-project.mjs', '--scenario', 'ledger'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Performance benchmark failed for ${scenario}: ${result.stderr}`);
  const measurement = JSON.parse(result.stdout.trim());
  if (measurement.scenario !== scenario || !Number.isFinite(measurement.durationMs) || !Number.isFinite(measurement.peakRssBytes)) {
    throw new Error(`Invalid performance measurement for ${scenario}`);
  }
  console.log(`${scenario}: ${measurement.durationMs}ms / ${measurement.peakRssBytes} bytes (budget ${budgetMs}ms)`);
  if (measurement.durationMs > budgetMs) throw new Error(`Performance budget exceeded for ${scenario}`);
}
