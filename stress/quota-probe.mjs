// ─────────────────────────────────────────────────────────────────────────────
// GEMINI QUOTA RAMP PROBE
//
// Answers: "how many requests / how many simultaneous navigators until the key
// rotation is exhausted?" It hammers /api/generate-audit (the heaviest per-item
// AI call — one Gemini generation each) at escalating concurrency and records,
// per level: how many returned 200, how many 429 ("All Gemini keys are
// rate-limited" = rotation exhausted), latency, and cumulative successful calls.
//
// It STOPS once a level is majority-429 (plus one confirming level) so it finds
// the ceiling without needlessly draining the daily quota.
//
// Run against a running server:  node stress/quota-probe.mjs
//   env: STRESS_BASE (default http://localhost:3000), STRESS_SECRET (default 0200)
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.STRESS_BASE || 'http://localhost:3000';
const SECRET = process.env.STRESS_SECRET || '0200';
const DOMAINS = ['intake', 'classification', 'routing', 'scheduling', 'boundaries', 'documentation'];
const LEVELS = [1, 2, 3, 5, 8, 12, 16, 20, 25, 30];
const CALL_TIMEOUT_MS = 45_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneCall(i) {
  const domain = DOMAINS[i % DOMAINS.length];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/generate-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, department: 'pediatrics', secret: SECRET }),
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ms, ok: res.ok, err: body?.error };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, ok: false, err: e?.name === 'AbortError' ? 'timeout' : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  console.log(`\n=== Gemini quota ramp probe → ${BASE}/api/generate-audit ===`);
  console.log('level  fired  200  429  other  ok%   avgMs   p95Ms  cum200  note');
  let cumOk = 0;
  let totalFired = 0;
  let firstAny429 = null;
  let firstMajority429 = null;
  let confirmAfterMajority = 0;

  for (const N of LEVELS) {
    const t0 = Date.now();
    const results = await Promise.all(Array.from({ length: N }, (_, i) => oneCall(i)));
    const wall = Date.now() - t0;
    totalFired += N;
    const ok = results.filter((r) => r.ok).length;
    const n429 = results.filter((r) => r.status === 429).length;
    const other = results.filter((r) => !r.ok && r.status !== 429).length;
    const lat = results.map((r) => r.ms);
    cumOk += ok;
    if (n429 > 0 && firstAny429 === null) firstAny429 = N;
    const majority = n429 >= Math.ceil(N / 2);
    if (majority && firstMajority429 === null) firstMajority429 = N;

    const note = [];
    const sampleErr = results.find((r) => !r.ok)?.err;
    if (sampleErr) note.push(`e.g. "${String(sampleErr).slice(0, 40)}"`);
    note.push(`wall ${wall}ms`);

    console.log(
      `${String(N).padStart(5)} ${String(N).padStart(6)} ${String(ok).padStart(4)} ${String(n429).padStart(4)} ` +
      `${String(other).padStart(6)} ${String(Math.round((ok / N) * 100)).padStart(4)} ${String(Math.round(lat.reduce((s, x) => s + x, 0) / N)).padStart(7)} ` +
      `${String(pct(lat, 95)).padStart(7)} ${String(cumOk).padStart(7)}  ${note.join(' · ')}`
    );

    if (firstMajority429 !== null) {
      confirmAfterMajority++;
      if (confirmAfterMajority >= 2) break; // measured the ceiling; stop draining quota
    }
    await sleep(2000); // brief gap so levels don't stack into each other
  }

  console.log('\n--- SUMMARY ---');
  console.log(`Total requests fired      : ${totalFired}`);
  console.log(`Total successful (200)    : ${cumOk}`);
  console.log(`First concurrency w/ any 429      : ${firstAny429 ?? 'none observed'}`);
  console.log(`First concurrency majority-429    : ${firstMajority429 ?? 'none observed'}`);
  console.log('Interpretation: the rotation sustains up to ~the last all-200 level; 429s begin');
  console.log('once concurrent in-flight calls exceed the combined free-tier RPM of all keys.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
