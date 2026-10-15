/**
 * Main-process import surface for the shared audit contract.
 *
 * Keeping this re-export beside the audit services makes the boundary explicit
 * without creating a second, divergent set of audit models.
 */
export * from '@shared/audit';
