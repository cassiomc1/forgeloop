import { existsSync, readFileSync } from 'node:fs';

const summaryPath = process.argv[2] || 'coverage/coverage-summary.json';
if (!existsSync(summaryPath)) throw new Error(`Coverage summary not found: ${summaryPath}`);

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const roots = ['src/main/security/', 'src/main/core/protocol/'];
const metrics = ['lines', 'functions', 'branches'];
const minimum = { lines: 95, functions: 95, branches: 90 };
const rows = Object.entries(summary).filter(([file]) => file !== 'total' && roots.some((root) => file.replaceAll('\\', '/').includes(root)));
if (rows.length === 0) throw new Error('No critical coverage entries found');

const totals = Object.fromEntries(metrics.map((metric) => [metric, { total: 0, covered: 0 }]));
for (const [, file] of rows) {
  for (const metric of metrics) {
    totals[metric].total += file[metric].total;
    totals[metric].covered += file[metric].covered;
  }
}

const failures = [];
for (const metric of metrics) {
  const actual = totals[metric].total === 0 ? 100 : (totals[metric].covered / totals[metric].total) * 100;
  console.log(`critical ${metric}: ${actual.toFixed(2)}% (required ${minimum[metric]}%)`);
  if (actual < minimum[metric]) failures.push(`${metric} ${actual.toFixed(2)}% < ${minimum[metric]}%`);
}
if (failures.length) throw new Error(`Critical coverage gate failed: ${failures.join(', ')}`);
