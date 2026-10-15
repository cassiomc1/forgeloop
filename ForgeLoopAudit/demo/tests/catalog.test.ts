import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterProducts, type Product } from '../src/catalog';

const products: Product[] = [
  { id: 'p1', name: 'Field Headphones', category: 'audio', price: 289 },
  { id: 'p2', name: 'Travel Kit', category: 'travel', price: 95 },
  { id: 'p3', name: 'Desk Shelf', category: 'desk', price: 149 },
];

test('filters by category', () => {
  assert.equal(filterProducts(products, { category: 'audio' }).length, 1);
});

test('filters by maximum price', () => {
  assert.equal(filterProducts(products, { maxPrice: 150 }).length, 2);
});

test('combines filters', () => {
  assert.deepEqual(filterProducts(products, { category: 'desk', maxPrice: 100 }), []);
});
