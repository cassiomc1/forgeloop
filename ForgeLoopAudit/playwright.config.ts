import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { colorScheme: 'dark', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/start-web-test.mjs',
    url: 'http://127.0.0.1:41731/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
});
