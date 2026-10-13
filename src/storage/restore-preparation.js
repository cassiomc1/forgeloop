import { randomUUID } from "node:crypto";
import { link, mkdir, open, rename, unlink } from "node:fs/promises";
import { assertSafePath, writeFileAtomic } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { JSON_LIMITS } from "../core/json-safety.js";
import { readStorageMetadataJson } from "./metadata-json.js";
import { backupProjectStorage, withVerifiedProjectStorageBackup } from "./project-backup.js";
import { assertOwnedStorageMaintenance } from "./maintenance.js";
import { restorePathExists } from "./restore-layout.js";

const invalid = message => Object.assign(new Error(message), { code: "E_STORAGE_RESTORE_INVALID" });

async function retainCompletedIntent(root, journal) {
  const directory = await assertSafePath(root, "snapshot-intents");
  await mkdir(directory, { recursive: true });
  const relative = `snapshot-intents/${journal.rebuild.historyId}.json`;
  const filename = await assertSafePath(root, relative);
  const record = { schemaVersion: 1, kind: "RESTORE_REBUILD_INTENT", operationId: journal.operationId,
    sourceFingerprint: journal.sourceFingerprint, intent: journal.rebuild };
  const temporary = await assertSafePath(root, `snapshot-intents/.publishing-${randomUUID()}.json`);
  await writeFileAtomic(temporary, `${JSON.stringify(record, null, 2)}\n`);
  try {
    try { await link(temporary, filename); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readStorageMetadataJson(root, relative, { limits: JSON_LIMITS });
      if (canonicalFingerprint(existing) !== canonicalFingerprint(record)) throw invalid("Retained restore intent differs from the completed cycle");
    }
  } finally { await unlink(temporary); }
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"].includes(error.code)) throw error; }
}

/** Retain an interrupted initial snapshot before rebuilding from bound source. */
export async function ensurePreparedRestoreSnapshot(target, root, journal, { journalFilename = "restore-journal.json" } = {}) {
  if (!["restore-journal.json", "replacement-intent.json"].includes(journalFilename)) throw invalid("Unsupported snapshot preparation journal");
  return withVerifiedProjectStorageBackup(journal.source, async source => {
    if (canonicalFingerprint(source.manifest) !== journal.sourceFingerprint) throw invalid("Restore source differs from its recorded preparation");
    const snapshot = await assertSafePath(root, "snapshot");
    const journalPath = await assertSafePath(root, journalFilename);
    const persist = async () => {
      await assertOwnedStorageMaintenance(target);
      return writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    };
    const manifest = await restorePathExists(root, "snapshot")
      ? await readStorageMetadataJson(snapshot, "backup-manifest.json", { limits: JSON_LIMITS, optional: true }) : null;
    if (manifest?.status === "READY" && !journal.rebuild) return;
    if (!journal.rebuild) {
      if (manifest && !["PREPARING", "FAILED"].includes(manifest.status)) throw invalid("Unrecognized incomplete restore snapshot");
      journal.rebuild = { historyId: randomUUID(), retainSnapshot: await restorePathExists(root, "snapshot"), phase: "RETAINING" };
      await persist();
    }
    const intent = journal.rebuild;
    const history = await assertSafePath(root, `snapshot-history/${intent.historyId}`);
    if (intent.phase === "RETAINING") {
      await assertOwnedStorageMaintenance(target);
      const present = await restorePathExists(root, "snapshot");
      const retained = await restorePathExists(root, `snapshot-history/${intent.historyId}`);
      if (intent.retainSnapshot) {
        if (present === retained) throw invalid("Restore snapshot retention has ambiguous membership");
        if (present) { await mkdir(await assertSafePath(root, "snapshot-history"), { recursive: true }); await rename(snapshot, history); }
      } else if (present || retained) throw invalid("Restore snapshot allocation intent disagrees with retained state");
      intent.phase = "RETAINED";
      await persist();
    }
    if (intent.retainSnapshot && !await restorePathExists(root, `snapshot-history/${intent.historyId}`)) throw invalid("Restore snapshot history is missing");
    if (await restorePathExists(root, "snapshot")) {
      const rebuilt = await readStorageMetadataJson(snapshot, "backup-manifest.json", { limits: JSON_LIMITS, optional: true });
      if (rebuilt?.status !== "READY") {
        if (rebuilt && !["PREPARING", "FAILED"].includes(rebuilt.status)) throw invalid("Unrecognized interrupted replacement snapshot");
        await assertOwnedStorageMaintenance(target);
        await retainCompletedIntent(root, journal);
        journal.rebuild = { historyId: randomUUID(), retainSnapshot: true, phase: "RETAINING" };
        await persist();
        return ensurePreparedRestoreSnapshot(target, root, journal, { journalFilename });
      }
      return;
    }
    await assertOwnedStorageMaintenance(target);
    await backupProjectStorage(source.db, source.root, snapshot);
  });
}
