import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('loads and exposes the connection form', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('AtlasMind');
    await expect(page.locator('#connection-string')).toBeVisible();
  });
});
