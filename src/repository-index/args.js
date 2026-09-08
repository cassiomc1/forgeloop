import { REPOSITORY_INDEX_DEFAULTS } from "./constants.js";

function pushPair(args, flag, value) {
  args.push(flag, String(value));
}

export function getCanonicalRepositoryIndexArgs({ mode, indexPath, config = {} } = {}) {
  if (!["index", "serve", "search", "status"].includes(mode)) {
    throw new Error(`Unknown Repository Index command mode: ${mode}`);
  }
  if (typeof indexPath !== "string" || indexPath.trim() === "") {
    throw new Error("Repository Index indexPath is required");
  }

  const effective = {
    ...REPOSITORY_INDEX_DEFAULTS,
    ...config,
  };
  const args = [];
  pushPair(args, "--index-path", indexPath);
  pushPair(args, "--max-filesize", effective.maxFileSize);
  if (["index", "serve"].includes(mode)) {
    args.push("--exclude", ".forgeloop/repository-index");
  }
  args.push("--no-require-git");

  if (mode === "index") {
    args.push("--index-strategy", "external");
  }
  if (mode === "serve") {
    pushPair(args, "--max-cpu", effective.maxCpuPercent);
    pushPair(args, "--watcher-queue-cap", effective.watcherQueueCap);
    pushPair(args, "--auto-save-mutations", effective.autoSaveMutations);
  }
  return Object.freeze(args);
}

export function getCanonicalRepositorySearchArgs({ indexPath, pattern, options = {}, config = {} } = {}) {
  const args = ["--regexp", pattern];
  if (options.fixedStrings) args.push("--fixed-strings");
  if (options.ignoreCase) args.push("--ignore-case");
  if (options.smartCase) args.push("--smart-case");
  if (options.wordRegexp) args.push("--word-regexp");
  if (options.context !== undefined && options.context !== null) pushPair(args, "--context", options.context);
  if (options.beforeContext !== undefined && options.beforeContext !== null) pushPair(args, "--before-context", options.beforeContext);
  if (options.afterContext !== undefined && options.afterContext !== null) pushPair(args, "--after-context", options.afterContext);
  if (options.maxCount !== undefined && options.maxCount !== null) pushPair(args, "--max-count", options.maxCount);
  if (options.filesWithMatches) args.push("--files-with-matches");
  if (options.stats) args.push("--stats");
  args.push("--json");
  args.push(...getCanonicalRepositoryIndexArgs({ mode: "search", indexPath, config }));
  return Object.freeze(args);
}

export function appendSearchFilters(args, { globs = [], types = [] } = {}) {
  for (const glob of globs) args.push("--glob", glob);
  for (const type of types) args.push("--type", type);
  return args;
}
