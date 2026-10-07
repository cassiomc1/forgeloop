import assert from "node:assert/strict";
import { LedgerEventCollection } from "../../src/core/ledger-event-collection.js";
import { validateLedgerEvents } from "../../src/core/events.js";

/** Decode a fresh object per positional read, as an immutable native snapshot does. */
export function decodedLedgerSource(events) {
  const bytes = events.map(event => JSON.stringify(event));
  return new LedgerEventCollection({
    length: bytes.length,
    readAt: index => JSON.parse(bytes[index]),
    *iterateRange(start, end) { for (let index = start; index < end; index += 1) yield JSON.parse(bytes[index]); },
  });
}

export function assertCollectionValidationParity(events, options = {}) {
  const expected = validateLedgerEvents(events, options);
  const observed = validateLedgerEvents(decodedLedgerSource(events), options);
  assert.deepEqual({ valid: observed.valid, errors: observed.errors }, { valid: expected.valid, errors: expected.errors });
}
