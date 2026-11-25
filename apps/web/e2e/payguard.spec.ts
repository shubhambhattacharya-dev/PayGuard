import { expect, test } from '@playwright/test';

test.describe('PayGuard E2E Suite', () => {
  test('Landing page (/): hero, explorable preview tabs, and interactive demo work with zero errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Let AI move faster/i })).toBeVisible();

    await page.getByRole('tab', { name: 'Invoice Evidence' }).click();
    await expect(page.getByText(/quote-matcher\.ts/i)).toBeVisible();

    await page.getByRole('tab', { name: 'Audit Trail' }).click();
    await expect(page.getByText(/Append-only audit trail/i)).toBeVisible();

    await page.getByRole('button', { name: /Cedar Supply · \$64\.00/i }).click();
    await expect(page.getByText('OK_AUTO')).toBeVisible();

    await page.getByRole('button', { name: /Untrusted Prompt · \$842\.50/i }).click();
    await expect(page.getByText('REJECT_PROMPT_INJECTION')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Landing page (/) mobile viewport (390x844): accessible menu toggle & no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const menuButton = page.getByRole('button', { name: /Open navigation menu/i });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.getByRole('link', { name: 'Open workspace' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Open navigation menu/i })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('Payments workspace (/payments): renders ledger, inspector, and collapsible sidebar toggle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/payments');

    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    await expect(page.getByText(/Needs review/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Aster Cloud/i).locator('visible=true').first()).toBeVisible();

    const hideBtn = page.getByRole('button', { name: 'Hide sidebar' });
    await expect(hideBtn).toBeVisible();
    await hideBtn.click();

    const showBtn = page.getByRole('button', { name: 'Show sidebar' });
    await expect(showBtn).toBeVisible();
    await showBtn.click();
    await expect(hideBtn).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Secondary routes (/overview, /audit, /evaluations) render cleanly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText(/Deterministic Policy Caps/i)).toBeVisible();

    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();

    await page.goto('/evaluations');
    await expect(page.getByRole('heading', { name: 'Evaluations' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
