import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// CONCURRENT-NAVIGATOR LOAD TEST
//
// Simulates N patient navigators using the app AT THE SAME TIME, each running the
// full quarterly-check journey (sign in → Pediatrics → MCQ → post-check coaching
// → dashboard). Every session drives live Firebase writes and one live Gemini
// coaching call, so this measures whether the Railway server + Firestore + Gemini
// hold up under simultaneous intensive use.
//
// N sessions all use the same pre-deploy test credential (turki khan / 1223). For
// a LOAD test that is intentional: 20 concurrent sessions writing the same result
// doc is a strictly harder concurrency case (last-write-wins contention) than 20
// distinct docs, and it needs no 20-row roster provisioning. It does not test 20
// distinct matrix rows — that is a data-shape concern, not a load concern.
//
//   env: STRESS_N (default 20)
// ─────────────────────────────────────────────────────────────────────────────

const NAV_NAME = /turki khan/i;
const NAV_PIN = '1223';
const N = Number(process.env.STRESS_N || 20);

async function runNavigatorJourney(context, id) {
  const t0 = Date.now();
  const marks = {};
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
  try {
    await page.goto('/', { timeout: 60_000 });
    await page.getByRole('button', { name: /I.?m a navigator/i }).click();

    const select = page.locator('select.gate__select');
    await expect(select).toBeVisible({ timeout: 40_000 });
    const value = await select.locator('option', { hasText: NAV_NAME }).first().getAttribute('value');
    await select.selectOption(value);
    await page.getByPlaceholder(/PIN/i).fill(NAV_PIN);
    await page.getByRole('button', { name: /^Continue$/i }).click();
    marks.signedIn = Date.now() - t0;

    await page.getByRole('button', { name: /Pediatrics/i }).click();

    // Normalise to the chooser (result may already exist from a prior run).
    const chooser = page.getByRole('heading', { name: /Choose your assessment/i });
    const takeAnother = page.getByRole('button', { name: /Take the other assessment|Retake an assessment/i });
    await expect(chooser.or(takeAnother)).toBeVisible({ timeout: 60_000 });
    if (await takeAnother.isVisible().catch(() => false)) await takeAnother.click();
    await page.getByRole('button', { name: /Multiple choice/i }).click();

    // Answer every question by first option, then submit.
    await expect(page.locator('.question')).toBeVisible({ timeout: 40_000 });
    for (let i = 0; i < 40; i++) {
      await page.locator('.option').first().click();
      const submit = page.getByRole('button', { name: /^Submit/ });
      if (await submit.isVisible().catch(() => false)) { await submit.click(); break; }
      await page.getByRole('button', { name: /^Next$/ }).click();
    }
    marks.submitted = Date.now() - t0;

    // Post-check coaching fires a live Gemini call; reaching the dashboard proves
    // the flow survived it (coaching falls back silently under load).
    await page.getByRole('button', { name: /View my dashboard/i }).click({ timeout: 60_000 });
    await expect(
      page.getByRole('button', { name: /Take the other assessment|Retake an assessment/i })
    ).toBeVisible({ timeout: 60_000 });
    marks.dashboard = Date.now() - t0;

    return { id, ok: true, ms: Date.now() - t0, marks, errors: errors.slice(0, 3) };
  } catch (err) {
    return { id, ok: false, ms: Date.now() - t0, marks, error: String(err).split('\n')[0].slice(0, 140), errors: errors.slice(0, 3) };
  } finally {
    await page.close().catch(() => {});
  }
}

test(`${N} navigators run the full check concurrently`, async ({ browser }) => {
  const t0 = Date.now();
  const contexts = await Promise.all(Array.from({ length: N }, () => browser.newContext()));
  const results = await Promise.all(contexts.map((ctx, i) => runNavigatorJourney(ctx, i)));
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  const wall = Date.now() - t0;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => times.length ? times[Math.min(times.length - 1, Math.floor((q / 100) * times.length))] : 0;

  console.log(`\n=== Concurrent load: ${N} navigators, full MCQ+coaching journey ===`);
  console.log(`Completed end-to-end : ${ok.length}/${N}`);
  console.log(`Failed               : ${failed.length}/${N}`);
  if (times.length) {
    console.log(`Journey time (ms)    : min ${times[0]} · p50 ${p(50)} · p95 ${p(95)} · max ${times[times.length - 1]}`);
  }
  console.log(`Total wall time      : ${wall}ms`);
  for (const f of failed) console.log(`  FAIL #${f.id} @${f.ms}ms — ${f.error}${f.errors?.length ? ' | console: ' + f.errors.join(' ; ') : ''}`);
  const anyConsole = results.flatMap((r) => r.errors || []);
  if (anyConsole.length) console.log(`Browser console errors (sample): ${[...new Set(anyConsole)].slice(0, 5).join(' ; ')}`);
  console.log('');

  // Load-test assertion: a strong majority must complete. We tolerate a few
  // failures under deliberate stress rather than demanding a perfect run.
  expect(ok.length, 'majority of concurrent navigators complete the journey').toBeGreaterThanOrEqual(Math.ceil(N * 0.7));
});
