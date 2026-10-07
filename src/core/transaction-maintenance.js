/** Retained compatibility refusal; SQLite has no filesystem transaction payloads. */
export async function compactTransactions({ retainDays = 7 } = {}) {
  if (!Number.isFinite(retainDays) || retainDays < 1) throw new Error("retainDays must be at least one day");
  throw Object.assign(new Error("Filesystem transaction compaction is retired; retained migration evidence must not be rewritten"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
}
