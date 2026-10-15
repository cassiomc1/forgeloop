import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveArgument(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

export function resolveLedgerOutput(args) {
  const output = resolveArgument(args, '--output', undefined);
  if (!output) {
    throw new Error('Missing required --output <path>. Benchmark fixtures must be generated outside the repository (e.g. os.tmpdir()).');
  }
  return output;
}

export function generateLedgerFixture({ count = 100000, output }) {
  mkdirSync(dirname(output), { recursive: true });
  let previousHash = null;
  const lines = [];
  for (let seq = 1; seq <= count; seq++) {
    const event = { seq, schemaVersion: 1, protocolVersion: 1, taskId: 'large-task', event: 'STEP', at: '1970-01-01T00:00:00.000Z', previousHash };
    const hash = `fixture-${seq}`;
    previousHash = hash;
    lines.push(JSON.stringify({ ...event, hash }));
  }
  writeFileSync(output, `${lines.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = Number(resolveArgument(process.argv, '--events', 100000));
  const output = resolveLedgerOutput(process.argv);
  generateLedgerFixture({ count, output });
  console.log(`Generated ${count} deterministic events at ${output}`);
}
