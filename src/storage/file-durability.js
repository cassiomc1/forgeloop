import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

const IGNORABLE_DIRECTORY_SYNC_ERRORS = new Set(["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"]);

// openDirectory defaults to fs.promises.open; tests pass their own handle.
export async function syncDirectory(directory, { catchOpenErrors = true, catchCloseErrors = true, openDirectory = open } = {}) {
  if (catchCloseErrors) {
    try {
      const handle = await openDirectory(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!catchOpenErrors || !IGNORABLE_DIRECTORY_SYNC_ERRORS.has(error.code)) throw error;
    }
    return;
  }
  let handle;
  try {
    handle = await openDirectory(directory, "r");
  } catch (error) {
    if (!catchOpenErrors || !IGNORABLE_DIRECTORY_SYNC_ERRORS.has(error.code)) throw error;
    return;
  }
  try {
    await handle.sync();
  } catch (error) {
    if (!IGNORABLE_DIRECTORY_SYNC_ERRORS.has(error.code)) throw error;
  } finally {
    await handle.close();
  }
}

export async function digestFile(filename, { includeSize = false } = {}) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const bytes of createReadStream(filename)) {
    hash.update(bytes);
    size += bytes.length;
  }
  const sha256 = hash.digest("hex");
  return includeSize ? { size, sha256 } : sha256;
}
