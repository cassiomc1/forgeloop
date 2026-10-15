import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLedgerPage } from '@main/core/events/streaming-ledger-reader';

describe('streaming ledger reader', () => {
  it('reads a bounded page without loading the complete ledger API', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-stream-'));
    const path = join(root, 'events.ndjson');
    writeFileSync(path, Array.from({ length: 1000 }, (_, i) => JSON.stringify({ seq: i + 1, hash: `hash-${i + 1}`, previousHash: i ? `hash-${i}` : null })).join('\n') + '\n');
    const page = await readLedgerPage(path, undefined, 25);
    expect(page.events).toHaveLength(25);
    expect(page.validation.chain).toBe('VALID');
    expect(page.fileIdentity.size).toBeGreaterThan(0);
  });
});
