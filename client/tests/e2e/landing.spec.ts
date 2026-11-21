import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('loads and exposes the connection form', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('AtlasMind');
    // The landing page is a lazy chunk; allow a cold dev server time to serve it.
    await expect(page.locator('#connection-string')).toBeVisible({ timeout: 30_000 });
  });
});
