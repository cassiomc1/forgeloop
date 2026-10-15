import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const REQUIRED_FILES = [
  'audit-summary.png',
  'projects.png',
  'kanban.png',
  'timeline.png',
  'findings.png',
  'task-audit.png',
  'evidence.png',
  'quality.png',
  'policy-trust.png',
  'history-diff.png',
  'report.png',
  'diagnostics.png',
  'settings.png',
];

function fail(message) {
  throw new Error(`Screenshot conformance failed: ${message}`);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function readPngDimensions(filePath) {
  const bytes = readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assertCondition(!bytes.subarray(0, 200).toString('utf8').includes('version https://git-lfs.github.com/spec/v1'), `${filePath} is a Git LFS pointer, not a PNG`);
  assertCondition(bytes.subarray(0, 8).equals(signature), `${filePath} is not a PNG`);
  assertCondition(bytes.toString('ascii', 12, 16) === 'IHDR', `${filePath} is missing a PNG IHDR`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function stringValues(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues);
  return [];
}

function extractReadmeImageReferences(readme) {
  const refs = [];
  for (const match of readme.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)) {
    refs.push({ syntax: 'html', path: match[1], alt: '' });
  }
  for (const match of readme.matchAll(/!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)/gu)) {
    refs.push({ syntax: 'markdown', path: match[2] || match[3], alt: match[1] });
  }
  return refs;
}

function normalizeRepositoryRelativePath(reference) {
  const slashPath = reference.replaceAll('\\', '/');
  if (slashPath.startsWith('/') || /^[A-Z]:\//iu.test(slashPath)) return null;
  const segments = [];
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function isScreenPathCandidate(reference) {
  const slashPath = reference.replaceAll('\\', '/').replace(/^\.\/+/, '');
  return slashPath === 'screen' || slashPath.startsWith('screen/');
}

function normalizeScreenReference(reference) {
  const normalized = normalizeRepositoryRelativePath(reference);
  if (!normalized?.startsWith('screen/')) return null;
  return normalized.slice('screen/'.length);
}

export function runScreenshotCheck(root = process.cwd()) {
  const screenDir = join(root, 'screen');
  const manifestPath = join(screenDir, 'manifest.json');
  const readmePath = join(root, 'README.md');
  assertCondition(existsSync(manifestPath), 'screen/manifest.json is missing');
  assertCondition(existsSync(readmePath), 'README.md is missing');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const provenance = JSON.parse(readFileSync(join(root, 'schemas', 'provenance.json'), 'utf8'));
  const entries = manifest.screenshots;

  assertCondition(manifest.manifestVersion === 1, 'manifestVersion must be 1');
  assertCondition(manifest.sourceProject === 'demo', 'sourceProject must be demo');
  assertCondition(manifest.sourceProjectName === 'ForgeShop', 'sourceProjectName must be ForgeShop');
  assertCondition(manifest.auditVersion === packageJson.version, 'manifest ForgeLoopAudit version does not match package.json');
  assertCondition(manifest.forgeLoopVersion === provenance.forgeLoopPackageVersion, 'manifest ForgeLoop version does not match provenance');
  assertCondition(manifest.forgeLoopCommit === provenance.forgeLoopGitCommit, 'manifest ForgeLoop commit does not match provenance');
  assertCondition(manifest.protocolVersion === provenance.protocolVersion, 'manifest protocol version does not match provenance');
  assertCondition(manifest.schemaVersion === 1, 'manifest schemaVersion must be 1');
  assertCondition(manifest.viewport?.width === 1440 && manifest.viewport?.height === 900, 'manifest viewport must be 1440x900');
  assertCondition(manifest.theme === 'dark', 'manifest theme must be dark');
  assertCondition(typeof manifest.captureScript === 'string' && !manifest.captureScript.startsWith('/'), 'captureScript must be repository-relative');

  for (const value of stringValues(manifest)) {
    assertCondition(!value.startsWith('/') && !/^[A-Z]:[\\/]/u.test(value), `manifest contains an absolute path: ${value}`);
  }

  assertCondition(Array.isArray(entries) && entries.length === REQUIRED_FILES.length, 'manifest must contain exactly the required screenshot entries');
  const entryFiles = entries.map((entry) => entry.file);
  assertCondition(new Set(entryFiles).size === entryFiles.length, 'manifest contains duplicate screenshot files');
  assertCondition(JSON.stringify(entryFiles) === JSON.stringify(REQUIRED_FILES), 'manifest screenshot order or files do not match the canonical set');

  const pngFiles = readdirSync(screenDir).filter((name) => name.endsWith('.png')).sort();
  assertCondition(JSON.stringify(pngFiles) === JSON.stringify([...REQUIRED_FILES].sort()), 'screen/ contains an orphan or missing PNG');
  for (const file of REQUIRED_FILES) {
    const filePath = join(screenDir, file);
    assertCondition(existsSync(filePath), `${file} is missing`);
    assertCondition(statSync(filePath).size > 0, `${file} is empty`);
    const dimensions = readPngDimensions(filePath);
    assertCondition(dimensions.width === manifest.viewport.width && dimensions.height === manifest.viewport.height, `${file} is ${dimensions.width}x${dimensions.height}, expected 1440x900`);
  }

  const imageRefs = extractReadmeImageReferences(readFileSync(readmePath, 'utf8'))
    .filter((ref) => isScreenPathCandidate(ref.path));
  assertCondition(imageRefs.every((ref) => ref.syntax === 'markdown'), 'canonical screenshots must use native Markdown image syntax; HTML <img> references are not allowed');
  assertCondition(imageRefs.every((ref) => ref.alt.trim().length > 0), 'canonical screenshots must have descriptive Markdown alt text');
  const readmeRefs = imageRefs.map((ref) => normalizeScreenReference(ref.path));
  assertCondition(readmeRefs.every((ref) => ref !== null), 'README screenshot paths must be safe repository-relative paths');
  assertCondition(new Set(readmeRefs).size === readmeRefs.length, 'README contains duplicate screenshot references');
  assertCondition(readmeRefs.length === REQUIRED_FILES.length, 'README must reference every canonical screenshot exactly once');
  assertCondition(JSON.stringify([...readmeRefs].sort()) === JSON.stringify([...REQUIRED_FILES].sort()), 'README screenshot references are stale or incomplete');

  return { count: REQUIRED_FILES.length, width: manifest.viewport.width, height: manifest.viewport.height };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runScreenshotCheck();
  console.log(`Screenshot conformance verified: ${result.count} images at ${result.width}x${result.height}`);
}
