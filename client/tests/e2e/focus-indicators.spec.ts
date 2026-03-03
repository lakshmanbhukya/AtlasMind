import { test, expect } from '@playwright/test';

/**
 * Focus Indicators and Keyboard Navigation Tests
 * Requirements: 11.3, 11.6
 * Task: 6.2
 */

test.describe('Focus Indicators and Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display focus indicators with 2px outline and 2px offset on buttons', async ({ page }) => {
    const button = page.locator('button').first();
    await button.focus();
    
    const focusStyles = await button.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        outlineWidth: styles.outlineWidth,
        outlineOffset: styles.outlineOffset
      };
    });
    
    expect(focusStyles.outlineWidth).toBe('2px');
    expect(focusStyles.outlineOffset).toBe('2px');
  });

  test('should display focus indicators on navigation tabs', async ({ page }) => {
    const navItem = page.locator('.sidebar-nav-item').first();
    await navItem.focus();
    
    const focusStyles = await navItem.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        outlineWidth: styles.outlineWidth,
        outlineOffset: styles.outlineOffset
      };
    });
    
    expect(focusStyles.outlineWidth).toBe('2px');
    expect(focusStyles.outlineOffset).toBe('2px');
  });

  test('should display focus indicators on suggestion chips', async ({ page }) => {
    const suggestionChip = page.locator('.chat-suggestion').first();
    await expect(suggestionChip).toBeVisible();
    await suggestionChip.focus();
    
    const focusStyles = await suggestionChip.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        outlineWidth: styles.outlineWidth,
        outlineOffset: styles.outlineOffset
      };
    });
    
    expect(focusStyles.outlineWidth).toBe('2px');
    expect(focusStyles.outlineOffset).toBe('2px');
  });

  test('should navigate through interactive elements with Tab key', async ({ page }) => {
    const tabbableElements = [];
    
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      const focusedElement = page.locator(':focus');
      
      if (await focusedElement.count() > 0) {
        const focusStyles = await focusedElement.evaluate((el) => {
          const styles = window.getComputedStyle(el);
          return {
            outlineWidth: styles.outlineWidth,
            outlineOffset: styles.outlineOffset
          };
        });
        
        expect(focusStyles.outlineWidth).toBe('2px');
        expect(focusStyles.outlineOffset).toBe('2px');
        tabbableElements.push(true);
      }
    }
    
    expect(tabbableElements.length).toBeGreaterThan(0);
  });

  test('should use cyan color for focus indicators', async ({ page }) => {
    const button = page.locator('button').first();
    await button.focus();
    
    const focusStyles = await button.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        outlineColor: styles.outlineColor
      };
    });
    
    // Cyan color: rgb(6, 182, 212) or #06b6d4
    expect(focusStyles.outlineColor).toMatch(/rgb\(6,\s*182,\s*212\)/);
  });
});
