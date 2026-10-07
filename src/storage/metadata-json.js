import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { assertSafePath } from "../core/filesystem.js";
import { assertJsonBytes, assertJsonLimits, JSON_LIMITS } from "../core/json-safety.js";

export const STORAGE_CATALOG_LIMITS = Object.freeze({ ...JSON_LIMITS, maxBytes: 64 * 1024 * 1024, maxArrayLength: 500_000 });

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_METADATA_INVALID" }); }

/** Bound allocation before reading, including growth after the initial stat. */
export async function readStorageMetadataJson(root, relative, { limits = STORAGE_CATALOG_LIMITS, optional = false } = {}) {
  const filename = await assertSafePath(root, relative);
  let file;
  try { file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (optional && error.code === "ENOENT") return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile()) throw invalid(`Storage metadata must be a regular file: ${relative}`);
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
