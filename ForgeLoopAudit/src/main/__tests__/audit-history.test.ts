import { describe, expect, it } from 'vitest';
import { retainAuditSnapshots } from '@main/core/audit/audit-snapshot-store';

describe('audit history retention', () => {
  it('keeps the newest configured snapshots and never mutates the input', () => {
    const snapshots = [1, 2, 3].map((number) => ({ id: String(number), generatedAt: `2026-01-0${number}T00:00:00.000Z` }));
    const retained = retainAuditSnapshots(snapshots, 2);
    expect(retained.map((item) => item.id)).toEqual(['3', '2']);
    expect(snapshots.map((item) => item.id)).toEqual(['1', '2', '3']);
  });
});
