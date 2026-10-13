/**
 * Explicit immutable-source event sequence. This is not an Array or a Proxy.
 * Readers decode on demand; historical views share only source position identity.
 * The source owner must hold one immutable snapshot for the sequence's lifetime.
 * Array-returning filter/map operations deliberately materialize selected proofs;
 * they do not establish bounded memory for arbitrarily large relation state.
 */
const collections = new WeakSet();
const viewToken = Symbol("ledger-source-view");

function sourceError(message) {
  return Object.assign(new Error(message), { code: "E_LEDGER_SOURCE_INVALID" });
}

function integer(value) {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : Math.trunc(number);
}

function bound(value, length) {
  const index = integer(value);
  return index < 0 ? Math.max(length + index, 0) : Math.min(index, length);
}

export class LedgerEventCollection {
  #source;
  #start;
  #end;

  constructor({ length, readAt, iterateRange = null, iterateTypes = null }, view = null, token = null) {
    if (view) {
      if (token !== viewToken) throw sourceError("Ledger views must come from their source collection");
      this.#source = view.source;
      this.#start = view.start;
      this.#end = view.end;
    } else {
      if (!Number.isSafeInteger(length) || length < 0 || typeof readAt !== "function"
        || (iterateRange !== null && typeof iterateRange !== "function")
        || (iterateTypes !== null && typeof iterateTypes !== "function")) {
        throw sourceError("Ledger source requires a finite length and synchronous readers");
      }
      this.#source = { length, readAt, iterateRange, iterateTypes, positions: new WeakMap() };
      this.#start = 0;
      this.#end = length;
    }
    collections.add(this);
    Object.freeze(this);
  }

  get length() { return this.#end - this.#start; }

  #observe(event, index) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw sourceError("Ledger source returned a non-object event");
    }
    const known = this.#source.positions.get(event);
    if (known !== undefined && known !== index) {
      throw sourceError("Ledger source reused one event object at distinct positions");
    }
    this.#source.positions.set(event, index);
    return event;
  }

  at(index) {
    const position = integer(index);
    const local = position < 0 ? this.length + position : position;
    if (local < 0 || local >= this.length) return undefined;
    const absolute = this.#start + local;
    return this.#observe(this.#source.readAt(absolute), absolute);
  }

  *values() {
    if (!this.#source.iterateRange) {
      for (let index = 0; index < this.length; index += 1) yield this.at(index);
      return;
    }
    let index = this.#start;
    for (const event of this.#source.iterateRange(this.#start, this.#end)) {
      if (index >= this.#end) throw sourceError("Ledger source exceeded its declared range");
      yield this.#observe(event, index);
      index += 1;
    }
    if (index !== this.#end) throw sourceError("Ledger source truncated its declared range");
  }

  [Symbol.iterator]() { return this.values(); }

  *entries() {
    let index = 0;
    for (const event of this) { yield [index, event]; index += 1; }
  }

  *entriesOfTypes(types) {
    const selected = new Set(types);
    if (!this.#source.iterateTypes) {
      for (const [index, event] of this.entries()) if (selected.has(event.event)) yield [index, event];
      return;
    }
    let previous = this.#start - 1;
    for (const { index, event } of this.#source.iterateTypes(this.#start, this.#end, [...selected])) {
      if (!Number.isSafeInteger(index) || index <= previous || index < this.#start || index >= this.#end || !selected.has(event?.event)) {
        throw sourceError("Ledger typed source returned an invalid position or event type");
      }
      previous = index;
      yield [index - this.#start, this.#observe(event, index)];
    }
  }

  slice(start = 0, end = this.length) {
    const first = bound(start, this.length);
    const last = Math.max(first, bound(end, this.length));
    return new LedgerEventCollection({}, { source: this.#source, start: this.#start + first, end: this.#start + last }, viewToken);
  }

  indexOf(event) {
    const absolute = event && typeof event === "object" ? this.#source.positions.get(event) : undefined;
    return absolute === undefined || absolute < this.#start || absolute >= this.#end ? -1 : absolute - this.#start;
  }

  findIndex(predicate) {
    for (const [index, event] of this.entries()) if (predicate(event, index, this)) return index;
    return -1;
  }

  find(predicate) {
    for (const [index, event] of this.entries()) if (predicate(event, index, this)) return event;
    return undefined;
  }

  findLast(predicate) {
    for (let index = this.length - 1; index >= 0; index -= 1) {
      const event = this.at(index);
      if (predicate(event, index, this)) return event;
    }
    return undefined;
  }

  some(predicate) { return this.findIndex(predicate) !== -1; }
  every(predicate) { return this.findIndex((event, index) => !predicate(event, index, this)) === -1; }

  filter(predicate) {
    const selected = [];
    for (const [index, event] of this.entries()) if (predicate(event, index, this)) selected.push(event);
    return selected;
  }

  map(project) {
    const values = [];
    for (const [index, event] of this.entries()) values.push(project(event, index, this));
    return values;
  }
}

export function isLedgerEventCollection(events) {
  return Array.isArray(events) || collections.has(events);
}

export function ledgerEventAt(events, index) {
  return Array.isArray(events) ? events[index] : (Number.isSafeInteger(index) && index >= 0 ? events.at(index) : undefined);
}

/** Preserve strict Array identity; decoded collections prove private source position. */
export function ledgerEventAtIs(events, index, event) {
  if (Array.isArray(events)) return events[index] === event;
  return Number.isSafeInteger(index) && index >= 0 && index < events.length && events.indexOf(event) === index;
}

/** Typed selection preserves canonical source positions without retaining selected payload arrays. */
export function* ledgerEntriesOfTypes(events, types) {
  if (!Array.isArray(events)) { yield* events.entriesOfTypes(types); return; }
  const selected = new Set(types);
  for (const [index, event] of events.entries()) if (selected.has(event.event)) yield [index, event];
}

export function* ledgerEventsOfTypes(events, types) {
  for (const [, event] of ledgerEntriesOfTypes(events, types)) yield event;
}

export function ledgerTypeSummary(events, type) {
  let count = 0;
  let first;
  let latest;
  for (const event of ledgerEventsOfTypes(events, [type])) {
    if (!count) first = event;
    latest = event;
    count += 1;
  }
  return { count, first, latest };
}
