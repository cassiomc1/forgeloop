export type CheckoutError =
  | { kind: 'validation'; field: string }
  | { kind: 'transient'; retryable: true }
  | { kind: 'declined'; reason: string };

export interface CheckoutRequest {
  cartTotalCents: number;
  currency: 'BRL' | 'USD';
}

export function validateRequest(request: CheckoutRequest): CheckoutError | null {
  if (!Number.isInteger(request.cartTotalCents) || request.cartTotalCents <= 0) {
    return { kind: 'validation', field: 'cartTotalCents' };
  }
  return null;
}

export async function submitOrder(request: CheckoutRequest, gateway: (r: CheckoutRequest) => Promise<CheckoutError | null>): Promise<CheckoutError | null> {
  const invalid = validateRequest(request);
  if (invalid) return invalid;
  return gateway(request);
}
