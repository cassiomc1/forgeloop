import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sbomPath = process.argv[2];
if (!sbomPath) throw new Error('SBOM normalization cannot proceed: missing SBOM path argument');
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'));
if (sbom.bomFormat !== 'CycloneDX' || !sbom.specVersion) {
  throw new Error(`SBOM normalization cannot proceed: ${sbomPath} is not a CycloneDX document`);
}
if (!sbom.metadata || typeof sbom.metadata !== 'object' || !sbom.metadata.component || typeof sbom.metadata.component !== 'object') {
  throw new Error(`SBOM normalization cannot proceed: ${sbomPath} has no metadata.component`);
}
const before = sbom.metadata.component.name;
sbom.metadata.component.name = pkg.name;
writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`SBOM normalized: metadata.component.name ${JSON.stringify(before ?? null)} -> ${JSON.stringify(pkg.name)} (version ${pkg.version})`);
