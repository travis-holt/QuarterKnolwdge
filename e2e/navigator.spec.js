import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// DEEP / LIVE-DATA navigator flows.
//
// This file is the DEEP suite: it uses a real test credential, WRITES results to
// live Firestore, and CALLS live Gemini (MCQ coaching + Spot the Error generation).
// It is NOT the routine demo smoke — for read-only, non-destructive coverage that
// is safe to run repeatedly (incl. against live Railway) see `tests/e2e/`.
//
// Run it deliberately:  npm run test:e2e:deep   (needs .env.local: Firebase + Gemini)
//
// Flow it exercises (current F26 3-phase model):
//   Start gate → navigator login → department select → PhaseHub
//   ("Your assessment — 3 phases") → Phase 1 (MCQ) → Phase 2 (Spot the Error).
// Phase 3 (Call QA Test) is a live microphone voice call and is intentionally NOT
// driven here (no headless mic); the read-only `tests/e2e/` suite covers its entry.
// ─────────────────────────────────────────────────────────────────────────────

const NAV_NAME = /turki khan/i;
const NAV_PIN = process.env.E2E_NAV_PIN || '1223';

async function signInAsNavigator(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /I.?m a navigator/i }).click();
  const select = page.locator('select.gate__select');
  await expect(select).toBeVisible({ timeout: 20_000 });
  const value = await select.locator('option', { hasText: NAV_NAME }).first().getAttribute('value');
  await select.selectOption(value);
  await page.getByPlaceholder(/PIN/i).fill(NAV_PIN);
  await page.getByRole('button', { name: /^Continue$/i }).click();
}

// Pick Pediatrics and land on the PhaseHub. When the test user has already
// completed all three phases the app lands on the dashboard instead, so use its
// "Retake a phase" / "Continue assessment" control to open the hub. Retries to
// absorb a late-Firestore-subscription view bounce (see PR #16).
async function reachPhaseHub(page) {
  await page.getByRole('button', { name: /Pediatrics/i }).click();

  const hub = page.getByRole('heading', { name: /Your assessment — 3 phases/i });
  const landed = await hub
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (landed) return hub;

  const toHub = page.getByRole('button', { name: /Retake a phase|Continue assessment/i });
  await expect(toHub).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await toHub.click();
    await expect(hub).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return hub;
}

// Answer every MCQ question by choosing the first option, then submit.
async function completeMcq(page) {
  await expect(page.locator('.question')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 40; i++) {
    await page.locator('.option').first().click();
    const submit = page.getByRole('button', { name: /^Submit/ });
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
      return;
    }
    await page.getByRole('button', { name: /^Next$/ }).click();
  }
  throw new Error('MCQ never reached the submit step');
}

// Click through the full-profile Spot the Error assessment (one item at a time).
async function completeSpot(page) {
  // Full mode fires one Gemini generation per domain in parallel — give it room.
  await expect(page.locator('.spot-error__transcript')).toBeVisible({ timeout: 120_000 });
  for (let i = 0; i < 12; i++) {
    await page.locator('.spot-error__bubble--clickable .spot-error__message').first().click();
    const seeResults = page.getByRole('button', { name: /See results/i });
    if (await seeResults.isVisible().catch(() => false)) {
      await seeResults.click();
      return;
    }
    await page.getByRole('button', { name: /Next item/i }).click();
  }
  throw new Error('Spot assessment never reached results');
}

test('navigator signs in and reaches the 3-phase hub', async ({ page }) => {
  await signInAsNavigator(page);
  await reachPhaseHub(page);

  // All three phase cards are present, in order.
  await expect(page.getByRole('button', { name: /Multiple choice/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Spot the Error/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Call QA Test/i })).toBeVisible();
  await expect(page.getByText(/phases complete/i)).toBeVisible();
});

test('navigator completes Phase 1 (MCQ) and lands on the dashboard', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsNavigator(page);
  await reachPhaseHub(page);

  await page.getByRole('button', { name: /Multiple choice/i }).click();
  await completeMcq(page);

  // Submit routes to the coaching review; continue to the dashboard from there.
  await page.getByRole('button', { name: /View my dashboard/i }).click();
  await expect(
    page.getByRole('button', { name: /Retake a phase|Continue assessment/i })
  ).toBeVisible({ timeout: 20_000 });
});

// The coexistence headline: take Phase 2 (Spot) as well, then switch which result
// the dashboard reflects. Live Gemini (Spot generation), so it gets a long budget.
test('navigator takes Phase 2 (Spot the Error) and can switch between MCQ and Spot results', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsNavigator(page);
  await reachPhaseHub(page);

  // Phase 2 — full-profile Spot the Error.
  await page.getByRole('button', { name: /Spot the Error/i }).click();
  await completeSpot(page);
  await page.getByRole('button', { name: /Save & finish/i }).click();
  await page.getByRole('button', { name: /See my results/i }).click();

  // Both MCQ and Spot results now exist → the assessment toggle appears and switches.
  await expect(page.getByText('Showing:')).toBeVisible({ timeout: 20_000 });
  const spotPill = page.locator('.assess-bar__pill', { hasText: 'Spot the Error' });
  const mcqPill = page.locator('.assess-bar__pill', { hasText: 'Multiple choice' });
  await expect(spotPill).toBeVisible();
  await expect(mcqPill).toBeVisible();
  await spotPill.click();
  await expect(spotPill).toHaveClass(/is-active/);
  await mcqPill.click();
  await expect(mcqPill).toHaveClass(/is-active/);
});
