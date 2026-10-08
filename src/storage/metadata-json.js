import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { assertSafePath, assertRegularProjectFileIdentity, realpathWithTransientWindowsRetry } from "../core/filesystem.js";
import { assertJsonBytes, assertJsonLimits, JSON_LIMITS } from "../core/json-safety.js";

export const STORAGE_CATALOG_LIMITS = Object.freeze({ ...JSON_LIMITS, maxBytes: 64 * 1024 * 1024, maxArrayLength: 500_000 });

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_METADATA_INVALID" }); }

/** Bound allocation before reading, including growth after the initial stat. */
export async function readStorageMetadataJson(root, relative, { limits = STORAGE_CATALOG_LIMITS, optional = false } = {}) {
  const filename = await assertSafePath(root, relative);
  const resolvedRoot = await realpathWithTransientWindowsRetry(root);
  let observed, file;
  try { observed = await lstat(filename, { bigint: true }); file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (error.code === "ELOOP") throw invalid(`Storage metadata must be a regular file: ${relative}`); if (optional && error.code === "ENOENT") return null; throw error; }
  try {
    const info = await assertRegularProjectFileIdentity(file, filename, observed, resolvedRoot,
      () => invalid(`Storage metadata must retain its admitted project file: ${relative}`));
    assertJsonBytes({ byteLength: info.size }, relative, limits);
    const chunks = [];
    let size = 0;
    for await (const bytes of file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
      size += bytes.length;
      assertJsonBytes({ byteLength: size }, relative, limits);
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks, size);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw invalid(`Storage metadata must be UTF-8: ${relative}`);
    const value = JSON.parse(text);
    assertJsonLimits(value, relative, limits);
    return value;
  } finally { await file.close(); }
}
