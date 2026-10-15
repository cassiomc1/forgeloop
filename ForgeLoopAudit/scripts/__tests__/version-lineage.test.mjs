import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const script = join(process.cwd(), 'scripts', 'verify-version-lineage.mjs');
const roots = [];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function commitFile(repo, name) {
  writeFileSync(join(repo, name), `${name}\n`);
  git(repo, 'add', '.');
  git(repo, '-c', 'user.email=lineage@test', '-c', 'user.name=lineage', 'commit', '-m', name);
  return git(repo, 'rev-parse', 'HEAD').trim();
}

function initSandbox({ version }) {
  const root = mkdtempSync(join(tmpdir(), 'forgeloop-lineage-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote]);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'lineage-sandbox', version }, null, 2)}\n`);
  git(repo, 'add', '.');
  git(repo, '-c', 'user.email=lineage@test', '-c', 'user.name=lineage', 'commit', '-m', 'initial');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', 'origin', 'main');
  return { root, repo, remote };
}

function runLineage(repo, env = {}) {
  return execFileSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, FORGELOOP_SOURCE_SHA: '', FORGELOOP_VERSION: '', GITHUB_SHA: '', ...env },
    encoding: 'utf8',
  });
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('accepts a version whose immutable tag does not exist yet', () => {
  const { repo } = initSandbox({ version: '9.0.0-dev.1' });
  const output = runLineage(repo);
  assert.match(output, /has no immutable tag yet/);
});

test('accepts the exact tagged commit of a lightweight tag', () => {
  const { repo } = initSandbox({ version: '1.2.3' });
  git(repo, 'tag', 'v1.2.3');
  git(repo, 'push', 'origin', 'v1.2.3');
  assert.match(runLineage(repo), /is exactly the immutable tag v1\.2\.3/);
});

test('accepts the exact tagged commit of an annotated tag via its peeled ref', () => {
  const { repo } = initSandbox({ version: '2.0.0' });
  git(repo, '-c', 'user.email=lineage@test', '-c', 'user.name=lineage', 'tag', '-a', 'v2.0.0', '-m', 'release');
  git(repo, 'push', 'origin', 'v2.0.0');
  assert.match(runLineage(repo), /is exactly the immutable tag v2\.0\.0/);
});

test('rejects a version whose immutable tag points at a different commit', () => {
  const { repo } = initSandbox({ version: '3.1.4' });
  const tagged = commitFile(repo, 'release-base.txt');
  git(repo, 'tag', 'v3.1.4');
  git(repo, 'push', 'origin', 'v3.1.4');
  commitFile(repo, 'post-release.txt');
  assert.notEqual(git(repo, 'rev-parse', 'HEAD').trim(), tagged);
  assert.throws(() => runLineage(repo), /Version identity violation[\s\S]*already represented by immutable tag v3\.1\.4[\s\S]*bump package version/);
});

test('rejects a post-tag development line that still claims an older candidate version', () => {
  const { repo } = initSandbox({ version: '5.0.0-rc.4' });
  commitFile(repo, 'candidate.txt');
  git(repo, 'tag', 'v5.0.0-rc.3');
  git(repo, 'push', 'origin', 'v5.0.0-rc.3');
  commitFile(repo, 'post-candidate.txt');
  assert.throws(() => runLineage(repo, { FORGELOOP_VERSION: '5.0.0-rc.3' }), /Version identity violation[\s\S]*immutable tag v5\.0\.0-rc\.3/);
});

test('honors an explicit PR source SHA over the local HEAD', () => {
  const { repo } = initSandbox({ version: '6.0.0' });
  const tagged = commitFile(repo, 'pr-source.txt');
  git(repo, 'tag', 'v6.0.0');
  git(repo, 'push', 'origin', 'v6.0.0');
  commitFile(repo, 'local-ahead.txt');
  const output = runLineage(repo, { FORGELOOP_SOURCE_SHA: tagged });
  assert.match(output, /is exactly the immutable tag v6\.0\.0/);
});

test('fails closed when the provided source SHA is not a commit SHA', () => {
  const { repo } = initSandbox({ version: '7.0.0' });
  assert.throws(() => runLineage(repo, { FORGELOOP_SOURCE_SHA: 'not-a-sha' }), /invalid source SHA/);
});

test('fails closed when the release remote cannot be queried', () => {
  const { repo } = initSandbox({ version: '8.0.0' });
  assert.throws(() => runLineage(repo, { FORGELOOP_RELEASE_REMOTE: 'does-not-exist' }), /cannot query tags on remote "does-not-exist"/);
});
