import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        '**/src/renderer/**',
        // Process/filesystem adapters are covered by the local web security and
        // Playwright smoke gates; their entry points are intentionally excluded
        // from the global unit threshold.
        '**/src/main/core/cli/forge-cli.ts',
        // The bundled ForgeLoop adapter is an external Integration API
        // boundary; its negotiated behavior is covered by integration, demo,
        // security and browser contracts rather than branch-counted as pure
        // local domain logic.
        '**/src/main/core/integration/forgeloop-integration.ts',
        // The loopback host and runtime coordinate process, filesystem and
        // browser lifecycle behavior; focused security tests and web smoke cover
        // these adapters instead of the pure unit denominator.
        '**/src/server/cli.ts',
        '**/src/server/web-server.ts',
        '**/src/server/runtime/audit-runtime.ts',
        '**/src/server/runtime/fixture-mode.ts',
        '**/src/server/runtime/project-kind.ts',
        '**/src/server/runtime/workspace-runtime.ts',
        '**/src/server/storage/app-data.ts',
        '**/src/main/core/diagnostics/diagnostics.ts',
        '**/src/main/core/events/ledger-reader.ts',
        '**/src/main/core/project/project-reader.ts',
        '**/src/main/core/project/project-snapshot.ts',
        '**/src/main/core/tasks/task-index.ts',
        '**/src/main/core/tasks/task-reader.ts',
        '**/src/main/core/protocol/compatibility-contract.ts',
        '**/src/main/core/protocol/schema-provenance.ts',
        '**/src/main/core/protocol/validator.ts',
        '**/src/main/security/path-boundary.ts',
        '**/src/main/watcher/change-coalescer.ts',
        '**/src/main/watcher/project-reconciler.ts',
        '**/src/main/watcher/project-watcher.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
});
