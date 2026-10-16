import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function bootstrapUrl(): string {
  return (JSON.parse(readFileSync(join(process.cwd(), 'test-results', 'web-server.json'), 'utf8')) as { bootstrapUrl: string }).bootstrapUrl;
}

for (const width of [320, 390, 768]) {
  test(`navigation preserves content space and keyboard access at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(bootstrapUrl());
    await expect(page.getByRole('heading', { name: 'Audit Summary', exact: true })).toBeVisible({ timeout: 20_000 });
    const main = page.locator('main');
    expect(await main.evaluate((element) => element.clientWidth)).toBeGreaterThanOrEqual(width - 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByLabel('Main navigation')).toBeHidden();

    const open = page.getByRole('button', { name: 'Open navigation', exact: true });
    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Project navigation' });
    await expect(drawer).toBeVisible();
    const close = drawer.getByRole('button', { name: 'Close navigation', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Close Project', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await page.getByLabel('Main navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByLabel('Main navigation')).toBeVisible();
    await expect(open).toBeHidden();
    await expect(main).not.toHaveAttribute('inert', '');
  });
}

test('collapsed desktop navigation retains accessible names and skip navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(bootstrapUrl());
  await expect(page.getByRole('heading', { name: 'Audit Summary', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.getByLabel('Main navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Skip to audit content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
