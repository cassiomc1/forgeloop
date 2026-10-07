import { assertSafePath } from "../core/filesystem.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { LEGACY_SOURCE_ROOTS, inventoryLegacyArchiveLayout, inventoryLegacySourceLayout, verifyLegacySourceCapture } from "./migration-source.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_MIGRATION_ARCHIVE_INVALID" }); }

function subset(inventory, root) {
  const matches = name => name === root || name.startsWith(`${root}/`);
  return { files: inventory.files.filter(file => matches(file.path)), directories: inventory.directories.filter(matches) };
}

function present(inventory) { return inventory.files.length > 0 || inventory.directories.length > 0; }

function assertAttachmentGrowth(root, original, active, archived, signatureObjects, allowAttachmentGrowth) {
  if (present(archived)) throw invalid("Published attachment objects must remain active");
  const originalFiles = new Map(original.files.map(file => [file.path, file]));
  const activeFiles = new Map(active.files.map(file => [file.path, file]));
  for (const file of original.files) {
    if (canonicalFingerprint(activeFiles.get(file.path) ?? null) !== canonicalFingerprint(file)) throw invalid("Captured attachment bytes were lost or changed");
  }
  for (const file of active.files) {
    if (originalFiles.has(file.path)) continue;
    const match = /^\.forgeloop\/attachments\/objects\/([a-f0-9]{64})$/.exec(file.path);
    if (!match || match[1] !== file.sha256) throw invalid("New attachment object path disagrees with immutable bytes");
    if (!allowAttachmentGrowth && signatureObjects.get(file.sha256) !== file.size) throw invalid("Pending attachment growth has no captured signature binding");
  }
  if (original.directories.some(directory => !active.directories.includes(directory))
    || active.directories.some(directory => !original.directories.includes(directory)
      && ![root, `${root}/objects`].includes(directory))) throw invalid("Attachment directory membership is invalid");
}

/** Verify crash-time source location from bytes/membership, never journal claims. */
export async function inspectMigrationSourcePartition(target, destination, { allowAttachmentGrowth = false, allowSignatureObjectGrowth = false } = {}) {
  const captured = await verifyLegacySourceCapture(target, destination);
  const archive = await assertSafePath(captured.path, "publication/legacy-archive");
  const activeInventory = await inventoryLegacySourceLayout(target);
  const archiveInventory = await inventoryLegacyArchiveLayout(archive);
  const expected = { files: captured.manifest.files, directories: captured.manifest.directories };
  const signatureObjects = new Map(expected.files.filter(file => /^\.forgeloop\/task-state\/[a-f0-9]{64}\/attestations\/(?:history\/cycle-[1-9][0-9]*\/)?statement\.sigstore\.json$/u.test(file.path)).map(file => [file.sha256, file.size]));
  const roots = [];
  for (const root of LEGACY_SOURCE_ROOTS) {
    const original = subset(expected, root);
    const active = subset(activeInventory, root);
    const archived = subset(archiveInventory, root);
    if ((allowAttachmentGrowth || allowSignatureObjectGrowth) && root === ".forgeloop/attachments") {
      assertAttachmentGrowth(root, original, active, archived, signatureObjects, allowAttachmentGrowth);
      roots.push({ path: root, location: present(active) ? "ACTIVE" : "ABSENT" });
      continue;
    }
    if (present(active) && present(archived)) throw invalid(`Source exists in both active and archived locations: ${root}`);
    const actual = present(active) ? active : archived;
    if (canonicalFingerprint(actual) !== canonicalFingerprint(original)) throw invalid(`Source membership or bytes differ from retained capture: ${root}`);
    roots.push({ path: root, location: present(active) ? "ACTIVE" : present(archived) ? "ARCHIVED" : "ABSENT" });
  }
  return { archive, sourceInventoryFingerprint: canonicalFingerprint(expected), roots };
}
