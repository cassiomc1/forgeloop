import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { runDocConformance } from '../check-doc-conformance.mjs';
import { runScreenshotCheck } from '../check-readme-screenshots.mjs';

const repositoryRoot = process.cwd();

function copyRepository() {
  const parent = mkdtempSync(join(tmpdir(), 'forgeloop-audit-docs-'));
  const root = join(parent, 'repo');
  const excludedDirectories = ['.git', 'node_modules', 'dist', '.worktrees', 'coverage', 'test-results', 'playwright-report'];
  cpSync(repositoryRoot, root, {
    recursive: true,
    filter: (source) => {
      const path = relative(repositoryRoot, source);
      return !excludedDirectories.some((excluded) => path === excluded || path.startsWith(`${excluded}/`));
    },
  });
  return { parent, root };
}

function withRepository(callback) {
  const sandbox = copyRepository();
  try {
    return callback(sandbox.root);
  } finally {
    rmSync(sandbox.parent, { recursive: true, force: true });
  }
}

function updateJson(root, file, update) {
  const path = join(root, file);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('accepts current documentation while excluding marked historical records', () => {
  withRepository((root) => {
    assert.doesNotThrow(() => runDocConformance(root, { validateLineage: false }));
  });
});

test('rejects a package release-version mismatch', () => {
  withRepository((root) => {
    updateJson(root, 'package.json', (packageJson) => { packageJson.version = '0.1.0-rc.8'; });
    assert.throws(() => runDocConformance(root, { validateLineage: false }), /package\.json version/);
  });
});

test('rejects a ForgeLoop provenance-version mismatch', () => {
  withRepository((root) => {
    updateJson(root, 'schemas/provenance.json', (provenance) => { provenance.forgeLoopPackageVersion = '1.6.3'; });
    assert.throws(() => runDocConformance(root, { validateLineage: false }), /schema provenance must pin ForgeLoop 2\.0\.0, got 1\.6\.3/);
  });
});

test('rejects a broken relative documentation link', () => {
  withRepository((root) => {
    const path = join(root, 'docs', 'README.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n[broken](missing-document.md)\n`);
    assert.throws(() => runDocConformance(root, { validateLineage: false }), /references a missing local path/);
  });
});

test('rejects duplicate headings in current documentation', () => {
  withRepository((root) => {
    const path = join(root, 'docs', 'README.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n## Trust boundary\n`);
    assert.throws(() => runDocConformance(root, { validateLineage: false }), /duplicate heading/);
  });
});

test('rejects references to missing npm scripts', () => {
  withRepository((root) => {
    const path = join(root, 'docs', 'README.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nRun \`npm run missing:script\`.\n`);
    assert.throws(() => runDocConformance(root, { validateLineage: false }), /missing npm script: missing:script/);
  });
});

test('rejects stale active release-candidate identifiers', () => {
  withRepository((root) => {
    const path = join(root, 'README.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nStale active release marker: RC3.\n`);
    assert.throws(() => runDocConformance(root, { validateLineage: false }), /stale active RC number/);
  });
});

test('runs the ForgeLoop lineage gate when requested', () => {
  withRepository((root) => {
    updateJson(root, 'schemas/provenance.json', (provenance) => { provenance.forgeLoopGitCommit = '0000000000000000000000000000000000000000'; });
    assert.throws(() => runDocConformance(root), /ForgeLoop vendor lineage verification failed/);
  });
});

test('rejects a missing canonical screenshot', () => {
  withRepository((root) => {
    rmSync(join(root, 'screen', 'audit-summary.png'));
    assert.throws(() => runScreenshotCheck(root), /audit-summary\.png is missing|orphan or missing PNG/);
  });
});

test('accepts normalized repository-relative Markdown screenshot paths', () => {
  withRepository((root) => {
    const path = join(root, 'README.md');
    const readme = readFileSync(path, 'utf8').replaceAll('./screen/', 'screen/');
    writeFileSync(path, readme);
    assert.doesNotThrow(() => runScreenshotCheck(root));
  });
});

test('rejects canonical screenshots expressed only as HTML image tags', () => {
  withRepository((root) => {
    const path = join(root, 'README.md');
    const readme = readFileSync(path, 'utf8').replace(/!\[([^\]]+)\]\((\.\/screen\/[^)]+)\)/gu, '<img src="$2" alt="$1">');
    writeFileSync(path, readme);
    assert.throws(() => runScreenshotCheck(root), /native Markdown image syntax/);
  });
});

test('rejects duplicate canonical screenshot references', () => {
  withRepository((root) => {
    const path = join(root, 'README.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n![Duplicate audit summary](./screen/audit-summary.png)\n`);
    assert.throws(() => runScreenshotCheck(root), /duplicate screenshot references/);
  });
});

test('rejects stale canonical screenshot names', () => {
  withRepository((root) => {
    const path = join(root, 'README.md');
    const readme = readFileSync(path, 'utf8').replace('./screen/settings.png', './screen/old-settings.png');
    writeFileSync(path, readme);
    assert.throws(() => runScreenshotCheck(root), /stale or incomplete/);
  });
});
