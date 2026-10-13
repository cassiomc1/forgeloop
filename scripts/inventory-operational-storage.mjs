import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "integrations/mcp/src", "scripts"];
const directSignals = /\b(?:readJsonArtifact|writeJsonArtifact|readWorkState|writeWorkState|mutateWorkState|readEvents|appendProtocolEvent|taskArtifactPath|taskDirectory|withTaskTransaction|withTaskMutation|discoverTasks|findTaskById|readFile|writeFile|readdir|rename|unlink|readBytes|writeFileAtomic)\b/g;
const files = new Map();
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(?:js|mjs|ts)$/.test(file)) files.set(file, await readFile(file, "utf8"));
  }
}
for (const root of roots) await walk(root);
const records = [...files].map(([file, source]) => {
  const dependencies = [...source.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g)]
    .map(match => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])))
    .filter(dependency => files.has(dependency));
  const signals = source.split("\n").flatMap((line, index) => {
    const matches = [...line.matchAll(directSignals)].map(match => match[0]);
    return matches.length ? [{ line: index + 1, symbols: [...new Set(matches)] }] : [];
  });
  return { file, dependencies: [...new Set(dependencies)].sort(), signals, lines: source.split("\n").length - 1 };
}).sort((a, b) => a.file.localeCompare(b.file));
const byFile = new Map(records.map(record => [record.file, record]));
function reachable(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const dependency of byFile.get(file)?.dependencies ?? []) reachable(dependency, seen);
  return seen;
}
const surfaces = records.filter(record => record.file.startsWith("src/commands/") || record.file.startsWith("integrations/mcp/src/")).map(record => ({
  surface: record.file,
  consumers: [...reachable(record.file)].filter(file => byFile.get(file).signals.length).sort(),
}));
const result = { schemaVersion: 1, scope: roots, method: "Static discovery of relative imports and named persistence/I/O symbols; findings require source review and are not completion evidence.", records: records.filter(record => record.signals.length), surfaces };
const destination = process.argv[2];
if (destination) await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
