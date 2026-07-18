import { test, expect } from '@playwright/test';
import {
  openNavigatorGate,
  rosterIsPopulated,
  signInAsNavigator,
  signInAsSupervisor,
  openSupervisorTab,
  visibleWithin,
  NAV_NAME,
  NAV_PIN,
} from './helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT WALKTHROUGH — a repeatable, CI-safe browser QA pass that walks the
// webapp like a real supervisor/navigator before a management demo.
//
// Guarantees (see the goal in the PR):
//   • Read-only: never submits an assessment, saves a result, starts a mic /
//     voice call, or triggers a live Gemini generation.
//   • No mic permission is granted or required.
//   • Data-backed navigator steps skip cleanly when the roster is empty (a
//     Firebase-less CI build) instead of failing.
//   • Supervisor steps need /api (local `npm start` server or a live URL).
//
// For a deeper pre-demo pass against the live deployment, run:
//   PLAYWRIGHT_BASE_URL=https://quarterknolwdge-production.up.railway.app npm run test:e2e
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Start gate', () => {
  test('Start screen loads with both role entry points', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Knowledge Check/i);
    await expect(page.getByRole('button', { name: /I.?m a navigator/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /I.?m a supervisor/i })).toBeVisible();
  });
});

test.describe('Navigator journey (read-only)', () => {
  test('Navigator role opens the roster gate', async ({ page }) => {
    const select = await openNavigatorGate(page);
    await expect(select).toBeVisible();
    await expect(page.getByPlaceholder(/PIN/i)).toBeVisible();
  });

  test('Navigator can sign in, pick Pediatrics, and reach the phase hub', async ({ page }) => {
    test.setTimeout(90_000);
    const select = await openNavigatorGate(page);
    test.skip(!(await rosterIsPopulated(select)), 'Roster empty (no backend data) — skipping data-backed navigator flow');

    // Sign in with the seeded test credential.
    const value = await select.locator('option', { hasText: NAV_NAME }).first().getAttribute('value');
    await select.selectOption(value);
    await page.getByPlaceholder(/PIN/i).fill(NAV_PIN);
    await page.getByRole('button', { name: /^Continue$/i }).click();

    // Department select.
    await expect(page.getByRole('heading', { name: /Which department/i })).toBeVisible({ timeout: 25_000 });
    await page.getByRole('button', { name: /Pediatrics/i }).click();

    // Phase hub OR the dashboard (if all phases already complete for this test user).
    const hub = page.getByRole('heading', { name: /Your assessment — [23] phases/i });
    const dashboardTab = page.getByRole('button', { name: 'My results' });
    await expect(hub.or(dashboardTab)).toBeVisible({ timeout: 25_000 });

    // If we landed on a completed dashboard, re-open the hub is not required for
    // this smoke — the point is the navigator reached their assessment home.
    if (await hub.isVisible().catch(() => false)) {
      await expect(page.getByText(/phases complete/i)).toBeVisible();
    }
  });

  test('Navigator can open the MCQ check without crashing (no submit)', async ({ page }) => {
    test.setTimeout(90_000);
    const select = await openNavigatorGate(page);
    test.skip(!(await rosterIsPopulated(select)), 'Roster empty (no backend data) — skipping data-backed navigator flow');

    const value = await select.locator('option', { hasText: NAV_NAME }).first().getAttribute('value');
    await select.selectOption(value);
    await page.getByPlaceholder(/PIN/i).fill(NAV_PIN);
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await page.getByRole('button', { name: /Pediatrics/i }).click();

    // Reach the phase hub. If the test user has already completed all phases the
    // app lands on the dashboard instead — use its "Retake a phase" control to
    // open the hub (completed phases can always be retaken). Retry to absorb a
    // late-subscription view bounce.
    const hub = page.getByRole('heading', { name: /Your assessment — [23] phases/i });
    if (!(await visibleWithin(hub, 25_000))) {
      const toHub = page.getByRole('button', { name: /Retake a phase|Continue assessment/i });
      await expect(toHub).toBeVisible({ timeout: 20_000 });
      await expect(async () => {
        await toHub.click();
        await expect(hub).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
    }

    // Phase 1 (Multiple choice) card — Start or Retake.
    await page.getByRole('button', { name: /Multiple choice/i }).click();

    // The check renders a question; we assert the shell and DO NOT submit.
    await expect(page.locator('.question')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.option').first()).toBeVisible();
  });

  test('Practice tab shows Voice/Chat entry points without starting the mic', async ({ page }) => {
    test.setTimeout(90_000);
    const select = await openNavigatorGate(page);
    test.skip(!(await rosterIsPopulated(select)), 'Roster empty (no backend data) — skipping data-backed navigator flow');

    const value = await select.locator('option', { hasText: NAV_NAME }).first().getAttribute('value');
    await select.selectOption(value);
    await page.getByPlaceholder(/PIN/i).fill(NAV_PIN);
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await page.getByRole('button', { name: /Pediatrics/i }).click();

    // Land somewhere signed-in, then open the Practice tab. A late Firestore
    // subscription can re-run NavigatorApp's landing effect and bounce the view
    // back to the dashboard just after a tab click, so retry the click until the
    // chooser sticks (toPass re-runs the whole block on failure).
    await expect(page.getByRole('button', { name: 'Practice' })).toBeVisible({ timeout: 25_000 });
    await expect(async () => {
      await page.getByRole('button', { name: 'Practice' }).click();
      // Both practice-mode cards render — we stop here (clicking a card would ask
      // for mic access / start a call), so no getUserMedia is ever invoked.
      await expect(page.getByRole('heading', { name: 'Voice call' })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Text chat' })).toBeVisible();
  });
});

test.describe('Supervisor journey (read-only shell navigation)', () => {
  test('Supervisor login screen loads', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /I.?m a supervisor/i }).click();
    await expect(page.getByRole('heading', { name: /Management view/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Supervisor passcode/i)).toBeVisible();
  });

  test('Wrong passcode is rejected', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /I.?m a supervisor/i }).click();
    await page.getByPlaceholder(/Supervisor passcode/i).fill('9999');
    await page.getByRole('button', { name: /Continue/i }).click();
    await expect(page.getByText(/Incorrect passcode/i)).toBeVisible();
  });

  test('Supervisor dashboard shell + all key tabs load', async ({ page }) => {
    test.setTimeout(90_000);
    await signInAsSupervisor(page);

    // Overview is the landing shell.
    await expect(page.getByRole('button', { name: 'Matrix' })).toBeVisible();

    // Walk the key tabs a supervisor would demo. Each click activates the tab
    // and renders its shell heading (read-only — no writes triggered).
    await openSupervisorTab(page, 'Matrix');
    await expect(page.getByRole('heading', { name: /Capability matrix|Matrix/i }).first()).toBeVisible();

    await openSupervisorTab(page, 'Navigators');
    await expect(page.getByRole('heading', { name: /Navigators/i }).first()).toBeVisible();

    await openSupervisorTab(page, 'Questions');
    await expect(page.getByRole('heading', { name: /Question bank/i })).toBeVisible();

    await openSupervisorTab(page, 'SOPs');
    await expect(page.getByRole('heading', { name: /^SOPs/i })).toBeVisible();

    // Back to Overview to confirm round-trip navigation is stable.
    await openSupervisorTab(page, 'Overview');
    await expect(page.getByRole('heading', { name: /Team overview/i })).toBeVisible();
  });

  test('Supervisor can open a Navigator Detail shell (if any navigator exists)', async ({ page }) => {
    test.setTimeout(90_000);
    await signInAsSupervisor(page);

    // The Matrix is the most reliable drill-in: every assessed navigator is a
    // clickable row-header button. Results load via a subscription, so give the
    // rows time to populate before deciding there is nothing to open.
    await openSupervisorTab(page, 'Matrix');
    // Results load via a subscription (~seconds). waitFor polls; isVisible() does
    // not, so use waitFor to distinguish "still loading" from "genuinely empty".
    const rowBtn = page.locator('.matrix__rowbtn').first();
    const hasRow = await rowBtn.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    if (!hasRow) {
      test.skip(true, 'No assessed navigator in the matrix to drill into (empty backend)');
    }
    await rowBtn.click();

    // The Navigator Detail shell renders and offers a way back — it did not crash.
    await expect(page.getByRole('button', { name: /Back to navigators/i }).first())
      .toBeVisible({ timeout: 15_000 });
  });
});
