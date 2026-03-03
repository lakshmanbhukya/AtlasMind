import { test, expect } from '@playwright/test';

test.describe('AtlasMind UI End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the application and display the sidebar', async ({ page }) => {
    // Check if the sidebar exists and has the correct title
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('h1')).toHaveText('AggregatorFlow');
    await expect(sidebar.locator('p')).toHaveText('AI ANALYTICS');
  });

  test('should have Chat and Dashboard tabs', async ({ page }) => {
    const chatTab = page.locator('.sidebar-nav-item', { hasText: 'Chat' });
    const dashboardTab = page.locator('.sidebar-nav-item', { hasText: 'Dashboard' });

    await expect(chatTab).toBeVisible();
    await expect(dashboardTab).toBeVisible();
  });

  test('should display the Schema Explorer', async ({ page }) => {
    const schemaExplorer = page.locator('.sidebar-schema');
    await expect(schemaExplorer).toBeVisible();
    // It might show 'Loading schema...', 'No schema loaded', or 'Databases' depending on the backend state
    await expect(schemaExplorer).toContainText(/Loading schema\.\.\.|Databases|No schema loaded/);
  });

  test('should switch between Chat and Dashboard tabs', async ({ page }) => {
    // Assuming initially on Chat tab
    let activeTab = page.locator('.sidebar-nav-item.active');
    await expect(activeTab).toHaveText(/Chat/);

    // Switch to Dashboard
    const dashboardTab = page.locator('.sidebar-nav-item', { hasText: 'Dashboard' });
    await dashboardTab.click();

    // Verify Dashboard is active
    activeTab = page.locator('.sidebar-nav-item.active');
    await expect(activeTab).toHaveText(/Dashboard/);

    // Switch back to Chat
    const chatTab = page.locator('.sidebar-nav-item', { hasText: 'Chat' });
    await chatTab.click();

    // Verify Chat is active
    activeTab = page.locator('.sidebar-nav-item.active');
    await expect(activeTab).toHaveText(/Chat/);
  });

  test('should display empty state with suggestion chips when no messages', async ({ page }) => {
    // Check if empty state is visible
    const emptyState = page.locator('.chat-welcome');
    await expect(emptyState).toBeVisible();

    // Check if the heading is present
    const heading = emptyState.locator('h2');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Query Your Data');

    // Check if suggestion chips are present
    const suggestions = page.locator('.chat-suggestion');
    await expect(suggestions).toHaveCount(4);

    // Verify suggestion chip styling
    const firstSuggestion = suggestions.first();
    await expect(firstSuggestion).toBeVisible();
    
    // Check computed styles for the first suggestion chip
    const borderStyle = await firstSuggestion.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        border: styles.border,
        borderWidth: styles.borderWidth,
        background: styles.backgroundColor,
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight
      };
    });

    // Verify brutalist design system styles
    expect(borderStyle.borderWidth).toBe('2px');
    expect(borderStyle.fontSize).toBe('12px');
    expect(borderStyle.fontWeight).toBe('500');
  });

  test('should apply hover effect to suggestion chips', async ({ page }) => {
    const firstSuggestion = page.locator('.chat-suggestion').first();
    await expect(firstSuggestion).toBeVisible();

    // Get initial position
    const initialBox = await firstSuggestion.boundingBox();

    // Hover over the suggestion chip
    await firstSuggestion.hover();

    // Wait for transition
    await page.waitForTimeout(200);

    // Verify hover effect (transform translate)
    const hoverStyles = await firstSuggestion.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        transform: styles.transform,
        borderColor: styles.borderColor
      };
    });

    // The transform should be applied (translate(-1px, -1px))
    expect(hoverStyles.transform).not.toBe('none');
  });
});
