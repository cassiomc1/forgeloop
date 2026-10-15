import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CartStore } from '../src/cart';
import type { Product } from '../src/catalog';

const product: Product = { id: 'p1', name: 'Field Headphones', category: 'audio', price: 289 };

test('adds and merges lines', () => {
  const store = new CartStore();
  store.add(product);
  store.add(product, 2);
  assert.equal(store.lines().length, 1);
  assert.equal(store.lines()[0]?.quantity, 3);
});

test('survives a serialize/hydrate round trip', () => {
  const store = new CartStore();
  store.add(product, 2);
  const restored = new CartStore();
  restored.hydrate(store.serialize());
  assert.deepEqual(restored.lines(), [{ productId: 'p1', quantity: 2 }]);
});

test('discards corrupted payloads instead of throwing', () => {
  const store = new CartStore();
  store.hydrate('{"version":9,"lines":"nope"}');
  assert.equal(store.lines().length, 0);
});
