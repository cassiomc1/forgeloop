import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('advisory context ForgeLoopAudit boundary', () => {
  it('does not import or invoke recallAdvisoryContext during normal refresh paths', () => {
    for (const path of [
      'src/main/core/project/project-snapshot.ts',
      'src/main/core/integration/forgeloop-integration.ts',
      'src/server/runtime/audit-runtime.ts',
    ]) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('recallAdvisoryContext');
    }
  });

  it('never creates the optional host-injected Ripwire provider', () => {
    for (const path of [
      'src/main/core/project/project-snapshot.ts',
      'src/main/core/integration/forgeloop-integration.ts',
      'src/server/runtime/audit-runtime.ts',
    ]) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('createRipwireAdvisoryContextProvider');
    }
  });
});
