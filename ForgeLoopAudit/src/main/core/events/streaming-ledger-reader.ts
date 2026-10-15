import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { EventRecord } from '@shared/domain';

export interface LedgerPage {
  events: EventRecord[];
  nextCursor?: string;
  validation: { schema: 'VALID' | 'INVALID'; chain: 'VALID' | 'INVALID' | 'PARTIAL'; recoverable?: boolean };
  fileIdentity: { size: number; mtimeMs: number };
}

export async function readLedgerPage(filePath: string, cursor: string | undefined, limit: number): Promise<LedgerPage> {
  const before = await stat(filePath);
  const events: EventRecord[] = [];
  let seenCursor = cursor === undefined;
  let schemaValid = true;
  let chainValid = true;
  let previous: EventRecord | undefined;
  let lastLineHadNewline = true;
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      lastLineHadNewline = line.length === 0 || true;
      if (!line.trim()) continue;
      let event: EventRecord;
      try { event = JSON.parse(line) as EventRecord; } catch { schemaValid = false; continue; }
      if (!event || typeof event.hash !== 'string' || typeof event.seq !== 'number') { schemaValid = false; continue; }
      if (previous && (event.seq !== previous.seq + 1 || event.previousHash !== previous.hash)) chainValid = false;
      previous = event;
      if (!seenCursor) {
        if (event.hash === cursor || String(event.seq) === cursor) seenCursor = true;
        continue;
      }
      if (events.length < Math.min(Math.max(limit, 1), 500)) events.push(event);
    }
  } finally {
    lines.close();
  }
  const after = await stat(filePath);
  const replacedOrAppended = after.size !== before.size || after.mtimeMs !== before.mtimeMs;
  const partial = !lastLineHadNewline && replacedOrAppended;
  return {
    events,
    nextCursor: events.at(-1)?.hash,
    validation: {
      schema: schemaValid ? 'VALID' : 'INVALID',
      chain: partial ? 'PARTIAL' : chainValid ? 'VALID' : 'INVALID',
      recoverable: partial,
    },
    fileIdentity: { size: after.size, mtimeMs: after.mtimeMs },
  };
}
