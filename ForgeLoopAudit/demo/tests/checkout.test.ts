import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submitOrder, type CheckoutError } from '../src/checkout';

test('rejects non-positive totals without calling the gateway', async () => {
  let called = false;
  const error = await submitOrder({ cartTotalCents: 0, currency: 'USD' }, async () => {
    called = true;
    return null;
  });
  assert.equal(called, false);
  assert.equal(error?.kind, 'validation');
});

test('maps transient gateway failures as retryable', async () => {
  const error: CheckoutError | null = await submitOrder({ cartTotalCents: 4200, currency: 'USD' }, async () => ({
    kind: 'transient',
    retryable: true,
  }));
  assert.deepEqual(error, { kind: 'transient', retryable: true });
});
