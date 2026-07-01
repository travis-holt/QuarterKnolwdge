import { test, expect } from '@playwright/test';

// Smoke tests — confirm the app boots and the Start gate renders + routes.
// These need no Firebase data (the role gate renders regardless of config).

test('app loads and shows the Start gate', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Knowledge Check/i);
  await expect(page.getByRole('button', { name: /I.?m a navigator/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /I.?m a supervisor/i })).toBeVisible();
});

test('supervisor passcode gate rejects a wrong code', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /I.?m a supervisor/i }).click();
  await expect(page.getByRole('heading', { name: /Management view/i })).toBeVisible();
  await page.getByPlaceholder(/Supervisor passcode/i).fill('9999');
  await page.getByRole('button', { name: /Continue/i }).click();
  await expect(page.getByText(/Incorrect passcode/i)).toBeVisible();
});
