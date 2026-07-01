import { test, expect } from '@playwright/test';

// Navigator-side end-to-end flows, using a real (pre-deploy) test credential.
// These write to live Firestore and the Spot the Error journey calls live Gemini.
const NAV_NAME = /turki khan/i;
const NAV_PIN = '1223';

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

// After picking a department the navigator lands on the chooser (no result yet)
// OR the dashboard (result exists). Normalise to the chooser either way.
async function openChooser(page) {
  const chooser = page.getByRole('heading', { name: /Choose your assessment/i });
  const takeAnother = page.getByRole('button', { name: /Take the other assessment|Retake an assessment/i });
  await expect(chooser.or(takeAnother)).toBeVisible({ timeout: 25_000 });
  if (await takeAnother.isVisible()) await takeAnother.click();
  await expect(chooser).toBeVisible();
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

// Click through the Spot the Error assessment (one agent bubble per item).
async function completeSpot(page) {
  // Wait out the Gemini generation (fires one call per domain in parallel).
  await expect(page.locator('.spot-error__transcript')).toBeVisible({ timeout: 90_000 });
  for (let i = 0; i < 10; i++) {
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

test('navigator signs in and reaches the MCQ / Spot chooser', async ({ page }) => {
  await signInAsNavigator(page);
  await page.getByRole('button', { name: /Pediatrics/i }).click();
  await openChooser(page);
  await expect(page.getByRole('heading', { name: 'Multiple choice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spot the Error' })).toBeVisible();
});

test('navigator completes an MCQ assessment and lands on the dashboard', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsNavigator(page);
  await page.getByRole('button', { name: /Pediatrics/i }).click();
  await openChooser(page);
  await page.getByRole('button', { name: /Multiple choice/i }).click();
  await completeMcq(page);
  await page.getByRole('button', { name: /View my dashboard/i }).click();
  // The dashboard assessment bar is present (take-another / toggle).
  await expect(
    page.getByRole('button', { name: /Take the other assessment|Retake an assessment/i })
  ).toBeVisible({ timeout: 20_000 });
});

// The headline feature: take BOTH assessment types and switch between them.
// Gemini-dependent (Spot generation), so it gets a long budget.
test('navigator takes Spot then MCQ and can switch between both results', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAsNavigator(page);
  await page.getByRole('button', { name: /Pediatrics/i }).click();

  // 1) Spot the Error, full profile.
  await openChooser(page);
  await page.getByRole('button', { name: /Spot the Error/i }).click();
  await completeSpot(page);
  await page.getByRole('button', { name: /Save & finish/i }).click();
  await page.getByRole('button', { name: /See my results/i }).click();

  // 2) Take the other assessment (MCQ).
  await openChooser(page);
  await page.getByRole('button', { name: /Multiple choice/i }).click();
  await completeMcq(page);
  await page.getByRole('button', { name: /View my dashboard/i }).click();

  // 3) Both results now exist → the toggle appears and switches.
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
