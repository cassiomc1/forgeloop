import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { PathBoundary } from '@main/security/path-boundary';
import { EventLedgerReader } from '@main/core/events/ledger-reader';
import { SchemaValidator } from '@main/core/protocol/validator';

const validator = () => new SchemaValidator('schemas');

function makeLedger(count: number) {
  const root = mkdtempSync(join(tmpdir(), 'forgeloop-ledger-'));
  const task = join(root, '.forgeloop', 'task-state', 'task-1');
  mkdirSync(task, { recursive: true });
  const canonicalize = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])] ))
    : value;
  let previousHash: string | null = null;
  const lines = Array.from({ length: count }, (_, index) => {
    const body = { seq: index + 1, schemaVersion: 1, protocolVersion: 1, taskId: 'task-1', event: 'STEP', at: new Date(0).toISOString(), previousHash };
    const hash = createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
    previousHash = hash;
    return JSON.stringify({ ...body, hash });
  });
  writeFileSync(join(task, 'events.ndjson'), `${lines.join('\n')}\n`);
  return root;
}

describe('EventLedgerReader', () => {
  it('paginates ledgers larger than the old 1000-line limit', () => {
    const reader = new EventLedgerReader(new PathBoundary(makeLedger(10000)), validator());
    const page = reader.readEventsPaginated('task-1', undefined, 100);
    expect(page.events).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(page.totalCount).toBeUndefined();
  });

  it('reports malformed lines instead of claiming the page is valid', () => {
    const root = makeLedger(2);
    appendFileSync(join(root, '.forgeloop', 'task-state', 'task-1', 'events.ndjson'), '{malformed}\n');
    const reader = new EventLedgerReader(new PathBoundary(root), validator());
    const page = reader.readEventsPaginated('task-1', undefined, 100);
    expect(page.validation?.schema).toBe('INVALID');
    expect(page.validation?.invalidLineCount).toBeGreaterThan(0);
  });
});
