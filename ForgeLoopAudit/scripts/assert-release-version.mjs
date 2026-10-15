import { readFileSync } from 'node:fs';

const tag = process.argv[2];
if (!tag) throw new Error('Usage: node scripts/assert-release-version.mjs <tag>');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const expected = `v${packageJson.version}`;
if (tag !== expected) {
  throw new Error(`Release tag ${tag} does not match package version ${expected}`);
}

console.log(`Release identity verified: ${tag}`);
