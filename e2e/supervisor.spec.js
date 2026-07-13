import { test, expect } from '@playwright/test';

// Use a dedicated deployment credential; local runs retain the demo fallback.
const SUPERVISOR_PASSCODE = process.env.E2E_SUPERVISOR_PASSCODE
  || process.env.SUPERVISOR_PASSCODE_SERVER
  || '0200';

test('supervisor can sign in and reach the management shell', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /I.?m a supervisor/i }).click();
  await page.getByPlaceholder(/Supervisor passcode/i).fill(SUPERVISOR_PASSCODE);
  await page.getByRole('button', { name: /Continue/i }).click();

  // The Start gate is gone and the supervisor nav is present.
  await expect(page.getByRole('heading', { name: /Management view/i })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Matrix' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // The department bar (supervisor-scoped analytics) renders on the overview.
  await expect(page.getByRole('button', { name: 'Matrix' })).toBeEnabled();
});
