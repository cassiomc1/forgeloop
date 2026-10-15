import { spawnSync } from 'node:child_process';
const gates = [
  ['brand-conformance', 'npm', ['run', 'brand:check']],
  ['forgeloop-vendor-lineage', 'npm', ['run', 'verify:forgeloop-lineage']],
  ['version-lineage', 'node', ['scripts/verify-version-lineage.mjs']],
  ['dependency-policy', 'node', ['scripts/dependency-policy.mjs']],
  ['audit-production', 'npm', ['run', 'audit:prod']],
  ['schema-provenance', 'npm', ['run', 'protocol:schemas:verify']],
  ['demo-drift-check', 'node', ['scripts/generate-demo-project.mjs', '--check']],
  ['demo-verification', 'npm', ['run', 'demo:verify']],
  ['docs-conformance', 'npm', ['run', 'docs:check']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['lint', 'npm', ['run', 'lint']],
  ['tests', 'npm', ['test']],
  ['release-contract-tests', 'npm', ['run', 'test:release-contracts']],
  ['coverage', 'npm', ['run', 'test:coverage']],
  ['critical-coverage', 'npm', ['run', 'verify:critical-coverage']],
  ['performance-budget', 'npm', ['run', 'verify:performance']],
  ['build', 'npm', ['run', 'build']],
  ['package-contract', 'node', ['scripts/verify-package-contents.mjs', 'dist']],
];
let failed = false;
console.log('ForgeLoopAudit Full Verification\n');
for (const [name, command, args] of gates) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status === 0) console.log(`PASS ${name}`); else { console.error(`FAIL ${name}`); failed = true; break; }
}
console.log(failed ? '\nLOCAL RESULT: FAIL' : '\nLOCAL RESULT: PASS\nPLATFORM RELEASE GATES: require GitHub Actions matrix');
process.exitCode = failed ? 1 : 0;
