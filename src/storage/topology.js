import { statfsSync } from "node:fs";
import path from "node:path";

// Linux UAPI magic.h identifies these network/shared filesystems. This is a
// deny-list of known unsupported topology, not certification of every other FS.
const NETWORK_TYPES = new Map([
  [0x6969n, "NFS"], [0x517bn, "SMB"], [0xff534d42n, "CIFS"], [0xfe534d42n, "SMB2"],
  [0x5346414fn, "AFS"], [0x6b414653n, "AFS"], [0x73757245n, "Coda"],
  [0x00c36400n, "Ceph"], [0x01021997n, "9P"],
]);

function unsupported(kind) {
  return Object.assign(new Error(`SQLite WAL storage requires a supported local filesystem; ${kind} topology is unsupported`), { code: "E_STORAGE_TOPOLOGY_UNSUPPORTED" });
}

export function assertStorageTopologyName(databasePath, platform, filesystemType = null) {
  const filename = String(databasePath).replaceAll("\\", "/");
  if (platform === "win32" && (/^\/\/[^?./]/.test(filename) || /^\/\/[?.]\/UNC\//i.test(filename))) throw unsupported("UNC network share");
  if (platform === "linux" && filesystemType !== null) {
    const kind = NETWORK_TYPES.get(BigInt.asUintN(32, BigInt(filesystemType)));
    if (kind) throw unsupported(kind);
  }
}

/** Inspect an existing ancestor before SQLite creates a database or sidecars. */
export function assertStorageTopology(databasePath) {
  assertStorageTopologyName(databasePath, process.platform);
  if (databasePath === ":memory:" || process.platform !== "linux") return;
  let candidate = path.resolve(databasePath);
  for (;;) {
    try {
      const filesystem = statfsSync(candidate, { bigint: true });
      assertStorageTopologyName(databasePath, process.platform, filesystem.type);
      return;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}
