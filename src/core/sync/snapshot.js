import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// Cloud-sync snapshots: an attachment-inclusive storage backup directory,
// packed into JSON, gzipped and encrypted on the client with AES-256-GCM. The
// key is derived with scrypt from FORGELOOP_SYNC_KEY and never leaves this
// machine; the repository name is authenticated as associated data, so a
// snapshot cannot be replayed under another repository.

export const SNAPSHOT_KIND = "forgeloop-sync-snapshot";
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MIN_PASSPHRASE_LENGTH = 16;
const SCRYPT = Object.freeze({ N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/u;

export function syncError(code, message) {
  return Object.assign(new Error(message), { code });
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Relative POSIX paths only: no absolute paths, no "." or ".." segments.
export function isSafeSnapshotPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  return value.split("/").every((segment) => SAFE_SEGMENT.test(segment) && segment !== "." && segment !== "..");
}

async function listFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw syncError("E_SYNC_SNAPSHOT_INVALID", `Backup contains an unsupported entry: ${child}`);
  }
  return files;
}

export async function packDirectory(directory) {
  const files = [];
  for (const name of await listFiles(directory)) {
    if (!isSafeSnapshotPath(name)) throw syncError("E_SYNC_SNAPSHOT_INVALID", `Backup contains an unsafe path: ${name}`);
    const bytes = await readFile(path.join(directory, name));
    files.push({ path: name, sha256: sha256(bytes), data: bytes.toString("base64") });
  }
  return { schemaVersion: 1, files };
}

export async function unpackDirectory(payload, directory) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.files) || payload.files.length === 0) {
    throw syncError("E_SYNC_SNAPSHOT_INVALID", "Snapshot payload has no files");
  }
  const seen = new Set();
  for (const file of payload.files) {
    if (!isSafeSnapshotPath(file?.path) || seen.has(file.path)) throw syncError("E_SYNC_SNAPSHOT_INVALID", "Snapshot payload has an unsafe or duplicate path");
    seen.add(file.path);
    const bytes = Buffer.from(String(file.data ?? ""), "base64");
    if (sha256(bytes) !== file.sha256) throw syncError("E_SYNC_SNAPSHOT_INVALID", `Snapshot file digest mismatch: ${file.path}`);
    const destination = path.join(directory, ...file.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  return [...seen];
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, SCRYPT);
}

export function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw syncError("E_SYNC_CONFIG", `FORGELOOP_SYNC_KEY must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
}

export function sealSnapshot(payload, { passphrase, repository, forgeloopVersion = null, now = new Date() }) {
  assertPassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  cipher.setAAD(Buffer.from(repository, "utf8"));
  const data = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload), "utf8"))), cipher.final()]);
  const envelope = {
    schemaVersion: 1,
    kind: SNAPSHOT_KIND,
    repository,
    createdAt: now.toISOString(),
    forgeloopVersion,
    cipher: {
      alg: "aes-256-gcm",
      kdf: "scrypt",
      kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    },
  };
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  if (body.length > MAX_SNAPSHOT_BYTES) throw syncError("E_SYNC_TOO_LARGE", `Encrypted snapshot is ${body.length} bytes; the limit is ${MAX_SNAPSHOT_BYTES}`);
  return body;
}

export function openSnapshot(body, { passphrase, repository }) {
  assertPassphrase(passphrase);
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw syncError("E_SYNC_SNAPSHOT_INVALID", "Remote snapshot is not valid JSON");
  }
  const cipher = envelope?.cipher;
  if (envelope?.schemaVersion !== 1 || envelope.kind !== SNAPSHOT_KIND || cipher?.alg !== "aes-256-gcm" || cipher.kdf !== "scrypt") {
    throw syncError("E_SYNC_SNAPSHOT_INVALID", "Remote snapshot has an unsupported format");
  }
  if (String(envelope.repository).toLowerCase() !== repository) throw syncError("E_SYNC_SNAPSHOT_INVALID", "Remote snapshot belongs to another repository");
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, Buffer.from(cipher.salt, "base64")), Buffer.from(cipher.iv, "base64"));
    decipher.setAAD(Buffer.from(repository, "utf8"));
    decipher.setAuthTag(Buffer.from(cipher.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(cipher.data, "base64")), decipher.final()]);
    return { envelope, payload: JSON.parse(gunzipSync(plain).toString("utf8")) };
  } catch {
    throw syncError("E_SYNC_SNAPSHOT_INVALID", "Remote snapshot could not be decrypted: wrong FORGELOOP_SYNC_KEY or tampered data");
  }
}
