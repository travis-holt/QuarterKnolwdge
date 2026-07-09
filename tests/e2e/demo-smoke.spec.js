import { test, expect } from '@playwright/test';
import { signInAsSupervisor } from './helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEMO SMOKE — a fast "is the demo up and healthy?" pass to run right before a
// management demo. Deliberately small and read-only. Works against either:
//   • a local server  (default:  npm run test:e2e)
//   • the live deploy  (PLAYWRIGHT_BASE_URL=https://quarterknolwdge-production.up.railway.app npm run test:e2e)
//
// It never submits, never starts a mic/voice call, and never triggers a live
// Gemini generation — so it is safe to run repeatedly against production.
// ─────────────────────────────────────────────────────────────────────────────

test('demo is reachable: Start gate renders with both roles', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Knowledge Check/i);
  await expect(page.getByRole('button', { name: /I.?m a navigator/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /I.?m a supervisor/i })).toBeVisible();
});

test('demo is reachable: navigator gate opens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /I.?m a navigator/i }).click();
  await expect(page.locator('select.gate__select')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByPlaceholder(/PIN/i)).toBeVisible();
});

test('demo is reachable: supervisor auth + management shell loads', async ({ page }) => {
  test.setTimeout(60_000);
  await signInAsSupervisor(page);
  // The core supervisor tabs a demo relies on are all present.
  for (const label of ['Overview', 'Matrix', 'Navigators', 'Questions', 'SOPs']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});
