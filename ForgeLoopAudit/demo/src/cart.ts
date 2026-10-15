import type { Product } from './catalog';

export interface CartLine {
  productId: string;
  quantity: number;
}

export class CartStore {
  private lines: CartLine[] = [];

  add(product: Product, quantity = 1): void {
    const existing = this.lines.find((line) => line.productId === product.id);
    if (existing) existing.quantity += quantity;
    else this.lines.push({ productId: product.id, quantity });
  }

  lines(): CartLine[] {
    return [...this.lines];
  }

  serialize(): string {
    return JSON.stringify({ version: 1, lines: this.lines });
  }

  hydrate(payload: string | null): void {
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload) as { version?: number; lines?: CartLine[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.lines)) throw new Error('unsupported payload');
      this.lines = parsed.lines.filter((line) => typeof line?.productId === 'string' && Number.isInteger(line?.quantity));
    } catch {
      // Corrupted carts are discarded; see TASK-002 in the demo ledger.
    }
  }
}
