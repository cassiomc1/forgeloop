import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const EXPECTED_VERSION = '2.0.0';
const EXPECTED_COMMIT = '4ff11bb4bc4be39b095a151a323f1388dad0d819';
const EXPECTED_PACKAGE_NAME = '@cassiomc1/forgeloop';

function readTarEntry(archivePath, entryName) {
  const compressed = readFileSync(archivePath);
  const tar = compressed[0] === 0x1f && compressed[1] === 0x8b ? gunzipSync(compressed) : compressed;
  for (let offset = 0; offset + 512 <= tar.length; offset += 512) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/u, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/u, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = header.toString('ascii', 124, 136).replace(/\0.*$/u, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const contentStart = offset + 512;
    if (fullName === entryName) return tar.subarray(contentStart, contentStart + size).toString('utf8');
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error(`Tarball is missing ${entryName}`);
}

function requireIncludes(content, expected, label) {
  if (!content.includes(expected)) throw new Error(`${label} does not contain ${expected}`);
}

function assertPackagedGuideClosure(archivePath) {
  const guideRegistry = JSON.parse(readTarEntry(archivePath, 'package/src/config/guides.json'));
  const requiredEntries = [
    'package/ENG/flutter-development-eng.md',
    'package/src/config/guides.json',
    'package/GUIDE_ROUTER.md',
  ];
  for (const entryName of requiredEntries) readTarEntry(archivePath, entryName);

  if (!guideRegistry.flutter || guideRegistry.flutter.path !== 'ENG/flutter-development-eng.md' || guideRegistry.flutter.install !== true) {
    throw new Error('Tarball guide registry does not contain the canonical installable flutter guide');
  }

  for (const [guideId, guide] of Object.entries(guideRegistry)) {
    if (guide?.install !== true) continue;
    if (typeof guide.path !== 'string' || !guide.path || guide.path.startsWith('/') || guide.path.includes('..')) {
      throw new Error(`Tarball guide registry has an unsafe install path for ${guideId}`);
    }
    readTarEntry(archivePath, `package/${guide.path}`);
  }
  return Object.keys(guideRegistry).length;
}

function main() {
  const repoRoot = process.cwd();
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
  const provenance = JSON.parse(readFileSync(join(repoRoot, 'schemas', 'provenance.json'), 'utf8'));
  const dependency = packageJson.dependencies?.[EXPECTED_PACKAGE_NAME];
  const lockDependency = packageLock.packages?.['node_modules/@cassiomc1/forgeloop'];

  if (provenance.forgeLoopPackageVersion !== EXPECTED_VERSION) {
    throw new Error(`Schema provenance has ForgeLoop ${provenance.forgeLoopPackageVersion}, expected ${EXPECTED_VERSION}`);
  }
  if (provenance.forgeLoopGitCommit !== EXPECTED_COMMIT) {
    throw new Error(`Schema provenance has ForgeLoop commit ${provenance.forgeLoopGitCommit}, expected ${EXPECTED_COMMIT}`);
  }
  if (typeof dependency !== 'string' || !dependency.startsWith('file:vendor/')) {
    throw new Error('package.json must use a vendored ForgeLoop tarball');
  }

  const relativeArchive = dependency.slice('file:'.length);
  const archivePath = join(repoRoot, relativeArchive);
  const archiveName = basename(archivePath);
  const expectedArchiveName = `cassiomc1-forgeloop-${EXPECTED_VERSION}-${EXPECTED_COMMIT.slice(0, 7)}.tgz`;
  if (archiveName !== expectedArchiveName) throw new Error(`package.json points to ${archiveName}, expected ${expectedArchiveName}`);
  if (!existsSync(archivePath)) throw new Error(`Vendored ForgeLoop archive is missing: ${relativeArchive}`);
  if (!lockDependency || lockDependency.resolved !== dependency || lockDependency.version !== EXPECTED_VERSION) {
    throw new Error('package-lock.json does not agree with the vendored ForgeLoop dependency');
  }

  const archiveBytes = readFileSync(archivePath);
  const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
  const archiveSha512 = createHash('sha512').update(archiveBytes).digest('base64');
  if (lockDependency.integrity !== `sha512-${archiveSha512}`) throw new Error('package-lock.json integrity does not match the vendored archive');

  const archivePackage = JSON.parse(readTarEntry(archivePath, 'package/package.json'));
  if (archivePackage.name !== EXPECTED_PACKAGE_NAME || archivePackage.version !== EXPECTED_VERSION) {
    throw new Error(`Tarball package identity is ${archivePackage.name}@${archivePackage.version}, expected ${EXPECTED_PACKAGE_NAME}@${EXPECTED_VERSION}`);
  }
  const guideCount = assertPackagedGuideClosure(archivePath);
  if (archivePackage.engines?.node !== '>=24.19.0'
    || archivePackage.license !== 'PolyForm-Noncommercial-1.0.0'
    || archivePackage.publishConfig?.access !== 'public') {
    throw new Error('Vendored ForgeLoop runtime, license or publication metadata drifted');
  }
  requireIncludes(readTarEntry(archivePath, 'package/LICENSE'), 'PolyForm Noncommercial License 1.0.0', 'ForgeLoop LICENSE');

  const vendorReadme = readFileSync(join(repoRoot, 'vendor', 'README.md'), 'utf8');
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  const compatibility = readFileSync(join(repoRoot, 'docs', 'PROTOCOL_COMPATIBILITY.md'), 'utf8');
  requireIncludes(vendorReadme, archiveName, 'vendor/README.md');
  requireIncludes(vendorReadme, EXPECTED_COMMIT, 'vendor/README.md');
  requireIncludes(vendorReadme, archiveSha256, 'vendor/README.md');
  requireIncludes(readme, `ForgeLoop \`${EXPECTED_VERSION}\``, 'README.md');
  requireIncludes(readme, EXPECTED_COMMIT, 'README.md');
  requireIncludes(compatibility, `ForgeLoop **${EXPECTED_VERSION}**`, 'docs/PROTOCOL_COMPATIBILITY.md');
  requireIncludes(compatibility, EXPECTED_COMMIT, 'docs/PROTOCOL_COMPATIBILITY.md');

  const staleArchives = readdirSync(join(repoRoot, 'vendor'))
    .filter((name) => /^cassiomc1-forgeloop-.*\.tgz$/u.test(name) && name !== archiveName);
  if (staleArchives.length > 0) throw new Error(`Unexpected extra ForgeLoop archives: ${staleArchives.join(', ')}`);

  console.log(`ForgeLoop vendor lineage verified: ${EXPECTED_PACKAGE_NAME}@${EXPECTED_VERSION} ${EXPECTED_COMMIT} sha256=${archiveSha256} packagedGuides=${guideCount}`);
}

main();
