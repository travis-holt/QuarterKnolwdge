import { expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the CI-safe product walkthrough + demo smoke suite.
//
// Design rules (see tests/e2e/product-walkthrough.spec.js):
//   • Read-only navigation only — never submit an assessment, save a result,
//     start a mic/voice call, or trigger a live Gemini call.
//   • Prefer role/text selectors over brittle CSS-only selectors.
//   • Deep, data-backed steps degrade gracefully when the backend has no data
//     (e.g. a build with no Firebase config): use `rosterIsPopulated()` to skip
//     rather than fail.
//
// Local defaults match the non-production demo setup. Remote/deployed runs must
// supply dedicated E2E credentials through environment variables.
// ─────────────────────────────────────────────────────────────────────────────

// Pilot-grade test navigator credential (present in the seeded roster).
export const NAV_NAME = /turki khan/i;
export const NAV_PIN = process.env.E2E_NAV_PIN || '1223';

export const SUPERVISOR_PASSCODE = process.env.E2E_SUPERVISOR_PASSCODE
  || process.env.SUPERVISOR_PASSCODE_SERVER
  || '0200';

// True if the locator becomes visible within `timeout`. Unlike locator.isVisible()
// (which samples the CURRENT state and never polls), this waits — use it to tell
// "still loading" apart from "genuinely absent" without failing the test.
export async function visibleWithin(locator, timeout = 15_000) {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

// Open the Start gate and choose the navigator role. Returns the roster <select>.
export async function openNavigatorGate(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /I.?m a navigator/i }).click();
  const select = page.locator('select.gate__select');
  await expect(select).toBeVisible({ timeout: 20_000 });
  return select;
}

// Does the roster dropdown actually contain a real navigator option? When the
// backend has no data (no Firebase config in CI), the select renders but only
// carries the placeholder option — data-backed steps should skip in that case.
export async function rosterIsPopulated(select) {
  // A populated roster has more than just the disabled placeholder option.
  const count = await select.locator('option').count();
  return count > 1;
}

// Full navigator sign-in with the seeded test credential. Assumes the roster is
// populated (guard with rosterIsPopulated first for CI-safe skips).
export async function signInAsNavigator(page) {
  const select = await openNavigatorGate(page);
  const value = await select
    .locator('option', { hasText: NAV_NAME })
    .first()
    .getAttribute('value');
  await select.selectOption(value);
  await page.getByPlaceholder(/PIN/i).fill(NAV_PIN);
  await page.getByRole('button', { name: /^Continue$/i }).click();
}

// Sign in as supervisor. Requires /api (local server or live URL). Returns once
// the management shell (nav tabs) is visible.
export async function signInAsSupervisor(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /I.?m a supervisor/i }).click();
  await page.getByPlaceholder(/Supervisor passcode/i).fill(SUPERVISOR_PASSCODE);
  await page.getByRole('button', { name: /Continue/i }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 20_000 });
}

// Click a supervisor nav tab by its visible label and confirm it activates.
export async function openSupervisorTab(page, label) {
  const tab = page.getByRole('button', { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveClass(/is-active/);
}
