import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative, resolve } from 'node:path';

export const historicalRoots = Object.freeze([
  'docs/superpowers/plans/',
  'docs/superpowers/specs/',
  'docs/verification/',
]);

const ignoredDirectories = new Set([
  '.git',
  '.worktrees',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
]);

const legacyReferences = Object.freeze([
  ['ForgeLoop', ' Studio'].join(''),
  ['ForgeLoop', 'Studio'].join(''),
  ['forgeloop', '-studio'].join(''),
  ['com.forgeloop', '.studio'].join(''),
  ['forgeLoop', 'Studio'].join(''),
  ['STUDIO', '_'].join(''),
]);

function isHistorical(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return historicalRoots.some((root) => normalized.startsWith(root));
}

function listFiles(root, directory = root) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...listFiles(root, path));
      continue;
    }
    if (entry.name === '.git') continue;
    if (!entry.isFile() || extname(entry.name).toLowerCase() === '.png' || extname(entry.name).toLowerCase() === '.ico' || extname(entry.name).toLowerCase() === '.icns') continue;
    files.push(path);
  }
  return files;
}

export function findBrandViolations(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const violations = [];
  let filesChecked = 0;
  for (const path of listFiles(resolvedRoot)) {
    const relativePath = relative(resolvedRoot, path).replaceAll('\\', '/');
    if (isHistorical(relativePath)) continue;
    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    filesChecked += 1;
    const matches = legacyReferences.filter((reference) => content.includes(reference));
    if (matches.length > 0) violations.push({ file: relativePath, matches });
  }
  return { filesChecked, violations };
}

export function runBrandConformance(root = process.cwd()) {
  const result = findBrandViolations(root);
  if (result.violations.length > 0) {
    const details = result.violations
      .map(({ file, matches }) => `${file}: ${matches.join(', ')}`)
      .join('\n');
    throw new Error(`Brand conformance failed:\n${details}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runBrandConformance();
  console.log(`Brand conformance verified: ${result.filesChecked} active files checked; historical exceptions are path-scoped.`);
}
