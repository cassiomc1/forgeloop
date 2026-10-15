import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDemoFiles, writeDemoProject } from './demo/write-demo-project.mjs';

const DEMO_ROOT = join(process.cwd(), 'demo');

export function collectFiles(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in demo output: ${join(dir, entry.name)}`);
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.set(relative(root, fullPath).replaceAll('\\', '/'), readFileSync(fullPath));
    }
  };
  walk(root);
  return files;
}

export function demoHasDrift() {
  if (!existsSync(DEMO_ROOT)) return { drift: true, reason: `committed ${relative(process.cwd(), DEMO_ROOT)} directory is missing` };
  const committed = collectFiles(DEMO_ROOT);
  const scratch = mkdtempSync(join(tmpdir(), 'forgeloop-demo-check-'));
  try {
    writeDemoProject(scratch);
    const generated = collectFiles(scratch);
    const committedKeys = [...committed.keys()].sort();
    const generatedKeys = [...generated.keys()].sort();
    if (committedKeys.join('\n') !== generatedKeys.join('\n')) {
      const missing = generatedKeys.filter((key) => !committed.has(key)).slice(0, 5);
      const extra = committedKeys.filter((key) => !generated.has(key)).slice(0, 5);
      return {
        drift: true,
        reason: `file set differs (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'})`,
      };
    }
    for (const [path, content] of generated) {
      const normalize = (buffer) => buffer.toString('utf8').replaceAll('\r\n', '\n');
      if (normalize(content) !== normalize(committed.get(path))) {
        return { drift: true, reason: `content drift at ${path}` };
      }
    }
    return { drift: false, fileCount: generated.size };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    const result = demoHasDrift();
    if (result.drift) {
      console.error(`DEMO DRIFT DETECTED: ${result.reason}`);
      console.error('Run "npm run demo:generate" and commit the regenerated demo/ directory.');
      process.exit(1);
    }
    console.log(`Demo project matches generator output (${result.fileCount} files)`);
  } else {
    const { fileCount, eventCount } = writeDemoProject(DEMO_ROOT);
    console.log(`Generated demo project at ${DEMO_ROOT} (${fileCount} files, ${eventCount} events)`);
  }
}
