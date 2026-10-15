import { parseJsonSafely } from '@main/security/resource-limits';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { TASK_STATE_DIR } from '@shared/constants';
import type { EventRecord, EventPage } from '@shared/domain';
import { SchemaValidator } from '@main/core/protocol/validator';

const CHUNK_BYTES = 64 * 1024;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function eventHash(event: EventRecord): string {
  const { hash: _hash, ...body } = event;
  return createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
}

export class EventLedgerReader {
  constructor(
    private readonly pathBoundary: PathBoundary,
    private readonly validator: SchemaValidator
  ) {}

  private isPersistedEvent(value: unknown): value is EventRecord {
    const validation = this.validator.validate('event.schema.json', value);
    if (!validation.valid || !value || typeof value !== 'object') return false;
    const event = value as Record<string, unknown>;
    return typeof event.hash === 'string' && /^[a-f0-9]{64}$/.test(event.hash);
  }

  private eventPath(taskKey: string): string | null {
    const candidate = this.pathBoundary.resolveForgeLoopPathLexically(join(TASK_STATE_DIR, taskKey, 'events.ndjson'));
    if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) return null;
    return this.pathBoundary.validatePath(candidate);
  }

  readEvents(taskKey: string, limit = 1000): EventRecord[] {
    return this.readEventsPaginated(taskKey, undefined, limit).events;
  }

  readEventsPaginated(taskKey: string, cursor?: string, limit = 100): EventPage {
    const eventsPath = this.eventPath(taskKey);
    if (!eventsPath) return { events: [], hasMore: false, validation: { schema: 'NOT_RUN', chain: 'NOT_RUN', cursor: 'NOT_RUN', scope: 'PAGE' } };
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const collected: EventRecord[] = [];
    let foundCursor = !cursor;
    let hasOlder = false;
    let invalidLineCount = 0;
    let pending = '';
    const fd = openSync(eventsPath, 'r');
    let position = fstatSync(fd).size;
    try {
      for (; position > 0 && (!hasOlder || collected.length < boundedLimit);) {
        const start = Math.max(0, position - CHUNK_BYTES);
        const buffer = Buffer.alloc(position - start);
        readSync(fd, buffer, 0, buffer.length, start);
        pending = buffer.toString('utf8') + pending;
        const lines = pending.split('\n');
        pending = lines.shift() || '';
        for (let index = lines.length - 1; index >= 0; index--) {
          const line = lines[index].trim();
          if (!line) continue;
          let parsed: unknown;
          try { parsed = parseJsonSafely(line); } catch { invalidLineCount++; continue; }
          if (!this.isPersistedEvent(parsed)) { invalidLineCount++; continue; }
          const event = parsed;
          if (!foundCursor) {
            if (event.hash === cursor || String(event.seq) === cursor) foundCursor = true;
            continue;
          }
          if (collected.length < boundedLimit) collected.push(event);
          else { hasOlder = true; break; }
        }
        position = start;
      }
      if (position === 0 && pending.trim()) {
        try {
          const parsed = parseJsonSafely(pending.trim());
          if (this.isPersistedEvent(parsed)) {
            if (foundCursor && collected.length < boundedLimit) collected.push(parsed);
          } else if (pending.trim()) invalidLineCount++;
        } catch { /* incomplete or malformed append is ignored until next write */ }
      }
    } finally { closeSync(fd); }

    const nextCursor = collected.length > 0 ? collected[collected.length - 1].hash || String(collected[collected.length - 1].seq) : undefined;
    return {
      events: collected,
      cursor: nextCursor,
      hasMore: hasOlder,
      validation: { schema: invalidLineCount === 0 ? 'VALID' : 'INVALID', chain: 'NOT_RUN', cursor: cursor ? (foundCursor ? 'FOUND' : 'NOT_FOUND') : 'NOT_RUN', scope: 'PAGE', invalidLineCount },
    };
  }

  validateIntegrity(taskKey: string): { schema: 'VALID' | 'INVALID' | 'NOT_RUN'; chain: 'VALID' | 'INVALID' | 'NOT_RUN'; scope: 'LEDGER'; errors?: string[] } {
    const eventsPath = this.eventPath(taskKey);
    if (!eventsPath) return { schema: 'NOT_RUN', chain: 'NOT_RUN', scope: 'LEDGER' };
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((line) => line.trim());
    let previous: EventRecord | undefined;
    const errors: string[] = [];
    for (const [index, line] of lines.entries()) {
      let parsed: unknown;
      try { parsed = parseJsonSafely(line); } catch { errors.push(`line ${index + 1}: invalid JSON`); continue; }
      if (!this.isPersistedEvent(parsed)) { errors.push(`line ${index + 1}: event schema invalid`); continue; }
      const event = parsed;
      if (!previous && (event.seq !== 1 || event.previousHash !== null)) errors.push(`event ${event.seq}: invalid first sequence or previousHash`);
      if (previous && event.seq !== previous.seq + 1) errors.push(`event ${event.seq}: sequence gap`);
      if (previous && event.previousHash !== previous.hash) errors.push(`event ${event.seq}: previousHash mismatch`);
      if (previous && event.taskId !== previous.taskId) errors.push(`event ${event.seq}: taskId changed`);
      if (event.hash !== eventHash(event)) errors.push(`event ${event.seq}: stored hash mismatch`);
      previous = event;
    }
    return { schema: errors.some((error) => error.includes('schema') || error.includes('JSON')) ? 'INVALID' : 'VALID', chain: errors.length > 0 ? 'INVALID' : 'VALID', scope: 'LEDGER', errors: errors.length > 0 ? errors : undefined };
  }
}

export function createEventLedgerReader(pathBoundary: PathBoundary, validator: SchemaValidator): EventLedgerReader {
  return new EventLedgerReader(pathBoundary, validator);
}
