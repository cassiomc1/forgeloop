import { rebuildRepositoryIndex, setupRepositoryIndex, startRepositoryIndexServer, stopRepositoryIndexServer } from "../repository-index/server.js";
import { searchRepository } from "../repository-index/search.js";
import { formatRepositoryIndexStatus, getRepositoryIndexStatus, sanitizeRepositoryIndexStatus } from "../repository-index/status.js";

function sanitizeLifecycleResult(result) {
  const { status, indexed, ...rest } = result ?? {};
  const publicIndexed = indexed && typeof indexed === "object"
    ? Object.fromEntries(Object.entries(indexed).filter(([key]) => !["root_path", "rootPath", "indexPath", "repositoryRoot"].includes(key)))
    : indexed;
  return {
    ...rest,
    ...(status ? { status: sanitizeRepositoryIndexStatus(status) } : {}),
    ...(indexed ? { indexed: publicIndexed } : {}),
  };
}

function nativeOptions(options, packageRoot) {
  return {
    packageRoot,
    assetPath: options.assetPath ?? undefined,
    binaryPath: options.binaryPath ?? undefined,
    homeDirectory: options.homeDirectory ?? undefined,
    force: options.force === true,
    config: options.indexConfig ?? undefined,
  };
}

export async function runRepositoryIndexSetup({ target, packageRoot, options = {} } = {}) {
  const native = nativeOptions(options, packageRoot);
  const result = await setupRepositoryIndex(target, native);
  return sanitizeLifecycleResult({ ...result, status: result.status ?? await getRepositoryIndexStatus(target, { ...native, packageRoot, includeLocalPaths: true }) });
}

export async function runRepositoryIndexStart({ target, packageRoot, options = {} } = {}) {
  const native = nativeOptions(options, packageRoot);
  const result = await startRepositoryIndexServer(target, native);
  return sanitizeLifecycleResult({ ...result, status: result.status ?? await getRepositoryIndexStatus(target, { ...native, packageRoot, includeLocalPaths: true }) });
}

export async function runRepositoryIndexStop({ target, packageRoot, options = {} } = {}) {
  const native = nativeOptions(options, packageRoot);
  const result = await stopRepositoryIndexServer(target, native);
  return sanitizeLifecycleResult({ ...result, status: await getRepositoryIndexStatus(target, { ...native, packageRoot, skipNativeStatus: true }) });
}

export async function runRepositoryIndexStatus({ target, packageRoot, options = {} } = {}) {
  return getRepositoryIndexStatus(target, { ...nativeOptions(options, packageRoot), packageRoot });
}

export async function runRepositoryIndexRebuild({ target, packageRoot, options = {} } = {}) {
  const native = nativeOptions(options, packageRoot);
  const result = await rebuildRepositoryIndex(target, native);
  const status = result.status ?? await getRepositoryIndexStatus(target, { ...native, packageRoot });
  const smoke = await searchRepository(target, {
    ...native,
    pattern: "__FORGELOOP_INDEX_REBUILD_SMOKE__",
    fixedStrings: true,
    maxCount: 1,
  });
  return sanitizeLifecycleResult({
    ...result,
    status: sanitizeRepositoryIndexStatus(status),
    smokeSearch: {
      status: "OK",
      matchCount: smoke.matches.length,
      nativeExitCode: smoke.metrics.exitCode,
    },
  });
}

export async function runSearch({ target, packageRoot, options = {} } = {}) {
  return searchRepository(target, {
    ...options,
    packageRoot,
    pattern: options.pattern,
    globs: options.globs ?? [],
    types: options.types ?? [],
  });
}

export function formatRepositoryIndexResult(result) {
  const status = result.status ?? result;
  const lines = [
    `Repository Index: ${status.health ?? "READY"}`,
    `Engine: ${status.engine ?? "tgrep"} ${status.engineVersion ?? "unknown"}`,
    `Index: ${status.indexPath ?? "unknown"}`,
    `Server: ${status.server?.running ? `running (pid ${status.server.pid ?? "unknown"})` : "not running"}`,
  ];
  if (result.rebuilt) lines.push("Rebuilt: yes");
  if (result.setup) lines.push(`Setup: ${result.rebuilt ? "rebuilt" : "reused"}`);
  if (result.stopped !== undefined) lines.push(`Stopped: ${result.stopped ? "yes" : "no"}`);
  return `${lines.join("\n")}\n`;
}

export function formatSearchResult(result) {
  if (result.query.filesWithMatches) return `${(result.files ?? []).join("\n")}${result.files?.length ? "\n" : "no matches\n"}`;
  const lines = (result.matches ?? []).map((match) => `${match.path}:${match.line}${match.column ? `:${match.column}` : ""}:${match.text}`);
  return `${lines.join("\n")}${lines.length ? "\n" : "no matches\n"}`;
}

export { formatRepositoryIndexStatus };
