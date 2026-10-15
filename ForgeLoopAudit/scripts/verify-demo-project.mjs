import { createNativeDemoFixture } from './demo/native-fixture.mjs';
import { join } from 'node:path';
import { verifyDemoProject, verifyCanonicalDemoSemantics } from './demo/verifier.mjs';

const root = process.argv[2] || join(process.cwd(), 'demo');
const result = verifyDemoProject(root);
console.log(`Demo verification: ${result.stats.tasks} tasks, ${result.stats.events} events, phases [${result.stats.phases.join(', ')}], ${result.stats.checkedReferences} references checked`);
console.log(`Demo artifact coverage: ${result.stats.artifactCoverage.represented}/${result.stats.artifactCoverage.total}`);
if (!result.ok) {
  console.error('DEMO VERIFICATION FAILED:');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

const native = createNativeDemoFixture(root);
let canonical;
try { canonical = await verifyCanonicalDemoSemantics(native.root); } finally { native.cleanup(); }
if (!canonical.ok) {
  console.error('DEMO CANONICAL SEMANTICS FAILED:');
  for (const error of canonical.errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Demo canonical ownership verified through ForgeLoop Integration API (${canonical.stats.tasksChecked} tasks)`);
console.log('Demo project is protocol-valid and internally consistent');
