import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const FORGELOOP_PACKAGE = '@cassiomc1/forgeloop';
const CURRENT_DOCS = [
  'README.md',
  'FORGELOOP_AUDIT_IMPLEMENTATION_SPEC.md',
  'demo/README.md',
  'schemas/README.md',
  'vendor/README.md',
  'screen/README.md',
  'docs/README.md',
  'docs/DEPENDENCY_POLICY.md',
  'docs/IMPLEMENTATION_CHECKLIST.md',
  'docs/PROTOCOL_COMPATIBILITY.md',
  'docs/QUALITY_GATES.md',
  'docs/RELEASE_MODEL.md',
  'docs/TROUBLESHOOTING.md',
  'docs/UI_DESIGN_DIRECTION.md',
  'docs/migration/WEB_IMPLEMENTATION_REPORT.md',
];
const HISTORICAL_DIRS = ['docs/superpowers', 'docs/verification'];
const STALE_ACTIVE_RELEASE = /\bRC[0-9]+\b/iu;
const STALE_FORGELOOP_FACTS = /\b1\.6\.1\b|f331100cff[a-f0-9]*/iu;
// Retired ForgeLoop baselines must never reappear in current documentation.
// Historical records (docs/superpowers, docs/verification) are excluded and
// must carry the explicit "Historical record." marker.
const STALE_ACTIVE_FORGELOOP_BASELINE = /\b1\.11\.1\b|674f12c006b3ace12278f109b7ae24f57012d09c|\b1\.13\.0\b|4fbc9f1463c66f0250f46cb76bc4d0c389c8c83c/iu;

function fail(message) {
  throw new Error(`Documentation conformance failed: ${message}`);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function readText(root, file) {
  const path = join(root, file);
  assertCondition(existsSync(path), `${file} is missing`);
  return readFileSync(path, 'utf8');
}

function readJson(root, file) {
  try {
    return JSON.parse(readText(root, file));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
}

function normalizeHeading(text) {
  return text.replace(/[`*_~]/gu, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function validateHeadings(file, content) {
  const headings = [];
  for (const match of content.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)) {
    headings.push({ level: match[1].length, title: normalizeHeading(match[2]) });
  }
  assertCondition(headings.filter((heading) => heading.level === 1).length >= 1, `${file} must have at least one H1`);
  const seen = new Set();
  for (const heading of headings) {
    const key = `${heading.level}:${heading.title}`;
    assertCondition(!seen.has(key), `${file} has a duplicate heading: ${heading.title}`);
    seen.add(key);
  }
}

function isExternalReference(reference) {
  return /^(?:https?:|mailto:|tel:|data:|#)/iu.test(reference);
}

function isWithinRoot(rootPath, targetPath) {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === '' || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function validateLocalReferences(root, file, content) {
  const references = [];
  for (const match of content.matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))/gu)) {
    references.push(match[1] || match[2]);
  }
  for (const match of content.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/giu)) references.push(match[1]);

  const filePath = join(root, file);
  const fileDirectory = dirname(filePath);
  const rootPath = resolve(root);
  for (const rawReference of references) {
    if (!rawReference || isExternalReference(rawReference)) continue;
    const reference = rawReference.split(/[?#]/u, 1)[0];
    if (!reference) continue;
    assertCondition(!reference.startsWith('/') && !/^[A-Z]:[\\/]/iu.test(reference), `${file} contains an absolute reference: ${rawReference}`);
    const target = resolve(fileDirectory, reference);
    assertCondition(isWithinRoot(rootPath, target), `${file} reference escapes the repository: ${rawReference}`);
    assertCondition(existsSync(target), `${file} references a missing local path: ${rawReference}`);
  }
}

function referencedNpmScripts(contents, packageJson) {
  const scripts = new Set(Object.keys(packageJson.scripts || {}));
  for (const content of contents) {
    for (const match of content.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/gu)) {
      const script = match[1];
      assertCondition(scripts.has(script), `documentation references missing npm script: ${script}`);
    }
  }
}

function listMarkdownFiles(root, directory) {
  const directoryPath = join(root, directory);
  if (!existsSync(directoryPath)) return [];
  const files = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    const entryName = relative(root, entryPath);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(root, entryName));
    else if (entry.isFile() && extname(entry.name).toLocaleLowerCase('en-US') === '.md') files.push(entryName);
  }
  return files;
}

function validateHistoricalRecords(root) {
  for (const directory of HISTORICAL_DIRS) {
    for (const file of listMarkdownFiles(root, directory)) {
      assertCondition(readText(root, file).includes('Historical record.'), `${file} must be marked as a Historical record`);
    }
  }
}

function validateLineage(root) {
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'verify-forgeloop-vendor-lineage.mjs')], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    fail(`ForgeLoop vendor lineage verification failed${detail ? `: ${detail}` : ''}`);
  }
}

function validateCurrentFacts(root, packageJson, provenance, archiveName, archiveSha256) {
  const version = provenance.forgeLoopPackageVersion;
  const commit = provenance.forgeLoopGitCommit;
  const current = Object.fromEntries(CURRENT_DOCS.map((file) => [file, readText(root, file)]));
  const currentText = Object.values(current).join('\n');

  assertCondition(packageJson.version === '0.3.0-rc.3', `package.json version must remain 0.3.0-rc.3, got ${packageJson.version}`);
  assertCondition(version === '2.0.0', `schema provenance must pin ForgeLoop 2.0.0, got ${version}`);
  assertCondition(typeof commit === 'string' && /^[a-f0-9]{40}$/u.test(commit), 'schema provenance must contain a 40-character ForgeLoop commit');
  assertCondition(provenance.protocolVersion === 1, 'schema provenance must pin protocol v1');
  assertCondition(!STALE_ACTIVE_RELEASE.test(currentText), 'current documentation contains a stale active RC number');
  assertCondition(!STALE_FORGELOOP_FACTS.test(currentText), 'current documentation contains stale ForgeLoop 1.6.1 lineage');
  assertCondition(!STALE_ACTIVE_FORGELOOP_BASELINE.test(currentText), 'current documentation contains the retired ForgeLoop 1.11.1 baseline');

  const required = {
    'README.md': [
      `v${packageJson.version}`,
      `ForgeLoop \`${version}\``,
      commit,
      'protocol v1',
      'schema v1',
      'Integration API v1',
      'read-only',
      'unsigned',
      'exactly-once',
      'operational receipt',
      'advisory context',
      'Flutter',
      'selected guide IDs',
    ],
    'FORGELOOP_AUDIT_IMPLEMENTATION_SPEC.md': [
      `ForgeLoop \`${version}\``,
      commit,
      'protocol v1',
      'schema v1',
      'Integration API v1',
      'Current implementation and design reference',
      'canonicalHandoffs v2',
      'advisoryContextProviders v1',
      'does not reimplement detection',
    ],
    'docs/PROTOCOL_COMPATIBILITY.md': [
      `ForgeLoop **${version}**`,
      commit,
      'protocol v1',
      'schema v1',
      'Integration API v1',
      'task/workspace-binding',
      'task/handoffs',
      'task/responsibility',
      'task/verification-scope',
      'task/attestation',
      'canonicalHandoffs v2',
      'advisoryContextProviders v1',
      'selectedGuideIds',
      'not evidence',
    ],
    'docs/RELEASE_MODEL.md': ['unsigned preview', 'release-matrix.json', 'SBOM-cyclonedx.json', 'tag-triggered workflow', '2.0.0', 'Flutter'],
    'docs/QUALITY_GATES.md': ['npm run verify:full', 'Ubuntu', 'macOS', 'Windows', 'CodeQL', '2.0.0'],
    'docs/IMPLEMENTATION_CHECKLIST.md': ['Current Implementation and Verification Matrix', '[x]', '[~]', '[-]', 'TASK-006', 'flutter'],
    'docs/README.md': ['Current documentation owners', 'Historical records', 'Trust boundary', '2.0.0', 'flutter'],
    'schemas/README.md': [`ForgeLoop \`${version}\``, commit, 'protocol v1', 'npm run protocol:schemas:verify', 'Schema v1'],
    'vendor/README.md': [archiveName, commit, archiveSha256, 'npm run verify:forgeloop-lineage', 'flutter'],
    'screen/README.md': ['npm run screenshots:readme', 'npm run screenshots:check', 'ForgeShop', '1440 × 900', '2.0.0'],
    'demo/README.md': ['ForgeShop', 'TASK-001', 'TASK-006', 'npm run demo:verify'],
    'docs/UI_DESIGN_DIRECTION.md': ['Current navigation and trust surfaces', 'Task Boundaries', 'Verification Scope', 'Attestation'],
    'docs/TROUBLESHOOTING.md': ['INTEGRATION_V1', 'COMMIT_UNKNOWN', 'UNAVAILABLE', 'Workspace binding'],
    'docs/DEPENDENCY_POLICY.md': ['npm run dependency:policy', 'npm run audit:prod', 'npm run verify:forgeloop-lineage'],
    'docs/migration/WEB_IMPLEMENTATION_REPORT.md': ['web migration report', '0.3.0-rc.3', '1.12.0', 'flutter', 'loopback', 'Discovery only'],
  };
  for (const [file, facts] of Object.entries(required)) {
    for (const fact of facts) assertCondition(current[file].includes(fact), `${file} is missing current fact: ${fact}`);
  }

  for (const [file, content] of Object.entries(current)) {
    validateHeadings(file, content);
    validateLocalReferences(root, file, content);
  }
  referencedNpmScripts(Object.values(current), packageJson);
  validateHistoricalRecords(root);
}

export function runDocConformance(root = process.cwd(), { validateLineage: shouldValidateLineage = true } = {}) {
  const packageJson = readJson(root, 'package.json');
  const provenance = readJson(root, 'schemas/provenance.json');
  const dependency = packageJson.dependencies?.[FORGELOOP_PACKAGE];
  assertCondition(typeof dependency === 'string' && dependency.startsWith('file:'), `${FORGELOOP_PACKAGE} must remain a local file dependency`);
  const rootPath = resolve(root);
  const archivePath = resolve(rootPath, dependency.slice('file:'.length));
  assertCondition(isWithinRoot(rootPath, archivePath) && archivePath !== rootPath, 'vendored ForgeLoop dependency escapes the repository');
  assertCondition(existsSync(archivePath), `vendored ForgeLoop archive is missing: ${dependency}`);
  const archiveName = basename(archivePath);
  const archiveSha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  if (shouldValidateLineage) validateLineage(root);
  validateCurrentFacts(root, packageJson, provenance, archiveName, archiveSha256);
  return { version: packageJson.version, forgeLoopVersion: provenance.forgeLoopPackageVersion, documents: CURRENT_DOCS.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runDocConformance();
  console.log(`Documentation conformance verified for ${result.version}; ${result.documents} current documents and historical markers checked.`);
}
