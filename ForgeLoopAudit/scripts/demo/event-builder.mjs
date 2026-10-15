import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function eventHash(event) {
  const { hash: _hash, ...body } = event;
  return createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
}

export class EventLedgerBuilder {
  constructor(taskId, { startAt = '2026-08-01T09:00:00.000Z', stepMinutes = 7 } = {}) {
    this.taskId = taskId;
    this.clock = Date.parse(startAt);
    this.stepMs = stepMinutes * 60_000;
    this.events = [];
  }

  nextTime() {
    const at = new Date(this.clock).toISOString();
    this.clock += this.stepMs;
    return at;
  }

  append(event, details, fingerprint) {
    const previous = this.events[this.events.length - 1];
    const record = {
      seq: this.events.length + 1,
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: this.taskId,
      event,
      at: this.nextTime(),
      previousHash: previous ? previous.hash : null,
    };
    if (fingerprint !== undefined) record.fingerprint = fingerprint;
    if (details !== undefined) record.details = details;
    record.hash = eventHash(record);
    this.events.push(record);
    return record;
  }

  recomputeHashes() {
    let previousHash = null;
    for (const event of this.events) {
      event.previousHash = previousHash;
      event.hash = eventHash(event);
      previousHash = event.hash;
    }
  }

  serialize() {
    if (this.events.length === 0) throw new Error(`Event ledger for ${this.taskId} is empty`);
    return `${this.events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  }
}
