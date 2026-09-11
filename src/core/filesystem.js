import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const WINDOWS_TRANSIENT_RETRY_DELAYS_MS = Object.freeze([5, 10, 20, 40]);

async function fsCallWithTransientWindowsRetry(fsImpl, filePath, {
  platform = process.platform,
  retryDelaysMs = WINDOWS_TRANSIENT_RETRY_DELAYS_MS,
  delayImpl = delay,
} = {}) {
  let retryIndex = 0;
  while (true) {
    try {
      return await fsImpl(filePath);
    } catch (error) {
      const retryable = platform === "win32"
        && (error?.code === "EPERM" || error?.code === "EACCES")
        && retryIndex < retryDelaysMs.length;
      if (!retryable) throw error;
      await delayImpl(retryDelaysMs[retryIndex]);
      retryIndex += 1;
    }
  }
}

export async function realpathWithTransientWindowsRetry(filePath, {
  platform = process.platform,
  retryDelaysMs = WINDOWS_TRANSIENT_RETRY_DELAYS_MS,
  realpathImpl = realpath,
  delayImpl = delay,
} = {}) {
  return fsCallWithTransientWindowsRetry(realpathImpl, filePath, {
    platform,
    retryDelaysMs,
    delayImpl,
  });
}

export function lstatWithTransientWindowsRetry(filePath, {
  platform = process.platform,
  retryDelaysMs = WINDOWS_TRANSIENT_RETRY_DELAYS_MS,
  lstatImpl = lstat,
  delayImpl = delay,
} = {}) {
  return fsCallWithTransientWindowsRetry(lstatImpl, filePath, {
    platform,
    retryDelaysMs,
    delayImpl,
  });
}

export function ensureWithin(root, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Path must remain inside target directory: ${relativePath}`);
  }

  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Path escapes target directory: ${relativePath}`);
  }

  return path.join(root, normalized);
}

function normalizeWindowsPathForComparison(value) {
  const lowerValue = value.toLowerCase();
  let normalized = value;
  if (lowerValue.startsWith("\\\\?\\unc\\")) {
    normalized = `\\\\${value.slice(8)}`;
  } else if (lowerValue.startsWith("\\\\.\\unc\\")) {
    normalized = `\\\\${value.slice(8)}`;
  } else if (lowerValue.startsWith("\\\\?\\")) {
    normalized = value.slice(4);
  } else if (lowerValue.startsWith("\\\\.\\")) {
    normalized = value.slice(4);
  }
  return path.win32.normalize(normalized).toLowerCase();
}

export function isPathWithin(root, candidate, { platform = process.platform } = {}) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalizeForComparison = (value) => {
    return platform === "win32"
      ? normalizeWindowsPathForComparison(value)
      : pathApi.normalize(value);
  };
  const relative = pathApi.relative(
    normalizeForComparison(root),
    normalizeForComparison(candidate),
  );
  return relative === ""
    || (relative !== ".."
      && !relative.startsWith(`..${pathApi.sep}`)
      && !pathApi.isAbsolute(relative));
}

export async function assertSafePath(root, relativePath) {
  const destination = ensureWithin(root, relativePath);
  const absoluteRoot = path.resolve(root);
  const rootInfo = await lstatWithTransientWindowsRetry(absoluteRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(`Target directory must not be a symlink: ${absoluteRoot}`);
  }

  let current = absoluteRoot;
  const segments = path.relative(absoluteRoot, destination).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const info = await lstatWithTransientWindowsRetry(current);
      if (info.isSymbolicLink()) {
        throw new Error(`Path uses a symlink inside target directory: ${relativePath}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }

  let existing = destination;
  while (true) {
    try {
      const info = await lstatWithTransientWindowsRetry(existing);
      if (info.isSymbolicLink()) {
        throw new Error(`Path uses a symlink inside target directory: ${relativePath}`);
      }
      const resolvedRoot = await realpathWithTransientWindowsRetry(absoluteRoot);
      const resolvedExisting = await realpathWithTransientWindowsRetry(existing);
      if (!isPathWithin(resolvedRoot, resolvedExisting)) {
        throw new Error(`Path escapes target directory: ${relativePath}`);
      }
      return destination;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error(`Path does not resolve inside target directory: ${relativePath}`);
      existing = parent;
    }
  }
}

export async function resolveTarget(cwd, requestedPath = ".") {
  const target = path.resolve(cwd, requestedPath);
  let targetStat;
  try {
    targetStat = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Target directory does not exist: ${target}`);
    }
    throw error;
  }

  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error(`Target path is not a directory: ${target}`);
  }

  return target;
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readBytes(filePath) {
  return readFile(filePath);
}

export async function writeFileAtomic(filePath, bytes, { dryRun = false } = {}) {
  if (dryRun) return;

  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  let temporaryHandle;
  try {
    // A rename alone is atomic but does not guarantee that staged bytes have
    // reached stable storage. Sync the temporary file before publishing it;
    // directory sync is best-effort because Windows and some filesystems do
    // not permit opening a directory for fsync.
    temporaryHandle = await open(temporaryPath, "w", 0o644);
    await temporaryHandle.writeFile(bytes);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await rename(temporaryPath, filePath);
    try {
      const directoryHandle = await open(path.dirname(filePath), "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "UNKNOWN"].includes(error.code)) throw error;
    }
  } catch (error) {
    if (temporaryHandle) {
      try { await temporaryHandle.close(); } catch { /* preserve original error */ }
    }
    try {
      await unlink(temporaryPath);
    } catch {
      // Preserve the original filesystem error.
    }
    throw error;
  }
}
