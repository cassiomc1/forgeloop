import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
const version = process.argv[2] || process.env.FORGELOOP_VERSION || pkg.version;
const remote = process.env.FORGELOOP_RELEASE_REMOTE || 'origin';

function resolveSourceSha() {
  const explicit = process.env.FORGELOOP_SOURCE_SHA || process.env.GITHUB_SHA;
  if (explicit && explicit.length > 0) {
    if (!/^[a-f0-9]{40}$/.test(explicit)) throw new Error(`Version lineage cannot proceed: invalid source SHA provided by environment: ${explicit}`);
    return explicit.toLowerCase();
  }
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim().toLowerCase();
}

const sourceSha = resolveSourceSha();
const tagRef = `refs/tags/v${version}`;

let listing;
try {
  listing = execFileSync('git', ['ls-remote', '--tags', remote, tagRef, `${tagRef}^{}`], { cwd, encoding: 'utf8' });
} catch (error) {
  throw new Error(`Version lineage cannot proceed: cannot query tags on remote "${remote}": ${error.stderr ?? error.message}`);
}
const entries = listing
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [sha, ref] = line.split(/\t/);
    return { ref, sha: sha.toLowerCase() };
  })
  .filter((entry) => entry.ref === tagRef || entry.ref === `${tagRef}^{}`);
if (entries.length === 0) {
  console.log(`Version lineage verified: v${version} has no immutable tag yet, so source commit ${sourceSha.slice(0, 12)} may carry the ${version} development line`);
  process.exit(0);
}
const taggedCommit = (entries.find((entry) => entry.ref === `${tagRef}^{}`) ?? entries.find((entry) => entry.ref === tagRef)).sha;
if (taggedCommit !== sourceSha) {
  throw new Error([
    'Version identity violation:',
    `package version ${version} is already represented by immutable tag v${version}`,
    `tag commit: ${taggedCommit}`,
    `current source commit: ${sourceSha}`,
    'bump package version before continuing development',
  ].join('\n'));
}
console.log(`Version lineage verified: source commit ${sourceSha.slice(0, 12)} is exactly the immutable tag v${version}`);
