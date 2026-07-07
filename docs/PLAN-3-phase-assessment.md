# PLAN — 3-Phase Assessment Flow (F26)

> **Execution instructions for the implementing agent.** Follow this plan step by step, in
> order. Every edit below names the exact file, the exact anchor text to find, and the exact
> replacement. Where a whole new file is given, create it verbatim. Do not improvise
> alternative designs — all design decisions are already made and recorded here. When done,
> run the validation gates in Step 9 and the doc updates in Step 10.
>
> Written 2026-07-07 against commit `6ebb82e` (branch `main`).

## 0. Pre-verified facts (checked against the working tree — do not re-derive)

- Baseline `npm test` is green: **363 tests / 14 files** pass before any change.
- `src/components/components.test.jsx` already imports `render, screen, fireEvent, waitFor`
  from `@testing-library/react` and runs under `// @vitest-environment jsdom` — you only need
  to add the `PhaseHub` import there.
- That test file mocks `../lib/db.js` with only `getRoster`/`updateRosterEntry`. This is safe
  for `PhaseHub`: its import chain (`lib/phases.js`, `lib/scoring.js` → `data/*`) never
  touches `db.js`. Do NOT import `NavigatorApp` into this test file — it does use `db.js`.
- All CSS variables used in Step 5 exist in `styles.css` `:root` (`--ink-faint`, `--ink-soft`,
  `--line`, `--accent`, `--accent-soft`, `--shadow-md`, `--level-canteach`, `--level-solid`,
  `--level-learning`), and `color-mix(...)` is already used elsewhere in the stylesheet.
- `AssessmentTypeChooser` and the string `'typeselect'` exist **only** in
  `src/components/NavigatorApp.jsx`; every occurrence is covered by a Step 4 edit. After
  Step 4 completes, `grep -r "typeselect\|AssessmentTypeChooser" src/` must return nothing.
- **Steps 1–3 and 6 are dry-run verified:** the exact contents of `src/lib/phases.js`,
  `src/lib/phases.test.js`, `src/components/PhaseHub.jsx`, and the PhaseHub describe block
  were created verbatim and run — **18/18 tests passed on the first run** with zero edits
  (2026-07-07). Copy them character-for-character; if a test fails, suspect a transcription
  error before suspecting the plan.
- All anchors and the 363-test baseline were verified against the **current working tree**,
  which already contains uncommitted 2026-07-07 audit-pass changes (see the ⚠ in Step 9).
  Do not `git checkout`/`git stash` anything before starting.

---

## 1. Goal

Today a navigator picks **one** of three assessment types at `AssessmentTypeChooser`
(Multiple choice / Spot the Error / Call QA Test). Change this into a **single sequenced
3-phase assessment** per department:

1. **Phase 1 — Multiple choice** (the MCQ scenario check, `Check.jsx`)
2. **Phase 2 — Spot the Error** (full-profile mode, one item per domain, `SpotTheError.jsx`)
3. **Phase 3 — Call QA Test** (graded voice call, `VoiceCall.jsx` with `mode="test"`) — the final phase

A phase unlocks only when all earlier phases are complete. Completed phases can be retaken
at any time (retaking never re-locks later phases).

## 2. Design decisions (already made — do not revisit)

- **D1 — No data-model change.** Each phase keeps saving exactly what it saves today:
  - Phase 1 → `results` doc `${navigatorId}__${dept}` (`assessmentType:'mcq'`) via `saveResult`.
  - Phase 2 → `results` doc `${navigatorId}__${dept}__spot` via `saveResult`.
  - Phase 3 → an `interviews` doc with a `qa` field (written by `VoiceCall` via
    `saveInterview` + `updateInterviewGrade`). **The QA test does NOT write a results doc**
    (removed 2026-07-07 — see docs/HISTORY.md top entry). Do not re-add that write.
- **D2 — Phase completion is DERIVED, never stored.** No new Firestore fields, no flags:
  - `mcq` complete ⇔ `resultsByType.mcq` is truthy for the active department.
  - `spot` complete ⇔ `resultsByType.spot` is truthy for the active department.
  - `qa` complete ⇔ `latestQaForDept(interviews, dept)` is truthy (an interview doc for this
    department that has a `qa` field). A saved-but-ungraded call does **not** count; a
    FAIL or NEEDS REVIEW verdict **does** count (completion = took the test, not passed it).
- **D3 — The chooser becomes a Phase Hub.** The `typeselect` view is renamed `phases` and
  `AssessmentTypeChooser` is replaced by a new `PhaseHub` component (its own file). Each of
  the three cards is in one of three states: `done` (summary + Retake), `next` (the first
  incomplete phase — the only clickable "start" card), `locked` (dimmed, not clickable).
- **D4 — Between phases the navigator returns to the hub**, not straight into the next
  assessment. Rationale: Phase 3 needs a mic; the hub is the natural breather/progress
  screen. After the MCQ the existing coaching screen still shows first (unchanged), and its
  "Continue" now lands on the hub instead of the dashboard while phases remain.
- **D5 — Landing rule.** On department select: if **all 3** phases are complete → `dashboard`
  (as before); otherwise → `phases` hub. The nav tabs (My results / My history / My training /
  Practice) are NOT gated — only the assessment flow is sequenced.
- **D6 — The Practice tab loses its "Call QA Test" card.** The graded QA test is now
  exclusively Phase 3 of the assessment (taking it from Practice would let a navigator
  complete Phase 3 before Phases 1–2). Practice keeps Voice call + Text chat (ungraded).
- **D7 — Retakes.** From the hub, any `done` card offers "Retake". The dashboard's
  `QaLatestCard` "Retake" button still deep-links straight to the QA test (allowed, because
  it only renders when a QA result exists, i.e. Phase 3 is already complete).
- **D8 — Legacy data.** A navigator with only a Spot result (took it standalone under the old
  chooser) sees: Phase 1 `next`, Phase 2 `done`, Phase 3 `locked` — the `next` pointer is
  always the **first incomplete** phase in order. Legacy `results` docs with the `__qa`
  suffix are ignored for completion (interview docs are the source of truth) but
  `resultsByType.qa` keeps being fetched because `MyHistory` receives `resultsByType`.

---

## 3. Step 1 — New pure helper module `src/lib/phases.js`

Create `src/lib/phases.js` with exactly this content:

```js
// ─────────────────────────────────────────────────────────────────────────────
// 3-phase assessment flow — pure helpers (no React, no Firestore).
//
// The department assessment is a fixed sequence of three phases:
//   1. 'mcq'  — multiple-choice scenario check
//   2. 'spot' — Spot the Error (full profile, one item per domain)
//   3. 'qa'   — Call QA Test (graded voice call) — the final phase
//
// Completion is DERIVED from stored data, never persisted as a flag:
//   mcq  — an MCQ result doc exists for the department
//   spot — a Spot result doc exists for the department
//   qa   — a graded QA interview (interview doc with a `qa` field) exists
//          for the department
//
// State rules: a phase is 'done' when complete; the FIRST incomplete phase in
// order is 'next' (the only startable one); every later incomplete phase is
// 'locked'. Retaking an earlier phase never re-locks later phases.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE_ORDER = ['mcq', 'spot', 'qa'];

export const PHASE_META = {
  mcq: {
    num: 1,
    title: 'Multiple choice',
    glyph: '📝',
    desc: 'Work through scenario questions and choose the best action. Measures every domain and competency.',
  },
  spot: {
    num: 2,
    title: 'Spot the Error',
    glyph: '🔍',
    desc: 'Read call transcripts and find where the agent broke policy — one per domain, one click each.',
  },
  qa: {
    num: 3,
    title: 'Call QA Test',
    glyph: '🎯',
    desc: 'The final phase: a graded voice call scored against the full quality scorecard. Pass or fail. Needs a mic.',
  },
};

/**
 * Build the per-phase display state from a completion map.
 * @param {{mcq?:boolean, spot?:boolean, qa?:boolean}} done
 * @returns {{id:string, state:'done'|'next'|'locked'}[]} one entry per phase, in order
 */
export function buildPhases(done = {}) {
  const firstIncomplete = PHASE_ORDER.find((id) => !done[id]) ?? null;
  return PHASE_ORDER.map((id) => ({
    id,
    state: done[id] ? 'done' : id === firstIncomplete ? 'next' : 'locked',
  }));
}

/** True when every phase is complete. */
export function phasesComplete(done = {}) {
  return PHASE_ORDER.every((id) => done[id]);
}

/** The id of the first incomplete phase, or null when all are done. */
export function nextPhase(done = {}) {
  return PHASE_ORDER.find((id) => !done[id]) ?? null;
}

/** How many phases are complete (0–3). */
export function completedCount(done = {}) {
  return PHASE_ORDER.filter((id) => done[id]).length;
}
```

## 4. Step 2 — Unit tests `src/lib/phases.test.js`

Create `src/lib/phases.test.js` with exactly this content:

```js
import { describe, it, expect } from 'vitest';
import { PHASE_ORDER, buildPhases, phasesComplete, nextPhase, completedCount } from './phases.js';

const states = (done) => buildPhases(done).map((p) => p.state);

describe('PHASE_ORDER', () => {
  it('is the fixed mcq → spot → qa sequence', () => {
    expect(PHASE_ORDER).toEqual(['mcq', 'spot', 'qa']);
  });
});

describe('buildPhases', () => {
  it('nothing done: phase 1 is next, the rest locked', () => {
    expect(states({})).toEqual(['next', 'locked', 'locked']);
  });
  it('mcq done: spot is next, qa locked', () => {
    expect(states({ mcq: true })).toEqual(['done', 'next', 'locked']);
  });
  it('mcq+spot done: qa is next', () => {
    expect(states({ mcq: true, spot: true })).toEqual(['done', 'done', 'next']);
  });
  it('all done: everything done, nothing next or locked', () => {
    expect(states({ mcq: true, spot: true, qa: true })).toEqual(['done', 'done', 'done']);
  });
  it('legacy out-of-order completion (spot only): first incomplete is still next', () => {
    // A navigator who took Spot standalone under the old chooser.
    expect(states({ spot: true })).toEqual(['next', 'done', 'locked']);
  });
  it('qa only: mcq next, spot locked, qa done', () => {
    expect(states({ qa: true })).toEqual(['next', 'locked', 'done']);
  });
  it('preserves phase ids in order', () => {
    expect(buildPhases({}).map((p) => p.id)).toEqual(['mcq', 'spot', 'qa']);
  });
  it('tolerates undefined input', () => {
    expect(states(undefined)).toEqual(['next', 'locked', 'locked']);
  });
});

describe('phasesComplete', () => {
  it('false when any phase is missing', () => {
    expect(phasesComplete({ mcq: true, spot: true })).toBe(false);
    expect(phasesComplete({})).toBe(false);
  });
  it('true only when all three are done', () => {
    expect(phasesComplete({ mcq: true, spot: true, qa: true })).toBe(true);
  });
});

describe('nextPhase', () => {
  it('walks the sequence', () => {
    expect(nextPhase({})).toBe('mcq');
    expect(nextPhase({ mcq: true })).toBe('spot');
    expect(nextPhase({ mcq: true, spot: true })).toBe('qa');
  });
  it('null when complete', () => {
    expect(nextPhase({ mcq: true, spot: true, qa: true })).toBe(null);
  });
});

describe('completedCount', () => {
  it('counts done phases', () => {
    expect(completedCount({})).toBe(0);
    expect(completedCount({ mcq: true, qa: true })).toBe(2);
    expect(completedCount({ mcq: true, spot: true, qa: true })).toBe(3);
  });
});
```

## 5. Step 3 — New component `src/components/PhaseHub.jsx`

Create `src/components/PhaseHub.jsx` with exactly this content:

```jsx
import { buildPhases, PHASE_META, completedCount, nextPhase } from '../lib/phases.js';
import { departmentOverall } from '../lib/scoring.js';

// ─────────────────────────────────────────────────────────────────────────────
// PhaseHub — the navigator's 3-phase assessment home (replaces the old
// AssessmentTypeChooser). Shows the fixed sequence MCQ → Spot the Error →
// Call QA Test. Only the first incomplete phase is startable; completed phases
// show a result summary and a Retake button; later phases are locked.
//
// Props:
//   deptName  — display name of the active department
//   done      — { mcq:boolean, spot:boolean, qa:boolean } completion map
//   results   — resultsByType from NavigatorApp ({ mcq, spot, qa } result docs)
//   latestQa  — latest QA interview for this dept ({ qa:{...}, endedAt }) or null
//   onStart   — (phaseId) => void: start/retake a phase
// ─────────────────────────────────────────────────────────────────────────────

function phaseSummary(id, results, latestQa) {
  if (id === 'qa') {
    const qa = latestQa?.qa;
    if (!qa) return null;
    const needsReview = qa.review?.recommendation === 'needs_review';
    return {
      label: needsReview ? 'NEEDS REVIEW' : qa.pass ? 'PASS' : 'FAIL',
      detail: `${qa.score}/100`,
      tone: needsReview ? 'review' : qa.pass ? 'pass' : 'fail',
    };
  }
  const scores = results?.[id]?.scores;
  const overall = scores ? departmentOverall(scores) : null;
  return overall == null ? null : { label: 'Completed', detail: `avg ${overall}%`, tone: 'pass' };
}

export default function PhaseHub({ deptName, done = {}, results, latestQa, onStart }) {
  const phases = buildPhases(done);
  const doneCount = completedCount(done);
  const allDone = doneCount === 3;
  const next = nextPhase(done);

  return (
    <section className="interview view-enter">
      <header className="overview__head">
        <div>
          <h1 className="overview__title">Your assessment — 3 phases</h1>
          <p className="overview__lede">
            The {deptName} assessment runs in three phases, in order. Complete all three to
            finish; you can retake any completed phase later.
          </p>
        </div>
      </header>

      <div className="phase-hub__progress" role="status">
        <span className="phase-hub__progress-label">
          {allDone ? 'All 3 phases complete' : `${doneCount} of 3 phases complete`}
        </span>
        <span className="phase-hub__dots" aria-hidden="true">
          {phases.map((p) => (
            <span key={p.id} className={`phase-hub__dot phase-hub__dot--${p.state}`} />
          ))}
        </span>
      </div>

      <div className="practice-choice">
        {phases.map((p) => {
          const meta = PHASE_META[p.id];
          const summary = p.state === 'done' ? phaseSummary(p.id, results, latestQa) : null;
          const clickable = p.state !== 'locked';
          return (
            <button
              key={p.id}
              type="button"
              className={`card practice-choice__card phase-card phase-card--${p.state}`}
              onClick={clickable ? () => onStart(p.id) : undefined}
              disabled={!clickable}
              aria-disabled={!clickable}
            >
              <span className="phase-card__phase">Phase {meta.num}</span>
              {p.state === 'done' && summary && (
                <span className={`phase-card__summary phase-card__summary--${summary.tone}`}>
                  ✓ {summary.label} · {summary.detail}
                </span>
              )}
              <span className="practice-choice__glyph" aria-hidden="true">{meta.glyph}</span>
              <h2 className="practice-choice__title">{meta.title}</h2>
              <p className="practice-choice__desc">{meta.desc}</p>
              {p.state === 'next' && (
                <span className="phase-card__cta">{done[p.id] ? 'Retake' : doneCount > 0 ? 'Continue →' : 'Start →'}</span>
              )}
              {p.state === 'done' && <span className="phase-card__cta phase-card__cta--ghost">Retake</span>}
              {p.state === 'locked' && (
                <span className="phase-card__lock">🔒 Complete Phase {meta.num - 1} first</span>
              )}
            </button>
          );
        })}
      </div>

      {next === 'qa' && (
        <p className="readoff__sub phase-hub__note">
          Phase 3 is a live voice call — you&rsquo;ll need a microphone (Chrome/Edge work best).
        </p>
      )}
    </section>
  );
}
```

Note: `done[p.id]` is never true when `p.state === 'next'` (by construction), so the
`'Retake'` branch inside the `next` CTA is dead-safe defensive copy — leave it as written.

## 6. Step 4 — Rewire `src/components/NavigatorApp.jsx`

All edits below are in `src/components/NavigatorApp.jsx`. Apply in order. Line numbers
reference the current file (commit `6ebb82e`) — use the anchor text, not the numbers.

### 4.1 Imports (top of file)

- Replace the line `import SpotTheError from './SpotTheError.jsx';` region: after the
  existing `import SpotTheError...` line add:
  ```js
  import PhaseHub from './PhaseHub.jsx';
  ```
- After the `import { MINICHECK_SIZE, MINICHECK_PASS } from '../data/config.js';` line add:
  ```js
  import { phasesComplete, completedCount } from '../lib/phases.js';
  ```
- The `getInterviews` import already exists in the `../lib/db.js` import — no change needed there.

### 4.2 View-list comment (line 42)

Replace:
```js
const [view, setView] = useState('loading'); // loading · deptselect · typeselect · check · spotfull · coaching · dashboard · history · training · module · interview · audit · minicheck
```
with:
```js
const [view, setView] = useState('loading'); // loading · deptselect · phases · check · spotfull · coaching · dashboard · history · training · module · interview · audit · minicheck · qatest
```

### 4.3 `handleDeptSelect` — fetch interviews and land on hub vs dashboard (lines 117–143)

Replace the whole `handleDeptSelect` function body's try-block logic. Current anchor
(lines 120–138):
```js
    try {
      const [mcq, spot, qa] = await Promise.all([
        getResult(navigatorId, dept, 'mcq'),
        getResult(navigatorId, dept, 'spot'),
        getResult(navigatorId, dept, 'qa'),
      ]);
      setResultsByType({ mcq, spot, qa });
      const byType = { mcq, spot, qa };
      const type = pickActiveType(byType);
      setActiveType(type);
      // Fetch the active question bank for this department (needed by MCQ + coaching).
      const qs = await getActiveQuestions(dept).catch(() => []);
      setQuestions(qs.length > 0 ? qs : (SEED_BY_DEPT[dept] ?? SEED_QUESTIONS));
      if (type) {
        setAllDeptResults((prev) => ({ ...prev, [dept]: byType[type].scores }));
        setView('dashboard');
      } else {
        setView('typeselect'); // no results yet → pick an assessment
      }
    } catch {
```
Replace with:
```js
    try {
      const [mcq, spot, qa, ivs] = await Promise.all([
        getResult(navigatorId, dept, 'mcq'),
        getResult(navigatorId, dept, 'spot'),
        getResult(navigatorId, dept, 'qa'),
        getInterviews(navigatorId).catch(() => []),
      ]);
      setResultsByType({ mcq, spot, qa });
      setInterviews(ivs);
      const byType = { mcq, spot, qa };
      const type = pickActiveType(byType);
      setActiveType(type);
      // Fetch the active question bank for this department (needed by MCQ + coaching).
      const qs = await getActiveQuestions(dept).catch(() => []);
      setQuestions(qs.length > 0 ? qs : (SEED_BY_DEPT[dept] ?? SEED_QUESTIONS));
      if (type) setAllDeptResults((prev) => ({ ...prev, [dept]: byType[type].scores }));
      // Land on the dashboard only when the full 3-phase assessment is complete;
      // otherwise the phase hub shows what's next (D5).
      const allDone = phasesComplete({
        mcq: Boolean(mcq),
        spot: Boolean(spot),
        qa: Boolean(latestQaForDept(ivs, dept)),
      });
      setView(allDone ? 'dashboard' : 'phases');
    } catch {
```
(`latestQaForDept` is a hoisted function declaration defined later in this file — calling it
here is fine.)

### 4.4 Interviews effect — also load on the hub (lines 179–190)

In the interviews-loading `useEffect`, replace:
```js
    if (view !== 'dashboard' && view !== 'training') return undefined;
```
(the one in the effect that calls `getInterviews`) with:
```js
    if (view !== 'dashboard' && view !== 'training' && view !== 'phases') return undefined;
```
⚠ There are TWO effects with that exact guard line (one for completions, one for
interviews). Only change the **second** one — the effect whose body calls
`getInterviews(navigatorId)`. Leave the completions effect untouched.

### 4.5 `handleTakeAnother` (line 252)

Replace:
```js
  // From the dashboard: go take another assessment (MCQ or Spot) for this dept.
  const handleTakeAnother = () => setView('typeselect');
```
with:
```js
  // From the dashboard: back to the 3-phase assessment hub (continue or retake).
  const handleTakeAnother = () => setView('phases');
```

### 4.6 Phase-completion map + after-phase router (around lines 332–344)

Directly AFTER the existing lines
```js
  const latestQa = latestQaForDept(interviews, dept);
  const practiceInterviews = interviews.filter((iv) => !iv?.qa);
```
insert:
```js
  // 3-phase assessment: completion is derived, never stored (see src/lib/phases.js).
  // Phase 3 completion comes from the interview docs (the QA test does not write a
  // results doc), so a saved-but-ungraded call does not count as complete.
  const phaseDone = { mcq: hasMcq, spot: hasSpot, qa: Boolean(latestQa) };
  // Where to go after finishing a phase: the hub while phases remain, else the dashboard.
  const afterPhase = () => setView(phasesComplete(phaseDone) ? 'dashboard' : 'phases');
```

### 4.7 Replace the `typeselect` render block (lines 411–418)

Replace:
```jsx
      {view === 'typeselect' && (
        <AssessmentTypeChooser
          deptName={deptName}
          taken={{ mcq: hasMcq, spot: hasSpot, qa: hasQa }}
          latestQa={latestQa}
          onPick={(type) => setView(type === 'spot' ? 'spotfull' : type === 'qa' ? 'qatest' : 'check')}
        />
      )}
```
with:
```jsx
      {view === 'phases' && (
        <PhaseHub
          deptName={deptName}
          done={phaseDone}
          results={resultsByType}
          latestQa={latestQa}
          onStart={(id) => setView(id === 'spot' ? 'spotfull' : id === 'qa' ? 'qatest' : 'check')}
        />
      )}
```

### 4.8 Route the exits of each phase back to the hub

- **Check** (line 423): replace `onCancel={() => setView('typeselect')}` with
  `onCancel={() => setView('phases')}`.
- **SpotTheError full mode** (lines 439–440): replace
  ```jsx
          onBack={() => setView('typeselect')}
          onFinish={() => setView('dashboard')}
  ```
  with
  ```jsx
          onBack={() => setView('phases')}
          onFinish={afterPhase}
  ```
- **VoiceCall qatest** (line 452): replace `onExit={() => setView('typeselect')}` with
  `onExit={() => setView('phases')}`. Leave `onDone={() => setView('dashboard')}` as is
  (Phase 3 is final — after it the assessment is complete).
- **Coaching** (line 466): replace `onContinue={() => setView('dashboard')}` with
  `onContinue={afterPhase}`.

### 4.9 Dashboard empty state (lines 500–504)

Replace:
```jsx
            <EmptyState title="No domain results yet">
              Take any assessment and your six domain scores will appear here.{' '}
              <button className="linkbtn" onClick={() => setView('typeselect')}>Start one now</button>.
            </EmptyState>
```
with:
```jsx
            <EmptyState title="No domain results yet">
              Complete the assessment phases and your six domain scores will appear here.{' '}
              <button className="linkbtn" onClick={() => setView('phases')}>Start Phase 1 now</button>.
            </EmptyState>
```

### 4.10 AssessmentBar — phase-aware CTA

At the call site (lines 477–482) replace:
```jsx
              <AssessmentBar
                activeType={activeType}
                resultsByType={resultsByType}
                onSwitch={handleSwitchType}
                onTakeAnother={handleTakeAnother}
              />
```
with:
```jsx
              <AssessmentBar
                activeType={activeType}
                resultsByType={resultsByType}
                onSwitch={handleSwitchType}
                onTakeAnother={handleTakeAnother}
                phasesDone={completedCount(phaseDone)}
              />
```
Then in the `AssessmentBar` function definition, replace the signature line:
```jsx
function AssessmentBar({ activeType, resultsByType, onSwitch, onTakeAnother }) {
```
with:
```jsx
function AssessmentBar({ activeType, resultsByType, onSwitch, onTakeAnother, phasesDone = 0 }) {
```
and replace its trailing button:
```jsx
      <button type="button" className="btn btn--ghost btn--sm" onClick={onTakeAnother}>
        {multiTaken ? 'Retake an assessment' : 'Take another assessment'}
      </button>
```
with:
```jsx
      <button type="button" className="btn btn--ghost btn--sm" onClick={onTakeAnother}>
        {phasesDone >= 3 ? 'Retake a phase' : `Continue assessment (Phase ${phasesDone + 1} of 3)`}
      </button>
```

### 4.11 Delete `AssessmentTypeChooser`

Delete the entire `AssessmentTypeChooser` function (lines 715–756, from
`function AssessmentTypeChooser({ deptName, taken = {}, latestQa, onPick }) {` through its
closing `}`), and the stale comment line directly above `QaLatestCard`:
```js
// Assessment-type chooser: all three assessment types feed the capability matrix.
```
(keep `QaLatestCard` itself — it is still used by the dashboard).

Also remove the now-unused `const hasQa = Boolean(resultsByType.qa);` (line 76) **only if**
nothing else references `hasQa` after your edits (it was only used by the deleted chooser
props). Search the file for `hasQa` before deleting; if the build/lint complains about an
unused variable, this is why.

### 4.12 Remove the QA test from the Practice tab (D6)

- In `PracticeChooser` (bottom of the file), delete the third card entirely:
  ```jsx
        <button className="card practice-choice__card practice-choice__card--test" onClick={() => onPick('test')} type="button">
          <span className="practice-choice__glyph" aria-hidden="true">🎯</span>
          <h2 className="practice-choice__title">Call QA Test</h2>
          <p className="practice-choice__desc">
            A graded voice call scored hard against the full quality scorecard — pass or fail,
            with auto-fail rules. Needs a mic.
          </p>
        </button>
  ```
- Delete the corresponding render branch (lines 554–563):
  ```jsx
      {view === 'interview' && practiceMode === 'test' && (
        <VoiceCall
          navigatorId={navigatorId}
          name={name}
          department={dept}
          onExit={() => setPracticeMode(null)}
          onQaResult={handleQaComplete}
          mode="test"
        />
      )}
  ```
- Update the `practiceMode` comment (line 55) from
  `// null (chooser) · 'voice' · 'chat'` — it already says that; just ensure no `'test'`
  mention remains anywhere in comments.
- **CSS cleanup:** after both deletions in this step and Step 4.11, the class
  `practice-choice__card--test` has no remaining users. Delete its rule from
  `src/styles.css` (around line 5038, under the `/* ── Call QA Test … ── */` banner):
  ```css
  .practice-choice__card--test {
    border-color: var(--accent);
  }
  ```
  Keep the banner comment and everything below it (`.qa-result` etc. — still used by
  `VoiceCall.jsx`). Verify with a project-wide search that `practice-choice__card--test`
  has zero references before deleting.

### 4.13 QaLatestCard retake stays

No change: `onRetake={() => setView('qatest')}` (line 473) is correct — the card only
renders when a QA result exists, i.e. Phase 3 is already done, so the direct deep-link
cannot skip phases.

## 7. Step 5 — CSS additions in `src/styles.css`

Append this block at the end of `src/styles.css` (it reuses the existing
`.practice-choice__card` layout; only phase-specific decoration is new):

```css
/* ── 3-phase assessment hub (PhaseHub.jsx) ──────────────────────────────── */
.phase-hub__progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.phase-hub__progress-label {
  font-size: 0.9rem;
  color: var(--ink-soft);
  font-weight: 600;
}
.phase-hub__dots { display: inline-flex; gap: 0.4rem; }
.phase-hub__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--line);
}
.phase-hub__dot--done { background: var(--level-canteach); }
.phase-hub__dot--next {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}
.phase-hub__note { margin-top: 1rem; }

.phase-card { position: relative; }
.phase-card__phase {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint, var(--ink-soft));
}
.phase-card--next { border-color: var(--accent); box-shadow: var(--shadow-md, 0 4px 14px rgba(0,0,0,0.08)); }
.phase-card--locked {
  opacity: 0.55;
  cursor: not-allowed;
  filter: saturate(0.4);
}
.phase-card__summary {
  font-size: 0.8rem;
  font-weight: 700;
}
.phase-card__summary--pass { color: var(--level-canteach); }
.phase-card__summary--fail { color: var(--level-learning); }
.phase-card__summary--review { color: var(--level-solid); }
.phase-card__cta {
  margin-top: 0.5rem;
  font-weight: 700;
  color: var(--accent);
}
.phase-card__cta--ghost { color: var(--ink-soft); font-weight: 600; }
.phase-card__lock {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--ink-soft);
}
```

If `color-mix` reads as too clever, an acceptable fallback for the `--next` dot ring is
`box-shadow: 0 0 0 3px var(--accent-soft);` (the `--accent-soft` token exists in `:root`).
Check `:root` in `styles.css` for `--ink-faint`; if it doesn't exist, the provided fallback
`var(--ink-faint, var(--ink-soft))` already handles it — leave as written.

## 8. Step 6 — Component tests (append to `src/components/components.test.jsx`)

Append a new describe block to the existing `src/components/components.test.jsx` (reuse its
existing imports of `render`/`screen`; add `import PhaseHub from './PhaseHub.jsx';` next to
the other component imports at the top, and `fireEvent` if not already imported from
`@testing-library/react`):

```jsx
describe('PhaseHub', () => {
  const noop = () => {};

  it('locks phases 2 and 3 when nothing is done', () => {
    render(<PhaseHub deptName="Pediatrics" done={{}} results={{}} latestQa={null} onStart={noop} />);
    expect(screen.getByText('0 of 3 phases complete')).toBeTruthy();
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    expect(cards).toHaveLength(3);
    expect(cards[0].disabled).toBe(false);
    expect(cards[1].disabled).toBe(true);
    expect(cards[2].disabled).toBe(true);
    expect(screen.getAllByText(/Complete Phase \d first/)).toHaveLength(2);
  });

  it('starts the first phase on click', () => {
    let picked = null;
    render(<PhaseHub deptName="Pediatrics" done={{}} results={{}} latestQa={null} onStart={(id) => { picked = id; }} />);
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    fireEvent.click(cards[0]);
    expect(picked).toBe('mcq');
  });

  it('unlocks phase 2 after the MCQ and shows its summary', () => {
    const results = { mcq: { scores: { intake: 80, classification: 60 } } };
    let picked = null;
    render(<PhaseHub deptName="Pediatrics" done={{ mcq: true }} results={results} latestQa={null} onStart={(id) => { picked = id; }} />);
    expect(screen.getByText('1 of 3 phases complete')).toBeTruthy();
    expect(screen.getByText(/avg 70%/)).toBeTruthy();
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    fireEvent.click(cards[1]);
    expect(picked).toBe('spot');
    expect(cards[2].disabled).toBe(true);
  });

  it('shows the QA verdict and all-complete state when every phase is done', () => {
    const latestQa = { qa: { pass: false, score: 62, review: null } };
    render(
      <PhaseHub
        deptName="Pediatrics"
        done={{ mcq: true, spot: true, qa: true }}
        results={{ mcq: { scores: { intake: 90 } }, spot: { scores: { intake: 100 } } }}
        latestQa={latestQa}
        onStart={noop}
      />
    );
    expect(screen.getByText('All 3 phases complete')).toBeTruthy();
    expect(screen.getByText(/FAIL · 62\/100/)).toBeTruthy();
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('phase-card'));
    expect(cards.every((c) => !c.disabled)).toBe(true);
  });
});
```

Adjust the summary-text assertions only if the rendered text nodes split differently
(e.g. use a function matcher) — do not change the component to make a selector easier.
Note the summary renders as `✓ FAIL · 62/100` inside one span, and `avg 70%` — check with
`screen.debug()` if a matcher misses, and prefer regex matchers as written above.

## 9. Step 7 — Validation gates (all must pass)

```bash
npm test        # expect: previous 363 tests still green + the new phases.test.js and PhaseHub tests
npm run build   # must be clean (the existing Firebase chunk-size warning is acceptable)
```

No `api/*` files change in this work — no `node --check` needed.

Manual smoke path (only if a browser is available; otherwise rely on tests):
1. Sign in as a navigator with no results → dept select → should land on the Phase Hub with
   Phase 1 startable, 2–3 locked.
2. Complete the MCQ → coaching → Continue → hub shows Phase 1 done, Phase 2 startable.
3. Complete Spot the Error → Save & finish → hub shows Phase 3 startable.
4. Practice tab shows only two cards (Voice call / Text chat).

## 10. Step 8 — Documentation updates (mandatory — the change is not done without these)

### `CLAUDE.md`
1. **Add a new feature entry** `### F26 — 3-Phase Assessment Flow` in §4 after F25, describing:
   purpose (sequenced MCQ → Spot → QA test per department), the derived-completion rule (D2),
   the PhaseHub component, the landing rule (D5), the Practice-tab QA card removal (D6), and
   files touched (`src/lib/phases.js`, `src/components/PhaseHub.jsx`,
   `src/components/NavigatorApp.jsx`, `src/styles.css`, tests). Status: Complete.
2. **F16 entry** — update the "Entry" bullet: `AssessmentTypeChooser` no longer exists; the
   full-profile Spot the Error is now **Phase 2** of the sequenced assessment (view `phases`
   in `NavigatorApp`). The per-domain training-plan launch is unchanged.
3. **F25 entry** — update: the Call QA Test is now **Phase 3** (final) of the sequenced
   assessment; the Practice-tab "Call QA Test" card was removed (the test lives only in the
   assessment flow); the dashboard QA card + supervisor views are unchanged.
4. **§8 Current System State** — rewrite the "choose an assessment type" sentence to describe
   the 3-phase sequence; update the test count (run `npm test` and use the real number).
5. **§9** — add `phases.js` to the lib file listing if the folder structure block is touched
   (optional; the structure block lists directories, not every file — skip if noisy).

### `docs/HISTORY.md`
Add a new top entry dated **2026-07-07** titled "3-phase assessment flow (F26)" — context
(owner request: sequence the three assessment types into one 3-phase test), decisions D1–D8
in brief, files, and the verification results (test count, build).

## 11. Step 9 — Commit

⚠ **The working tree already contains UNCOMMITTED, UNRELATED changes** (the 2026-07-07
"audit follow-ups" pass — `server.js`, several `api/*` files, `db.js`, `scoring.js`,
`NavigatorApp.jsx`, `SupervisorApp.jsx`, `CLAUDE.md`, `docs/HISTORY.md`, new
`api/_rate-limit.js`). Do **not** stage them wholesale and do **not** discard them. Stage
only the files this plan touches, explicitly:

```bash
git add src/lib/phases.js src/lib/phases.test.js src/components/PhaseHub.jsx \
        src/components/NavigatorApp.jsx src/components/components.test.jsx \
        src/styles.css CLAUDE.md docs/HISTORY.md
```

Note `NavigatorApp.jsx`, `CLAUDE.md`, and `docs/HISTORY.md` already carry audit-pass edits —
staging them will include those pre-existing hunks in your commit. That is acceptable only if
the owner confirms; otherwise ask the owner to commit the audit work first, then commit this
plan's work on top. **If in doubt, stop and ask before committing.**

Single commit straight to `main` (this repo commits to main; Railway auto-deploys on push —
**do not push** unless the owner asked for deploy; committing is enough):

```
Make the assessment a sequenced 3-phase test (MCQ → Spot the Error → Call QA)

- New PhaseHub replaces AssessmentTypeChooser: phases unlock in order, completed
  phases show summaries + retake, completion derived (never stored)
- Phase 3 completion = graded QA interview for the dept (QA writes no results doc)
- Coaching/Spot exits route to the hub while phases remain; dept select lands on
  the hub until all 3 phases are done
- Practice tab drops the Call QA Test card (the test lives only in the assessment)
- New src/lib/phases.js (+ tests), PhaseHub component tests, hub CSS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## 12. Edge cases the implementation must respect (verify against your diff)

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | Navigator with only a legacy Spot result | Hub: Phase 1 `next`, Phase 2 `done`, Phase 3 `locked` |
| 2 | QA call saved but grading failed (no `qa` on the doc) | Phase 3 NOT complete; navigator can retry grading from the reviewed screen — `onQaResult` then marks it complete |
| 3 | QA verdict FAIL or NEEDS REVIEW | Phase 3 IS complete (completion ≠ passing); hub shows the verdict badge + Retake |
| 4 | Abandon test (`discard`) mid-call | Nothing saved; Phase 3 still `next` |
| 5 | Mid-MCQ refresh | Unchanged: sessionStorage `persistKey` progress restore still works |
| 6 | Department switch from the hub | Allowed (the hub is not in the `showDeptSwitcher` exclusion list — don't add it) |
| 7 | Legacy `results` doc with `__qa` suffix | Ignored for phase completion; still loaded into `resultsByType.qa` for MyHistory |
| 8 | Retaking Phase 1 after all 3 complete | Phases 2–3 stay `done`; after coaching, `afterPhase` routes to `dashboard` (all complete) |
| 9 | Training-plan per-domain Spot ("audit" view) & mini-checks | Untouched — they are training tools, not assessment phases |
| 10 | Supervisor app | Zero changes — result docs, interview docs, and all supervisor views are unaffected |
