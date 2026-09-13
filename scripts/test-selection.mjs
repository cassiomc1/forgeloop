import { readdir } from "node:fs/promises";
import path from "node:path";

export async function discoverTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !["fixtures", "helpers", "node_modules"].includes(entry.name)) {
      files.push(...await discoverTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(fullPath);
  }
  return files.sort();
}

export function selectTests(files, args, root) {
  const options = [];
  const selectors = [];
  let shard = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--watch" || arg === "--watch-preserve-output") {
      options.push(arg);
    } else if (arg === "--watch-path") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options.push(arg, value);
    } else if (arg === "--shard") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      shard = parseShard(value);
    } else if (/^--shard=\d+\/\d+$/u.test(arg)) {
      shard = parseShard(arg.slice("--shard=".length));
    } else if (/^--test-(name-pattern|skip-pattern|concurrency|timeout)(=|$)/u.test(arg)) {
      options.push(arg);
      if (!arg.includes("=")) {
        const value = args[++index];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
        options.push(value);
      }
    } else if (arg.startsWith("-")) throw new Error(`Unsupported test option: ${arg}`);
    else selectors.push(path.resolve(root, arg));
  }
  const selected = selectors.length === 0 ? files : files.filter((file) => selectors.some((selector) => file === selector || file.startsWith(`${selector}${path.sep}`)));
  for (const selector of selectors) {
    if (!selected.some((file) => file === selector || file.startsWith(`${selector}${path.sep}`))) throw new Error(`No tests match ${selector}`);
  }
  if (selected.length === 0) throw new Error("No test files found");
  const sharded = shard
    ? selected.filter((_, index) => index % shard.total === shard.index - 1)
    : selected;
  if (sharded.length === 0) throw new Error(`Shard ${shard.index}/${shard.total} has no selected test files`);
  return ["--test", ...options, ...sharded];
}

function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || !Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
    throw new Error(`Invalid shard ${value}; expected 1/N through N/N`);
  }
  return { index, total };
}
