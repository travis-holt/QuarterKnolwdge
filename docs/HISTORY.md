# Development History - Knowledge Check

## 2026-07-21 — Department-based Call QA rubric profiles; OB/GYN is the first dedicated profile

**Status: draft PR against `main`, not merged, not deployed.** No Firestore migration, no
production write, no private-scenario provisioning, and no historical grade rewritten.

### The problem

One shared rubric was treated as correct for every department. Three consequences on the
OB/GYN floor:

1. **The rubric asked for the wrong things.** It required a patient survey prompt OB/GYN does
   not run, allowed "any polite sign-off" to satisfy closing, accepted a phone number or home
   address in place of date of birth, and used Pediatrics-only documentation examples
   (`Shots PE UTD`, `GS` newborns).
2. **It was rigid where the floor is not.** Empathy and hold-narration were always-required
   (`core: true`), so a navigator lost points for not performing scripted empathy on a routine
   scheduling call, or for not narrating a two-second chart lookup — a thing a text transcript
   cannot even establish.
3. **There was nowhere to put a department difference.** The only tool available was another
   `department === 'obgyn'` branch inside the grading pipeline, which is exactly how prompt
   rules, deterministic scoring, and auto-fail logic drift apart.

### The architecture

`src/data/qaRubricProfiles.js` introduces **one authoritative resolution point** —
`getQaRubricProfile(department)`. A profile carries everything needed to grade one department:
department id, rubric version, categories/criteria, auto-fail definitions, criterion
applicability (`core`), safety-critical + repairable sets, per-criterion evidence policies, and
the department-specific grader instructions. Department behavior is **data, not branches**.

`gradeCallQaTranscript` resolves the profile ONCE from the server-authoritative department on
the stored attempt (never a browser value) and threads that single object through prompt
construction, response validation, fairness repairs, scoring, category totals, core/NA handling,
auto-fail evaluation, deterministic findings, the review layer, and the QA domain/competency
projections. Two guards make drift impossible rather than merely discouraged:
`validateQaResponse` stamps the validating profile's version onto its output, and `scoreQa`
**throws** if handed a verdict for a criterion its profile does not define.

- `pediatrics` reuses the historical shared rubric **verbatim** (`qa-rubric-v2`), so no
  non-OB/GYN verdict, point, prompt line, or version string changes.
- `obgyn` is the new `qa-rubric-obgyn-v1`.
- An unsupported department resolves to `null` and the scored runtime **fails closed** (422,
  grader never called). There is no `?? 'pediatrics'` fallback left in the scored path —
  `buildScenarioContextFromAttempt` now returns `department: null` rather than defaulting.

### The OB/GYN rubric — still 100 points, still passes at 85

Category weights are **unchanged**: Opening 10 · Verification 10 · Call Control 10 ·
Documentation Reason 10 · Communication 15 · Active Listening 10 · Knowledge 15 · Scheduling 15
· Closing 5.

| Area | Before (shared) | After (OB/GYN) |
|---|---|---|
| Opening | greeting 4 + own name 3 + org 3 | same points; greeting must also **offer assistance**; org accepts "Aizer Health" **or** "Aizer Women's Health"; navigator-name requirement **unchanged** |
| Verification | 3 identifiers incl. "**or** home address / phone number" | exactly **first name + last name + DOB**; phone/address **never** substitute; volunteered identifiers count; multi-turn collection counts |
| Empathy | `core: true` — always required | **conditional**: NA when the caller expressed no emotional/sensitive cue; MET on natural acknowledgment; NOT_MET only when a cue existed and went unacknowledged |
| Active listening | "explicitly acknowledged … *I understand*, *I hear you*" | natural recognition of the request counts; scripted empathy not required. `listen-gather` stays strict |
| Hold narration | `core: true` — narrate every system action | **conditional**: NA with no hold/meaningful wait; MET when an explained hold; NOT_MET only for an **explicit** unexplained hold. Dead air/delay may never be inferred from text |
| Documentation | Pediatrics examples (`Shots PE UTD`, `GS`) | department-neutral / OB/GYN wording. Underlying standard unchanged |
| Closing | `close-survey` 3 + `close-anything-thanks` 2 | ONE criterion **`close-offer-help`** at **5**: an explicit offer of further assistance. Thanks / goodbye / mutual close / survey-alone earn **0** |

**Survey wording is score-neutral** for OB/GYN: no points, no deduction, does not satisfy the
closing criterion, and survey + a valid offer still earns exactly 5. The grader instruction that
let "any polite sign-off" satisfy closing is **removed** for OB/GYN and retained for Pediatrics.

The new criterion uses a **new id** rather than reusing `close-survey`, which would have been
actively misleading in stored results. Its domain/competency tags are the **union** of the two
removed criteria (`documentation` + `intake`; `communication` + `customerHandling`), so closing
evidence is not silently dropped from QA domain/competency summaries — asserted by test.

`af-hipaa` for OB/GYN is rendered from the **same** `OBGYN_VERIFICATION_IDENTIFIERS` constant as
`verify-three` / `verify-before-access`, so the regular criterion and the privacy auto-fail
cannot accept different definitions.

### The `identity-verification` evidence policy

Callers routinely volunteer "this is Maria Alvarez, date of birth March 2nd 1991". Under the
navigator-only evidence rule the only quotable proof of complete verification sits in a *caller*
turn, so a correct call looked unverified. A narrow, explicitly named per-criterion policy now
lets `verify-three` / `verify-before-access` verify a contiguous quote from ONE turn of either
role. Scope limits, all tested:

- **MET credit only** — an evidence-based negative stays navigator-only, so a caller's words can
  never substantiate an accusation against the navigator.
- **Opt-in per criterion** — caller wording cannot earn an unrelated navigator-performance
  criterion (asserted against `comm-empathy` and `close-offer-help`).
- **Auto-fails are never covered**, including `af-hipaa`.
- **Order is preserved** — `verify-before-access` declares
  `evidenceOrder: 'before-protected-disclosure'` and only accepts evidence from a turn strictly
  before the first deterministically detected protected disclosure, so identifiers collected
  afterwards can never retroactively satisfy it. The disclosure detector is deliberately narrow
  and can only *reject* a MET, never create one.

### Versioning, provenance, and history

`qa.gradingMetadata` now records `rubricDepartment` alongside `rubricVersion`.
`profileForGradedAttempt()` resolves a stored result by its **recorded version first** and
returns `null` — never a guess — for an unrecognised version. QA domain/competency summaries,
the shadow-automation completeness check, and the supervisor UI all use it, so a historical
attempt keeps rendering under the rubric that graded it. The supervisor session panel now shows
"Graded with: *<department>* rubric (*version*)". `CALL_QA_PROMPT_VERSION` is **unchanged** —
the prompt *contract* (EVIDENCE/ABSENCE shapes, criterion ids, response schema) did not change;
only per-department rubric content did, which the rubric version already records.

### Tooling made department-aware

- **Calibration** validates each fixture against its own department's profile; a criterion or
  auto-fail id from another department now fails validation, as does a `rubricVersion` that is
  not that department's. Criterion metrics run over the union of profiles (each recording which
  `departments` define it); per-department coverage uses that department's own criteria.
- **Rubric drift is now measured within a department.** Two departments reporting two rubric
  versions is department identity, not drift, so the `requireSingleRubricVersion` gate checks
  `mixedRubricVersionWithinADepartment()` instead of a flat count. Grader model and prompt
  version remain global.
- **Shadow automation** measures "complete rubric output" against the profile that actually
  graded the attempt; an unrecognised rubric version is never complete (fails closed).
- **Pilot smoke** retargets its rehearsal fixtures onto the target department's rubric, carrying
  a replaced criterion's label onto its replacement so the rehearsed outcome is preserved.
- **The deterministic corpus** resolves a profile per case exactly as the real pipeline does, and
  gains three OB/GYN cases covering the fix direction and both abuse directions (conditional
  criteria NA on a routine call; a sign-off-only close failing; a worried caller's unacknowledged
  concern still costing its 5 points — "conditional" must never degrade into "never scored").

### Manual-review fixtures

`api/_qa-obgyn-review-fixtures.js` adds eight synthetic, non-production OB/GYN calls — strong
routine call, thanks-and-goodbye close, worried caller handled well, worried caller
unacknowledged, phone-instead-of-DOB, disclosure-before-DOB, quick silent chart check,
unexplained hold — each executed through the real pipeline by `api/obgynRubricProfile.test.js`.
Nothing is derived from or comparable to the private runtime bank, and none of it is calibration
evidence.

One fixture documents a genuine, pre-existing property worth naming: a call that fails **all**
identity verification still scores 88 numerically, because verification is only 10 of 100 points.
Both verification criteria are safety-critical, so the review layer refuses to call it a
confident pass and routes it to a supervisor. Numeric pass + non-final `needs_review` is the
designed behavior, not a gap — but it is now written down and asserted.

### Verification

`npm test` 1735 → **1822** across 77 → 78 files (all green). Build clean including the
private-runtime bundle scan; 12/12 safe Playwright E2E; Firestore Rules 76/76; encoding guard
clean; `qa:pilot-smoke` `PILOT_SMOKE_VERIFIED`. `qa:calibrate` and `qa:coverage` still report
`INSUFFICIENT_DATA` with 0 human-pilot fixtures — **that is the correct, expected state, not a
passing calibration result.**

## 2026-07-21 — PR #40 MERGED to `main` (`01a7f27`) and auto-deployed

The one-official-status capability redesign is live.

### What merged

| | |
|---|---|
| PR | #40 — *One official capability status per navigator per department* |
| Merged head | `a18d00b` |
| Merge commit | `01a7f27` |
| Merged by | travis-holt, 2026-07-21 |
| Diff | 38 files · +7,205 / −687 · 6 commits |

### Merge-gate evidence (checked immediately before merging)

- Local `HEAD`, `origin/feature/overall-capability-status` and GitHub's PR head were **all
  `a18d00b`** — CI ran on the exact head that merged, not an earlier one.
- Branch was **0 commits behind `main`**; `mergeable: MERGEABLE`; `mergeStateStatus: CLEAN`.
- **0 unresolved review threads** (0 reviews, 0 comments).
- GitHub Actions `verify` workflow: **success** on `headSha: a18d00b` (run 29842091680).
- Local gate, all nine commands run: `vitest` **1,735/1,735 across 77 files** · `build` clean incl.
  the Call QA private-runtime bundle scan · `test:e2e:safe` **12/12** · `test:rules` **76/76**
  (51 result-authorization + 25 Call QA) · `qa:pilot-smoke` `PILOT_SMOKE_VERIFIED` · `qa:calibrate`
  `INSUFFICIENT_DATA` (the documented expected state) · `qa:coverage` exit 0 ·
  `check-encoding` passed · `git diff --check` clean.

### Deployment

Railway is Git-connected to `main` and auto-deploys on push, so the merge triggered a production
deploy. This was raised with the owner before merging — the review had run under a standing "do not
deploy" instruction — and the owner explicitly authorised the merge and the resulting deploy.

**No migration was run and no Firestore data was modified.** The whole redesign derives status at
runtime from the `scores` object result documents already carry, so no stored record needed
rewriting. Firestore schemas, rules, migrations, result selection and persistence are unchanged.

### What shipped

One official capability status per navigator per department, from the arithmetic mean of all six
domain scores: `0–39` Critical · `40–64` Learning · `65–89` Solid · `90–100` Can-Teach. Domain
percentages remain diagnostic evidence. Competencies keep their own separate three-level scale.
Five review passes are recorded in the entries below this one.

The governing invariant established across those passes:

> **Missing evidence must never be represented as failure, mastery, or a real 0%.
> Only a genuinely measured numeric zero is a Critical result.**

### Live watch items

These are now production behaviours, tracked in CLAUDE.md §15:

1. **Stored results re-classify on first view.** The new bands are stricter than the old
   `<60/60–84/85+` scale. No data changed — only the derived label — but supervisors will see
   navigators at different levels than last quarter and should be told before they notice.
2. **Two new blocking screens are live.** An incomplete question bank, or a failed bank read, now
   blocks the MCQ instead of silently fabricating zero scores. Correct, but it turns a quiet data
   bug into a visible outage; watch for reports and verify bank coverage per department.
3. **Smoke the deployment** — Matrix, a NavigatorDetail with history, and Team Overview against real
   Railway data, confirming the Overall column, Incomplete vs Not-assessed labels, and N/A
   aggregates.
4. **Not shipped:** `err?.message ?? err` still appears in ~10 `api/*` server handlers. PR #40 fixed
   only the navigator-facing site and added `safeErrorMessage()`; the server-side instances are a
   cheap follow-up using the same helper.

## 2026-07-21 — PR #40: synthetic trend data is never "measured"; safe rejection logging

A narrow final pass over PR #40 closing one correctness defect and one logging-safety item. Head
before this pass: `fcf5e76`. Every previously completed PR #40 correction is preserved. No
thresholds, grading, scoring, bank-coverage or seed-fallback behaviour, training rules, mentor
qualification, persistence, Firestore schemas or rules, migrations, `MINICHECK_PASS`, OB/GYN or
Pediatrics content, or production configuration changed.

### 1. Synthetic trend points could be captioned as "last measured"

`buildTrend()` prepends illustrative synthetic points (correctly flagged `simulated: true`) when a
navigator has fewer than `TREND_SYNTH_POINTS` real snapshots, so the chart is never empty. The
"last measured X%" caption added in the previous pass derived its value from
`latestMeasured(trend.overallSeries)` — and that helper sees only a flattened numeric array. It
cannot tell a genuine measurement from chart scaffolding.

Reproduced directly: a navigator whose single real snapshot recorded nothing produced

```
points:        [ { label: 'Q−1 (illustrative)', simulated: true, overall: 30 },
                 { label: 'Jan 1970',           simulated: false, overall: null } ]
overallSeries: [ 30, null ]
latestMeasured(series) => 30      // captioned "last measured 30%"
```

The navigator had never scored 30. That is exactly the governing invariant being violated —
missing evidence represented as a measured result.

**Fix.** Provenance is now exposed explicitly from `buildTrend()` rather than inferred from numbers:

```js
{ points, domainSeries, overallSeries,
  latestRealOverall,        // number|null — real, non-simulated snapshots only
  latestRealDomainValues,   // Record<domainId, number|null>
  hasRealMeasurements }     // boolean
```

These scan **real** points only (`simulated !== true`) backwards for finite evidence, and are `null`
when no real snapshot ever measured that value. `NavigatorDetail` reads them for both the overall and
the per-domain captions; when they are `null` the caption is **omitted entirely** and the current
value simply reads `N/A`. A genuine historical `0` is real evidence and still captions
"last measured 0%".

Synthesis itself is untouched: synthetic points are still generated, still drawn, still labelled
`(illustrative)`, and still carry `simulated: true`. They are scaffolding for an otherwise-empty
chart — they are simply never *described* as measurements.

`latestMeasured()` stays in `formatScore.js` as a generic array helper but now carries an explicit
**provenance-unaware** warning telling callers not to use it for "last measured" captions over any
series that may contain simulated points. It has no remaining call sites in application code; the
dead import was removed from `NavigatorDetail`.

### 2. Non-Error rejections could log an arbitrary object

`NavigatorApp`'s bank-read failure logged `err?.message ?? err`. When a rejection is not an Error and
has no `message`, that falls through to the **raw value** — and a plain object could carry question
text, answer options, answer keys, a Firestore snapshot or a request payload straight into
`console.error`, where it would be serialized.

**Fix.** New `src/lib/safeError.js` exports `safeErrorMessage(err, fallback)`:

- `Error` with a string message → that message, truncated to 200 chars;
- string rejection → the string, truncated;
- anything else → a generic label (here, `"Unknown question-bank read error"`).

Arbitrary objects are never serialized and stack traces are never logged. The check is deliberately
`err instanceof Error` rather than duck-typing on `.message`, because a non-Error object's `message`
property is untrusted and could itself be assembled from payload data. The department id is still
logged — it is not assessment content.

It lives in its own module rather than in `formatScore.js`: an error-normalization helper has no
cohesion with score formatting.

### Files changed

`src/lib/scoring.js` (buildTrend provenance) · `src/lib/formatScore.js` (provenance warning on
`latestMeasured`) · **new** `src/lib/safeError.js` · `src/components/NavigatorDetail.jsx` ·
`src/components/NavigatorApp.jsx` · `src/lib/scoring.test.js` ·
`src/components/sparklineTrend.test.jsx` · **new** `src/lib/safeError.test.js` · `CLAUDE.md` ·
`docs/HISTORY.md`.

### Tests added

- `scoring.test.js` (294 → 304): an empty real snapshot with synthesis reports no real measurement;
  synthetic values never become `latestRealOverall`; an older real score followed by an empty
  snapshot reports the older real score; an older synthetic value does not count; a history snapshot
  explicitly flagged `simulated` is excluded; a genuine historical `0` counts; domain provenance
  follows the same rule; the `simulated` marker and `(illustrative)` labels survive.
- `sparklineTrend.test.jsx` (11 → 19): a single empty real snapshot shows `N/A` with no caption;
  no synthetic value is ever quoted; illustrative points still render when synthesis supplies enough
  of them; an older real score is captioned; a genuine historical `0` captions "last measured 0%";
  domain captions follow the same rule and are omitted when only synthetic data exists.
- **New** `safeError.test.js` (16): Error message only, no stack; string handling and truncation;
  object rejections never exposing their fields; a `message` field on a non-Error object not trusted;
  generic label for every other type; caller-supplied fallback; empty-message fallback; an object
  with a readable `toString` still not serialized.

### Verification

Every command was run; exact results are recorded in the PR description. No deployment, migration,
Firestore data change, merge, or production write occurred.

## 2026-07-21 — PR #40 final correction: read failures, competency scoreability, trend labels

A narrow third correction pass over PR #40, closing three residual paths where absent evidence could
still surface as a measured result. Head before this pass: `7c63736`. All previously completed PR #40
fixes are preserved; capability and competency thresholds, mentor qualification, training thresholds,
MCQ point maths for valid questions, Spot the Error and Call QA grading, OB/GYN and Pediatrics
content, Firestore schemas/rules, persistence, result selection, migrations and `MINICHECK_PASS` are
all unchanged.

### 1. A failed live-bank read was treated as an empty bank

`NavigatorApp` loaded the bank with:

```js
const live = await getActiveQuestions(dept).catch(() => []);
const bank = live.length > 0 ? live : (SEED_BY_DEPT[dept] ?? SEED_QUESTIONS);
```

That `.catch(() => [])` made two very different situations identical:

- Firestore **succeeded** and the live bank is genuinely empty, and
- Firestore or the network **failed**, so the live bank's contents are unknown.

The second case silently launched the committed **seed** assessment. A navigator could then sit a
potentially stale assessment, have it graded, and have the result stored as their official profile —
purely because a network read blipped.

**Fix.** New `loadBankForDept(dept)` handles three distinct outcomes:

| Read | Bank used | MCQ |
|---|---|---|
| succeeded, non-empty | live bank | allowed after coverage validation |
| succeeded, empty | department seed bank | allowed after coverage validation |
| **rejected** | *none* | **blocked** — status unknown |

A rejected read sets `bankLoadFailed`, clears coverage, and routes to a dedicated
`view === 'bankUnavailable'` state: *"Couldn't load the question bank"*, explaining it is a
connection problem, that nothing was recorded, and offering **Try again** (which re-reads the active
department's bank without signing out) alongside a back link. Both gates enforce it — the phase-hub
start handler and `handleSubmit`, so no result can be saved from an unknown bank. The error is
logged with its message only (never the payload, which could carry question content) rather than
swallowed.

This is deliberately kept separate from the existing *incomplete bank* state: "we couldn't read it"
is not "we read it and it's missing domains", and the two produce different screens.

`docs/PLAN-3-phase-assessment.md` still contains the old `.catch(() => [])` snippet. It is a
historical execution plan written against commit `6ebb82e`, so the snippet is preserved unedited and
the document now carries a superseded banner pointing at the current behaviour.

### 2. Unscoreable questions still contributed zeroes to competencies

`scorePerDomain` had already been taught to ignore questions failing `isScoreableQuestion()`, but
`scorePerCompetency` still processed them. A question with no options measured nothing yet
contributed **0 points** to every competency it was tagged with, dragging that competency's average
down for evidence that never existed. A test explicitly asserted this incorrect behaviour.

**Fix.** The same scoreability rule now gates competency scoring. A competency exercised only by
unscoreable questions returns `null`; a competency with no tagged scoreable questions returns `null`;
and a competency measured by a valid question still returns a genuine `0` when the navigator left it
unanswered or chose a zero-point or nonexistent option. Unknown competency ids are still ignored
safely, and the three-band thresholds (`<60` Learning · `60–84` Solid · `85+` Can-Teach) are
untouched.

The test asserting `0` for an optionless question was **replaced** by one asserting `null`.

### 3. Trend labels could still round null to 0%

`buildTrend` stored `null` for missing historical domain scores and `Sparkline` drew gaps correctly,
but the text labels beside the charts did:

```js
Math.round(series[series.length - 1]) + '%'
```

`Math.round(null)` is `0`, so a domain the latest check never measured was labelled **0%** — a
fabricated Critical-looking reading. `trendOverall()` compounded it by falling back to `0` when a
snapshot had no measurable evidence at all, injecting an artificial overall trend point.

**Fix.** `trendOverall()` now returns `null` when neither `overallScore` nor `partialAverage` exists,
and `buildTrend().overallSeries` is `(number|null)[]`. A new shared formatter,
`src/lib/formatScore.js`, is the single place that decides measured-versus-gap:

- `formatPercent(v)` — genuine `0` → `"0%"`; finite → rounded; null/undefined/NaN/non-numeric →
  `"N/A"`.
- `formatSeriesCurrent(series)` — labels the **latest snapshot**, deliberately *not* the latest
  measured value, so a stale reading is never presented as current.
- `latestMeasured(series)` — the last finite value, ignoring trailing gaps.
- `isMeasured(v)` — finite-number predicate.

`NavigatorDetail` uses `formatSeriesCurrent` for both the overall and per-domain labels, and when the
latest snapshot measured nothing it adds a separate *"last measured X%"* caption so the historical
segment stays visible without implying it is current. `Overview`'s local `fmtPct` now delegates to the
shared `formatPercent`. `Sparkline` continues to split its line around gaps and dot isolated
readings. `teamTrend`'s existing behaviour — omitting timepoints with zero complete profiles — is
unchanged.

Every consumer of `overallSeries`, `domainSeries`, `Sparkline` and `trendOverall` was audited; no
`Math.round(series[…])` remains anywhere in the tracked tree.

### Files changed

`src/components/NavigatorApp.jsx` · `src/components/NavigatorDetail.jsx` ·
`src/components/Overview.jsx` · `src/lib/scoring.js` · **new** `src/lib/formatScore.js` ·
`src/styles.css` · `src/lib/scoring.test.js` · **new** `src/lib/formatScore.test.js` ·
**new** `src/components/sparklineTrend.test.jsx` · `src/components/roleApps.behavior.test.jsx` ·
`docs/PLAN-3-phase-assessment.md` (superseded banner only) · `CLAUDE.md` · `docs/HISTORY.md`.

### Tests added or updated

- `roleApps.behavior.test.jsx` (22 → 30): rejected read shows the connection-error state; no seed
  fallback on failure; MCQ stays closed; `saveResult` never called; retry loads the correct bank once
  the read succeeds; a successful empty read still uses the seed bank; a partial live bank stays
  blocked as *incomplete* (a distinct screen); a complete live bank stays allowed.
- `scoring.test.js` (278 → 294): competency null for no-options / empty-options / unknown-domain
  questions; genuine `0` for zero-point, nonexistent-option and unanswered valid questions; mixed
  banks averaging only scoreable questions; unknown competency ids still safe; real Pediatrics and
  OB/GYN banks still valid; distribution finite with no Critical bucket; thresholds unchanged.
  Trend: empty snapshot → null overall, partial snapshot → `partialAverage`, measured-then-missing
  does not collapse to zero, genuine zero still `0`, series entries never NaN.
  **Replaced** the test expecting an optionless question to score `0`.
- **New** `formatScore.test.js` (26): `isMeasured`, `formatPercent`, `latestMeasured` and
  `formatSeriesCurrent`, including an explicit assertion that `Math.round(null) === 0` while the
  formatter does not inherit that.
- **New** `sparklineTrend.test.jsx` (11): Sparkline gap splitting, lone-reading dots, refusal to
  render fewer than two measured points, genuine zero plotted; NavigatorDetail latest-null → N/A,
  latest-undefined → N/A, genuine latest `0` → `0%`, empty latest snapshot → N/A plus the
  "last measured" caption, fully-measured snapshot → percentage with no caption.

### Verification

Every command below was run; exact results are in the PR description. No production deployment,
migration, Firestore data change, merge, or production write was performed.

## 2026-07-21 — PR #40 full-codebase review: six correctness fixes

A final full-codebase pass over PR #40 found six issues that all shared one root cause: **absent
evidence being rendered as a measured result.** The overall-status architecture, the capability
thresholds, the competency thresholds, mentor safeguards, domain-driven training, Call QA behaviour,
OB/GYN content, Firestore rules, persistence, result selection and historical records are unchanged.

The invariant these fixes establish, now stated in CLAUDE.md:

> **Missing evidence must never be represented as failure, mastery, or a real 0%. Only a genuinely
> measured numeric zero is a Critical result.**

### 1. Incomplete bank coverage could fabricate Critical domain scores

`scorePerDomain` returned `0` whenever a domain had no questions (`total === 0`), so a supervisor's
partially-populated question bank produced navigator scores of 0 — i.e. **Critical results the
navigator never earned**. `NavigatorApp` compounded it by accepting any non-empty active bank
without checking that all six configured domains were represented.

**Fix.** New canonical helpers in `scoring.js`: `isScoreableQuestion()` (a question needs a known
domain and at least one option), `assessmentBankCoverage()` returning
`{ complete, covered, missing, countsByDomain, scoreable, total }`, `isAssessmentBankComplete()`,
and `IncompleteAssessmentBankError`.

`scorePerDomain` now distinguishes the two cases explicitly — **null** for "this domain had no
scoreable questions", a genuine **0** for "measured and earned nothing" — mirroring what
`scorePerCompetency` already did for competencies. `{ strict: true }` throws rather than returning a
profile with holes.

Both navigator paths are gated: the MCQ phase is **blocked** at start with a screen naming the
uncovered domains, and `handleSubmit` re-checks before persisting so nothing is written. Chosen
failure mode is blocking rather than degrading, because a partial result is indistinguishable from a
poor one once stored.

A partial live bank is deliberately **not** topped up from the seed bank — that would mix outdated
seed content with current supervisor-managed content inside one graded assessment. The seed bank is
used only when the live bank is entirely empty.

The mini-check path was hardened too: it no longer coerces an unmeasurable domain to `0` (which
would have looked like a failed attempt) and records no mastery from it.

### 2. Zero training assignments read as complete mastery

`trainingForRow` correctly skips unscored domains, which made `assignments.length === 0` ambiguous —
it can mean genuine mastery *or* nothing to assess. Several surfaces congratulated navigators who
had simply never been assessed ("Every domain scored 90% or above — consider mentoring a colleague").

**Fix.** New `trainingEmptyStateReason(row, assignments?)` resolves the reason to
`unassessed` / `incomplete` / `mastered` / `has-assignments`, with `hasMasteredAllDomains(row)` true
only for a complete profile where every domain is ≥ 90. Applied in `MyTraining`, `NavigatorDetail`
and `TrainingModule` (whose cohort panel no longer claims "the floor has it covered" when nobody was
scored in that domain). Mentoring is never suggested to an incomplete or unassessed navigator.

Required states now render distinctly: 0/6 "No assessment results are available yet"; 1–5/6
"Training cannot be finalized until the remaining domains are assessed" (with the count); 6/6 all
≥ 90 keeps the mastery message; 6/6 with weak domains renders assignments.

### 3. Missing aggregate evidence rendered as 0%

`floorStats` returned `avgOverallScore: 0` and `solidPlusRate: 0` with zero complete profiles;
`domainDistribution` returned `avgScore: 0` for a domain nobody had been scored in; `teamTrend`
emitted 0% timepoints; and personal domain trend series inserted `0` for missing historical scores,
drawing an artificial collapse.

**Fix.** These official aggregates are now **null** when there is no eligible evidence.
`teamTrend` omits timepoints with zero complete profiles entirely. `buildTrend` puts `null` where a
historical domain score is missing, and `Sparkline` renders those as **gaps** (splitting the
polyline into segments, marking a lone reading with a dot) rather than plotting them at zero.
`CountUp` gained an `emptyLabel` (default `—`) and refuses to animate a non-finite value to 0.
Overview renders percentages through a `fmtPct` helper that shows `N/A` for null.

Counts remain genuine zeroes throughout — "zero navigators are Critical" is a real fact, not a gap.
A complete floor whose actual average is 0 still displays `0%`.

### 4. Competency UI used the four-band capability scale

Competencies deliberately keep three levels (`<60` Learning · `60–84` Solid · `85+` Can-Teach) and
have no Critical band, but the Overview competency bars and legend still iterated `LEVEL_ORDER`,
rendering a Critical bucket that scale does not have.

**Fix.** Both loops now use `COMPETENCY_LEVEL_ORDER`, and the panel lede states explicitly that this
is a separate three-level scale, not the official department status. `competencyScoreToLevel` and
`COMPETENCY_THRESHOLDS` remain independent of the capability scale.

### 5. Incomplete versus Not assessed collapsed in several consumers

Both states have `overallScore === null`, so consumers keying on the score alone merged them.
Overview's "Ready for more" showed both as "Not assessed"; Matrix's readiness signal showed both as
a bare dash; `MyHistory` hid the overall state for incomplete attempts entirely and indexed
`LEVELS[domainBand(pct)]` directly — which throws on a null band from a legacy/malformed score.

**Fix.** `readinessTally` now carries `assessedDomains`/`totalDomains`/`complete`, and both readiness
surfaces label the states distinctly (with "X of 6 domains"). `MyHistory` always shows the overall
state including Incomplete, and renders any non-finite legacy domain value as an explicit
"not scored" chip instead of indexing `LEVELS` with null.

`OverallBadge` is now **defensive**: `complete === false` (or `row.overallComplete === false`) always
suppresses the official percentage and level, even when a caller supplies stale or inconsistent
score/level props. An unknown level id degrades to the no-status badge rather than throwing.

### 6. Misleading count and stale documentation

Training's "of {rows.length} assessed" counted incomplete and unassessed navigators as assessed. It
now reads "of N navigators on the floor", adding "· M with a complete profile" when they differ.

CLAUDE.md corrected: the Spot-the-Error description claimed failed generations "backfill to 0" — the
code is already all-or-nothing and never backfills, so the doc was the stale part. The governing
invariant and all new helpers are now documented in F2/§9.

### Files changed

`src/lib/scoring.js` · `src/components/NavigatorApp.jsx` · `src/components/MyTraining.jsx` ·
`src/components/NavigatorDetail.jsx` · `src/components/TrainingModule.jsx` ·
`src/components/Overview.jsx` · `src/components/Matrix.jsx` · `src/components/MyHistory.jsx` ·
`src/components/OverallStatus.jsx` · `src/components/Training.jsx` · `src/components/CountUp.jsx` ·
`src/components/Sparkline.jsx` · `src/lib/scoring.test.js` ·
`src/components/capabilityStatus.test.jsx` · `src/components/roleApps.behavior.test.jsx` ·
**new** `src/components/trainingEmptyState.test.jsx` · `CLAUDE.md` · `docs/HISTORY.md`.

### Tests added

Scoring (`scoring.test.js`, 242 → 278): bank coverage accept/reject/empty/unscoreable, real seed
banks complete and scoring normally, uncovered domain null vs measured zero, partial bank producing
no official profile, strict-mode throw, uncovered domain producing no gap or training;
`trainingEmptyStateReason` across all four states; null aggregates vs genuine zero for `floorStats`,
`domainDistribution`, `teamTrend` and `buildTrend`; competency boundaries 0/39/40/59/60/84/85/100
with finite sums and no Critical band; `readinessTally` distinguishing Incomplete from Not assessed.

Components: `capabilityStatus.test.jsx` (34 → 47) — OverallBadge 0/6, 1/6, 5/6, 6/6, stale-props
override, unknown level; Overview N/A vs genuine 0%, domain avg N/A, competency panel three-level,
readiness distinction; `Matrix` readiness distinction. New `trainingEmptyState.test.jsx` (10) covers
all four empty states across MyTraining, NavigatorDetail and TrainingModule.
`roleApps.behavior.test.jsx` (18 → 22) covers the bank-coverage gate end to end: blocked with named
domains, no seed top-up of a partial bank, complete bank allowed, empty bank falling back to seed.

### Verification

All commands were run; exact results are recorded in the PR description. No production deployment,
migration, merge, or production write was performed.

## 2026-07-20 — PR #40 final cleanup: encoding guard, stale docs, cross-department Incomplete

A narrow third pass over PR #40. The overall-capability architecture, the exact thresholds, the
colours, the domain training rules, the mentor safeguards and the three previously-fixed merge
blockers are all preserved unchanged.

### 1. Remaining encoding corruption removed, and the guard widened

The earlier repair pass fixed only the curly-quote/dash family, because that is the only family
`scripts/check-encoding.mjs` could detect. Two other families survived the same PowerShell
`Add-Content` round-trip:

| Corrupted | Intended | Where |
|---|---|---|
| a-circumflex + dagger + right-quote | `→` U+2192 | 6x in `src/lib/scoring.test.js` |
| a-circumflex + right-double-quote + euro | `─` U+2500 | 154x `scoring.test.js`, 9x `capabilityStatus.test.jsx`, 30x `call-qa-interviews.rules.mjs` |

Every sequence was enumerated and verified by reversing the Windows-1252 remap and strictly decoding
the result as UTF-8, rather than guessing at a search-and-replace. Repair only rewrote a run when it
decoded cleanly **and** produced a character outside Latin-1, so genuinely accented prose was never
touched. The box-drawing damage in `tests/firestore-rules/call-qa-interviews.rules.mjs` was
**pre-existing on `main`**, not introduced by this branch; it is fixed here because the task was to
leave zero corruption in the tracked tree.

**Root cause of the survival:** the guard matched only the literal lead pair for the cp1252 euro
byte. Every 3-byte UTF-8 character in U+2000–U+2FFF shares the same 0xE2 lead, so arrows and box
drawing corrupt into the same shape with a different second byte. The pattern is now
`a-circumflex` followed by the **full continuation class** already used for the 2-byte Latin path,
which covers punctuation, arrows, box drawing, math, block and geometric shapes in one rule.
Requiring a continuation-class character immediately after the lead keeps real words safe: French
spells a-circumflex followed by a letter, never by a dagger or a euro sign.

**The guard also never ran on Windows.** `api/encoding.test.js` passed
`new URL('..', import.meta.url).pathname`, which yields `/C:/Users/...` — not a valid cwd — so
`git ls-files` failed with `spawnSync git ENOENT` and the repository scan silently no-oped on every
Windows checkout. That is why the corruption reached the branch at all despite a green-looking
guard. Fixed with `fileURLToPath`. The full unit suite is now green **including** the encoding
guard, for the first time in this branch.

New tests in `api/encoding.test.js` (3 tests -> 7): detects corrupted arrows (`34 -> 72`,
`complete -> canTeach`); detects corrupted box drawing (`-- section`, a long rule); allows the real
arrows, real box-drawing characters, em dashes, curly quotes, accents and Arabic this repo actually
uses; and does not flag French words where a-circumflex precedes a letter.

### 2. Stale "capped at Learning" documentation corrected

The first implementation of the redesign capped an incomplete profile at `learning`. The
merge-blocker review replaced that with a hard null, but two documents still described the cap as
current behaviour.

The final rule, now stated consistently everywhere:

| Domains scored | Result |
|---|---|
| 0 of 6 | **Not assessed** — `overallScore` null, `overallLevel` null |
| 1–5 of 6 | **Incomplete** — `overallScore` null, `overallLevel` null, no capability classification |
| 6 of 6 | Official overall score **and** official capability level |

`partialAverage` remains available as diagnostic progress data only.

Corrected: the `CLAUDE.md` decision-log entry (which claimed the profile was "capped at `learning`")
and the `docs/HISTORY.md` "Missing-domain safety" section. Both now state the current rule and carry
an explicit superseded note explaining that the cap existed briefly and why it was replaced — a cap
still hands out an official level the navigator has not earned, and it allowed incomplete rows to be
double-counted in the status distribution. Historical narrative is preserved, not rewritten.

### 3. Cross-department view keeps Incomplete distinct from Unassessed

`departmentMatrix()` returned `null` for a cell whenever `status.score` was null. Since an
incomplete profile deliberately has `score === null`, the cross-department table rendered these two
very different situations identically:

- a navigator who has never started that department, and
- a navigator who is part-way through it

**Fix.** A cell is null **only** when the department is genuinely unassessed (0 of 6 domains). An
incomplete department (1–5 of 6) now returns a real cell:

```js
{ overall: null, level: null, complete: false, label: 'Incomplete',
  assessedDomains: 3, totalDomains: 6 }
```

`Overview`'s "Strength by department" table and `NavigatorDetail`'s department strip both pass
`assessedDomains`/`totalDomains` through to `OverallBadge`. Without that metadata the badge would
fall back to "Not assessed" and reintroduce the same conflation at the render layer;
`NavigatorDetail` additionally stopped indexing `LEVELS` with a null level id. Neither surface ever
renders `partialAverage` as an official percentage.

`PhaseHub` keeps its `partialAverage` fallback: it is a progress summary that prints a plain
`avg X%` and never attaches a capability level to a partial profile.

Regression tests — 8 in `scoring.test.js` (0/6 null; absent department null; 1/6 and 5/6 real
Incomplete cells; 6/6 official percentage and level; a 1/6 profile holding 100% reporting neither
100% nor Can-Teach; all three states side by side; `assessedDomains` carried through) and 8 in
`capabilityStatus.test.jsx` (the same matrix at the render layer, plus the tooltip wording and the
visual distinction between unassessed and incomplete).

### Files changed

`scripts/check-encoding.mjs` · `api/encoding.test.js` · `src/lib/scoring.js` (`departmentMatrix`
only) · `src/components/Overview.jsx` · `src/components/NavigatorDetail.jsx` ·
`src/lib/scoring.test.js` · `src/components/capabilityStatus.test.jsx` ·
`tests/firestore-rules/call-qa-interviews.rules.mjs` (encoding repair only, no logic change) ·
`CLAUDE.md` · `docs/HISTORY.md`.

### Verification

| Command | Result |
|---|---|
| `npx vitest run` | **1,572 passed / 1,572** across 73 files — fully green |
| `npm run build` | clean, incl. the private-runtime bundle scan |
| `npm run test:e2e:safe` | **12/12** passed (real Chromium) |
| `npm run test:rules` | **76/76** assertions (51 result-authorization + 25 Call QA), exit 0 |
| `npm run qa:pilot-smoke` | `PILOT_SMOKE_VERIFIED`, exit 0 |
| `npm run qa:calibrate` | `INSUFFICIENT_DATA` (documented expected state), exit 0 |
| `npm run qa:coverage` | exit 0 |
| `node scripts/check-encoding.mjs` | passed |
| `git diff --check` | clean |

Repository-wide searches for the three mojibake lead sequences and for "capped at learning" /
"capped at Learning" all return **zero matches**.

The Firestore Rules suite required a JRE, which is not on this machine's PATH; it was run against
the portable Temurin 21 JRE already present under the user's temp directory from an earlier session.
No Java was installed and no PATH was permanently modified.

No production deployment, migration, or write was performed, and PR #40 remains unmerged.

## 2026-07-20 — PR #40 merge-blocker review: three correctness fixes

A review of PR #40 against the latest `main` found three defects in the first implementation of the
overall-status redesign. The architecture, exact thresholds, colours, domain training rules, mentor
safeguards, OB/GYN content, Call QA logic, Firestore rules, migrations and result history are all
preserved unchanged; only the defects below are fixed.

### Blocker 1 — missing domain evidence was being converted into a score of 0

`buildMatrixRows` derived `domainDevelopmentBands` with `scores[d.id] ?? 0`, and `bandFor` /
`trainingForRow` repeated the same fallback. Because 0 falls in the Critical band, **"we never
measured this domain" was reported as "they scored 0%, which is critical."**

A navigator with a single recorded domain produced, entirely from absent data:

```
bands:              5 × "critical"
training:           5 × Critical (required)
criticalDomainGaps: 5
columnGaps:         5
```

Reporting five invented critical findings against a real person is a correctness and fairness
failure, not a cosmetic one.

**Fix.** `domainBand(pct)` now returns **`null`** for a missing or non-numeric value — an explicit
*unassessed* diagnostic state. Only a genuinely recorded number in 0–39 is a Critical gap. A missing
domain now produces **no** critical-gap alert, **no** required/critical training assignment, **no**
column gap, **no** distribution band count, **no** Learning Loop weak-domain signal, **no** mentor
suggestion or pairing (and no "unmatched mentee" entry either), and **no** Action Center row.

Call sites hardened: `buildMatrixRows`, `bandFor` (which now derives from the raw score first, so a
legacy `levels` map cannot reintroduce a phantom band), `trainingForRow`, `columnGaps` — which now
measures only the navigators actually scored on that domain, in both numerator and denominator —
`domainDistribution` (new `unassessed` bucket; it previously did `counts[null] += 1` and produced
`NaN`), `buildLearningSignals`, `mentorSuggestions`, `buildMentorMatches`, and `buildActionCenter`.

A **recorded `0` still behaves exactly as before**: Critical band, Critical training, critical-gap
alert, weak-domain signal. The two cases are deliberately distinguishable everywhere and are
regression-tested against each other.

The UI follows: `DomainScore`, the Matrix cells, the roster strip and the NavigatorDetail per-domain
cards render an explicit "Not scored" dash on a neutral hatched surface — never `0%`, never a band
tint, never a Critical gap.

The test that asserted the old behaviour (*"defaults a missing domain score to 0 → critical band"*)
was **removed and replaced** by one asserting the opposite.

### Blocker 2 — incomplete profiles were double-counted and could inflate KPIs

`overallDistribution` incremented `incomplete` **and then also** incremented Learning or Critical
for the same row, so the categories overlapped and did not sum to the total:

```
{ learning: 1, incomplete: 1, unassessed: 1, total: 2 }   // sums to 3
```

Separately, `overallScore` averaged whatever domains happened to exist, so a one-domain
`{intake: 100}` reported **100% overall** and dragged the floor average up with it, and
`floorStats.assessed` counted every row including fully unassessed ones.

**Fix.** `overallScore()` now returns **null unless all six domains are numeric**. An incomplete
profile therefore has no official score *and* no official level — it is neither Learning nor
Critical, it is **Incomplete**. `overallStatus()` reports three mutually exclusive states —
`unassessed` (nothing scored) · `!complete` (Incomplete) · `complete` (exactly one official level) —
and `overallDistribution` buckets are mutually exclusive, so:

```
critical + learning + solid + canTeach + incomplete + unassessed === total
```

`floorStats` now computes every official KPI over **complete six-domain profiles only**:
`assessed` is the count of complete profiles (the population the KPIs describe), with `rowCount`,
`incompleteCount` and `unassessedCount` reported alongside. A partial profile can no longer move the
average, the Solid+ rate, or the Can-Teach/Critical counts. The Team Overview renders an eligibility
note whenever rows were excluded.

`partialAverage(scores)` is kept as a **separate, explicitly diagnostic** field for surfaces that
genuinely need the mean of the evidence that exists. It is never called an overall score, never
rendered with a capability level, and never feeds an official KPI. `PhaseHub` uses it as the
fallback for its "avg X%" phase-progress summary — a progress readout, not a status.

A useful consequence of the stricter rule: because an incomplete profile has no level at all,
`overallLevel === 'canTeach'` now *implies* completeness, so the mentor, readiness and
question-health checks inherit the safety without re-checking it.

The declining-trend comparison in `buildActionCenter` now skips a snapshot with no official score
rather than treating it as 0, which would otherwise have fabricated a large "decline".

### Blocker 3 — competency regression (NaN counts, disappearing competencies)

`buildMatrixRows` had been changed to pass competency scores through the new four-band capability
`scoreToLevel`, while `competencyDistribution` still initialised only `{learning, solid, canTeach}`.
A competency below 40 therefore hit `counts['critical'] += 1` on an undefined bucket:

```
{ competencyId: 'sopKnowledge', learning: 0, solid: 0, canTeach: 0, critical: NaN, total: 1 }
```

The competency vanished from the Team Overview entirely.

**Fix.** The competency axis keeps its **original independent thresholds**. New
`competencyScoreToLevel()` maps against `COMPETENCY_THRESHOLDS` (`<60` Learning · `60–84` Solid ·
`85+` Can-Teach) and has no Critical band. `buildMatrixRows`, `competencyDistribution`,
`buildLearningSignals` and `Coaching.jsx` all use it. `competencyDistribution` now derives the level
from the **score** rather than trusting a precomputed level, and skips any id it has no bucket for,
so a stray capability band on a legacy row can no longer produce `NaN`.

The requested feature concerned the official department status, not competency re-banding. Adopting
the four capability bands for competencies remains available as a future owner decision; it is not
made here.

### Regression tests added

`src/lib/scoring.test.js` (+53 tests) and `src/components/capabilityStatus.test.jsx` (+7 tests):

- `{one domain: 100}` is Incomplete; zero critical gaps; zero training assignments; zero column
  gaps; zero weak-domain signals; zero mentor suggestions/pairings; no official band; does not
  inflate the floor average.
- A recorded `0` still yields a Critical gap, Critical training and a weak-domain signal — asserted
  side by side with the missing-domain case.
- Distribution categories are mutually exclusive and sum exactly to total, for a seven-row fixture
  covering all six states.
- Unassessed rows do not count as assessed; `floorStats` KPIs use complete profiles only.
- Competency scores at **0, 39, 40, 59, 60, 84, 85, 100**; every distribution count finite; counts
  sum to total; a below-40 competency neither NaNs nor disappears; a stray `'critical'` id on a
  legacy row is ignored.
- Complete profiles retain all prior threshold, training, readiness, mentorship and question-health
  behaviour.
- UI: Matrix renders "Incomplete" with no percentage and no level; unscored cells render a dash, not
  `0%` or a Critical gap; Action Center raises nothing for missing domains; Overview excludes partial
  profiles from official KPIs; roster cards report "1 of 6 domains scored".

### Also in this pass

`docs/HISTORY.md` and `CLAUDE.md` corrected: the stale "can-teach roster" / "readiness tally" /
"Can-Teach depth" terminology in §2 Product Goals and §3 Product Usage now reads as the
domain-mentor roster and the overall-status readiness ranking, and the F2/F5/§8/§9 sections document
the unassessed contract, eligible-profile KPIs and the separate competency axis.

One self-inflicted issue worth recording: appending the new test blocks via PowerShell
`Add-Content` round-tripped the files through Latin-1 and mangled every em-dash into the classic
three-byte mojibake sequence. The repository's own `scripts/check-encoding.mjs` guard caught it
immediately, and the files were repaired before commit — a good demonstration that the encoding
guard earns its place.

### Verification

- `npx vitest run` — **1,552 passed / 1,552** across 73 files (1,512 before this pass).
- `npm run build` — clean, including the `check-call-qa-client-bundle` private-runtime scan.
- `npm run test:e2e:safe` — **12/12 passed** (real Chromium, real server).
- `npm run test:rules` — Firestore Rules emulator suite, **76/76 assertions**.
- `npm run qa:pilot-smoke`, `npm run qa:calibrate`, `npm run qa:coverage` — offline Call QA checks.
- `node scripts/check-encoding.mjs` — passed.

`api/encoding.test.js > finds no mojibake in tracked source files` still fails on Windows with
`spawnSync git ENOENT` (the test passes `new URL('..', import.meta.url).pathname`, i.e.
`/C:/Users/...`, as a cwd). Pre-existing and unrelated — confirmed identical on a clean worktree of
untouched `main` — and the underlying script that CI runs passes.

No production deployment, migration, or write was performed.

## 2026-07-20 — One official capability status per navigator per department

**This reverses an original product principle.** Since 2026-06-23 the app deliberately produced
"per-domain scoring, never a single total". That optimised for actionability but made the
supervisor experience unusable: with six domain levels per person per department, a supervisor had
to reconcile six separate classifications to answer "how is this navigator doing?" — and different
readers reconciled them differently. Each department assessment now produces **exactly one official
capability status**, calculated from the **arithmetic mean of all six domain scores**. The
individual domain percentages remain visible everywhere as **diagnostic evidence** for targeted
training, coaching, development paths, trends, critical-gap alerts, question-health evidence, and
safe mentor qualification.

Supervisors now read:

```
72% Overall · Solid
```

### The exact bands

Non-overlapping, centralized in `src/data/config.js`, with every boundary pinned by tests:

| Range | Status |
|-------|--------|
| 0–39 | **Critical** |
| 40–64 | **Learning** |
| 65–89 | **Solid** |
| 90–100 | **Can-Teach** |

`0 → Critical · 39 → Critical · 40 → Learning · 64 → Learning · 65 → Solid · 89 → Solid ·
90 → Can-Teach · 100 → Can-Teach`.

```js
export const THRESHOLDS = { critical: 40, solid: 65, canTeach: 90 };
```

A fourth **Critical** band was added because the previous three-band scale had no way to separate
"needs development" from "needs attention now".

### Colour scheme

A four-step **Burgundy → Orange → Gold → Green** progression replaces the old three-step traffic
light. Every level carries a strong `color`, a readable `text`, and a light `tint`:

| Level | color | text | tint |
|-------|-------|------|------|
| Critical | `#8B1E2D` | `#FFFFFF` | `#F4DADD` |
| Learning | `#C9682C` | `#FFFFFF` | `#F7E1D2` |
| Solid | `#D8A72E` | `#3F3210` | `#F6EBC8` |
| Can-Teach | `#347A4D` | `#FFFFFF` | `#DCECDF` |

**Strong colours** are reserved for the official overall badge. **Tints** wash the diagnostic domain
score cells, bars and critical-gap callouts. Mirrored into CSS as `--level-{critical,learning,solid,
canteach}` plus `-tint` variants. **Status is never communicated by colour alone** — every badge and
chip renders the percentage and the written label, and a sub-40 domain carries explicit
"Critical gap" text.

### The averaging formula

One canonical implementation in `src/lib/scoring.js`; `departmentOverall()` became a thin alias of
`overallScore()` so exactly **one** averaging formula exists in the app.

```
92 + 88 + 96 + 90 + 94 + 86 = 546
546 ÷ 6 = 91          →  91% Overall · Can-Teach
```

Rules enforced by tests: all six configured domains; rounding **only after** the complete average;
never blending MCQ / Spot the Error / Call QA; never averaging across departments; the existing
active-result selection preserved; **no Firestore migration** — status is derived at runtime from
the `scores` object result documents already carry.

### Missing-domain safety

An incomplete profile can never be inflated. `overallComplete()` requires all six domains to be
numeric and `overallStatus()` labels an incomplete profile **"Incomplete"**.

> **⚠ Superseded the same day.** As first written, this section shipped a *cap*: `overallLevel()`
> returned `learning` (or `critical` when genuinely low) for an incomplete profile, so
> `{ intake: 100 }` "resolved to `learning`, never `canTeach`". **That behaviour no longer exists.**
> The merge-blocker review below replaced the cap with a hard null: an incomplete profile now has
> `overallScore === null` and `overallLevel === null` and holds **no official capability status at
> all** — not Can-Teach, not Solid, not Learning, not Critical. A cap still hands out an official
> level the navigator has not earned, and it allowed incomplete rows to be counted twice in the
> status distribution. See *"PR #40 merge-blocker review: three correctness fixes"* at the top of
> this file for the final rule.

A useful consequence that survived the correction: because an incomplete profile carries no level at
all, `overallLevel === 'canTeach'` implies completeness, so every downstream mentor and readiness
check inherits the safety by construction rather than re-checking.

### Domain scores stay diagnostic — and critical gaps stay loud

Domain percentages keep the same bands, but only as **score ranges** driving tints and training
priority. Nothing renders "Routing · Solid" any more. A domain below 40 is flagged as a
**Critical gap** even when the overall status is higher:

```
Overall: 72% · Solid
Routing: 34% · Critical gap
```

The navigator remains officially Solid; the supervisor still gets the urgent Routing warning.
`buildMatrixRows` rows now expose `overallScore` / `overallLevel` / `overallComplete` /
`overallLabel` as the official fields and `domainDevelopmentBands` for diagnostics, with `levels`
retained as a deprecated read-only alias so no legacy caller breaks.

### Targeted training is preserved and independent of the overall status

Training is assigned **purely from individual domain scores**:

| Domain score | Priority | Assignment | Rank |
|---|---|---|---|
| 0–39 | Critical | required | 0 |
| 40–64 | Required | required | 1 |
| 65–89 | Stretch | optional | 2 |
| 90–100 | — | none | — |

A navigator who is **Can-Teach overall (91%) still receives a Required assignment for Routing at
58%** — a high average never suppresses a weak-domain assignment. Explanations now cite the measured
score ("Assigned because Routing scored 54%", "Immediate focus because Routing scored 34%") instead
of a level name.

### Mentorship safeguards

A navigator may mentor a domain only when **both** hold: their official overall status is
**Can-Teach** *and* they scored **≥ 90% in that specific domain**.

- Overall 94, Routing 95 → eligible Routing mentor
- Overall 94, Routing 62 → not eligible for Routing
- Overall 84, Routing 100 → not an official mentor at all

`canTeachRoster()` became `domainMentorRoster()` (old name kept as an alias). New pairing records
carry `mentorOverallScore` / `mentorOverallLevel` / `mentorDomainScore` / `menteeOverallScore` /
`menteeOverallLevel` / `baselineDomainScore`, while still writing the legacy `menteeLevel` and
`baselineScore` fields — **no existing pairing document is rewritten**.

### Everything else that moved

- **Action Center** — new `criticalOverall` (first, "Immediate supervisor attention recommended"),
  `criticalDomainGaps`, and `learningOverall` categories; `readyForMore` now admits **only**
  overall-Can-Teach navigators; critical training assignments escalate to `severity:'high'`.
  Critical is explicitly a developmental/supervisory signal — it drives no automatic employment
  decision, restriction, suspension, or access removal, and the UI says so.
- **Team Overview** — cell-based KPIs replaced with navigator-level ones (% Solid-or-above,
  Can-Teach count, **Critical count**, average overall score, assessed) plus an official
  overall-status distribution. The domain panel is relabelled a diagnostic score distribution and
  now reports each domain's average score and sub-40 count.
- **Readiness / trends** — `readinessTally()` ranks by official status then overall score and
  exposes `readyForMore`; `teamTrend()` reports `avgOverallScore` / `solidPlusRate` /
  `canTeachRate` / `criticalCount`, preserving the existing MCQ-vs-Spot comparability rule.
- **Question health** — the Can-Teach-miss signal now keys off the navigator's **overall** status at
  submission time, not their score in the question's own domain; incomplete profiles never count.
- **Learning Loop** — evidence wording moved to measured scores ("Routing scored 54%. No completed
  practice is recorded."); critical gaps rank ahead of ordinary required-training gaps; a new
  `overallRisks` signal surfaces Critical and Learning overall statuses.
- **Competencies** — untouched as a scoring axis, but the Coaching screen now states explicitly that
  competency analysis is separate from the official department status.
- **Spot the Error** — only a full six-domain run shows an official status; a single-domain run
  shows its percentage without a level. Per-domain review rows show percentages, not level pills.

### Files changed

`src/data/config.js` · `src/lib/scoring.js` · **new** `src/components/OverallStatus.jsx` ·
`src/components/{Matrix,Navigators,NavigatorDetail,Overview,ActionCenter,Mentorship,Training,MyTraining,MyHistory,Coaching,SpotTheError,TrainingModule}.jsx` ·
`src/styles.css` · `src/lib/scoring.test.js` · `src/lib/gradingInvariants.test.js` ·
**new** `src/components/capabilityStatus.test.jsx` ·
**new** `src/components/navigatorDetail.capability.test.jsx` · `playwright.config.js` ·
`CLAUDE.md` · `docs/HISTORY.md`.

`playwright.config.js` got a one-line `testIgnore` addition (`**/.claude/worktrees/**`, alongside
the existing `**/.codex-worktrees/**`): a stray agent worktree carries its own `node_modules`, so
globbing a spec from it loaded a **second** copy of `@playwright/test` and Playwright aborted at
config load. That was blocking the E2E verification step; it is test-infrastructure hygiene and
changes no product behaviour.

### Verification

- `npx vitest run` — **1,512 passed / 1,512** across 73 files (up from 1,417 across 71).
- `npm run build` — clean, including the `check-call-qa-client-bundle` private-runtime scan.
- `npm run test:e2e:safe` — **12/12 passed** (real Chromium, real server, 1.8m).
- `node scripts/check-encoding.mjs` — passed.

**One pre-existing failure is unrelated to this work:** `api/encoding.test.js > finds no mojibake in
tracked source files` fails on Windows with `spawnSync git ENOENT`, because the test passes
`new URL('..', import.meta.url).pathname` (which yields `/C:/Users/...`) as a cwd. Confirmed
identical on a clean `git worktree` of untouched `main`, and the underlying
`scripts/check-encoding.mjs` — the check CI actually runs — passes.

### Explicitly not touched

No OB/GYN question bank, audit transcript, SOP rule, training content, private Call QA scenario,
grading pipeline, relay, persistence, migration, or Firestore security rule was modified. No
production deployment, production write, or migration was performed.


## 2026-07-20 — Department-controlled training modules (PR #38 integration + integrity fixes)

**PR #38 was merged onto the latest `main` three times** — after PR #37, after the answer-length
balance, and finally after **PR #39 (OB/GYN Spot-the-Error individually authored bank v5)** — so the
branch is zero commits behind `origin/main`. Every one of those changes is preserved intact: the v3
MCQ bank, the v5 individually authored audit bank (30 ten-turn transcripts, shared builder removed,
errors distributed 8/8/7/7 across Agent indices 2/4/6/8, varied chart-opening placement, natural
post-error patient continuation, human-review metadata, the audit-only v5 migration marker), the
expanded deterministic contradiction guards in `contentGuards.js`, their tests, the `SupervisorApp`
migration wiring, and every PR #37 / answer-balance / PR #39 `CLAUDE.md` and `docs/HISTORY.md`
entry. Documentation conflicts were resolved by keeping **both** sides — no entry was dropped and no
file was resolved by taking one side wholesale. The PR diff touches no PR #39 audit file, migration,
guard, stable ID, or marker.

### What the first PR #38 implementation got wrong

The original fix moved the department out of `CallSimulator` but gave `TrainingModule` its own
**private `selectedDept` state** (plus a `deptPropRef` re-seeding path and a module-local selector).
That closed the content leak but opened three integrity risks caught in pre-merge review:

- **Completion integrity.** A navigator could switch the module-local selector, review one
  department's content, and have the completion saved under the app's *outer* department —
  `completeLearningStep` only ever read `dept`. Credit for content never reviewed.
- **Supervisor divergence.** The module could render Pediatrics content while showing the OB/GYN
  `deptRows` cohort (or the reverse), because content came from local state and the cohort from a prop.
- **Silent Pediatrics fallback.** `trainingDeptFor()` mapped every unsupported department (Adult
  Medicine, Behavioural Health, a missing value) to `pediatrics`, presenting Pediatrics rules as
  though they belonged to that department.

### The correction — `department` is a controlled prop

- `TrainingModule` keeps **no department state**. `selectedDept`, `deptPropRef`, the re-seeding
  logic, `trainingDeptFor()` and the module-level selector are removed, along with the orphaned
  `.module__depts` / `.module__dept` CSS. The rendered department derives directly from the
  controlled `department` prop, which has **no default** — a caller that omits it gets the
  unavailable state, never a silent Pediatrics render.
- `NavigatorApp` controls the navigator's active department; `SupervisorApp` controls the globally
  selected one. Content, `rows`/cohort, navigator links and the completion department all derive
  from that single value, so no local interaction can make them disagree. `CallSimulator` receives
  the already-filtered simulation; lessons, points, scripts, examples, model docs, mistakes,
  quick-reference rows, drills, simulations, feedback/endings and takeaways use the same department.
- The supervisor department bar is not rendered in the module view (`DEPT_SCOPED_VIEWS` excludes
  `module`), so department cannot change while a module is open — divergence is structurally
  impossible rather than merely avoided.

### Completion integrity

`onComplete(completionKind, department)` carries the department the module actually **rendered**.
`NavigatorApp.completeLearningStep(kind, completionDepartment)` rejects a mismatch with
*"Training department changed. Reopen the module and try again."* — nothing is written, the error
surfaces inline through the existing completion-error path, and the action stays retryable.
Navigators cannot switch department inside a completion-bearing module, so a Pediatrics module can
only produce a Pediatrics completion and an OB/GYN module only an OB/GYN completion.

### Unsupported departments

Only `pediatrics` and `obgyn` have authored training content. Anything else renders **"Training
content is not available for this department yet."** — no Pediatrics or OB/GYN content, no
simulation, drills, quick-reference, takeaways, cohort or completion control, with the Back action
preserved and no console errors.

### Preserved

The explicit catalog metadata (`departments: ['pediatrics'] | ['obgyn']`, absent = shared) and the
pure helpers (`scopeForDept`, `belongsToDept`, `itemDepartments`, `itemText`,
`TRAINING_DEPARTMENTS`) are unchanged — no keyword filtering. The confirmed regression holds both
ways (OB/GYN Classification shows no "My daughter's strep test came back"; Pediatrics Classification
shows no decreased-fetal-movement content). All six modules were re-audited after each merge: every
module × department view is clean and usable (≥1 lesson, exactly 1 simulation, ≥1 drill / mistake /
quick-ref row / takeaway). Every current-floor SOP rule is unchanged.

### Verification

Unit suite **1374 → 1417** across **71 files**; Firestore Rules emulator **76/76**; build clean
including the private-runtime bundle scan; `qa:pilot-smoke` `PILOT_SMOKE_VERIFIED` (15 cases);
`qa:calibrate` and `qa:coverage` both **`INSUFFICIENT_DATA`** (0 human-pilot fixtures — the intended
state, not a readiness signal). `trainingModule.test.jsx` (38) was rewritten for the controlled
contract; new `src/components/trainingDepartmentIntegrity.test.jsx` (11) drives the real callers for
completion integrity, supervisor content/cohort agreement, and unsupported-department behavior.
Browser-verified in real Chromium at 1280×900 and 390×844 (**582/582 checks, 0 console errors**), including a completion-department mismatch that surfaces the error and writes nothing.

The safe Playwright suite passes **12/12**, identically on unmodified `main` (an earlier run in a
partially-configured tree — client Firebase vars present, server credentials absent — failed at the
sign-in gate; with no configuration at all the app degrades gracefully and the whole suite passes).
The real signed-in app route was deliberately **not** driven, because mounting `SupervisorApp` runs
the marker-gated Firestore migrations against the live project and completing a module would write a
real completion — owner-local testing should cover it.

### Not changed

No scoring, API, Firestore rules, Call QA, assessment-bank content, dependency, deployment, or
production-data behavior.
## 2026-07-19 — OB/GYN Spot-the-Error individually authored bank v5

- Replaced the rejected v4 shared call constructor with 30 complete, individually authored ten-turn transcripts stored directly in the six OB/GYN domain files. Stable IDs, five items per domain, all 14 workflow types, and current SOP/rule/source provenance are unchanged.
- Distributed the planted error across Agent indices 2/4/6/8 at 8/8/7/7 calls. Chart-opening placement now varies across three Agent positions; all non-greeting Agent messages and all final Agent actions are unique.
- Reworked the wrong decisions as plausible near-misses: most of the workflow is handled correctly while one chart-dependent choice is wrong. Every call contains multiple substantive competing Agent decisions, and the error line remains no longer than the longest surrounding Agent line.
- Re-authored every immediate post-error Patient turn so the caller continues with availability, contact, or scenario facts rather than correcting the navigator. A curated regression list blocks the rejected v4 correction lines, and each audit records a human-reviewed subtle trap, two correct distractor decisions, and blind-review confirmation.
- Expanded deterministic OB/GYN contradiction detection for the subtler formulations, including recent non-annual visits used for GYN OV, estimated dating used for New OB, cross-day/gapped New OB construction, unchanged paired status, stale refill pharmacy, and latest-visit-provider refill routing.
- Bumped the audit source to `obgyn-current-floor-audit-bank-v5-individually-authored-2026-07-19` and the audit-only marker to `2026-07-obgyn-current-floor-audit-bank-v5-individually-authored`. Existing environments refresh only stable OB/GYN audit documents; MCQs, Pediatrics, manual content, drafts, and history remain untouched.
- Manually reviewed all 30 calls without the planted-error highlight against position bias, answer reveal, visual/tonal obviousness, competing judgment decisions, floor plausibility, and material distinctness. No production migration or deployment was run.

## 2026-07-19 — OB/GYN Spot-the-Error challenging-call bank v4

- Re-authored all 30 OB/GYN Spot-the-Error calls as hard, multi-fact scenarios. Each case now combines at least two controlling chart facts with a plausible near-miss, instead of relying on a generic one-line request and an obvious workflow mistake.
- Replaced the repeated eight-line call frame with five safe verification/chart/wrap-up variants plus a unique patient follow-up for every case. The first Agent turn is always exactly one of the two owner-specified Aizer Womens Health greetings.
- Standardized chart-review speech on "Let me open your chart" and removed spoken system-by-system narration such as checking encounters, messages, visits, or Rx logs; opening the chart represents reviewing the complete record.
- Preserved the strict 10-turn alternating transcript, one indexed deterministic Agent error, all 14 workflow types, five items per domain, stable IDs, current SOP/rule/source provenance, and the error-line length guard. Pediatrics content and MCQs were not edited.
- Added tests for the approved greetings, whole-chart phrasing, absence of system-list narration, all-hard difficulty, at least two required chart facts, substantive patient context, 30 unique patient follow-ups, audit bank version, and existing deterministic content guards.
- Added audit bank version `obgyn-current-floor-audit-bank-v4-challenging-calls-2026-07-19` and a distinct audit-only migration marker. Existing environments update only stable OB/GYN audit documents; fresh environments still receive the complete current-floor OB/GYN bank. No direct Firestore write or deployment was performed.

## 2026-07-19 — OB/GYN assessment answer-length balance

- Shortened only the conspicuously long correct options in the 24-item current-floor OB/GYN MCQ bank. Scenarios, distractors, correct option IDs, point values, rationales, rule coverage, and medical workflow meaning remain unchanged.
- Shortened the long indexed error lines in the 30-item OB/GYN Spot-the-Error bank so the target line no longer stands out from the surrounding Agent turns. Each transcript retains the same single deterministic workflow violation and explanation.
- Added regression guards: an MCQ correct option can be at most four words longer than its longest distractor, and a Spot-the-Error target line can be no longer than the longest surrounding Agent turn.
- Bumped the curated bank source version and added a distinct marker-gated migration ID so supervisor initialization upserts the concise wording even when an environment has already completed the original v3 migration. Stable question/audit document IDs are retained, and the existing archive scope remains limited to stale active non-manual OB/GYN content.
- No Firestore write, migration execution, generation behavior, scoring change, or deployment was performed.

## 2026-07-19 — OB/GYN current-floor assessment bank v3

- Replaced the stale OB/GYN half of the MCQ bank with **24 challenging current-floor scenarios** (4 per domain), authored against the owner-confirmed Women's Health Patient Navigator SOP v1.0 effective 2026-07-17. The bank covers all 24 executable OB/GYN rules and removes old PSS OB/PSS Queue routing, navigator lab scheduling, forced Confirmation for reliable LMP, and other legacy assumptions.
- Added a **30-item curated Spot-the-Error bank** (5 per domain) covering all 14 OB/GYN audit workflow types. Every transcript has exactly 10 alternating turns, one indexed deterministic Agent violation, realistic chart facts, and exact SOP/rule/source provenance.
- Added `runObgynCurrentFloorBankMigration()`: a marker-gated, non-destructive Firestore migration that archives stale active **non-manual OB/GYN** questions and audits, upserts the v3 stable IDs as active, and preserves Pediatrics, drafts, supervisor-authored content, and all archived history.
- Wired the migration after seed/content-quality/MCQ-v2 initialization in `SupervisorApp`, avoiding a race with the older v2 migration.
- Added regression tests for balance, partial-credit scoring shape, all-rule coverage, all-workflow coverage, deterministic exactly-one-error validation, stale-rule absence, provenance, and archive-preservation planning.
- No direct production Firestore write or deployment was performed by this code change; the marker migration runs through the authenticated supervisor initialization path after merge/deploy.

### 2026-07-19 - PR #34 content precision: routine-GYN routing + serious-symptom TE separation
- **Follow-up to the same-day recovery+cleanup below**, correcting two OB/GYN teaching defects
  against the owner-confirmed current-floor Women's Health SOP v1.0 (2026-07-17).
- **Routine GYN scheduling is DIRECT, not OB Portal.** The routing module previously read "OB:
  almost everything → OB Portal" (lesson bullet and key takeaway). That over-routes routine work.
  Corrected across the routing lesson, quick-reference, and key takeaway to teach the split
  explicitly: **routine GYN scheduling → schedule DIRECTLY** using the Annual GYN "up to date" rule
  and the correct provider template (Annual UTD → GYN office visit; not UTD → schedule the Annual
  GYN); **OB Portal owns the clinical / uncertain lane** — clinical questions, triage, missing or
  unclear orders, labs, results, procedures, transfer review, pregnancy-related clinical questions,
  and scheduling exceptions. **All MFM → Rebecca Wood; Dr. Bank annual/fertility → Waiting List
  Portal; no `PSS OB`.** A new quick-ref row pins routine GYN scheduling to a direct booking. The
  intake/scheduling GYN content already scheduled directly and was left intact.
- **Serious symptom keeps unrelated requests on separate TEs.** In the decreased-fetal-movement
  scenario (classification module simulation + its annotated call example), a strong response said
  "I'll note the vitamins too," which can teach folding the unrelated prenatal-vitamin refill into
  the serious-symptom TE. Rewritten so the strong path escalates the serious symptom (High Priority
  TE to OB Portal → *Women's Health OB Urgent Calls* Intermedia channel → follow the clinical team)
  and then creates a **separate** refill TE for the vitamins; the good-choice text, feedback, the
  strong ending's summary/lesson, and the lesson's call example all now state the separation. The
  documentation module already taught same-issue → Take Action / different-issue → separate TE and
  showed mixing as the wrong choice; that content was already correct and is unchanged.
- **Full-catalog sweep:** every lesson, script pair, annotated example, mistake card, quick-ref row,
  drill option, simulation choice/feedback/ending, and takeaway was checked for "almost everything",
  broad OB Portal claims, routine-GYN-misrouting, and TE-mixing wording. The only affirmative
  offenders were the two above; the remaining "Almost everything…" string is a Pediatrics
  documentation drill about a thin refill TE (correct content, unrelated to routing).
- **Regression tests (`src/data/training.test.js`):** (1) routine GYN scheduling is taught as direct
  (Annual UTD + template), the quick-ref has a routine-GYN → direct row, and the catalog contains no
  "almost every…" / "everything → OB Portal" reduction; (2) no strong OB/GYN path uses affirmative
  refill-mixing wording, and the decreased-fetal-movement strong path commits to a separate refill
  TE and reinforces it in the debrief. Both would fail on the pre-fix wording.
- **Boundaries held:** advisory-only training unchanged; no scoring, persistence, Firestore, API,
  auth, Call QA, or PR #35/#36 behavior touched. No merge or deploy.

### 2026-07-19 - PR #34 recovery + cleanup: rich SOP-grounded training modules (F9)
- **What shipped:** the abandoned PR #34 rich-training feature, recovered onto current `main`
  (`be8f7bb`, after PR #35/#36) and flattened into the intended project structure. Each of the six
  domain modules now teaches the navigator *decision* — a branching **live call simulation** with a
  Pediatrics/OB-GYN department toggle, "Say / Not" script pairs, annotated call examples, a model TE
  document, mistake→consequence→instead cards, a pin-this quick-reference, and interactive decision
  drills. Advisory only: nothing is scored or persisted; the assignment logic still reads only
  `domainId`.
- **Cleanup (why the recovery form was not merge-acceptable):** the recovery branch imported an
  entire older global stylesheet (`src/styles-pr34-base.css`, 6.7k lines) into a cascade-layer shim
  (`src/styles-training.css`), re-exported the renderer through a wrapper
  (`src/components/TrainingModuleRich.jsx`), and kept a duplicate catalog
  (`src/data/training-rich-catalog.js`) that `training.js` deep-cloned and runtime-patched. All of
  that was removed. The full `TRAINING_MODULES` catalog now lives directly in
  [src/data/training.js](src/data/training.js); the rich renderer directly in
  [src/components/TrainingModule.jsx](src/components/TrainingModule.jsx); and only the training-
  specific selectors (`.tsim*`, `.tscript*`, `.texample*`, `.tdoc*`, `.tmistake(s)*`, `.tquickref*`,
  `.tdrill*` + their keyframes/responsive rules) were extracted into
  [src/styles.css](src/styles.css). No legacy global selectors (nav, matrix, gate, SOP manager, Call
  QA, typography, etc.) were copied.
- **Content authority (OB/GYN):** authored against the owner-confirmed current-floor Women's Health
  Patient Navigator SOP v1.0 (2026-07-17). Encodes chart-first scheduling (Encounters / Medical
  Summary RTO / last note / open TEs, never the patient's wording); routing to **OB Portal**
  (questions/triage/missing orders/labs/results/procedures/transfer), **Rebecca Wood** (all MFM), and
  the **Waiting List Portal** (Dr. Bank annual/fertility — never scheduled directly); **no `PSS OB`**
  language anywhere; the serious-symptom workflow (gather without triaging → High Priority TE to OB
  Portal → the *Women's Health OB Urgent Calls* Intermedia channel → follow the clinical team, never
  dispatch to Labor & Delivery or decide urgency); an open OB/GYN Urgent slot is **not**
  authorization; New OB = a back-to-back same-day 30-min sonogram + 30-min provider visit with the
  second record **OB Verified**, reliable LMP → New OB directly, unknown/unreliable LMP → 15-min
  Confirmation of Pregnancy; and TE discipline (Take Action for the same issue, a separate TE for a
  different one, priority via the High Priority checkbox, never the typed word "urgent"). L&D appears
  only on explicitly-wrong choices and weak/mixed teaching endings, never a correct path.
- **Pediatrics same-day-sick correction (applied in the data):** a same-day sick visit books **only
  on the day itself**. A correct path offers availability today; when tomorrow suits the parent
  better it instructs the parent to *call tomorrow for that day's* availability. The recovery branch
  taught pre-booking tomorrow's "same-day" slot as correct on the intake simulation's strong path;
  that node's good-choice text/feedback and the `end_sameday` lesson are corrected directly in
  `training.js` (not via a runtime clone-and-patch). All strong Pediatrics paths were audited for the
  same defect and are clean.
- **Tests:** [src/data/training.test.js](src/data/training.test.js) keeps the catalog-integrity and
  simulation-graph guards (every domain once; valid base/optional fields; exactly one correct drill
  option; valid start; every `next` exists; every node reachable; acyclic/terminating; ≥1 strong
  ending; L&D only on wrong paths) and gains the source-authority guards merged from the deleted
  `training-current-floor.test.js` (no `PSS OB`; OB Portal / Rebecca Wood / Waiting List Portal
  present; serious-symptom High Priority + OB Portal + OB Urgent Calls; New OB pairing + OB Verified;
  no future-day Pediatrics same-day booking on a correct path).
  [src/components/trainingModule.test.jsx](src/components/trainingModule.test.jsx) covers rich-content
  rendering, department-toggle reset, module-switch reset of both simulation and drill, strong/weak
  debriefs, restart, drill lock/independence, navigator-hides-cohort, supervisor-shows-cohort, and
  the completion control (fires `onComplete`, keeps a save failure visible, renders the completed
  state).
- **Boundaries held:** advisory-only training unchanged; no scoring, persistence, Firestore, API,
  auth, Call QA, or PR #35/#36 behavior touched. No merge or deploy performed by this change.

### 2026-07-18 - PR #36 blocker follow-up: safe 403 rotation + saved-grading wait
- **403 rotation restored:** a 403 now rotates to another configured key because one stale key must
  not randomly break every Gemini endpoint. HTTP 400/401 remain immediate fatal request failures;
  408/429/500/502/503/504 and fetch failures remain transient. `maxAttempts` and the total deadline
  still cap actual calls. The final result is `auth` only when every request actually attempted was
  403; 403 mixed with timeout/429/5xx is `exhausted`. Logs remain structured and contain no keys,
  prompts, transcript, scenario, or grading context. The auth error now describes attempted requests
  rather than claiming every configured key failed.
- **Saved Call QA grading state:** scored `VoiceCall` grading now uses a 100,000 ms request timeout
  within a strict 150,000 ms overall wait. AbortError and HTTP 409/429/503 keep the saved attempt ID,
  show "Your call is saved. Grading is still in progress…", and retry the same attempt-only request
  after 2s, 5s, 10s, then bounded 15s intervals. A later idempotent server response renders the
  durable grade normally. At the ceiling the UI says the call is safely saved and keeps manual Retry
  Grading; it never starts a new call or creates/writes a client result. HTTP 422 keeps the existing
  capture-error path; permanent 400/401/403/500 errors keep manual saved-grade retry. Practice-call
  grading remains unchanged at 30,000 ms.
- **Boundaries held:** no private scenarios, Firestore data, grading rubric, grader model, thinking
  configuration, prompt, deterministic scoring, server attempt budget, merge, or deployment changed.
- **Verification:** targeted suites 373/373 across 5 files; full Vitest suite 1312/1312 across 65
  files; Firestore rules 25/25; production build and private-runtime bundle scan passed; pilot smoke
  verified 15 cases; calibration and coverage produced expected `INSUFFICIENT_DATA` reports with 0
  human cases; production dependency audit found 0 vulnerabilities; `git diff --check` clean.

### 2026-07-18 - Bounded scored Call QA grading attempts
- **Root cause:** the shared Gemini client allowed each configured key to consume the full 25-second
  timeout sequentially. A scored grading request with four keys could therefore outlive the browser's
  wait even though the server-authoritative transcript had already been saved safely.
- **Shared client:** `geminiWithRotation` now accepts optional `timeoutMs`, `maxAttempts`, and
  `totalDeadlineMs`, and returns the number of actual upstream fetches used. The attempt ceiling is
  global across keys and models, and the total deadline is checked before each fetch and caps each
  attempt's abort timer. Callers that omit the new options retain their prior unbounded rotation.
  Retries are limited to fetch/transient failures and HTTP 408/429/500/502/503/504; 403 key rotation
  was restored in the follow-up above, while 400/401 and other clear request failures stop
  immediately. Cooldowns remain for 429/503. Upstream logs
  contain only the endpoint label, model, attempt number, elapsed time, and timeout/status fields.
- **Scored Call QA:** new server-only settings are `CALL_QA_GEMINI_ATTEMPT_TIMEOUT_MS` (default
  40000, clamp 10000–60000), `CALL_QA_GEMINI_MAX_ATTEMPTS` (default 2, clamp 1–3), and
  `CALL_QA_GEMINI_TOTAL_DEADLINE_MS` (default 85000, clamp 30000–120000). Key rotation and the
  existing malformed-output recovery share the same attempt counter/deadline, so four keys can make
  at most two upstream calls. Scoring remains pinned to exactly `models: [graderModel]`; no fallback
  model, `CALL_QA_GRADER_MODEL` behavior, thinking budget, rubric, prompt, scenario content,
  persistence shape, or Firestore data changed. The saved-attempt client timeout/retry state was
  aligned in the follow-up above.
- **Verification:** shared-client tests 40/40; grade-call-qa tests 277/277; combined targeted tests
  317/317; full Vitest suite 1292/1292 across 65 files; Firestore rules 25/25; production build and
  private-runtime bundle scan passed; pilot smoke verified 15 cases; calibration and coverage
  produced their expected `INSUFFICIENT_DATA` reports (0 human cases); production dependency audit
  found 0 vulnerabilities; `git diff --check` clean.

### 2026-07-18 - Private Call QA bank provisioned + Firestore rules deployed (operator action)
- **Provisioning gate cleared.** An authorized operator authored 15 fresh private OB/GYN Call QA
  scenarios (fictional callers; reconciled against the owner-provided current-floor SOP, Version
  1.0 effective 17 July 2026, which matches the pinned `obgyn-current-floor-2026-07-17`
  constant — no re-versioning needed). The bank passed the exact production validator locally
  (15/15 active OB/GYN; difficulty mix 4 easy / 7 medium / 4 hard; 17 of 24 executable rule IDs
  covered — full rule coverage is a later bank-expansion goal, not a launch blocker).
- **Production Firestore written.** After a clean dry run (`Would create: 15 · update: 0 ·
  deactivate: 0`), the bank was applied to the Admin-only `callQaScenariosPrivate` collection:
  **15 created, 0 updated, 0 deactivated.** All scenario content, the SOP reconciliation record,
  and the review table live only in gitignored operator storage (`private-call-qa/`) — no scenario
  material, secret path, key identifier, or credential is committed to the repo, this file, or the PR.
- **Pre-publish integrity scan run (read-only, Firebase Admin).** The §12-mandated scan of the
  production `results` collection validated every document ID against its body ownership/
  department/assessment-type: **17 documents, 17 clean, 0 flagged** — nothing to quarantine.
- **Firestore rules deployed.** The tightened `firestore.rules` (result document ID+body ownership
  binding, private Call QA store denial for every client, navigator raw-attempt denial,
  forged/legacy QA protection) compiled and released to production.
- **Still outstanding (live smoke requirements):** merge PR #35 and let Railway deploy; verify
  navigator login/token exchange against the live deployment; verify `/api/my-interviews` returns
  only the safe projected history; run the safe Playwright walkthrough; place one deliberate
  real-microphone Call QA test call confirming a private-bank scenario is selected, the call opens
  normally, the server transcript finalizes, grading completes, the supervisor sees the result,
  and the navigator cannot access private answers, hidden chart state, or raw attempt data.
- **Post-merge live verification (same day, after PR #35 merged as `c17d1a6` and Railway deployed):**
  navigator login + custom-token → ID-token exchange verified against production; public roster
  projection confirmed `{id,name,pinSet}` only; `/api/my-interviews` audited per-document — server
  Call QA attempts expose only the result rubric (no transcript, snapshot, or private grading
  fields) while practice docs keep their own transcripts; safe Playwright walkthrough 12/12 green
  against the live URL after fixing a stale smoke expectation (the hub heading regex still assumed
  3 phases for Pediatrics; the OB/GYN-only rollout intentionally made Pediatrics two-phase — test
  now accepts 2 or 3). Remaining: one deliberate real-microphone Call QA test call (operator).
- Docs updated: CLAUDE.md header note, F25 status/rotation gate, §8, §12 scan entry, §15
  priorities/blockers. Docs-only change; no application code touched.

### 2026-07-18 - OB/GYN-only scored Call QA rollout scope
- **Rollout configuration:** new `CALL_QA_ROLLOUT_DEPARTMENTS = ['obgyn']` +
  `isCallQaRolloutDept()` in `src/data/callQaScenarios.js` now govern scored Call QA availability
  everywhere. `CALL_QA_COVERAGE_BLUEPRINT` drops the Pediatrics entry: the private-bank minimum is
  **15 active OB/GYN scenarios only**. Adding a department later is a config change plus private
  provisioning, not another redesign.
- **Relay gate:** `/api/live` `mode:'test'` starts are rejected server-side for any department
  outside the rollout (Pediatrics gets a clear "not in this rollout" error, no attempt created;
  `selectScenario` is never called). Practice mode is unchanged for all departments.
- **Phase flow:** `phaseOrderForDept(dept)` in `src/lib/phases.js` — OB/GYN keeps the 3-phase
  MCQ → Spot → Call QA sequence; Pediatrics runs a two-phase MCQ → Spot assessment that COMPLETES
  without QA (no fake completions, no permanently-impossible completion). `buildPhases`/
  `phasesComplete`/`nextPhase`/`completedCount` accept the department-scoped order; `PhaseHub`
  renders 2 or 3 cards with correct copy; the dashboard's historical QA card stays visible for
  every department but only offers Retake in rollout departments; the `qatest` view is
  rollout-guarded.
- **Provisioning tool:** `validateProvisioningPayload` rejects scenarios for non-rollout
  departments (no Pediatrics section required — or accepted), and requires ≥15 active OB/GYN
  scenarios. `diffAgainstExisting` only manages (and can only deactivate) existing documents in
  rollout departments — an OB/GYN-only manifest can never deactivate a legacy Pediatrics document.
  Tests rewritten for OB/GYN-only payloads with real provenance constants.
- **Strict OB/GYN provenance:** `validatePrivateScenario` now REQUIRES, for OB/GYN, a non-null
  `sourceRuleVersion === OBGYN_RULE_SET_VERSION`, `sourceAuthority === OBGYN_SOURCE_AUTHORITY`,
  `sourceSopVersion === OBGYN_SOP_VERSION` (the launch contract pins private Call QA content to
  the owner-confirmed current-floor version — no dynamic active-SOP grounding; re-pin the constant
  on a deliberate content re-authoring), and non-empty valid `ruleIds`. Null/empty provenance
  fails validation; Pediatrics-shaped legacy fixtures keep legacy-tolerant behavior (they are not
  provisionable anyway).
- **Honest reporting:** calibration coverage flags `runtime-bank-evidence-missing`/
  `private-bank-below-minimum` only for rollout departments; pilot smoke requires coverage of the
  rollout departments only (Pediatrics synthetic rehearsal cases remain valid extra evidence) and
  reports `rolloutDepartments: ['obgyn']`.
- **CI:** the workflow now also runs `qa:pilot-smoke`, `qa:calibrate`, and `qa:coverage` (all
  offline/deterministic; no Firestore, Gemini, or private files). `qa:calibrate:check` is
  intentionally NOT a required green step — it exits 1 with `INSUFFICIENT_DATA` until real human
  calibration evidence exists.

### 2026-07-18 - PR #35 merge-readiness pass: main integration, calibration adaptation, callerCaseFile, randomized selection
- **Merged current `origin/main` (`d4ee320`, PR #33)** into `feature/obgyn-operating-model-v2`
  with `--no-ff` (no rebase/force-push). The full PR #33 calibration/readiness architecture is
  preserved: `api/_qa-automation-policy.js`, `_qa-calibration-gates.js`, `_qa-calibration.js`,
  `_qa-grading-versions.js`, fixtures + validation, `scripts/call-qa/{calibrate,pilot-smoke}.mjs`,
  and the `qa:calibrate`/`qa:calibrate:check`/`qa:coverage`/`qa:pilot-smoke` commands. Readiness
  honestly remains `INSUFFICIENT_DATA` (3 synthetic examples, 0 human pilots).
- **Grader version single source of truth:** `api/_qa-grading-versions.js` now owns
  `CALL_QA_PROMPT_VERSION = 'call-qa-grader-v3'`; `api/grade-call-qa.js` re-exports it (its local
  duplicate constant is gone). Fixtures, calibration validation, automation-policy tests, and docs
  use v3 + `qa-rubric-v2` consistently.
- **Calibration adapted to the private runtime bank:** new `api/_qa-calibration-scenarios.js`
  provides committed NON-PRODUCTION synthetic descriptors (metadata only; marked
  `nonProduction`/`calibrationAuthority: 'none'`/`evidenceUse: 'synthetic-rehearsal-only'`, marks
  now REQUIRED on `synthetic-example` fixtures) and a metadata-only private-manifest
  loader/validator that rejects every private instance field. `qa:pilot-smoke` runs entirely on
  synthetic descriptors (no Firestore); `qa:coverage` accepts `--private-manifest
  <ignored-local-path>` or an injected loader; without private evidence, coverage flags
  `runtime-bank-evidence-missing` per department and readiness carries
  `scenarioEvidence:synthetic-only` — aggregate minimum counts alone are never runtime coverage
  evidence. Live calibration now grades only fixtures embedding a sanitized `scenarioSnapshot`
  (never reads the private bank). No readiness threshold was weakened.
- **Private caller contract (`callerCaseFile`):** private scenarios now REQUIRE a validated
  `callerCaseFile` `{callerGoal, knownFacts, factsToReveal, revealRules, behavior,
  consistencyConstraints}` — the AI caller's own consistent knowledge (LMP, medication/pharmacy,
  prior callbacks, symptoms, what the patient believes the provider said), separate from
  grader-only `hiddenChartState` which is never auto-treated as caller knowledge. It lives only in
  the private Firestore doc + immutable attempt snapshot, is rendered server-side into the caller
  system instruction (`renderCallerCaseFile` in `interview-turn.js`, reveal-only-when-asked +
  never-coach rules), and never reaches the browser `ready` projection, `/api/my-interviews`, or
  the client bundle (scanner extended with `callerCaseFile` + `scenarioSnapshot`). Tests prove
  facts reach the persona but never any browser payload.
- **Randomized server-side scenario selection:** `selectLoadedCallQaScenario` no longer picks the
  first alphabetical eligible scenario — it excludes the 3 most recent completed unarchived
  scenario ids (server-trusted history only), then chooses RANDOMLY among the remaining eligible
  set, falling back to a random choice over the full valid set when everything is recent.
  Injectable RNG for deterministic tests; new tests cover recency exclusion, multi-eligible
  randomness, all-recent fallback, empty bank, and wrong-department isolation.
- **Exact active-SOP content currency:** `src/lib/contentVersion.js` rewritten around four
  separate concepts (active SOP grounding version, fallback SOP version, executable rule-set
  version, source authority). With an active supervisor SOP, AI-generated content is Current only
  when grounded in that EXACT `active-sop:<dept>:vN` version — fallback-grounded content is
  Stale/review even with a current rule version; with no active SOP, matching fallback content is
  Current; owner-confirmed current-floor content is evaluated separately against the rule-set
  version (and cannot ride that authority while falsely claiming active-SOP grounding); legacy
  stays Legacy; unknown rules stay blocked. 9 tests cover the required matrix.
- **Contextual deterministic audit validation:** `validateAuditContent`'s indexed-error check now
  evaluates the planted Agent error against requiredChartFacts + the immediately preceding
  Patient turn + the Agent line, so a natural error need not restate every controlling chart fact;
  all OTHER Agent turns are still checked strictly per-turn, preserving the exactly-one
  deterministic-error guarantee. New `api/generateAuditObgynWorkflows.test.js` smoke-tests all 14
  OB/GYN audit workflows with mocked model output (no paid API calls).
- **Encoding cleanup + guard:** fixed the double-encoded-apostrophe mojibake character classes in
  `api/_qa-rubric.js` regexes (now a plain `['’]` class, which also repairs curly-apostrophe
  matching); added
  `scripts/check-encoding.mjs` + `api/encoding.test.js`, an escape-only repo-wide mojibake
  regression scan run in the unit suite.
- **Private provisioning tool:** new Admin-only operator script
  `scripts/call-qa/provision-private-scenarios.mjs` — ignored local JSON input, dry-run by
  default, `--apply` + explicit `--project` match required, production validator (incl.
  callerCaseFile + unique id__version identities + 8 Pediatrics / 15 OB/GYN minimums +
  OB/GYN rule verification), create/update/deactivate counts, no secret content in logs, never run
  automatically. NOT executed against production; the private bank remains unprovisioned.
- **Verification:** `npm ci` clean · unit suite **1261/1261 across 65 files** · Firestore rules
  emulator suites **76/76** (51 result-authorization + 25 Call QA, portable Temurin 21) ·
  `npm run build` + private-runtime bundle scan clean · `npm audit --omit=dev` **0
  vulnerabilities** · `qa:calibrate`/`qa:coverage` valid reports · `qa:pilot-smoke`
  `PILOT_SMOKE_VERIFIED` (15 cases) · `qa:calibrate:check` exit 1 `INSUFFICIENT_DATA` (expected) ·
  repo encoding scan clean · `git diff --check` clean.

### 2026-07-17 (part 5) - Call QA private runtime, caller-observable grading, and honest coverage
- **Security finding and root cause:** the previously published Call QA bank exposed stable scenario
  IDs, caller/opening text, workflow metadata, hidden chart facts, expected actions, critical misses,
  and scoring notes. Even after moving selection server-side, that source still provided an
  opening-line-to-answer mapping to anyone reading the public repository. Server Call QA attempt
  documents also held the immutable answer snapshot while navigator owners could read those raw
  documents. The relay disclosed the attempt ID, making the read path straightforward.
- **Runtime scenario instances removed from public source:** `src/data/callQaScenarios.js` now contains
  only anonymous aggregate requirements (minimum 8 Pediatrics and 15 OB/GYN scenarios). Runtime IDs,
  versions, clinician/caller names, opening lines, public briefings, workflow/difficulty, domains,
  competencies, rule IDs, grading context, hidden facts, expected actions, critical misses, and
  scoring notes were deleted from the public bank. `src/data/obgynCallQaScenarios.js` was removed.
  The repo therefore carries no opening-line-to-answer mapping.
- **Private runtime store:** every runtime scenario-instance field now loads through Firebase Admin
  from client-denied `callQaScenariosPrivate`. The private-store validator requires an active,
  department-matching, document-ID/version-bound complete shape. The relay selects from authenticated
  navigator identity plus Admin-loaded prior attempts and ignores client scenario IDs, prompts,
  history, workflow metadata, and answer hints. A missing or invalid private bank fails closed; there
  is no public-code or browser fallback.
- **Neutral caller/browser projection:** the scored caller receives only `publicBriefing`,
  `callerName`, and `openingLine`. It receives no workflow/rule metadata, grading context, hidden chart
  facts, expected actions, critical misses, or scoring notes. The browser receives only
  `{prompt, callerName, department, primaryDomainId}` plus `attemptId`; the prompt is the neutral
  public briefing. `attemptId` is an identifier, not authorization.
- **Immutable snapshot-only grading:** before `ready`, the server stores the complete private scenario
  snapshot on the server-owned attempt. `/api/grade-call-qa` authenticates ownership, loads the
  server-captured transcript, cross-checks server authority plus snapshot ID/department/version and
  required private fields, and rebuilds grading context from that stored snapshot only. Neither the
  browser nor the current private bank can alter an already-captured attempt. Missing, incomplete,
  forged, or mismatched snapshot authority disables repairs and forces supervisor review.
- **Navigator read denial and sanitized history:** Firestore denies every client access to
  `callQaScenariosPrivate`. Navigators cannot get or list raw server/curated/protected legacy Call QA
  attempts; supervisors retain full attempt access for audit. New navigator-only
  `POST /api/my-interviews` derives ownership from the verified token and strictly allowlists
  result/status fields, stripping transcript, snapshot, rubric/grading context, leases, and future
  unlisted fields. Rows carrying legacy `qaScenarioId` or `qa` are protected and normalized as Call
  QA. Navigators also cannot forge practice rows with server authority, `assessmentType:'call-qa'`,
  `qaScenarioId`, or `qa`; Phase 3 requires a projected/server Call QA row plus a saved QA result.
- **Caller-observable fairness repair:** grader prompt/rubric versions were bumped. Internal ECW
  clicks, buttons, visit labels, queues, channels, and staff assignments are private implementation
  details, not patient scripts. For OB/GYN, a model false negative based solely on missing internal
  narration may be repaired only when a separate verified navigator line states the equivalent safe
  caller-visible outcome and there is no substantive workflow failure, over-promise, or clinical
  advice. Repairs remain whitelisted, persisted, and supervisor-visible.
- **Contradiction-only OB/GYN checks:** the old literal checks for `OB Verified`, `Take Action`,
  `High Priority`, `TE`, `OB Portal`, `Intermedia`, and `Rebecca Wood` were removed. OB/GYN
  deterministic findings now require an explicit spoken wrong/unsafe outcome and evaluate clauses
  independently, so a safe disclaimer cannot hide a later unsafe instruction. Missing internal
  wording alone creates neither a finding nor human review; duplicate reasons and review flags are
  collapsed. Legacy Pediatrics routing checks remain conservative.
- **Honest metadata:** the uniform all-six-domain/fixed-five-competency OB/GYN default was removed.
  Every privately provisioned scenario must use narrow, de-duplicated domain and competency unions
  derived from its referenced rules, with the primary domain included. The public repo exposes only
  aggregate minimum counts, so it cannot inflate readiness coverage or reveal rule mappings.
- **Related stale-content correction:** OB/GYN MCQ, fallback-question, training, and SOP-context text
  for decreased fetal movement now teaches immediate escalation through the urgent OB clinical
  workflow without independent navigator direction to Labor and Delivery. Explicit unsafe L&D
  direction remains detectable. Approved real clinician/provider names may remain where operationally
  necessary; patient PII, credentials, and private contact details remain forbidden.
- **Defense in depth:** `npm run build` now scans `dist` for private runtime shape/store tokens.
  Private provisioning directories/files are gitignored. The grading invariants now bind the private
  store, neutral projections, immutable snapshot authority, legacy/forged protections,
  caller-observable repair, contradiction-only checks, and pre-deploy rotation gate.
- **Rotation/provisioning prerequisite:** all formerly committed or published scenario instances and
  opening-line mappings are compromised and **must never be reused**. An authorized operator must
  privately provision freshly rotated Pediatrics and OB/GYN instances in
  `callQaScenariosPrivate` before deployment. This PR intentionally performs no provisioning,
  production Firestore write, migration, merge, or deployment. The new rules are not live until
  separately published; without private provisioning the scored relay intentionally has no scenario.
- **Verification:** `npm test` -> **1,124/1,124 tests across 57 files**; Firestore Rules emulator ->
  **76/76 assertions** (51 result authorization + 25 Call QA); `npm run build` passed including the
  private-runtime bundle scan; `npm audit --omit=dev` found 0 vulnerabilities.

### 2026-07-17 (part 4) - OB/GYN current-floor operating model v2
- **Authority and source versioning:** replaced the active hardcoded OB/GYN grounding with the
  owner-confirmed 2026-07-17 current-floor workflow and made source precedence explicit:
  owner-confirmed current-floor rules, then the active supervisor-managed department SOP, then the
  current hardcoded department fallback, then the generic navigator model. Active SOP records now
  preserve version metadata while old body-only callers remain compatible. Real approved staff
  names are retained where routing depends on them; credentials, phone numbers, and patient data are
  excluded.
- **Executable rules:** added `src/data/obgynWorkflowRules.js` with 24 versioned rules covering
  Annual GYN/GYN OV, Dr. Bank waitlist, known/unknown LMP, New OB construction, documented RTO and
  missing orders, OB sonography/provider pairs, postpartum/IUD variants (Dr. Stanislawski and Dr.
  Klein), MFM/Rebecca Wood, transfer OB, High Priority + Intermedia escalation, Take Action,
  refills, labs, late arrival, and pregnancy loss. Each rule carries triggers, chart checks,
  required/prohibited actions, documentation, escalation, variants, domains, competencies, and
  stable provenance.
- **Generated assessment contracts:** MCQs and Spot-the-Error audits now select structured rules,
  receive only those rules plus SOP grounding, and persist `sourceSopVersion`, `sourceRuleVersion`,
  `sourceAuthority`, `ruleIds`, and `workflowType`. OB/GYN audits use a 14-workflow taxonomy and
  additionally persist `errorKind`, `expectedCorrection`, and `requiredChartFacts`; validation
  requires exactly 10 alternating turns, exactly one deterministically contradictory Agent error,
  and an Agent `errorIndex` (no silent repair from a Patient turn). Data-driven guards reject stale
  workflow contradictions before generated content can be saved.
- **Call QA bank and grading:** replaced the active generic OB/GYN bank with 15 curated current-floor
  workflows, each with a hidden chart state, expected actions, critical misses, scoring notes, rule
  IDs, and source versions. Hidden chart facts stay server-side in the caller persona and immutable
  attempt snapshot. The deterministic grader recognizes current OB Portal, Rebecca Wood, waitlist,
  Take Action, paired-appointment, New OB, lab, transfer, and High Priority/Intermedia handling while
  retaining legacy policies solely for historical attempt replay. Transcript grading evaluates
  observable questions, classifications, explanations, and stated next steps; it never assumes
  silent ECW actions and forces review where an unobservable action determines correctness.
- **Drift/review UI:** a pure non-destructive helper labels question, audit, and Call QA content
  Current, Stale, Legacy/unversioned, or unknown-rule review. Historical content is never rewritten,
  and activating a new SOP never retroactively validates old content.
- **Governance:** the human-readable active SOP remains the operational source; structured rules are
  the executable assessment layer. Content still requires supervisor review, live-model calibration,
  and operational monitoring. Scores/recommendations are coaching evidence, not an automatic
  employment decision.
- **Safety/scope:** no merge, deployment, production Firestore write, or destructive migration in
  this branch.


### 2026-07-17 - PR #33 integrated with main b54f701
- Merged main commit `b54f701` into the Call QA calibration branch. Conflict resolution preserves
  PR #33's calibration/pilot-smoke documentation and main's visual-polish and Spot the Error
  deferred-feedback history. The combined suite is 1133 tests across 56 files.
- **Verification:** `npm ci` succeeded (864 packages; 3 existing moderate findings); `npm test`
  1133/1133; `npm run test:rules` 51/51 + 16/16; `npm run build` passed with the existing Firebase
  chunk warning; calibration and coverage remained `INSUFFICIENT_DATA` with 0 human cases and 88
  gaps; pilot smoke remained `PILOT_SMOKE_VERIFIED` for 15 cases; the readiness check exited 1 as
  expected; `npm run test:e2e:safe` passed 12/12. No live model call, production-data access,
  audio storage, automatic final verdict, merge of PR #33, or deployment occurred.

### 2026-07-17 - PR #33 pilot-smoke grade-failure coverage guard
- Added `grade-failed` to the mandatory `qa:pilot-smoke` categories and a regression proving that
  removing every grade-failed rehearsal returns `PILOT_SMOKE_FAILED` with
  `missing-category:grade-failed`. Calibration thresholds and automation authority are unchanged.
- **Verification:** `npm test` 1129/1129 across 55 files; `npm run test:rules` 51/51 + 16/16;
  `npm run build` passed with the existing Firebase chunk-size warning; `npm run qa:calibrate`
  and `npm run qa:coverage` remained `INSUFFICIENT_DATA` with 0 human cases and 88 gaps;
  `npm run qa:pilot-smoke` reported `PILOT_SMOKE_VERIFIED` for the standard 15 cases;
  `npm run qa:calibrate:check` exited 1 as expected. No live model call, production data access,
  audio storage, automatic final verdict, merge, or deployment occurred.

### 2026-07-16 - PR #33 operational calibration and management pilot smoke
- **Capture-only evidence:** added sanitized `source:'operational-pilot'` fixtures for terminal
  abandoned, capture-incomplete, and grade-failed attempts. They may omit transcript, turn counts,
  human review, model output, and rubric labels; any transcript/count data that exists is still
  validated against allowed roles and counts. Non-failure or graded operational fixtures fail
  closed.
- **Metric boundary:** operational-pilot fixtures feed capture reliability, capture/grading
  breakdowns, mixed-population capture evidence, and the critical capture-failure safety gate.
  They are excluded from final-outcome agreement, human pass/fail/review counts, criterion and
  auto-fail accuracy, scenario/workflow calibration volume, and every automation sample minimum.
  Grading fixtures now remain fully graded/labeled; live calibration retains operational failures
  in reports but never sends them to Gemini.
- **Monday smoke workflow:** added `qa:pilot-smoke`, a separate non-production 15-case local
  synthetic/rehearsed suite covering pass, fail, safety violation, needs review, incomplete
  capture, abandoned capture, grade failure, Pediatrics, OB/GYN, and Phase 3 complete/incomplete
  behavior. It prints `PILOT_SMOKE_VERIFIED` or `PILOT_SMOKE_FAILED`, exposes no readiness or
  approved population, and cannot unlock shadow eligibility or automatic finalization.
- **Policy separation:** the production gate remains calibration policy v2 with at least 200
  independently human-reviewed adjudicated calls plus all outcome, coverage, safety, and version
  gates. Committed evidence remains 3 synthetic examples, 0 human pilots, and 0 operational pilots;
  readiness remains intentionally `INSUFFICIENT_DATA`.
- **Verification:** `npm test` 1128/1128 across 55 files; `npm run test:rules` 51/51 + 16/16 using
  the existing portable Temurin 21 runtime; `npm run build` passed with the existing Firebase
  chunk-size warning; `npm run qa:calibrate` and `npm run qa:coverage` reported
  `INSUFFICIENT_DATA`, 0 human cases, 0 operational fixtures, 3 excluded synthetic examples, and
  88 coverage gaps; `npm run qa:pilot-smoke` reported `PILOT_SMOKE_VERIFIED` for 15 cases;
  `npm run qa:calibrate:check` exited 1 as expected. No live model call, production data access,
  audio storage, merge, or deployment occurred.

### 2026-07-16 - PR #33 calibration/readiness merge-blocker hardening
- **Population integrity:** bumped the calibration policy to
  `call-qa-calibration-policy-v2`. Readiness now requires at least 60 human passes, 60 fails, and
  40 review-required outcomes, with every class at least 15% of evaluated cases. Zero-denominator
  Wilson intervals remain `null`/unavailable and cannot satisfy readiness. All-pass, all-fail,
  all-review, severely imbalanced, and zero-denominator populations are regression-tested.
- **Label integrity:** every human reviewer, adjudication, and model run must label all 20 rubric
  criteria exactly once (`NA` when inapplicable). Missing/unknown criteria and duplicate model
  criteria fail validation. Adjudicated recommendation/finalPass/reviewRequired and model
  recommendation/pass combinations are checked for consistency. The 3 synthetic examples and all
  sufficient-population test builders now use the complete rubric.
- **Capture integrity:** fixture validation now enforces the PR #32 capture/grading state matrix,
  exact `captureComplete` semantics, model-run presence only for graded attempts, and exact
  patient/navigator transcript role counts. Human incomplete, abandoned, active, and grade-failed
  attempts remain visible in capture/grading breakdowns and every mixed-version readiness report.
  A versioned 1% critical capture-failure gate covers incomplete, abandoned, and grade-failed
  attempts, so enough successful cases cannot hide operational failures.
- **Shadow hardening:** bumped the non-final diagnostic policy to
  `call-qa-clean-pass-shadow-v2`. Eligibility now requires calibration policy v2,
  `qa.metadataIntegrity.verified === true`, a complete valid rubric result, and
  server-authoritative `qa.transcriptMetadata` matching the attempt ID, capture state,
  capture-complete flag, capture version, and live model. `off|shadow` remains the entire mode set;
  no `qaFinalReview` or automatic finalization path was added.
- **Verification:** focused calibration/shadow/CLI tests 78/78; `npm test` 1123/1123 across 54
  files; `npm run test:rules` 51/51 + 16/16; `npm run build` passed with the existing Firebase
  chunk-size warning; `npm run qa:calibrate` and `npm run qa:coverage` remained
  `INSUFFICIENT_DATA` with 0 human cases, 3 excluded synthetic examples, and 88 coverage gaps;
  `npm run qa:calibrate:check` exited 1 as expected; changed server/CLI files passed
  `node --check`; `git diff --check` passed. No live model call, production data access, audio
  retention, merge, or deployment occurred.

### 2026-07-16 - Call QA calibration, coverage, and shadow automation readiness (PR 3)
- **Goal:** add an honest measuring instrument around the PR #31 evidence/model protections and PR
  #32 server-authoritative capture state machine without enabling automatic final pass/fail.
- **Calibration fixtures:** added versioned sanitized local fixtures with a pure fail-closed
  validator. It rejects unknown departments/scenarios/criteria/auto-fails, scenario mismatch,
  invalid verdict/capture/grading states, duplicate/insufficient reviewers, incomplete human
  adjudication, empty/malformed transcripts, missing model provenance, and recursive sensitive
  fields. The 3 committed examples are explicitly `source:'synthetic-example'`; they do not count
  as human evidence. No production Firestore downloader was added.
- **Metrics/readiness:** `api/_qa-calibration.js` reports the 3×3 human/model outcome confusion
  matrix, false passes/fails, review misses, criterion precision/recall and disagreements,
  safety-critical agreement from the existing safety source, auto-fail TP/FP/FN/TN, capture
  integrity, Wilson 95% intervals, version populations, operational breakdowns, and rich curated
  scenario/workflow/domain/competency coverage. `api/_qa-calibration-gates.js` owns
  `call-qa-calibration-policy-v1`; small perfect samples remain insufficient, mixed populations
  must qualify independently, and false automatic auto-fails/review misses fail safety.
- **CLI:** added `qa:calibrate`, `qa:calibrate:check`, and `qa:coverage`. Offline runs validate every
  JSON fixture and deterministically write ignored `artifacts/call-qa-calibration/report.{json,md}`.
  Empty/no-human data returns `INSUFFICIENT_DATA` and explicitly says no real-world accuracy
  conclusion is possible. Optional live mode requires `CALL_QA_CALIBRATION_LIVE=true`, Gemini keys,
  `--live`, and `--confirm-live`, prints request exposure first, runs sequentially through the
  existing pinned `gradeCallQaTranscript()` service with static local SOP context, and never
  reads/writes Firestore or edits fixtures.
- **Shadow automation:** `api/_qa-automation-policy.js` adds a pure fail-closed eligibility check and
  `off|shadow` environment parsing. It requires clean server capture, high-confidence pass, zero
  auto-fails/unresolved evidence/deterministic findings/repairs/review flags/capture warnings,
  complete matching provenance, clean-pass calibration readiness, and no final supervisor review.
  It never changes `qa.pass`, creates `qaFinalReview`, changes Phase 3 completion, or affects
  capability/history scoring, training, coaching, or supervisor actions.
- **Privacy/docs:** no audio is stored. Added `docs/CALL_QA_CALIBRATION.md`,
  `docs/CALL_QA_AUDIO_RETENTION_DECISION.md`, root `CALL_QA_CALIBRATION.md`, grading invariants,
  README/env guidance, and F27 in CLAUDE.md. Current evidence is 0 human pilot cases and the expected
  readiness result is `INSUFFICIENT_DATA`.
- **Verification:** `npm ci` succeeded (864 packages; existing audit reports 3 moderate
  vulnerabilities); `npm test` 1101/1101 across 54 files; `npm run test:rules` 51/51 result
  authorization + 16/16 Call QA interview assertions using a temporary portable Temurin 21 JRE;
  `npm run build` clean (existing >500 kB Firebase chunk warning only); `npm run qa:calibrate` and
  `npm run qa:coverage` both generated deterministic `INSUFFICIENT_DATA` reports with 0 human cases,
  3 excluded synthetic examples, and 88 visible coverage gaps; all six changed/new server or CLI
  JavaScript files passed `node --check`; `git diff --check` clean. No Playwright run because
  production UI was untouched. No live calibration, production data access, audio storage, merge,
  or deploy.
### 2026-07-17 (part 3) - Spot the Error: deferred feedback + required explanation
- **What changed (owner request):** the assessment's active phase no longer reveals correct/wrong
  after each pick, and every pick now requires a typed explanation of *why* that message is the
  error before advancing.
- **Active phase (`SpotTheError.jsx`):** clicking an Agent bubble now just SELECTS it (neutral
  clay highlight, `spot-error__bubble--selected`, `aria-pressed`); the pick stays changeable until
  "Next item →" / "Finish & see results" commits `{ picked, correct, explanation }` into `picks`.
  The commit button lives in an explain panel (label + textarea, reusing `.spot-error__textarea`)
  that appears once a message is selected and is disabled until the explanation is non-empty
  (trimmed). The old one-click lock, per-item verdict card, and `--found`/`--wrong` bubble reveals
  are gone; header copy updated ("…then explain why. You can change your pick until you continue —
  results are revealed after the last item.").
- **Review phase:** now the FIRST place any verdict appears. Each item shows the ✓ Correct /
  ✗ Missed badge (unchanged), the navigator's own pick quoted when missed
  (`.spot-error__review-pick`), the actual error + model explanation (unchanged), and the
  navigator's typed reasoning in a labelled quote block (`.spot-error__review-yours`).
- **Scoring/persistence unchanged:** click accuracy is still the entire score
  (`scoreSpotTheError` already reads `p?.correct` and tolerates the extra `explanation` field);
  `onComplete(domainScores, mode)` signature untouched; explanations are display-only in the
  review and are NOT persisted to Firestore (possible future follow-up: thread them into the spot
  result's `answers` for supervisor visibility).
- **CSS:** added `--selected` bubble, `.spot-error__explain-label/-hint`,
  `.spot-error__review-pick`, `.spot-error__review-yours*`; deleted the now-orphaned
  `--found`/`--wrong` reveal rules, the `spot-shake` animation block, and the
  `__feedback-verdict` rules (`.spot-error__feedback` container kept and reused for the explain
  panel).
- **Tests:** new `src/components/spotTheError.component.test.jsx` (4 jsdom tests, db/firebase/
  apiFetch mocked, items served from a mocked audit bank): no verdict text/classes during the run;
  explanation gating + changeable pick + per-item reset; patient turns not pickable; review-only
  correctness/pick/reasoning display. Full suite 1049/1049 across 52 files; build clean.

### 2026-07-17 (part 2) - Bold visual layer (floating pill nav, 3D hero, lettered options)
- **Context:** the owner judged the part-1 polish "not impressive at all" — the brief is to make
  the site as beautiful as possible. This layer goes for visible drama while keeping the warm
  refined-light identity and staying CSS-only (zero JSX changes, zero new dependencies).
- **Nav:** now a floating frosted pill — detached from the page edge, sticky at `top: 14px`,
  `min(100% - 32px, 1360px)` wide, stronger blur/highlight shadows, `white-space: nowrap` on brand
  + tabs. Below 1200px the link strip scrolls horizontally behind an overflow fade (no visible
  scrollbar); ≤760px it wraps under the brand as the part-1 swipeable row (pill radius relaxes to
  24px for the two-row shape).
- **Start hero:** the headline is an ink→clay gradient serif masthead (`background-clip: text`
  over the Fraunces title); the capability-map preview tilts in gentle 3D
  (`perspective(1300px) rotateY(-7deg)`, flattens on hover) above a blurred warm halo pseudo.
- **Screen titles:** block-level page titles (`overview/matrix-view/results/module/gate/
  dept-select`) get a 46px clay kicker rule above the headline — an editorial signature.
- **KPI tiles:** left accent rail replaced by a gradient crown along the top edge; values grew to
  46px gradient numerals; labels became small-caps with tracking.
- **Matrix:** column headers are small-caps micro-labels; capability pills are full-round with a
  top-light/bottom-shade inset pair and a deeper hover pop.
- **MCQ options:** the empty `aria-hidden` marker span now renders lettered A/B/C/D chips via CSS
  counters (`counter(opt, upper-alpha)`); hover tints the letter clay; the selected chip fills
  with the clay gradient + glow. Options widened to 16px radius with better line-height.
- **Buttons/cards/canvas:** primary buttons run a light sweep on hover (reusing the existing
  `shimmer` keyframe; `.btn` gained `overflow: hidden`); cards moved to `--radius-lg` with a
  machined inset top highlight; the body mesh gained a top-center ivory spotlight and stronger
  color pools; progress bars thickened to 8px.
- **Safety:** card borders stayed real (no gradient-border trick), so every state signal that
  swaps `border-color` (`.phase-card--next`, `.option.is-selected`, `.deptstrip__item.is-current`,
  interview log open, etc.) still renders exactly as before.
- **Verification:** `npm test` 1045/1045, `npm run build` clean. Headless-Chromium screenshots of
  the Start gate plus a throwaway harness (real `Nav` + `Matrix` + `Check` with mock rows, never
  committed) at 1440px/390px: zero horizontal overflow at both widths, one-line pill nav at
  desktop, swipeable strip on mobile, lettered options + serif scenario verified rendering.
- **Files:** `src/styles.css`, `CLAUDE.md`, `docs/HISTORY.md`.

### 2026-07-17 - Visual polish pass (typography, mobile nav fix, brand details)
- **Goal:** make the app as beautiful as possible within the established refined-light
  ivory/clay identity — no redesign, no new dependencies, CSS + `index.html` only.
- **Two-voice typography:** added **Fraunces** (variable optical-size serif) as `--font-display`
  on the ten page-level headline classes + the MCQ scenario prose (`.question__scenario`), and
  switched Inter to its variable range (`wght@400..900`) so the sheet's 550/650/850 intermediate
  weights render as true weights instead of snapping to the nearest static cut. Panel/widget
  headers deliberately stay Inter. Headlines get `text-wrap: balance`, ledes `text-wrap: pretty`.
  The display layer lives at the END of `styles.css` so it wins same-specificity ties.
- **Fixed the documented mobile nav overflow** (recorded 2026-07-14 during the Assessment Bank
  selector browser walkthrough): at ≤760px the nav wraps to brand-above-links and `.nav__links`
  becomes a full-width, swipeable, scrollbar-less pill row with a right-edge mask fade hinting at
  overflow (`padding-right` lets the last pill scroll clear of the fade). Verified in headless
  Chromium at 390px: `document.scrollWidth` now equals the viewport (no horizontal page scroll)
  with the strip internally scrollable; desktop layout unchanged. The same query tightens
  `.main`/`.deptbar` side padding to 16px on phones.
- **Brand details:** deleted the orphaned `.nav__logo`/`.start__logo`/`logo-float` rules (flagged
  in §8 since 2026-06-28); the wordmark now carries a CSS-only rotated clay-gradient "gem"
  (`.nav__brand::before`), and the footer became a refined uppercase closing band with a short
  clay rule flourish (`.footer::before`).
- **Micro-polish:** warm minimal scrollbars (thin, content-box thumb, transparent track, both
  engines); a zero-specificity global focus ring (`:where(button, a, [role='tab'],
  [tabindex]):focus-visible`) so keyboard focus is always visible without fighting component
  rules like `.btn`'s box-shadow ring; proper tracking (0.06–0.08em) on the uppercase
  micro-labels that had `letter-spacing: 0`; `theme-color` meta aligned to the ivory canvas
  (`#f4eee1`).
- **Verification:** `npm test` 1045/1045, `npm run build` clean. Real-browser (headless Chromium
  via the repo's Playwright) screenshots of the Start gate at 1440px + 390px and a throwaway
  harness mounting the real supervisor `Nav` (widest tab set, never committed) confirmed the
  serif headlines, gem mark, footer flourish, and the nav overflow fix end to end.
- **Files:** `index.html`, `src/styles.css`, `CLAUDE.md`, `docs/HISTORY.md`. No JSX changes.

### 2026-07-15 (part 3) - Call QA checkpoint write serialization (PR 2 final merge blocker)
- **Context:** the final merge review of draft PR #32 found the server-authoritative transcript
  pipeline still permitted concurrent Firestore checkpoint writes: `requestCheckpoint({force})` called
  the async `doCheckpoint()` without serializing it, so (a) an older in-flight checkpoint could
  complete after a newer one and overwrite it, and (b) an in-flight checkpoint could land AFTER the
  terminal `finalizeCapture()` and overwrite the finalized transcript/metadata while `captureStatus`
  stayed `captured`. Fixed on the same branch in one commit; no merge/deploy.
- **Fix (`api/live-relay.js`):** all checkpoint writes now go through ONE session-owned serialized
  loop (`runCheckpointQueue` + `buildCheckpointPayload` + `drainCheckpointQueue`).
  - At most one `checkpointTranscript()` is ever in flight; concurrent requests set a dirty flag and
    coalesce onto the running loop, which re-writes the NEWEST bounded snapshot (generated at write
    time) when the current write finishes — an older snapshot can never overwrite a newer one, and it
    never does one write per fragment.
  - `terminateCapture()` sets `finalizing` first (which blocks any new checkpoint from starting),
    cancels the trailing-checkpoint timer, **awaits `drainCheckpointQueue()`**, then runs
    `finalizeCapture()` as the LAST write. `requestCheckpoint`/`runCheckpointQueue`/the trailing timer
    all refuse to start once `finalizing`/`finalized`/`closed`, so no checkpoint can modify transcript
    data after finalization. Durability points (active-turn settle expiry, End Call, terminal
    finalization) `await` the queue.
  - A checkpoint failure preserves dirty state (re-set on the caught error, loop breaks to avoid a hot
    retry) so a later checkpoint or the terminal finalization still persists the newest transcript;
    transcript content is never logged; a failed terminal write keeps the retake behavior.
- **Tests:** +5 (1045 total, 51 files) in `api/liveRelay.test.js`, with a new controllable-write-order
  fake Firestore (`_deferred`/`settleDeferred`/`failDeferred`/`_applied` in
  `api/fixtures/fakeFirestore.js`): older-checkpoint-can't-overwrite-newer, one-trailing-write-per-late-
  fragment, checkpoint-can't-overwrite-terminal-finalization (finalize is the last write, no checkpoint
  after), checkpoint-failure-preserves-dirty (+ no transcript in logs), and finalization-ownership (no
  new checkpoint + no double-finalize after `finalizing`).
- **Docs:** [GRADING_INVARIANTS.md](GRADING_INVARIANTS.md) §0d (5 new binding statements), CLAUDE.md
  F25 + counts.

### 2026-07-15 (part 2) - Call QA capture integration fixes (PR 2 final merge-review)
- **Context:** the final merge-review of draft PR #32 found three integration defects in the
  server-authoritative Call QA capture. Fixed on the same branch in one follow-up commit; no
  merge/deploy.
- **Fixes:**
  1. **Active-call late transcriptions + turn-scoped ordering (`api/live-relay.js`).** An ordinary
     active-call `turnComplete` no longer flushes immediately (a transcription can arrive after
     `turnComplete` at any point, not just after End). Each exchange now waits a short
     `CALL_QA_ACTIVE_TURN_SETTLE_MS` window before committing; late fragments stay with their
     exchange (never merged into the next), flushed navigator-first. End Call absorbs any pending
     active exchange before draining, with no duplicate lines. Active and drain settle share one
     mechanism.
  2. **Durable + bounded staged checkpoints (`api/live-relay.js`, `api/_call-qa-transcript.js`).**
     Post-boundary/drain fragments force an immediate durable checkpoint; debounced writes mark the
     checkpoint dirty and guarantee one trailing durable write, so a crash mid-settle can't strand a
     late fragment in memory. Staged strings are bounded by the SAME `boundedAppend` used by the
     coalescer (shared, not two implementations) — `MAX_QA_TURN_CHARS` per turn (non-silent
     `turn-length-capped`), and the durable snapshot is capped at `MAX_QA_TURNS`.
  3. **Aligned browser/server finalization timeouts (`api/live-relay.js`, `src/components/VoiceCall.jsx`).**
     The server computes a safe client guard from its actual drain+settle config plus a
     persistence/network margin (`clientFinalizeGuardMs`, bounded 20–90s) and sends it in the trusted
     `ready.finalization.clientGuardMs`. The browser applies a defensive clamp and uses it (no more
     hardcoded 15s that could abandon a valid 30s drain); a ≥60s fallback covers a missing value.
     Client timings are never trusted.
- **Tests:** +17 (1040 total, 51 files) — relay active-turn-settle/ordering/absorb-on-End/no-dup,
  durable-late-checkpoint, staged-content bounds + warnings, finalization-timing metadata; a
  `boundedAppend` unit test; and two client guard tests (server value applied, fallback ≥ server max).
- **Docs:** [GRADING_INVARIANTS.md](GRADING_INVARIANTS.md) §0c (7 new binding statements),
  `.env.local.example` (`CALL_QA_ACTIVE_TURN_SETTLE_MS`, `CALL_QA_FINALIZE_MARGIN_MS`), CLAUDE.md
  F25 + counts.

### 2026-07-15 - Call QA capture/finalization hardening (PR 2 merge-review follow-up)
- **Context:** merge-review of draft PR #32 surfaced correctness blockers in the PR-2 server-
  authoritative Call QA capture. Addressed on the same branch in one follow-up commit; no merge/deploy.
- **Fixes:**
  1. **Final-transcription ordering + two-stage drain (`api/live-relay.js`).** Gemini Live delivers
     `input`/`outputTranscription` independently and can deliver a transcription AFTER `turnComplete`,
     so `turnComplete` no longer immediately closes the capture. End Call now runs a bounded two-stage
     drain: an overall `CALL_QA_DRAIN_TIMEOUT_MS` deadline plus a `CALL_QA_TRANSCRIPT_SETTLE_MS` quiet
     window that only elapses after a post-End boundary with no further transcription (any
     transcription resets it). Each exchange is staged and flushed navigator-first so out-of-order
     input/output events are stored in speaking order. Env values are parsed + clamped.
  2. **Never acknowledge before the terminal write (`api/live-relay.js`).** `finalizing`/`finalized`
     states; `finalized` is set only after `finalizeCapture` resolves; a failed terminal write sends
     an explicit `capture-finalize-failed` error (not `captured`) and preserves the attempt.
  3. **Exact grading-lease ownership (`api/_call-qa-attempts.js`).** `commitGrade`/`markGradeFailed`
     require `gradingLeaseId === leaseId`; a null/missing/different lease id is not ownership.
  4. **No unpersisted grade after lease loss (`api/grade-call-qa.js`).** On `lease_lost` the endpoint
     returns a stored grade only if one is durably persisted, else a retryable 409/503 — never the
     losing request's local model output.
  5. **Already-graded readable during grader outage (`api/grade-call-qa.js`).** Gemini keys are
     required only when new grading must run; an already-graded attempt returns its stored result
     with zero keys; a missing-keys claim releases the lease (transcript retained).
  6. **Roster-member gate (`api/live-relay.js`).** `loadRosterMember` replaces `loadRosterName`;
     a start is rejected (no attempt created) unless the roster doc exists, matches the token, and is
     not `inactive`.
  7. **Integrity hardening:** capture integrity FAILS CLOSED (needs both `captureStatus:'captured'`
     and `captureComplete:true`); accurate `endedBy` provenance (`navigator`/`client_disconnect`/
     `upstream_service`/`server_timeout`); non-silent `turn-length-capped` truncation warnings;
     `attemptId` validation (400, not a 500 path exception); staged-transcript checkpointing.
  8. **Client (`VoiceCall.jsx`).** An unacknowledged finalization (socket close / timeout /
     capture-finalize error) routes to a RETAKE screen with no grade retry; grade retry is preserved
     only after a confirmed `captured` ack; a `captured` incomplete ack still grades (with mandatory
     review).
- **Tests:** +26 (1023 total, 51 files) — relay two-stage-drain/ordering/roster/ack-after-write,
  attempts lease-race regressions, transcript truncation warnings, endpoint fail-closed / keys-after-
  claim / lease-loss-no-fallback / attemptId-validation, and a new `voiceCall.component.test.jsx`
  driving the End-Call handshake + capture-vs-grade-retry distinctions with fake browser APIs.
- **Docs:** [GRADING_INVARIANTS.md](GRADING_INVARIANTS.md) §0b (10 new binding statements),
  `.env.local.example` (`CALL_QA_TRANSCRIPT_SETTLE_MS`), CLAUDE.md F25 + counts.

### 2026-07-14 (part 6) - Server-authoritative Call QA transcript capture (PR 2)
- **Context:** PR 1 hardened the Call QA *grading* pipeline but left the scored transcript
  browser-authoritative — `VoiceCall.jsx` coalesced transcript fragments in browser memory, saved
  them through the client Firestore SDK, and sent the same browser-built transcript to
  `/api/grade-call-qa`. A modified browser could alter or replace its own transcript before grading,
  and clicking End closed the socket immediately, which could drop the final transcription event.
- **Change:** the scored Call QA test is now captured, finalized, loaded, graded, and persisted by
  the server.
  - **New `api/_call-qa-transcript.js`** — pure, testable transcript coalescer (`TranscriptCapture`)
    that normalizes roles to `patient`/`navigator`, coalesces consecutive same-role fragments,
    bounds turn length + count, and ignores empties.
  - **New `api/_call-qa-attempts.js`** — server-owned Call QA attempt state machine over the
    existing `interviews` collection (Firebase Admin). Explicit `captureStatus`
    (`active`/`captured`/`capture_incomplete`/`abandoned`) and `gradingStatus`
    (`not_started`/`grading`/`graded`/`grade_failed`) axes, an immutable server `scenarioSnapshot`,
    checkpoint/finalize writes, and a transactional grading **lease** for idempotency. All functions
    take `db` for DI so the machine is unit-testable against an in-memory Firestore double.
  - **`api/live-relay.js` rewritten with dependency injection.** Test-mode `start` now carries only
    `{ idToken, mode:'test', department, qaScenarioId }`; the relay derives `navigatorId` from the
    verified token, loads + validates the curated scenario server-side, creates the attempt BEFORE
    `ready`, captures the transcript from Gemini Live's `inputTranscription`/`outputTranscription`,
    checkpoints at turn boundaries, IGNORES any browser transcript message, and runs a bounded
    **End Call drain handshake** (signal end-of-audio upstream → wait `CALL_QA_DRAIN_TIMEOUT_MS` for
    a final boundary → finalize `captured` vs `capture_incomplete` → send `{type:'captured'}`). An
    unexpected disconnect persists the partial transcript as `abandoned`. Practice mode is unchanged.
  - **`api/grade-call-qa.js`** — the grading orchestration is extracted into a reusable
    `gradeCallQaTranscript()` service (all PR-1 invariants preserved); the public endpoint now takes
    ONLY `{ attemptId }`, loads the stored transcript + snapshot, grades that, and persists via the
    lease. Idempotent (already-graded returns the stored result with no second Gemini call),
    retryable (a failure keeps the transcript), and adds server-owned `qa.transcriptMetadata`
    provenance separate from `qa.gradingMetadata`.
  - **`VoiceCall.jsx` test mode** no longer calls `saveInterview`/`updateInterviewGrade` or submits a
    transcript. It keeps only the attempt id + a caption mirror, runs the End→`finalizing`→`captured`
    handshake, and grades by `{ attemptId }`. `apiFetch` now surfaces the HTTP status so the client
    can show the "no speech captured" (422) case distinctly. Practice mode unchanged.
  - **`firestore.rules`** — navigators may still create/read their own practice interviews and attach
    the advisory grade, but may NOT create a server-authoritative Call QA attempt (`assessmentType:
    'call-qa'`, `captureAuthority:'server'`, or a curated QA scenario id) nor mutate any field of a
    server-created attempt. New emulator suite `tests/firestore-rules/call-qa-interviews.rules.mjs`
    (chained into `npm run test:rules`).
  - **Supervisor UI** (`NavigatorDetail.jsx`) shows transcript provenance: "Server-captured live
    transcript" + capture status (with an incomplete-capture warning) vs "Legacy browser-captured
    transcript." Navigator result screen says "Transcript captured by the call server" — never
    "perfect."
- **Tests:** +44 unit tests (997 total, 50 files) — `api/_call-qa-transcript.test.js`,
  `api/_call-qa-attempts.test.js`, rewritten `api/gradeCallQaEndpoint.test.js` (attempt-id +
  service), new `api/liveRelay.test.js` (DI capture + drain + disconnect), and rewritten
  `voiceCall.test.js` / `components.test.jsx` QA blocks. Rules suite requires a Java-equipped
  environment (run in CI); not runnable in the container. Build clean.
- **Explicitly NOT in scope:** server-authoritative MCQ/Spot scoring (separate future project); real
  microphone/acoustic validation (post-deploy manual step). No migration or deployment performed.
- **Docs:** [GRADING_INVARIANTS.md](GRADING_INVARIANTS.md) §0a (ten new binding invariants);
  CLAUDE.md F25 + counts.

### 2026-07-14 (part 5) - Call QA evidence integrity + model auditability (PR 1)
- **Context:** hardening pass on the existing Call QA grading pipeline (F25). The pipeline was
  reliable but had three trust gaps: (1) evidence verification (`verifyEvidence`) matched against
  the *concatenated full transcript* and had an unordered word-bag fallback, so a quote could be
  "verified" from caller wording or stitched across turns; (2) a NOT_MET verdict did not
  distinguish an *observed wrong behavior* from an *absent behavior*, and an unverifiable negative
  allegation was treated as fully trustworthy; (3) scored Call QA used a `[MODEL, STABLE, LITE]`
  fallback chain, so a scored assessment could be graded by an un-recorded, un-calibrated model, and
  no model/version provenance was stored. **This PR does NOT make the transcript server-authoritative
  (that is PR 2).**
- **Evidence integrity:** `verifyEvidence(transcript, quote, { role, requireSingleTurn })` now
  matches a normalized, in-order, **contiguous substring inside ONE eligible turn** of the required
  role (grading always uses `verifyNavigatorEvidence` = `{ role: 'navigator', requireSingleTurn:
  true }`). Removed the unordered `words.every(...)` fallback and the full-transcript concatenation.
  `patient`/`caller` are equivalent caller-side aliases and never satisfy a navigator criterion,
  auto-fail, or negative evidence. Matching tolerates case, punctuation, repeated whitespace, curly
  apostrophes, and a small deterministic contraction normalization ("I'm" ↔ "I am") — no fuzzy or
  semantic matching. All MET criterion evidence, auto-fail evidence, evidence-based NOT_MET, and
  deterministic repair evidence go through this one verifier; a repair is only applied when its
  replacement evidence verifies as one navigator turn.
- **Negative-judgment basis:** every grader criterion now carries `basis` (`EVIDENCE` | `ABSENCE`).
  MET → EVIDENCE + quote; an OBSERVED wrong/unsafe miss → NOT_MET/EVIDENCE + quoted navigator line;
  a never-happened behavior → NOT_MET (or NA)/ABSENCE + empty evidence. `validateQaResponse` (and
  the exported `validateCriterionBasis`) reject any other combination (MET/ABSENCE, MET-empty,
  NOT_MET/EVIDENCE-empty, NOT_MET/ABSENCE-with-evidence, NA/EVIDENCE, unknown/missing basis) so the
  existing malformed-response retry runs — malformed output is never silently coerced. The response
  schema + grader prompt require and explain `basis`.
- **Unresolved negatives:** a NOT_MET/EVIDENCE whose quote fails navigator verification is marked
  `unresolved` + `unresolvedReason`, forces `recommendation: needs_review` via the new
  `unresolved-negative-evidence` review flag, and raises `safetyRisk` to at least `elevated` when the
  criterion is safety-critical. It normally stays provisionally NOT_MET; a whitelist-only deterministic
  fairness repair backed by independently verified navigator evidence may change the *effective*
  verdict to MET, but the original allegation stays unresolved and supervisor review remains
  mandatory (see the audit follow-up below and GRADING_INVARIANTS §0.4). It is never presented as
  observed (excluded from projected quotes).
- **Model auditability:** the raw validated grader judgment is preserved on every scored criterion
  as `modelJudgment` and on every repair as `originalBasis` (alongside the existing
  `originalVerdict`/`originalNote`/`originalEvidence`). `geminiWithRotation` now returns the actual
  successful `model` (backward-compatible — callers reading only `text` are unaffected).
- **Pinned scored model:** `grade-call-qa` uses ONE model via the new `callQaGraderModel(env)`
  helper + `CALL_QA_GRADER_MODEL` env var (default `MODEL`; empty/whitespace → `MODEL`). Key
  rotation still applies; **model fallback does not** — a pinned-model exhaustion returns the normal
  grading failure (preserving the already-saved attempt for the existing retry flow), never a Lite
  fallback; a malformed-output retry reuses the same pinned model. Advisory practice grading and
  other endpoints keep their fallback chains.
- **Grading metadata:** every successful QA result now includes `qa.gradingMetadata =
  { model, rubricVersion, promptVersion, scenarioVersion, gradedAt }`, all server-owned — `model`
  is the actual answering model, `rubricVersion` (`QA_RUBRIC_VERSION`) / `promptVersion`
  (`CALL_QA_PROMPT_VERSION`) are pinned constants, `scenarioVersion` comes from the trusted curated
  scenario (`CALL_QA_SCENARIO_BANK_VERSION` via the `scenario()` factory), and `gradedAt` is a
  server ISO timestamp. Client-supplied model/version/gradedAt are ignored. Persisted through the
  existing `updateInterviewGrade(id, grade, qa)` path — no new collection or metadata document.
- **Non-final labels:** the navigator-facing immediate Call QA result and the supervisor
  history badge never show a bare PASS/FAIL for an un-reviewed attempt. New shared helpers in
  `qaFinalReview.js` — `qaAiResultLabel(qa)` (`AI PASS/FAIL — PENDING SUPERVISOR REVIEW` /
  `NEEDS SUPERVISOR REVIEW`), `qaHistoryBadgeLabel(session)` (`QA TEST · AI PASS — PENDING REVIEW`
  … / `QA TEST · FINAL/OVERRIDDEN PASS/FAIL`), and `qaBadgeTone(session)`. The supervisor detail
  panel keeps its explicit "AI verdict: … / Final verdict: …" rows. Existing `qaFinalReview` /
  `qaFinalVerdict` / supervisor confirm/override flow unchanged.
- **Preserved:** glossary corrections, curated-scenario authority checks, fairness repairs
  (still whitelist-only NOT_MET→MET on `know-rule`/`doc-te`), routing-policy checks, deterministic
  conflict findings, auto-fail evidence verification, the 85 pass threshold + auto-fail zeroing,
  persistence retries, supervisor final review, the deterministic corpus (54/54), and grading
  invariants (17/17). The captured-response fixture gained `basis` on every criterion; its two
  refill evidence quotes were corrected to the glossary-normalized form they grade against (it is a
  `simulated-example`, not a real capture).
- **Files:** `api/_qa-rubric.js`, `api/grade-call-qa.js`, `api/_gemini-client.js`,
  `src/data/qaRubric.js`, `src/data/callQaScenarios.js`, `src/components/VoiceCall.jsx`,
  `src/components/NavigatorDetail.jsx`, `src/lib/qaFinalReview.js`,
  `api/_qa-grading-corpus.js`, `api/fixtures/qa-model-capture.example.json`; tests:
  `api/grade-call-qa.test.js`, `api/_gemini-client.test.js`, new `api/gradeCallQaEndpoint.test.js`,
  `src/lib/qaFinalReview.test.js`, `src/components/navigatorDetail.override.test.jsx`; docs:
  `.env.local.example`, `docs/GRADING_INVARIANTS.md`, `CLAUDE.md`. New Railway/Vercel env var to set
  on the next scored re-calibration only: `CALL_QA_GRADER_MODEL` (recommended initial value
  `gemini-2.5-flash`). **Limitations unchanged:** the transcript is still browser-authoritative, the
  final utterance can still be lost, browser tampering remains possible, and real-world acoustic
  calibration is pending (PR 2 territory). No merge, Firebase deploy, Railway deploy, or migration
  performed.
- **Audit follow-up (same PR, 2026-07-14):** six review findings addressed. (1) The raw
  per-criterion `modelJudgment` is now captured in `repairQaVerdictsForScenario` **before** a repair
  mutates the effective verdict/basis/evidence/note, so a repaired effective MET still exposes the
  grader's original NOT_MET judgment (previously `scoreQa` built `modelJudgment` from the
  already-repaired fields). (2) The ORIGINAL evidence-based negative is evaluated before repair:
  an original `NOT_MET`/`EVIDENCE` whose quote fails navigator-turn verification carries
  `unresolved: true` / `unresolvedReason: 'negative-evidence-not-verified'` **through** any
  subsequent repair — the effective verdict may become MET, but the unresolved original allegation
  still forces `needs_review`. (3) The remaining un-reviewed QA UI surfaces — `PhaseHub.jsx` phase
  summary and `QaLatestCard` in `NavigatorApp.jsx` — now use the shared `qaSummaryLabel`/`qaBadgeTone`
  helpers (new `qaSummaryLabel`), so pending results read `AI PASS/FAIL — PENDING SUPERVISOR REVIEW`
  or `NEEDS SUPERVISOR REVIEW`, and `FINAL`/`OVERRIDDEN` appear only after `qaFinalReview`. (4)
  `buildMessages()` serializes both `patient` and `caller` roles as `Caller` (only `navigator` →
  `Navigator`) — a `role:'caller'` turn can no longer be labelled Navigator in the grader prompt.
  (5) `callQaScenarioMetadata()` records `scenarioVersion: selectedScenario.version` so saved-but-
  ungraded attempts retain scenario provenance (the server-trusted scenario version stays
  authoritative for `qa.gradingMetadata`). (6) Corrected the stale `grade-call-qa.js` module comment
  that still described a Lite-model fallback. New regression tests cover all six. Full suite **948
  passing / 47 files**; corpus 54/54; invariants 17/17. `npm run test:rules` was **not runnable in
  this environment (no Java / Firestore emulator); this PR changes no Firestore rules** — run it in a
  Java-equipped environment before release.
- **Merge-review follow-up (same PR #31, 2026-07-14):** two findings. (1) `validateCriterionBasis`
  now enforces that an `ABSENCE` judgment has **completely empty or whitespace-only** evidence — ANY
  non-whitespace quote (`"incorrect"`, `"N/A"`, `"."`, a full sentence) is rejected for both
  `NOT_MET/ABSENCE` and `NA/ABSENCE`, replacing the earlier "substantive two-word" threshold (error:
  `"<verdict> with basis ABSENCE must have empty evidence."`). Malformed ABSENCE evidence trips the
  endpoint's existing malformed-response retry (regression-tested). The now-unused
  `hasSubstantiveEvidence` helper was removed. (2) The binding docs were corrected to match the
  implemented repair exception: an unverifiable evidence-based negative normally stays provisionally
  NOT_MET, but a whitelist-only deterministic fairness repair backed by *independently verified*
  navigator evidence may change the *effective* verdict to MET — the repair never validates the
  model's fabricated negative quote, the original judgment + unresolved status are retained in
  `modelJudgment`, and supervisor review stays mandatory (`recommendation: needs_review`). Statements
  saying an unresolved negative "never becomes MET" were revised across `CLAUDE.md`,
  `docs/GRADING_INVARIANTS.md` (§0.4 + a new §1 note), `docs/HISTORY.md`, and the `_qa-rubric.js`
  comments. New regression tests: ABSENCE one-word / punctuation-only / `N/A` rejection, whitespace-
  only acceptance, and the endpoint malformed-ABSENCE retry. Full suite **953 passing / 47 files**;
  corpus 54/54; invariants 17/17; build clean. `npm run test:rules` still not runnable here
  (no Java / Firestore emulator); no Firestore rules changed.

### 2026-07-14 (part 4) - Top-level Assessment Bank selector (Scenario Questions / Spot the Error)
- **Context:** PR #28 merged to `main` as `db8c0f4`; it redesigned the Question Bank into the collapsible
  workspace documented in the entries below. Separately, an unrelated branch
  (`feature/question-bank-collapsible-sections`, opened as PR #29) was built from stale pre-PR-#28
  `main` and re-implemented an outdated, already-superseded design (a simple per-domain-grouped
  accordion) on top of code PR #28 had already replaced. **PR #29 was closed unmerged as
  superseded.** This entry and PR #30 (`feature/assessment-bank-selector`) start clean from latest
  `main` (including PR #28)
  and implement the actual, still-outstanding request: the supervisor "Questions" tab rendered
  `QuestionBank` immediately followed by `AuditBank` on one page, forcing a scroll through the
  entire (up to 24-item) Scenario Question Bank just to reach the Spot the Error bank below it.
- **Fix:** new [src/components/AssessmentBankSelector.jsx](../src/components/AssessmentBankSelector.jsx)
  renders an accessible `role="tablist"` of two compact cards — "Scenario Questions" and "Spot the
  Error" — each showing its name, a one-line description, and department-scoped draft/active
  counts. Only one bank is visible at a time; **both stay mounted** (toggled via the native
  `hidden` attribute rather than conditional rendering), so each bank's own internal UI state
  (QuestionBank's status tab/filters/expanded row; AuditBank's generation form) survives switching
  back and forth. Roving-tabindex keyboard nav (Left/Right/Home/End) mirrors the pattern
  `QuestionBank` already uses for its own status tabs. `SupervisorApp.jsx` no longer imports
  `QuestionBank`/`AuditBank` directly — it builds two grouped prop objects
  (`questionBankProps`/`auditBankProps`, unchanged from the props each component received before)
  and passes them into `AssessmentBankSelector`, which forwards them through untouched;
  `selectedDept` flows through exactly as before. **Neither `QuestionBank.jsx` nor `AuditBank.jsx`
  internals were rewritten** — no status-tab/toolbar/generation-dialog/accordion behavior was
  removed or duplicated. The only edit inside `AuditBank.jsx` is dropping a now-stale
  `marginTop: '2.5rem'` inline style that existed solely to space it below `QuestionBank` on the
  old single-page layout; it now renders as the top of its own panel. New CSS (`.assessbank*` in
  `styles.css`) reuses the existing `max-width: 760px` breakpoint to collapse the two-card grid to
  one column on narrow viewports.
- **Verification:** 12 new tests in
  [src/components/assessmentBankSelector.test.jsx](../src/components/assessmentBankSelector.test.jsx)
  covering default selection, hide/show on click and switch-back, state preservation across a
  switch, keyboard navigation, department-scoped counts updating on a department change, and
  confirmation that no `QuestionBank` toolbar/tabs/generation-button behavior was removed (886
  tests total, 46 files). `npm run build` clean. `npm audit --omit=dev`: 0 vulnerabilities.
  `npm ls --all`: valid tree. `git diff --check`: no whitespace errors. GitHub CI run #71 passed
  the unit suite, the real Firestore Rules emulator regression suite, and the production build.
  A real headless
  Chromium walkthrough (Playwright, against the actual dev server and live Firestore data, not just
  jsdom) verified default-selected Scenario Questions, switching to Spot the Error and back,
  keyboard Left/Right/Home/End, both banks staying mounted with zero layout height while hidden,
  and the two cards stacking to one column at a 390px mobile viewport with both fully inside the
  viewport. That walkthrough also surfaced a **pre-existing, unrelated** issue confirmed present on
  the Overview tab too (not introduced by this change): the supervisor `Nav` bar's link strip has
  no wrap/scroll handling and overflows the viewport at phone widths — left for a future Nav
  responsiveness pass, out of scope here.
- **Files:** new `src/components/AssessmentBankSelector.jsx`,
  `src/components/assessmentBankSelector.test.jsx`; edited `src/components/SupervisorApp.jsx`,
  `src/components/AuditBank.jsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-07-14 (part 3) - Question Bank: focus-timing, message-scoping, request-tag, keyboard fixes
- **Follow-up to the same day's failure-safe-actions/true-modality pass** (same branch,
  `redesign/question-bank-workspace`), a fourth round of coordinator review corrections.
- **1. Fixed modal focus-restoration timing.** `QuestionBankGenerateDialog`'s `close()` used to
  call `onClose()` then immediately `returnFocusRef.current.focus()` in the same synchronous
  handler. Since React may not have committed the dialog's unmount (and the paired un-inert of
  `#root`) by the time that line runs, the focus() call could silently do nothing while the
  trigger button was still inside an inert subtree. Fixed: moved the focus-restore into the SAME
  `useEffect` cleanup that un-inerts `#root`, in that exact order — un-inert first, then focus —
  which is guaranteed correct regardless of React's commit timing, since both statements execute
  synchronously within the one cleanup callback. `close()` itself is now just a guarded call to
  `onClose()`. Escape, backdrop click, Cancel, and the × button all still route through the same
  `close()`, so all three real dismissal paths get the fix uniformly. Verified in a real browser:
  Escape, Cancel, and × close all land focus back on "Generate questions" and clear `#root.inert`.
- **2. Department-scoped transient messages.** `genMessage` (generation success/error banner) and
  `queueMessage` (Learning Loop "revision queued" banner) now carry the department they were
  created for (`{ ..., dept }`) and only render when `message.dept === selectedDept` — chosen over
  the "clear both on department switch" alternative because it also lets a message correctly
  reappear if the supervisor switches back to the department it belongs to. A Pediatrics
  generation success message (or a Learning Loop queue message) can no longer be visible while
  viewing OB/GYN.
- **3. Generation request tags are now truly immutable per request.** The prior fix (2026-07-14,
  part 2) tagged each generation with `{ dept, seq }`, but stored it in a single mutable
  `requestTagRef.current` — an OLDER request's completion read *whatever the ref currently held*,
  which could already have been overwritten by a NEWER request's tag by the time the older one
  resolved. Concretely: request A starts (ref = tagA, seq 1); request B starts before A resolves
  (ref = tagB, seq 2); when A finally resolves and reads `requestTagRef.current`, it gets tagB —
  and the staleness check (`tag.seq !== generationSeqRef.current`) would then pass, since tagB's
  seq *does* match the latest sequence, incorrectly treating A's stale completion as current.
  Fixed: `wrappedOnGenerate` now creates a **frozen, request-scoped** `{ dept, seq }` object and
  returns it *alongside* the count (`{ n, tag }`); the dialog passes that exact tag back to
  `onGenerated(text, tag)`; `handleGenerated` validates the **supplied** tag against the live
  department ref + latest sequence — it never reads a ref to infer which request just completed.
  Also: `selectedDeptRef.current = selectedDept` is now assigned **synchronously during render**
  (a plain ref mutation, which is safe and does not affect this render's output) rather than in a
  passive `useEffect`, so the ref is guaranteed current even if a completion is validated before
  this render's effects have had a chance to flush.
- **4. Keyboard focus stays inside the modal even with zero enabled controls.** While generating,
  every real control in the dialog is disabled, so the existing focusable-elements query returns
  an empty list — Tab could then fall through toward `document.body`. Fixed: the dialog container
  now has `tabIndex={-1}` and becomes the focus anchor the moment generation starts (a `useEffect`
  keyed on the `generating` transition calls `dialogRef.current.focus()`); the Tab/Shift+Tab
  keydown handler now explicitly re-focuses the dialog container whenever the focusable list is
  empty (or focus has otherwise drifted outside the dialog), instead of doing nothing; and once
  generation completes, focus moves to a real enabled control (the footer Done/Cancel button).
- **5. Edit disabled while any persistence action is pending.** While Activate, Restore, Archive,
  Discard, or Delete is in flight for a question, its Edit button is now also disabled
  (`disabled={anyPending}` in `QuestionBankItem.jsx`) — the row can no longer switch into
  `QuestionEditor` mid-write.
- **Tests:** 6 new tests added to `src/components/questionBank.test.jsx` (46 total) — two for
  department-scoped messages (generation success banner, Learning Loop queue message), two for
  Edit-disabled-during-pending (Activate and Archive), covering both the disabled state and (for
  Archive, which doesn't auto-collapse the row) re-enabling once the write settles. A new dedicated
  file, `src/components/questionBankGenerationOrdering.test.jsx` (2 tests), mocks
  `QuestionBankGenerateDialog` with a minimal, non-serializing stand-in specifically so the
  immutable-tag guarantee (item 3) can be exercised directly: the *real* dialog structurally
  prevents two overlapping generation requests (the button disables itself and dismissal is
  suppressed while generating) — which is a correct and intentional property, not a testing
  inconvenience — so reproducing "an older request resolves after a newer one supersedes it"
  requires bypassing that serialization, exactly as the earlier department-switch race test
  bypassed the modal's own UI-level prevention via a forced re-render. Both are documented,
  deliberate defense-in-depth tests of the underlying guard logic, decoupled from whether the UI
  can currently reach that state. Full suite: **874 tests across 45 files** (was 868/44 before
  this pass).
- **Real-browser (headless Chromium) walkthrough, third round:** a fresh throwaway harness (never
  committed) verified, in a real browser: focus lands correctly on the "Generate questions" button
  and `#root.inert` clears after all three close paths (Escape, Cancel, ×); 10× Tab and 10×
  Shift+Tab never leave the dialog while a (harness-simulated, 600ms) generation is in flight, with
  every control disabled; focus moves to the "Done" button once generation completes; a
  generation success banner is visible in Pediatrics but not after switching to OB/GYN; and Edit is
  disabled while Archive is pending and re-enabled once it settles.
- **Verification (this pass, portable JDK reused, no `npm ci` needed — `node_modules` was already
  intact from the prior pass):** `npm test -- src/components` **131 passed** (9 files, was 125/8);
  `npm test` **874 passed** (45 files, was 868/44); `npm run test:rules` **51 passed, 0 failed**
  against the real Firestore Rules emulator; `npm run build` clean; `npm audit --omit=dev` 0
  vulnerabilities; `npm ls --all` exits 0 with no `ELSPROBLEMS`/required-dependency errors (68
  informational `UNMET OPTIONAL DEPENDENCY` entries only, unchanged from prior passes); `git diff
  --check` clean.
- **Files:** edited `src/components/{QuestionBank,QuestionBankGenerateDialog,QuestionBankItem,
  questionBank.test}.jsx`; new `src/components/questionBankGenerationOrdering.test.jsx`; edited
  `CLAUDE.md`, `docs/HISTORY.md`. No Firestore rules, scoring, question content, or document-shape
  changes.

### 2026-07-14 (part 2) - Question Bank: failure-safe actions, true modality, keyboard/empty-dept fixes
- **Follow-up to the same day's async-load-tab-default + sort-label pass** (same branch,
  `redesign/question-bank-workspace`), addressing a second round of coordinator review feedback.
- **1. Failure-safe persistence actions.** Activate, Delete (draft discard AND archived delete),
  Archive, and Restore (which also goes through `onActivate`) are real async Firestore operations
  that can reject — the prior implementation assumed success (auto-advancing the Review Queue
  unconditionally). Fixed with a shared `runAction(id, actionKey, fn, advanceOnSuccess)` helper in
  `QuestionBank.jsx`:
  - A synchronous `pendingRef` `Set` guards re-entrancy — duplicate/rapid clicks before React even
    re-renders still only trigger one write (verified directly in a real browser with 3
    back-to-back forced clicks).
  - `pendingActions`/`actionErrors` state (keyed by question id) disables the in-flight button and
    swaps its label to a pending state ("Activating…"/"Restoring…"/"Archiving…"/"Discarding…"/
    "Deleting…"), rendered in `QuestionBankItem.jsx`.
  - On rejection, a `role="alert"` inline error renders beside that specific question's actions —
    the question stays expanded, and (for Review Queue activate/discard) auto-advance to the next
    draft does **not** fire; the write must resolve successfully first.
  - Archive/Restore/archived-Delete get the identical pending+error treatment (auto-advance was
    never part of their contract, so nothing else changes for them).
  - Tests: rejected-promise scenarios for no-auto-advance-on-failure, expansion retention, the
    accessible error, duplicate-click de-duplication, and a genuine successful-write auto-advance
    (simulated via a follow-up rerender with updated data, matching how the real Firestore
    subscription round-trip would present it).
- **2. Generation-dialog stale-completion race eliminated.** Previously, if the supervisor closed
  the dialog or switched departments while a generation was still in flight, the eventual
  completion could still call `setActiveTab('draft')` / show a success banner against whatever
  department the supervisor was *now* looking at — a stale Pediatrics generation could silently
  switch OB/GYN's tab. Fixed with two independent layers (both implemented, not just one):
  - The dialog is now truly modal (see #3) — Escape/backdrop-click/×-button/Cancel are all
    suppressed while `generating` is true, so the dialog cannot be dismissed mid-request, and the
    background (including the department switcher) becomes `inert` while it's open — the race is
    unreachable through the UI at all once both fixes are combined.
  - Independently, `QuestionBank.jsx` tags every generation with the department + a monotonic
    sequence number the instant it starts (`wrappedOnGenerate` sets `requestTagRef.current =
    {dept: selectedDept, seq}`, relying on ordinary JS closures — each render creates fresh
    closures, so whichever one is actually invoked when the request resolves is bound to whatever
    department was selected at click time). `handleGenerated` compares that tag against a
    continuously-updated ref (`selectedDeptRef`, synced every render via a no-deps effect) and a
    live `generationSeqRef`; a mismatch means the completion is dropped — no tab switch, no
    banner. This logical guard is unit-tested by forcing a re-render with a different
    `selectedDept` mid-flight (via a deferred/controllable promise), independent of whether the UI
    would also prevent the switch — defense in depth, and resilient to any future change to the
    modal's dismiss-prevention behavior.
- **3. Generation dialog made truly modal.** Replaced the plain `role="dialog"` div with:
  a `createPortal` render directly under `document.body` (so the dialog is NOT a descendant of
  `#root`, meaning marking `#root` `inert` doesn't also disable the dialog itself); `#root` gets
  `inert` + `aria-hidden="true"` while the dialog is open, restored on close; a manual Tab/
  Shift+Tab keydown handler loops focus within the dialog's own focusable elements (a native
  `<dialog>` was considered per the task brief, but jsdom's `showModal()`/`close()` support is
  inconsistent across versions — the manual approach behaves identically in unit tests and real
  browsers); and Escape/backdrop-click/×-button/footer-Cancel are all suppressed while generating
  (see #2). Focus still returns to the "Generate questions" trigger button on close.
- **4. Empty-department tab-state fix.** Switching departments previously left whatever tab the
  *previous* department had been on displayed for the newly-selected one, because the "auto-
  resolve" effect only fires once the new department's `deptQuestions` becomes non-empty — a
  department with zero questions never gets that signal and would otherwise show a stale tab
  forever. Fixed: the department-switch effect now immediately resets the tab to Active (a
  correct temporary default for any department, empty or not); the resolve effect still upgrades
  it to Review Queue as soon as the new department's first non-empty snapshot contains drafts, and
  manual tab choices still are never overridden (both existing rules preserved).
- **5. Edit-save errors moved beside the active editor.** The error paragraph previously rendered
  once, after the whole question list — not obviously tied to the specific editor above it in a
  filtered/sorted list. Now rendered as a `role="alert"` paragraph inside the very same
  `<li class="is-editing">` as the open `QuestionEditor`, immediately below it.
- **6. Full roving-tabindex keyboard semantics for the status tabs** (WAI-ARIA Authoring Practices
  tabs pattern, automatic activation): only the selected tab has `tabIndex={0}`; the other two are
  `-1`. Left/Right arrows move focus AND selection between tabs, wrapping at the ends; Home/End
  jump to the first/last tab. Enter/Space needed no new code — these are native `<button>`s.
- **Tests:** 10 new Vitest tests in `src/components/questionBank.test.jsx` (40 total, up from 30):
  activation-failure (no-advance/stays-expanded/accessible-error), duplicate-click guard,
  successful-activation-still-advances, archive/restore/archived-delete failure-handling parity,
  the stale-generation-completion guard, the empty-department reset, edit-error placement, and
  roving-tabindex arrow/Home/End navigation (with wraparound). Full suite: **868 tests across 44
  files** (was 858/44). `npm run test:rules`: **51/51** against a real Firestore Rules emulator
  (reused the portable Temurin 21 JDK from the previous pass — extracted into the session scratch
  dir, prepended to `PATH`, no admin/install required). `npm run build`: clean. `npm audit
  --omit=dev`: 0 vulnerabilities. `npm ci` was re-run first to get a clean worktree-local
  `node_modules`; `npm ls --all` now exits 0 with no `ELSPROBLEMS`/required-dependency errors (only
  68 informational `UNMET OPTIONAL DEPENDENCY` entries for platform-specific/ecosystem-adjacent
  packages, same as the prior pass). `git diff --check`: clean.
- **Real-browser (headless Chromium) walkthrough, second round:** a richer throwaway harness
  (never committed — created outside `src/`, deleted before finalizing) exposed a `window.__qb`
  control surface (`failNextActivate`/`failNextArchive`/`failNextDelete`, call-count arrays,
  `setQuestions`/`setDept`) so failure/retry/duplicate-click/department-switch scenarios could be
  driven deterministically. All 20 scripted checks passed in a real browser, including several
  that are NOT meaningfully testable in jsdom: 15× Tab and 15× Shift+Tab presses confirming focus
  never left the open dialog, `#root.inert === true` while open (and cleared after close), the ×
  and footer buttons genuinely disabled while generating, and Escape/backdrop-click confirmed
  inert while generating. Screenshots captured (activation-failure state with the accessible error
  visible, and the generation dialog mid-flow with the dimmed/inert background). One real bug was
  found and fixed *while building the harness test itself* (not a product bug): Playwright text-
  based button locators stopped matching once the button's label switched from "Activate" to
  "Activating…" mid-test — fixed in the test script by using a class-based locator instead; noted
  here for completeness even though it was a test-authoring issue, not an app defect.
- **Files:** edited `src/components/{QuestionBank,QuestionBankGenerateDialog,QuestionBankItem,
  questionBank.test}.jsx`, `src/styles.css` (new `.qbank__action-error` rule), `CLAUDE.md`,
  `docs/HISTORY.md`. No Firestore rules, scoring, question content, or document-shape changes.


### 2026-07-14 - Question Bank workspace: async-load-aware tab default fix + sort-label wording fix
- **Follow-up to the 2026-07-13 Question Bank redesign** (same branch,
  `redesign/question-bank-workspace`), addressing coordinator review feedback before the PR ships.
- **Bug fixed — initial-tab resolution against async Firestore data:** `SupervisorApp` renders
  `QuestionBank` with `questions=[]` on mount, then fills that array in asynchronously via
  `subscribeQuestions`. The first cut of the redesign picked the default status tab (Review Queue
  if drafts exist, else Active) exactly once, against whatever `questions` happened to be at first
  render — i.e. against the still-empty array — so in real usage the tab could get permanently
  stuck on Active even when the department's actual first Firestore snapshot contained drafts.
  - **Fix:** `QuestionBank` now defers the auto-default decision until the current department's
    first **non-empty** snapshot arrives, tracked per department in a `resolvedDeptsRef` map (not a
    single shared boolean) so a resolution made while viewing one department can never leak into
    another. The decision resolves **at most once per department-visit**. A tab the supervisor
    clicks manually (`changeTab(tab, {manual:true})`, recorded in `manualDeptsRef`) always wins over
    the auto-default for the rest of that department's session — a later async load can never snap
    the tab back. A successful generation still force-switches to Review Queue; that is treated as a
    separate, intentional, action-driven override (not the "don't override manual" rule), implemented
    by marking the department resolved (not manual) in `handleGenerated`. Switching departments —
    including revisiting one already seen this session — always re-arms the auto-default logic for
    the newly selected department, so a department that previously resolved to Active is not
    "sticky" on return. A department that legitimately has zero questions is never stuck in a
    loading limbo: `defaultStatusTab()` on all-zero counts already returns `'active'`, which is both
    the correct final answer and the initial guess, and the empty-state message renders immediately
    regardless of resolution status — no additional "questions loaded" signal from `SupervisorApp`
    was needed for correctness.
  - **Tests:** 4 new regression tests in `src/components/questionBank.test.jsx` — async
    empty→(active+draft) resolves to Review Queue; async empty→active-only resolves to Active; a
    manual tab selection survives a later async load (does not snap back); and a department switch
    re-resolves fresh even when the previous department had resolved to Active.
- **Wording fixed — misleading sort labels:** "Recently updated"/"Oldest updated" implied an
  `updatedAt` field that questions do not have and do not maintain; sorting has always used
  `createdAt`. Relabeled to **"Newest created"/"Oldest created"** in
  `src/lib/questionBankView.js` `SORT_OPTIONS`. Sort mode ids (`updatedDesc`/`updatedAsc`) were left
  unchanged — only the label text changed. No `updatedAt` field was added to the question document
  shape (explicitly out of scope).
- **Verification (this pass, in the actual agent worktree, not an ambient/shared node_modules):**
  - `npm ci` — clean install, 864 packages, into the worktree's own `node_modules` (previously this
    worktree had no local `node_modules` of its own and was silently resolving packages from
    elsewhere, which made `npm ls --all` report false "UNMET DEPENDENCY" errors for core packages).
  - `npm test -- src/components` — **115 passed** (8 test files; was 111/8 before this pass).
  - `npm test` (full suite) — **858 passed** (44 test files; was 854/44 before this pass).
  - `npm run test:rules` — **actually executed this time** against a real Firestore Rules emulator.
    A JDK is not installed in this sandbox by default; a portable Eclipse Temurin 21 JDK zip was
    downloaded and extracted into the session scratch directory (no admin/install required — a
    `winget`-driven MSI install failed with exit 1602, "user cancelled", consistent with no
    interactive UAC in this sandbox; the portable zip sidesteps that) and prepended to `PATH` for
    the command. Result: **51 passed, 0 failed** against the real emulator (`firebase
    emulators:exec --only firestore`), covering the full own-ID matrix, cross-navigator denial,
    squatted-document protection, arbitrary-ID denial, ownership-mutation denial, and
    list/query/supervisor behavior — unchanged from the 2026-07-13 rules-hardening PR, since this
    pass touched no Firestore rules.
  - `npm run build` — clean (`✓ 92 modules transformed`, built in ~580ms).
  - `npm audit --omit=dev` — `found 0 vulnerabilities`.
  - `npm ls --all` — now genuinely clean: exit code 0, no `ELSPROBLEMS`, no `npm error`, no
    required-dependency "missing"/"UNMET DEPENDENCY" lines. The only remaining "UNMET OPTIONAL
    DEPENDENCY" entries (68 of them) are legitimately optional, platform-specific, or
    ecosystem-adjacent packages (darwin/linux native binaries, React Native/TypeScript peer
    optionals, etc.) that npm correctly reports as informational without erroring — a normal
    pattern for a project this size, not a defect.
  - `git diff --check` — clean (exit 0; only benign LF→CRLF conversion notices, not diff errors).
  - `git status --short` — clean after committing this pass's changes.
- **Real browser walkthrough — actually performed this time:** Playwright's bundled Chromium
  (already installed at `~/AppData/Local/ms-playwright`, a real browser engine, not jsdom) was
  driven headlessly against a temporary, throwaway harness page (`harness.html`/`harness.jsx`,
  created outside `src/`, served by a plain `vite` dev server on a scratch port, and deleted — never
  committed) that mounts the real `QuestionBank.jsx` + the real `styles.css` with mock data that
  mimics `SupervisorApp`'s actual async-load shape (`questions=[]` on mount, then a snapshot with
  drafts + active + archived items arrives ~400ms later). All 21 scripted checks passed against the
  real rendered DOM/CSS: (1) the initial pre-load guess is Active, (2) **the exact bug being fixed**
  — after the async snapshot lands with drafts, the tab switches to Review Queue — verified true in
  a real browser, not just jsdom; (3) questions render collapsed with no option text visible; (4)
  only one row expands at a time; (5) the generation dialog opens, Escape closes it, and focus
  returns to the "Generate questions" button; (6) the renamed sort labels ("Newest created"/"Oldest
  created") appear and the old ones do not; (7) search and domain filters narrow the visible count;
  (8) Edit opens `QuestionEditor` and Cancel restores the expanded view; (9) Archive/Restore actions
  are present and clickable without crashing; (10) switching departments re-resolves the tab fresh
  (OB/GYN with no drafts → Active; back to Pediatrics with drafts → Review Queue); (11) tablet
  (820px) and mobile (390px) viewports have no horizontal overflow. Screenshots were captured at
  each step for visual review.
  - **Real bug found and fixed by this walkthrough:** the mobile toolbar screenshot showed a large
    empty gap under the search box. Root cause: `.qbank-toolbar__search { flex: 1 1 220px; }` sets a
    220px **flex-basis**, which the row layout treats as a width — but the `max-width: 760px` media
    query switches `.qbank-toolbar` to `flex-direction: column`, at which point that same 220px basis
    is applied to the **height** dimension instead, inflating the search field's box. Fixed with a
    mobile-only override (`flex: none; min-width: 0;` on `.qbank-toolbar__search`). Re-verified with
    the same Playwright harness after the fix — gap gone, all 21 checks still passing, screenshots
    re-captured.
- **Files:** edited `src/components/QuestionBank.jsx` (async-load-aware tab resolution + manual/
  generation override tracking), `src/components/questionBank.test.jsx` (+4 tests),
  `src/lib/questionBankView.js` (sort label wording only), `src/styles.css` (mobile toolbar
  flex-basis fix found during the browser walkthrough), `CLAUDE.md`, `docs/HISTORY.md`. No
  Firestore rules, scoring, question content, or document-shape changes.

### 2026-07-13 - Redesign supervisor Question Bank as a collapsible review workspace
- **Problem:** the Question Bank (F14) rendered every question permanently fully expanded — all
  answer options, point values, rationale, health detail, tags, and the full action row, for every
  question, in every one of the stacked Review Queue / Active / Archived sections at once. On a
  bank of any real size this was a very long, hard-to-scan page with no way to focus on one
  question at a time.
- **Redesign (implemented in PR #28, merged to `main` as `db8c0f4`):**
  - Compact header (title + "Generate questions" primary button) + 4 department-scoped summary
    pills (Awaiting review / Active / Archived / Needs review), replacing the old always-open
    "Generate from the SOP" panel and 2-3 stacked full-list sections.
  - Generation moved into an accessible modal, `QuestionBankGenerateDialog.jsx` — `role="dialog"`,
    focuses in on open, Escape closes it, focus returns to the trigger button on close. A
    successful generation switches the workspace to the Review Queue tab and the success message
    stays visible (in the dialog and as a banner in that tab) so new drafts are easy to find.
  - Real semantic status tabs (`role="tablist"/"tab"/"tabpanel"`, `aria-selected`): Review Queue /
    Active / Archived, each with a live count. Defaults to Review Queue when there are drafts,
    otherwise Active.
  - Search/filter/sort toolbar (`QuestionBankToolbar.jsx`): case-insensitive search over
    scenario/ID/option text; domain, competency, and health filters (a "Not live" health state for
    drafts/archived items instead of ever mislabeling them healthy); 7 sort modes, with
    health-based sorts always placing no-health-data questions after ones with health data; a
    "N of M questions" count; a "Clear filters" action that only appears when a filter is active.
  - Collapsed-by-default, single-open accordion rows (`QuestionBankItem.jsx`): collapsed shows
    only status/domain/competency tags, a 2-line CSS-clamped scenario preview, the (secondary)
    question ID, and a health summary; expanding reveals the full options/rationale/health-detail/
    content-warning/action panel. Clicking an action button inside the expanded panel never
    toggles the accordion (`stopPropagation`); opening a second question collapses the first;
    switching tabs or filtering the expanded question out of view clears the expanded state.
  - Review Queue workflow polish: a small progress readout ("Question N of M" while one is
    expanded, otherwise "M questions awaiting review") plus Previous/Next controls scoped to the
    current filtered queue (correctly disabled at the ends); activating or discarding the
    currently-expanded draft auto-advances to the next remaining one. Deliberately **no bulk
    activation** — every question still requires individual review, per the review-gate model.
  - New pure helper module `src/lib/questionBankView.js` (statusCounts, defaultStatusTab,
    filterQuestions, sortQuestions — never mutates its input, matchesSearch, hasActiveFilters,
    nextExpandedId, adjacentQuestionId, indexOfQuestion) so all filtering/sorting/navigation logic
    is unit-testable without rendering React.
  - **All existing behavior preserved exactly** — generation, editing (`QuestionEditor.jsx`
    unchanged; save failures now keep the editor open with an inline error instead of silently
    closing on rejection), activation/restore, archive, delete/discard, content-guard blocking
    (`hasBlockingFlags`/`validateQuestionContent` still disable Activate/Restore and show the
    blocking reason), question health (`computeQuestionHealth`), supervisor `FeedbackControls`,
    and Learning Loop revision queueing — same props/callbacks (`onActivate`, `onArchive`,
    `onDelete`, `onSaveEdit`, `onGenerate`, `onSaveFeedback`, `onSaveProposal`), same Firestore
    document shape, no scoring/activation/validation logic changes.
- **Tests:** new `src/components/questionBank.test.jsx` (26 tests: tab defaults/isolation,
  collapsed-by-default rendering, single-open accordion, action-click-does-not-toggle-accordion,
  search/domain/competency/health filters, clear-filters, sort-does-not-mutate-input,
  generate-opens-dialog, successful-generation-switches-tab, activate/restore/archive/discard/
  delete callback wiring, blocked-content gating, edit-opens-correct-question, empty and
  filtered-empty states, tab/accordion aria attributes) and new `src/lib/questionBankView.test.js`
  (13 tests for the pure helpers). Full suite: **854 tests across 44 files** (was 815/42),
  `npm run build` clean, `npm audit --omit=dev` 0 vulnerabilities.
- **Not done in this change (explicit non-goals):** no question content rewrites, no scoring/point
  changes, no Firestore document-shape changes, no data migration, no bulk activation, no
  pagination, no AI-generation prompt changes, no auth/Firestore-rules changes, no deploy, no merge.
- **Verification gap:** built and self-reviewed in a non-browser sandbox — no manual browser
  click-through, no screenshots. A human should click through the redesigned workspace (desktop/
  tablet/mobile) before merging.

### 2026-07-13 - Bind result document IDs to navigator identity (path + body ownership)
- **Follow-up to the same day's "incomplete-navigator result reads" fix (below):** that fix's
  `isOwnResultDocId(docId)` direct-read exception recognized a navigator's own deterministic result
  paths, and the `get` rule allowed EITHER that path-only branch OR `owns(resource.data)` (body
  ownership) — independent alternatives, not a combined check. Separately, and more importantly,
  `create` checked ONLY `owns(request.resource.data)` (the requested body) — it never checked
  whether the document ID belonged to the requester at all.
- **Exploit this allowed:** an authenticated navigator (A) could `create` a document at ANOTHER
  navigator's (B's) deterministic result path (e.g. `results/navigator-b__pediatrics`) while writing
  A's OWN `navigatorId` into the body. `create` accepted this purely on body ownership, since it
  never checked the path. From there: **B** could read the malformed document through the old
  `get` rule's path-only branch (`isOwnResultDocId(docId)`, which doesn't inspect the body) —
  exposing A's spoofed content at B's expected path (result spoofing). **A** retained read/update
  access to the same document through the body-only `get`/`update` branch (`owns(resource.data)`
  still matched A's `navigatorId`). And **B** could not repair or overwrite it: `update` requires
  `owns(resource.data)` on the EXISTING body, which still said `navigatorId: navigator-a`, so B's
  own legitimate submission was blocked from ever occupying that path (denial of service against
  B's own retake).
- **Fix:** `results/{docId}` now requires the document ID AND the body to both belong to the caller
  for every operation:
  - `get`: `isSupervisor() || (isOwnResultDocId(docId) && (!resultDocExists(docId) || owns(resource.data)))`
    — a genuinely missing own document still reads as a normal not-found result (preserving the same-day
    fix above); an EXISTING document at a navigator's own deterministic path is only readable when its
    stored `navigatorId` also matches.
  - `create`: `isSupervisor() || (isOwnResultDocId(docId) && owns(request.resource.data))`.
  - `update`: `isSupervisor() || (isOwnResultDocId(docId) && owns(resource.data) && owns(request.resource.data) && ownerUnchanged())`.
  - `list`/`delete`: unchanged — supervisor-only.
  New `resultDocExists(docId)` helper makes the existence check explicit so `get` can distinguish
  "missing" (safe) from "exists but owned by someone else" (deny) without ever exposing the mismatched
  body.
- **Committed regression coverage (new):** `tests/firestore-rules/result-authorization.rules.mjs`, a
  standalone Node script (not Vitest — the normal `npm test` run must never require a live emulator)
  run via `npm run test:rules` (`firebase emulators:exec --only firestore`). It exercises the REAL
  Firestore Rules emulator (not a string match on the rules file) across 7 sections / 51 assertions:
  the full own-supported-ID matrix for one navigator (7 deterministic IDs × missing-read/create/
  read-after-create/update), cross-navigator get/create/update/delete denial, squatted-document
  protection (seeded directly via `withSecurityRulesDisabled`, matching the exploit shape above),
  arbitrary non-deterministic result-ID denial, ownership-mutation denial on update, navigator
  list/query denial, and full supervisor access. Verified to **fail** (multiple assertions) against
  the pre-fix rules and **pass 51/51** against the fixed rules. New `firebase.json` emulator block
  (Firestore only, explicit port) and `package.json` `test:rules` script; `.github/workflows/ci.yml`
  now installs Temurin JDK 21 (`actions/setup-java`) and runs `npm run test:rules` between `npm test`
  and `npm run build` on every PR and `main` push. New dev dependencies: `firebase-tools`,
  `@firebase/rules-unit-testing`.
- **Related fix — NavigatorApp own-row identity (same underlying "path vs. body identity" class of
  bug, different layer):** the navigator dashboard merged the minimized `/api/mentor-scores` floor
  projection (keyed by `navigatorId ?? name`) with the navigator's own local/submitted result (keyed
  by bare `name`) into one `Map`, then resolved the current navigator's row via `findRow(rows, name)`.
  When a stale floor copy (keyed by `navigatorId`) and a fresh own result (keyed by `name`) coexisted
  for the same person, both survived the merge as separate rows, and `findRow`'s name-only lookup
  could resolve to whichever row iterated first — sometimes the STALE one — showing an outdated score
  on the navigator's own dashboard after a fresh submission or a mid-quarter rename. Fixed by a new
  pure helper, `src/lib/navigatorResultMerge.js` (`navigatorResultIdentityKey`,
  `mergeNavigatorFloorAndOwnResult`): rows are keyed by a prefixed `id:<navigatorId>` when present,
  falling back to `name:<name>` only for legacy no-ID rows; the own result always replaces any floor
  row under the same stable ID AND any legacy no-ID floor row sharing the same display name, while
  never merging two rows that simply share a name but have different navigatorIds. `NavigatorApp`
  now calls `findRow(rows, navigatorId ?? name)` instead of `findRow(rows, name)`. New
  `src/lib/navigatorResultMerge.test.js` (**10 unit tests total**: 3 for `navigatorResultIdentityKey`
  — id-priority, name fallback, id/name collision-safety — and 7 for
  `mergeNavigatorFloorAndOwnResult` — stale/fresh same-ID replacement, legacy-name-fallback,
  distinct-ID/same-name non-merge, rename, no-own-result/no-mutation, duplicate-collapse, and
  no-input-mutation; the same-ID collapse case directly asserts `toHaveLength(1)` on the returned
  merged array) plus a NavigatorApp behavioral regression test in
  `src/components/roleApps.behavior.test.jsx` ("uses the fresh own score when the mentor projection
  contains a stale copy of the current navigator") that mocks a stale `/api/mentor-scores` projection
  for the signed-in navigator alongside a fresher own MCQ result and asserts the fresh score renders
  while the stale one does not — confirmed to fail against the pre-fix merge logic and pass against
  the fix. (The rendered-app test proves score freshness, not a DOM row count — `NavigatorApp` has no
  semantic per-row container to assert "exactly one row" against, and the navigator's display name
  legitimately appears elsewhere on the page regardless of the merge outcome; exact same-ID collapse
  is proven directly by the helper's own unit test instead.)
- **Rollout prerequisite — pre-publish existing-data integrity scan (documented, not run here):**
  the tightened rules are fail-closed against any ALREADY-EXISTING malformed result document (e.g.
  a historical doc at `results/navigator-b__pediatrics` whose stored `navigatorId` is
  `navigator-a`) — once published, neither navigator A nor navigator B could read or fix it
  (A's `navigatorId` doesn't match the path; B's `navigatorId` doesn't match the body), only a
  supervisor/server administrator could. This is correct fail-closed behavior, but it means
  existing malformed documents must be found and triaged BEFORE publishing, or affected navigators
  would be silently locked out of a result they should own. Documented required check (using
  trusted Firebase Admin access only, never navigator client access — not run as part of this PR
  and no production system was accessed): read every document in `results`, and for each, validate
  the document ID against its own `navigatorId`/`department`/`assessmentType` fields using the
  canonical ID forms — MCQ `<navigatorId>__<department>`, Spot `<navigatorId>__<department>__spot`,
  QA `<navigatorId>__<department>__qa`, departments `pediatrics`/`obgyn`, plus the legacy
  `<navigatorId>`-only form (valid ONLY as legacy Pediatrics MCQ). Flag: missing `navigatorId`;
  document ID belonging to a different `navigatorId` than the body; unsupported department;
  unsupported `assessmentType`; a suffix inconsistent with `assessmentType`; a legacy plain ID
  carrying non-Pediatrics or non-MCQ data; and duplicate/conflicting canonical slots for the same
  navigator+department+type. Investigate every mismatch, and quarantine/archive/manually correct
  any malformed document (preserving evidence first) via trusted administrator access before the
  new rules go live. See CLAUDE.md §12/§15.
- **Documented, not fixed, in this PR — client-authoritative scoring:** this PR closes the
  document-ID/body ownership hole and the row-identity bug, but MCQ/Spot scoring still runs
  client-side and a navigator can still write their own ownership-scoped result document. Firestore
  rules now guarantee a navigator can only ever write AS THEMSELVES (never spoof or squat another
  navigator's document), but cannot cryptographically prove a submitted score came from an untampered
  client run. Client-submitted MCQ/Spot results should not be treated as tamper-proof, high-stakes
  employment evidence until a separate, larger server-authoritative scoring migration ships (see
  CLAUDE.md §12 and §15 for the required design). That migration is explicitly out of scope here.
- **Verification:** full local `npm test` suite green (with the new `navigatorResultMerge.test.js`
  file and the edited `roleApps.behavior.test.jsx`), `npm run test:rules` 51/51 against the fixed
  rules (and confirmed failing — 7/51 — against the pre-fix rules), `npm run build` clean,
  `node --check` on both new script files, `git diff --check` clean. No Firestore rules were
  published, no production data changed, no deployment occurred.

### 2026-07-13 - Fix incomplete-navigator result reads under hardened rules
- **Production regression:** after PR #25's ownership rules were published, navigators missing any
  one of the MCQ/Spot/QA result documents could reach the generic "Couldn't connect" screen.
  Firestore evaluates a direct `get` against the rules even when the document does not exist, so
  `owns(resource.data)` could not authorize the expected "not found" response.
- **Fix:** `results` now separates `get` from `list`. A navigator may directly fetch only the seven
  exact legacy/current result IDs derived from their authenticated `navigatorId` across the two
  live departments; supervisors retain full reads and navigator collection-wide reads remain
  denied. Existing ownership checks still protect every create/update.
- **Verification:** Firestore emulator rules compile; an authenticated regression proves own
  existing and own missing result reads succeed, cross-navigator existing/missing reads fail,
  navigator collection reads fail, and supervisor collection reads succeed.

### 2026-07-12 - Complete audit remediation and production trust boundary (PR #25)
- **Scope:** PR #25 is based on the nine-commit Call QA hardening work from draft PR #24, then
  closes the separate full-codebase audit findings across scoring fairness, persistence,
  authorization, concurrency, voice reliability, analytics, identity, timestamps, and tooling.
- **Authorization / staff-data protection:** replaced anonymous Firebase use and localStorage role
  trust with server-minted Firebase custom identities. Navigator PIN verification/create/migration
  now runs transactionally on the server, stores salted scrypt hashes, removes legacy plaintext,
  and returns no PIN material. Supervisors receive both a role claim and signed HttpOnly cookie;
  deployed environments fail closed without an explicit server passcode. Every REST/voice gate
  verifies claims; Firestore rules grant supervisor or stable-UUID owner access only. Public roster
  and peer-mentor reads are minimized server projections rather than full client collection reads.
  **Why:** browser roles, anonymous auth, client filtering, and plaintext PINs cannot protect staff
  scores, transcripts, roster secrets, or management actions.
- **Assessment fairness / durability:** Spot the Error now starts only with its complete requested
  plan—generation failures never backfill employee zeroes. Mini-checks score the displayed subset,
  record mastery only on pass, and remain retakeable on failure. `saveResult` batches the current
  result, answer-bearing history, and optional completions atomically. A keyed generation-aware
  retry queue preserves multiple independent failed saves so a later success cannot erase an
  earlier warning. Empty MCQ banks render safely; progress is question-bank-versioned; submits are
  single-flight. Text/voice practice now expose save/grade-save retry states and text cannot save
  while a patient reply is pending.
- **Development paths / QA display:** coaching and modules require explicit completion; failed or
  legacy mini-check markers do not imply mastery; exactly one step is `next` after local or AI
  sequencing. The sequence endpoint rejects duplicate/missing/extra domains and steps. Training
  practice calls retain the chosen domain instead of becoming random. Navigator QA cards preserve
  `NEEDS REVIEW` and supervisor final verdicts instead of flattening everything to PASS/FAIL.
- **Concurrency / availability:** active SOP selection is a transactional per-department pointer;
  archive clears the pointer atomically; fresh concurrent server reads await one shared refresh.
  Railway's trusted `X-Real-IP` now keys REST and voice quotas so unrelated users do not share a
  proxy bucket. Gemini REST calls have a server abort timeout. Voice relay setup rotates every key
  with authentication/setup deadlines; unexpected closes and all client-side setup errors tear
  down mic tracks, processors, playback, sockets, and audio contexts.
- **Analytics / identity correctness:** matrix and analytics rows preserve `navigatorId`; roster
  renames rehydrate display names without orphaning results or the Reset action. Timestamp ordering
  uses milliseconds plus Firestore nanoseconds. Training impact and decline alerts compare only the
  same assessment instrument; supervisor grade overrides are the effective practice score; question
  health consumes answer-bearing retake history instead of only the overwritten latest result.
- **Toolchain / deployment:** upgraded the single top-level graph to Vite 8.1 + plugin-react 6,
  aligned Node engines to `^20.19 || >=22.12`, added Firebase Admin, changed Railway to `npm ci`,
  overrode Firebase Admin's vulnerable transitive `uuid@9` with compatible fixed `uuid@11.1.1`,
  and documented the safe identity-before-rules rollout plus required server variables.
- **Verification:** **804/804 Vitest tests across 41 files**, production build clean, all API files
  parse, `npm ls --all` exits cleanly, clean `npm ci` reproduces, and production/full audits report
  zero vulnerabilities. Browser microphone/live Firebase/Gemini behavior remains an explicit post-deploy smoke.

### 2026-07-10 - Call QA conflict labeling and literal-TE detail guard
- Deterministic over-promise/clinical-advice findings now represent an actual model-positive
  conflict only when `know-rule` was marked `MET`; model-detected safety misses remain in the
  original criterion instead of being mislabeled as conflicts. Literal-TE repair now rejects a
  routing/message wording complaint that also says details or information are missing.
- Added adversarial regressions for both cases. Focused Call QA: **188**; corpus: **54**;
  invariants: **17**; full suite: **764/30 files**; production build clean.

### 2026-07-10 - Centralize deterministic Call QA review gating
- `assessQa` now accepts persisted deterministic findings and independently forces
  `needs_review` for model-positive routing or safety conflicts; `finalizeQaResult`
  passes findings into that shared contract. Added regression coverage proving the
  score and criteria remain unchanged. Focused Call QA: **186**; full suite:
  **762/30 files**.

### 2026-07-10 - Call QA loophole-closure pass (final pre-merge reliability gate, PR #24)
- **Deterministic conflict layer (model-positive protection):** new
  `evaluateQaDeterministicFindings(criteria, transcript, context)` in `api/_qa-rubric.js` detects
  the OPPOSITE model error from the repair layer — know-rule/doc-te marked MET (with a verifiable
  quote) on a call whose committed route the routing policy knows is wrong, contradictory,
  ambiguous, or missing, plus deterministic over-promise/clinical-advice signals. Findings are
  stored on `qa.deterministicFindings` (`type`, `reason`, `evidence`, `destinationId`,
  `affectedCriteria`), never touch verdicts/scores/repairs, and force `needs_review` (flags
  `model-routing-conflict` / `deterministic-safety-conflict`) whenever the result would otherwise
  pass confidently. Findings are NOT fairness repairs — the R1–R10 repair invariants are unchanged.
- **Clause-aware safety detection:** over-promise and clinical-advice detection now splits each
  navigator turn into clauses (sentence boundaries, semicolons, em dashes, but/however/although/
  meanwhile). A safe disclaimer/deferral clause exempts only itself: "I can't promise timing, but I
  guarantee approval today" is an over-promise; "that's for the nurse, but take twice the dose
  tonight" is clinical advice. New `findOverPromiseLine` / `findClinicalAdviceLine` return the
  offending line as finding evidence.
- **Routing hedging guard:** `isUncertainRoutingLanguage` rejects hedged wording ("I think…",
  "I'm not sure whether…", "maybe/perhaps/probably/possibly/may/might/could/whether/supposed to")
  as a routing commitment — uncertainty can never support a repair and, when the model calls it
  MET, becomes a deterministic conflict. Confident valid commitments (incl. "Actually, PEDS
  Encounters is the correct queue") remain accepted.
- **Strict PE-only repair gate:** `isStrictPeOnlyFailure` replaces the expanding blacklist with a
  positive token check — after normalization every note token must be a PE term or generic failure
  scaffolding; any substantive residue (urgency, "out", callback, pharmacy, queue…) blocks the
  repair. The PE repair also now requires a COMPLETE standard refill: medication + pharmacy +
  callback + out/urgency + safe accepted routing.
- **Positively scoped literal-TE gate:** `isLiteralTeWordingFailure` replaces the generic
  "did not say / not documented" matcher — the note must reference the routing/message action
  (TE/route/send/message/log/forward) and contain no wrongness, missing-detail, urgency,
  destination, or incompleteness complaint.
- **Supervisor UI:** each repair in `NavigatorDetail.jsx` now shows the grader's ORIGINAL verdict,
  reason, and evidence (with an explicit "No evidence supplied" state) alongside the applied rule
  and replacement evidence, plus a new "Deterministic grading conflicts" section rendering
  `qa.deterministicFindings`.
- **Corpus + invariants:** added the `lenient` (routing-blind, false-positive-prone) simulated
  grader profile and new cases (wrong route/contradiction/generic-team/missing-route marked MET,
  hedged routing, mixed disclaimer+guarantee, mixed deferral+advice, PE+urgency mixed note, generic
  doc-te complaint); aggregate false-pass/false-fail/review-miss/silent-pass counts remain zero and
  findings never coexist with a confident pass. `docs/GRADING_INVARIANTS.md` gains §3a (C1–C4) and
  R6a/R6b/R7/R8 updates; `gradingInvariants.test.js` gains the I-CONFLICT block. Counts: focused
  Call QA 203 (grade-call-qa 185 + glossary 18), corpus 54, invariants 17, full suite 761/30 files.

### 2026-07-10 - Call QA owner-confirmed routing reliability review
- **Authority:** routing now prioritizes owner-confirmed floor operations over conflicting sanitized
  SOP text, then explicit SOP rules, trusted curated scenarios, and only then generic language.
  The server policy accepts PEDS Encounters for pediatric refills, Anisa for referrals, PSS OB for
  non-pregnant GYN, OB Portal for pregnancy, Rebecca for MFM, and OB Portal or the scenario's
  explicit clinical TE/message path for OB/GYN results. Named owners use stable destination IDs and
  the approved minimum public label.
- **Final decision:** deterministic routing separates commitments, mentions, corrections,
  questions/offers/history, and negations. A clear correction inherits the prior action without its
  verb; unresolved later ownership/destination contradictions cannot repair.
- **Limits:** pediatric records/forms (except trusted subtype rules), urgent symptoms, unclear
  requests, and unknown/conflicting OB workflows remain review-only. The deterministic
  grading-pipeline regression corpus, simulated grader profiles, and captured-response replay fixture
  do not prove live Gemini accuracy. TODO: calibrate with de-identified captured real-model outputs.

### 2026-07-10 - Call QA workflow routing policy + server-authoritative scenario metadata
- **Routing policy:** replaced the global destination allow/block lists with one destination
  vocabulary plus department/workflow policies derived from `_sop-context.js` and the curated QA
  scenarios. Pediatrics refill/referral and OB/GYN PSS/nursing/MFM/records destinations are scoped
  independently. Pediatrics generic records/forms, urgent symptoms, and unclear requests remain
  review-only because the repository does not establish one precise destination.
- **Contradictions:** call-level validation now uses the final committed routing decision. A later
  wrong route defeats an earlier correct route; a wrong route can be superseded only by an explicit
  correction to the policy-correct destination; unexplained conflicts and generic "team" wording
  cannot support repairs. Line and call checks share the same destination vocabulary.
- **Grading authority:** `/api/grade-call-qa` now resolves workflow/scoring metadata from the
  server-owned curated scenario id and builds the grading context server-side. Browser-supplied
  `workflowType`, `scoringNotes`, `expectedActions`, and `criticalMisses` no longer influence scoring
  or repairs. Missing, unknown, department-mismatched, or scenario-mismatched authority disables
  repairs and adds an `unverified-scenario-metadata` supervisor-review flag.
- **Calibration claims:** renamed the existing corpus as a deterministic grading-pipeline regression
  corpus using simulated grader verdicts; it does not independently validate Gemini judgment.
  `api/fixtures/qa-model-capture.example.json` defines a replayable captured-response format and is
  explicitly labelled as a simulated example until real model responses are captured. Documentation
  now separates deterministic regression, captured real-model replay, and live model evaluation.
- **Tests:** added adversarial coverage for final-route contradictions, explicit corrections,
  generic destinations, Pediatrics/OB-GYN route isolation, review-only workflows, and forged/missing
  scenario metadata. Focused Call QA: **117/117**; deterministic corpus: **43/43**; full
  `npm test`: **673/673 across 30 files**; production build and `git diff --check` clean.

### 2026-07-10 - Call QA evidence-model hardening + deterministic grading corpus + grading invariants
- **Context:** Independent re-review of PR #24's repair layer, reasoning over the whole evidence
  model (glossary → grader → validation → repairs → trust-gated scoring → review → supervisor
  verdict) so each fairness fix cannot open a new loophole.
- **Loopholes found and closed (`api/_qa-rubric.js`):**
  1. A commitment to an UNLISTED wrong destination ("I'll send this to the billing team") could
     serve as `doc-te` repair evidence → repairs now require a committed line with a
     positively-cleared destination (`findCommittedRoutingLineWithDestination`): approved
     destination named (nurse/provider/doctor/team/queue) AND no known-wrong destination
     (billing, front desk, records, referral coordinator, scheduling, specialist, OB...).
     Destination-less "I'll send it" is no longer sufficient to overturn a grader verdict.
     **Superseded by the entry above:** destination validity is now department/workflow-specific;
     generic team/person words are not a universal allowlist.
  2. Offer-questions ("I can send it — do you want me to?") counted as commitments → rejected
     via a `ROUTING_OFFER` pattern.
  3. A grader note mixing PE with another real failure (wrong routing, identity, scheduling,
     promising, missing details, conflation) could still repair `know-rule` → `NON_PE_FAILURE_NOTE`
     vocabulary now disqualifies mixed notes; only strictly PE-only notes are repairable.
  4. A `doc-te` note saying the routing was WRONG (vs merely unworded) could match the
     literal-TE patterns → `ROUTING_WRONGNESS_NOTE` blocks wrongness notes from repair.
  5. Repairs discarded the grader's original note/evidence → every repair now records
     `originalVerdict`/`originalNote`/`originalEvidence` (rendered to supervisors).
  6. A repair could silently flip fail→pass → `assessQa` now recomputes the unrepaired score;
     an outcome-flipping repair adds the `repair-changed-outcome` flag and forces `needs_review`.
  7. Over-broad repair BLOCKERS caused retained false negatives: bare `/definitely/` no longer
     reads "I'll definitely pass this along" as an over-promise, and scope-deferral lines
     ("I can't tell you if it's safe — that's for the nurse") no longer read as clinical advice.
- **Deterministic grading-pipeline corpus (`api/_qa-grading-corpus.js` + `_qa-grading-corpus.test.js`):**
  ~20 full-call cases across good / borderline / unsafe / incomplete / natural-phrasing /
  question-vs-commitment / ambiguous-intent categories, each with an authored expected outcome and simulated
  `accurate` + `literalist` grader profiles, plus paraphrase variants and glossary mis-hearing
  (speech-transcription) variants. The harness runs every case × profile × variant through the
  REAL pipeline and asserts **zero false passes, zero false fails, zero review misses, zero
  silent passes** — measuring deterministic pipeline outcomes, not live Gemini judgment. Validated by running
  the corpus against the pre-hardening repair layer: it correctly failed 11 tests there,
  including a confident false pass from the wrong-destination loophole.
- **Grading invariants (`docs/GRADING_INVARIANTS.md` + `src/lib/gradingInvariants.test.js`):**
  explicit, binding invariants all future grading changes must preserve — shared 0–100 scale and
  `scoreToLevel` bands, repair whitelist/direction/logging (R1–R10), review-layer guarantees
  (verified auto-fail zeroes; unverified auto-fail never fails but never vanishes; borderline
  and safety-miss passes always reviewed), supervisor verdicts stored beside (never over) AI
  originals, and the cross-system consistency audit of MCQ vs Spot the Error vs Call QA vs QA
  projections vs supervisor verdicts (intentional differences documented, e.g. Spot's coarse
  full-profile mode, the 85/85 pass-mark/canTeach alignment, no MCQ/Spot override layer).
- **Verification:** `npm test` **659 passing / 30 files** (was 588/28), `npm run build` clean,
  `node --check` on edited handlers. New unit tests cover wrong-destination rejection,
  destination-less commitments, offer-questions, mixed/wrongness notes, repair-original
  preservation, deferral/over-promise narrowing, and the outcome-flip review gate.

### 2026-07-10 - Call QA fairness hardening for refill PE status and natural TE wording
- **Problem:** The QA grader could deduct for missing PE status during a standard pediatric refill or for not saying the internal Telephone Encounter phrase verbatim.
- **Fix:** Curated scenario scoring notes now reach grading; the prompt accepts natural message/routing wording; a transparent deterministic repair layer corrects only these verified false-negative patterns before scoring.
- **Safety:** Repairs do not excuse wrong routing, missing medication/pharmacy details, overpromising, clinical advice, or privacy failures. `qa.repairs` is supervisor-visible.
- **Tests:** Added focused refill, TE wording, no-over-repair, prompt, metadata, and supervisor-transparency coverage. Verified with `npm test -- grade-call-qa` (84 passing), `npm test` (588 passing / 28 files), `npm run build`, and `git diff --check`.
- **Follow-up:** Routing repair now requires a clear navigator-owned commitment or committed team follow-up. Questions such as "Did you send this request?" or "Can you message the nurse?" are not routing evidence; neither are destination-only mentions, historical checks, or hypotheticals.

### 2026-07-09 - Gemini REST primary reverted to 2.5 Flash + universal fallback chain + 503 cooldown
- **Problem:** Practice calls (`interview-turn`) and grading (`grade-interview`/`grade-call-qa`)
  kept failing with `503 — rotating` on `gemini-3.5-flash`. Live probe against all 4 project keys:
  3.5-flash free tier returned 503 UNAVAILABLE on every key most of the time, and the rare 200
  took **50–76 seconds** — a random one-minute hang inside a live call. (`gemini-3.1-flash`, the
  pre-migration model, now 404s — that was the earlier "model not available" error.)
- **Fix (probe-driven, `api/_gemini-client.js`):**
  - `MODEL` reverted to `gemini-2.5-flash` (answered on all 4 keys in ~3s with clean structured
    output). Revisit 3.5-flash when its free tier stabilizes.
  - New `STABLE_MODEL = 'gemini-2.5-flash-lite'` — a second independent per-model quota bucket,
    now a fallback on **every** REST endpoint, including the five that previously had none
    (`generate-audit`, `generate-scenarios`, `refine-sop`, `sequence-path`, `coach-audit`).
  - Chat/advisory endpoints (`interview-turn`, `generate-coaching`, `grade-interview`,
    `grade-call-qa`) chain a third bucket: `[MODEL, STABLE_MODEL, LITE_MODEL]`
    (`gemini-3.1-flash-lite`).
  - 503s now put the key+model on cooldown like 429s do, so a capacity-dead model is skipped
    instead of re-probed on every request.
- **Verification:** live end-to-end probe with the real keys (both chains answered in ~1s),
  `node --check` on all edited handlers, `npm test` green (+2 new cooldown/fallback tests),
  `npm run build` clean.

### 2026-07-09 - MCQ v2 operating-model question bank replaces weak active MCQs
- **Context:** The active MCQ bank (original seed questions + early Gemini-generated scenarios) was
  too SOP-literal and too easy — it tested "what is the rule" instead of "what is the right decision
  on a messy real call." With the Patient Navigator Operating Model now merged, the active bank was
  rewritten to match it.
- **New bank — `src/data/questions-v2.js`:** 48 scenario-based MCQs — **24 Pediatrics + 24 OB/GYN, 4
  per domain per department** (intake · classification · routing · scheduling · boundaries ·
  documentation). Every item tests real navigator decision quality across the eight-step decision
  loop with realistic near-miss distractors from the mistake taxonomy (wrong chart, missing
  authorization, wrong queue/owner, wrong appointment type/timing, clinical-advice/result-reading
  overreach, promised approval, over-/under-escalation, incomplete documentation, multi-child
  chart-mixing, same-name wrong-chart). Same doc shape as before (one 100-point best answer,
  partial-credit distractors, per-option rationale, domain + competency tags) — **the capability
  matrix scoring model is unchanged.** No new SOP facts were invented; all referenced facts already
  existed in the seed banks / `_sop-context.js`.
- **Marker-gated migration — `runMcqV2OperatingModelMigration()` in `src/lib/db.js`:** runs once
  (marker `contentMigrations/2026-07-mcq-v2-operating-model`). It **archives** the current active
  generated/seed MCQs for Pediatrics + OB/GYN (`status:'archived'`, `archivedReason` /
  `replacedByVersion` = `mcq-v2-operating-model-2026-07`, `archivedAt`) — **never deletes** them —
  **preserves** manual/supervisor-authored questions (`source==='manual'`), and inserts the 48 v2
  items as `active`. The marker records `archivedQuestions`, `insertedQuestions`, `departments`, and
  `reason`. Hooked into the SupervisorApp question-bank effect, now ordered
  `runContentQualityFixesMigration → seedQuestionsIfEmpty → runMcqV2OperatingModelMigration` so a
  fresh DB seeds first, then has its seed content archived and replaced.
- **Tests:** new `src/data/questions-v2.test.js` (bank shape, unique ids, exactly one 100-point
  option, correctOptionId integrity, every option has a rationale, dept/domain/competency tags,
  content-guard compliance, 4-per-domain-per-department balance, and a scoring-pipeline
  no-regression check via `scorePerDomain`/`scorePerCompetency`); `src/lib/db.test.js` extended with
  archive-not-delete / manual-preserved / v2-inserted-active / marker-count and no-rerun cases.
- **Verification:** `npm test` -> **548 passing / 28 files**; `npm run build` passed;
  `git diff --check` clean. No merge, no deploy. Old questions archived, not deleted.

### 2026-07-09 - Gemini REST migration and 503 capacity fallback
- **Fix:** REST Gemini calls use `gemini-3.5-flash`, with practice-call and Call QA grading
  falling back to `gemini-3.1-flash-lite` when the primary is unavailable (503/high demand).
  Deterministic QA rubric and score math remain unchanged; the primary model is preferred.
- **Reason:** Rotating keys cannot resolve a model-wide capacity outage when every key returns 503.
- **Verification:** API syntax checks, `npm test` (**548 passing**), and `npm run build` passed.

### 2026-07-09 - PR #19 review fixes: consume caseFile behavior fields + QA-domain auto-fails
- **Context:** Two review blockers on PR #19.
- **Blocker 1 — caseFile behavior fields unused:** `renderCaseFileNotes()` in `api/interview-turn.js`
  now renders `requiredActions`, `acceptableNavigatorPaths`, and `criticalMistakes` into the hidden
  private caller notes (alongside patient type, caller relationship, request summary, facts to reveal,
  emotional tone). They are phrased as hidden caller-behavior guidance — "Correct handling to silently
  expect — never reveal this as SOP guidance", "Acceptable safe paths — cooperate if the navigator
  follows one of these", "Critical mistakes to react to naturally — … ask a clarifying question or show
  mild confusion/frustration, but never explain the SOP answer" — so the caller reacts realistically
  without ever coaching the navigator. `caseFile` remains hidden (never shown in UI or saved to
  Firestore). Test added in `api/api-handlers.test.js`.
- **Blocker 2 — QA-domain scoring ignored verified auto-fails:** `src/lib/qaDomainScoring.js` now folds
  `qa.autoFails` (the verified-only list from `scoreQa`) into the QA-only per-domain / per-competency
  summaries. Any domain/competency tagged on a verified auto-fail is forced to `score: 0` with
  `autoFailed: true` + `autoFails: [{id, text}]` (criterion `earned`/`possible`/`criteria` preserved for
  context; a tag with no normal criteria still returns a non-null zeroed record). So a scope/privacy/
  safety auto-fail can never be hidden behind a clean high QA-only signal. `NavigatorDetail.jsx` shows
  affected tags as "`<score> · Auto-fail`". Tests added in `src/lib/qaDomainScoring.test.js` and
  `src/components/navigatorDetail.override.test.jsx`. **The deterministic pass/fail math in
  `api/_qa-rubric.js` is unchanged, and this stays QA-only — it does not touch the capability matrix.**
- **Polish:** `api/sequence-path.js` prompt now says "patient navigator learning advisor" instead of
  "clinical learning advisor".
- **Regression fix — QA final-review action gating restored in `NavigatorDetail.jsx`:** the branch had
  accidentally shown Confirm Pass, Confirm Fail, Override to Pass, and Override to Fail together for
  every unreviewed/editing QA session. Restored the AI-verdict gating (matching main): AI PASS →
  Confirm Pass + Override to Fail only; AI FAIL → Confirm Fail + Override to Pass only; NEEDS REVIEW →
  no confirm buttons, both overrides only (each requires a reason). The QA-only domain signal and
  "· Auto-fail" label are unchanged. Tests in `navigatorDetail.override.test.jsx` cover all three
  verdict states plus both reason-required overrides.
- **Verification:** `npm test` -> **535 passing / 27 files**; `npm run build` passed;
  `git diff --check origin/main..HEAD` clean. No merge, no deploy.

### 2026-07-09 - Patient Navigator Operating Model injected into all AI endpoints
- **Context:** The AI (scenario generation, roleplay, practice grading, QA grading, audit
  generation, coaching, learning paths) was too SOP-literal — it rewarded exact wording and
  isolated rule-recall instead of real navigator decision quality. Grading also hardcoded a
  "pediatric medical contact centre" framing even for OB/GYN, and the audit prompt taught a single
  "correct lookup order."
- **Change — new shared context module** `api/_navigator-operating-model.js`: exports
  `NAVIGATOR_DECISION_LOOP`, `REALISTIC_CALL_BEHAVIOR`, `SCORING_PRINCIPLES`,
  `WORKFLOW_MISTAKE_TYPES`, and `navigatorContextBlock({ department, mode })`. It describes the JOB
  (identify → authorize → classify → decide action → route/schedule → protect boundaries →
  document → close) and the judging philosophy (strict on safety/privacy/scope/routing/scheduling/
  documentation; flexible on natural wording; lookup order is never the scored target; PE status is
  not a universal refill hard-stop). It carries NO SOP facts or PII — department rules still come
  from `_sop-context.js`.
- **Change — wiring:** `_sop-context.js` now derives `NAVIGATOR_ROLE_CONTEXT` from
  `navigatorContextBlock()` (backward-compatible export; `sopContextFor`/`sopContextForFresh`
  resolution order unchanged: live SOP → hardcoded dept → Pediatrics). Mode-tailored blocks injected
  into `generate-scenarios` (scenario-generation), `interview-turn` (roleplay-init + roleplay-caller),
  `grade-interview` (practice-grading), `generate-audit` (audit-generation), `grade-call-qa`
  (qa-grading), `generate-coaching` (coaching), `sequence-path` (learning-path).
- **Change — grade-interview:** replaced the hardcoded pediatric framing with `departmentName(department)`
  and added an optional structured `findings[]` array (area/verdict/evidence/coaching) that old UI
  ignores; `grade` output stays backward compatible.
- **Change — roleplay `caseFile` (init → turns → voice relay):** `interview-turn` init now returns a
  hidden `caseFile` (workflowType, patientType, callerRelationship, requestSummary, requiredActions,
  acceptableNavigatorPaths, criticalMistakes, factsToReveal, emotionalTone, difficulty).
  `buildSystemInstruction` renders it as private caller notes so the caller stays consistent and
  reveals facts only when asked, never coaching the navigator. The client now carries it end to end:
  `Interview.jsx` and `VoiceCall.jsx` capture `caseFile` from init and echo it back on each turn /
  in the `/api/live` start payload; `live-relay.js` forwards it into `buildSystemInstruction`. Fully
  backward compatible — roleplay still works without a `caseFile`.
- **Change — generate-audit:** removed "correct lookup order for the department"; now "identify the
  correct patient/chart safely for the department context" and the full call shape (identify →
  classify → act/route/schedule/escalate → document/close). All existing guards + Agent-error-index
  validation unchanged.
- **Change — VoiceCall.jsx:** `retryGrading()` now passes `metadata: qaScenarioMetadataRef.current`
  into `gradeSavedAttempt`, so a retried Call QA grade keeps the curated scenario's expectedActions /
  criticalMisses (initial grading already did). Deterministic QA scoring math in `_qa-rubric.js` is
  unchanged.
- **Files:** new `api/_navigator-operating-model.js` (+ `.test.js`); edited `api/_sop-context.js`,
  `api/generate-scenarios.js`, `api/interview-turn.js`, `api/grade-interview.js`,
  `api/generate-audit.js`, `api/grade-call-qa.js`, `api/generate-coaching.js`, `api/sequence-path.js`,
  `api/live-relay.js`, `src/components/Interview.jsx`, `src/components/VoiceCall.jsx`; tests
  added/updated in `api/api-handlers.test.js`, `api/grade-interview.test.js`,
  `api/generate-audit.test.js`, new `src/components/voiceCall.test.js`.
- **Verification:** `npm test` -> **522 passing / 27 files**; `npm run build` passed; `git diff --check`
  clean. Rebased onto `main` after the Call QA final-verdict merge; no merge, no deploy.

### 2026-07-09 - Domain-tagged Call QA scoring bridge
- **Context:** Call QA should eventually contribute to the capability matrix, but only after rubric
  criteria map to patient-navigator domains and competencies. A single overall QA score must not be
  spread across every domain.
- **Changes:**
  - Added shared `src/data/qaRubric.js` metadata so every Call QA criterion and auto-fail carries
    valid `domainIds` and `competencyIds`.
  - Added pure QA-only scoring helpers in `src/lib/qaDomainScoring.js` that split multi-tag criteria
    evenly, exclude `NA` from the denominator, and return per-domain / per-competency score objects.
  - Updated `/api/grade-call-qa` to attach `qa.domainScores`, `qa.competencyScores`, and
    `qa.domainScoreVersion = '2026-07-09-v1'` to the saved QA result without changing pass/fail math.
  - Added a compact **QA-only domain signal** section to the supervisor QA session panel in
    `NavigatorDetail.jsx`. The capability matrix is intentionally still unchanged.
- **Verification:** covered by `src/lib/qaDomainScoring.test.js`; folded into the branch's final
  `npm test` -> **522 passing / 27 files** gate. No merge, no deploy.

### 2026-07-09 - Call QA supervisor final verdict
- **Context:** Call QA now has reliable persistence and curated scenarios, but management still needs a human final-decision layer before relying on AI pass/fail for high-stakes review.
- **Changes:**
  - Added `qaFinalReview` on QA interview docs.
  - Added `updateQaFinalReview()` in `src/lib/db.js`.
  - Added pure final-verdict helpers in `src/lib/qaFinalReview.js`.
  - Added supervisor UI in `NavigatorDetail.jsx` to confirm or override AI QA pass/fail.
  - Required reasons for overrides while preserving original AI `qa` and `grade`.
  - Follow-up fix: confirmation actions now only render when they agree with the AI verdict; NEEDS REVIEW sessions expose override-only actions so supervisors cannot silently convert an AI fail into a "confirm pass".
- **Verification:** `npm test` -> **482 passing / 24 files**; `npm run build` passed; `git diff --check` clean.
### 2026-07-09 - Fix legacy Playwright navigator flow for PhaseHub (deep suite green again)
- **Context:** After PR #16, a full `npx playwright test` (18 specs) had **3 failures**, all in the
  legacy `e2e/navigator.spec.js`. Those tests waited for the pre-F26 "Choose your assessment"
  chooser, which production replaced with the 3-phase PhaseHub ("Your assessment — 3 phases"). The
  Playwright commands were therefore not truthful/green.
- **Change — rewrote `e2e/navigator.spec.js`** to the current F26 flow: Start gate → navigator login
  → department select → **PhaseHub** → Phase 1 (MCQ) completion → dashboard, and Phase 2 (Spot the
  Error) completion → MCQ/Spot coexistence toggle. A `reachPhaseHub` helper opens the hub directly,
  or via the dashboard's "Retake a phase" control when the test user has already completed all
  phases (with a `toPass` retry for the late-subscription view bounce learned in PR #16). Phase 3
  (Call QA) is intentionally **not** driven — it is a live mic voice call; its entry is covered
  read-only by `tests/e2e/`. This file stays the **deep live-data suite**: it writes results to
  Firestore and calls Gemini (MCQ coaching + Spot generation) on purpose.
- **Change — suite separation (scripts):** `package.json` now has explicit scripts —
  `test:e2e:safe` (routine, `tests/e2e/`), `test:e2e:deep` (deep, `e2e/` via a `(?<!tests/)e2e/`
  path filter so it never picks up the safe folder), and `test:e2e:all` (both). **`test:e2e` now
  runs the SAFE suite by default** (was: all specs), so the routine/live command can't accidentally
  trigger destructive writes or Gemini calls. `playwright.config.js` header + README updated to
  document safe-vs-deep and to point the live-URL example at `test:e2e:safe`.
- **No production behavior changed**; `firestore.rules` untouched.
- **Verification:** `npm test` → **462 passing / 23 files**; `npm run build` clean; `git diff
  --check` clean. Playwright: `test:e2e:safe` → **12 passed** locally AND against live Railway;
  `test:e2e:deep` → **6 passed** locally (writes Firestore + Gemini; one transient 503 absorbed by
  key rotation during Spot generation); full `test:e2e:all` → **18 passed** locally.

### 2026-07-09 - Playwright product walkthrough QA coverage (CI-safe, no live AI/mic)
- **Context:** Before management demos there was no repeatable browser pass that walked the app the
  way a supervisor/navigator would. The existing `e2e/` suite covers deep flows but writes to
  Firestore and calls Gemini, so it is not something to run casually or in CI.
- **Change — config:** `playwright.config.js` now discovers both `e2e/**` (original live-data
  suite) and the new `tests/e2e/**` suite from a root `testDir`, ignores `.codex-worktrees/`,
  `node_modules/`, and `stress/`, honours `PLAYWRIGHT_BASE_URL` (skips the local `webServer` and
  runs against a live URL when set), and retains **screenshot + video + trace on failure**.
- **Change — tests:** new `tests/e2e/product-walkthrough.spec.js` (9 tests) and
  `tests/e2e/demo-smoke.spec.js` (3 tests) — **12 tests total** — plus `tests/e2e/helpers.js`. The walkthrough covers:
  Start gate → navigator role/roster gate → sign-in → pick Pediatrics → phase hub → open the MCQ
  check (no submit) → Practice tab shows Voice/Chat entry points **without invoking the mic** →
  supervisor login screen → wrong-passcode rejection → management shell + Overview/Matrix/
  Navigators/Questions/SOPs tabs → open a Navigator Detail shell via a Matrix row.
- **CI-safety guarantees:** read-only navigation only — **no** assessment submits, result saves,
  `getUserMedia`/voice calls, or live Gemini generations. Data-backed navigator steps `test.skip`
  gracefully when the roster is empty (a Firebase-less build); the completed-phases path opens the
  hub via "Retake a phase" so the MCQ-entry step still runs for a fully-completed test user.
- **Selector discipline:** role/text selectors preferred over brittle CSS. Added a `visibleWithin`
  helper because `locator.isVisible()` samples the current state and never polls — the naive skip
  guard was mis-reading subscription-loaded content (matrix rows, phase hub) as absent.
- **Docs:** README gained a "Browser end-to-end tests (Playwright)" section documenting
  `npm run test:e2e` and the `PLAYWRIGHT_BASE_URL=…` live-URL form.
- **Verification:** `npm test` → **462 passing / 23 files**; `npm run build` clean (existing
  Firebase chunk-size warning only); `npx playwright test tests/e2e/` → **12 passed** locally
  against `npm start` (Firebase-backed); `git diff --check` clean. No production source changed.

### 2026-07-08 - Call QA grader receives curated scenario expectations (PR #15 review fix)
- **Context:** PR #15 review caught that the curated scenario's `expectedActions`/`criticalMisses`
  were persisted on the interview doc but never reached `/api/grade-call-qa` — `VoiceCall` only sent
  `{ scenario, transcript, department }`, so the deterministic grader graded without knowing what
  "good" looked like for the selected call.
- **Changes:**
  - Added `buildCallQaGradingScenario(scenario, metadata)` in `VoiceCall.jsx` — appends a plain-text
    "GRADING CONTEXT" block (title / workflow / difficulty + expected behaviors + critical misses)
    to the scenario string. Endpoint already accepts a scenario string, so no rubric change.
  - Threaded `metadata` through `runQaPersistenceSequence → gradeSavedAttempt → gradeQaRequest`;
    generated (non-curated) calls send the original scenario unchanged.
  - Added a component test proving curated `expectedActions`/`criticalMisses` appear in the scenario
    passed to `gradeQaFn`, plus a focused unit test for the helper; kept the existing
    persistence-metadata test.
- **Verification:** `npm test` -> **462 passing / 23 files**; `npm run build` clean; `git diff --check`
  clean.

### 2026-07-08 - Curated Call QA scenario bank
- **Context:** Call QA persistence was reliable, but test scenarios were still generated live at
  call start, which made difficulty and coverage less controlled for management-grade assessment.
- **Changes:**
  - Added `src/data/callQaScenarios.js` with curated Pediatrics and OB/GYN Call QA scenarios.
  - Added scenario validation and selector tests.
  - Updated `VoiceCall mode="test"` to use curated scenarios while keeping practice voice calls
    generated.
  - Stored scenario metadata on QA interview docs.
  - Showed QA workflow/difficulty/scenario metadata in supervisor history.
- **Verification:** `npm test` -> **453 passing / 22 files**; `npm run build` passed (existing
  Firebase chunk-size warning only); `git diff --check` clean (Windows line-ending warnings only).

> Full dated development journal, moved out of CLAUDE.md on 2026-07-07 to cut per-session
> context cost. This file is NOT auto-loaded; read it when you need the history of a
> feature, decision, or fix. New entries are added HERE (newest first, same format),
> not in CLAUDE.md.

### 2026-07-08 — Supervisor grade override for practice sessions (F15)
- **Context:** The AI practice-call grade (`grade-interview`) was the final word on a saved
  roleplay session's score. Supervisors had no way to correct a grade they judged wrong. This was
  the last open item under §15 Current Priorities.
- **Change — db:** New `updateInterviewGradeOverride(interviewId, {score, reason})` in
  `src/lib/db.js`. Coerces/validates score (finite → clamped 0–100 → rounded), requires a non-empty
  reason, and writes **only** a `gradeOverride` field
  `{ score, reason, overriddenAt: serverTimestamp(), overriddenBy: 'supervisor' }`. The original
  `grade` is never touched (audit trail preserved). `overriddenBy` is a pilot-grade placeholder
  until real per-user auth.
- **Change — UI:** In `NavigatorDetail.jsx`'s supervisor-only Practice sessions panel, each graded
  session gains an "Override score" (or "Adjust override") inline form: a 0–100 number input, a
  required reason textarea, Save/Cancel, and inline validation for out-of-range score / missing
  reason. On save the override is reflected in local state immediately (no re-fetch). Overridden
  sessions show the effective (override) score in the header badge and grade panel, a "Supervisor
  override" tag, "Original AI score: X", and the reason. Sessions without an override render exactly
  as before.
- **Styles:** minimal `grade-override__*` rules added to `src/styles.css` (badge, form, fields,
  error, actions); the Practice panel layout is otherwise unchanged.
- **Scope guarantees:** override scores are **advisory only** — they do NOT feed the capability
  matrix, `resultHistory`, MCQ/Spot scores, the deterministic Call QA rubric engine, or any
  navigator-facing assessment score. `firestore.rules` untouched (the `interviews` collection was
  already writable by signed-in pilot clients).
- **Tests:** new `src/components/navigatorDetail.override.test.jsx` (6 tests, `db.js` mocked, no
  Firebase): AI-only score display; override + original-AI-score display; form open; out-of-range
  score rejected; missing reason rejected; valid override calls the db helper with the expected
  `{score, reason}` payload and reflects immediately.
- **Verification:** `npm test` green (450 tests, 22 files), `npm run build` clean, `git diff --check`
  clean. DRAFT PR, no merge, no deploy.

### 2026-07-08 — Call QA save/reset reliability
- **Context:** Call QA Phase 3 completion was derived from interview docs, but the voice-test flow
  could continue after a failed `saveInterview()` and supervisor reset cleared result docs without
  touching existing QA interview attempts. That could leave navigators locally "graded" without a
  durable Firestore record, or leave Phase 3 looking complete after reset because the old QA
  interview still counted as the latest active attempt.
- **Changes:**
  - `VoiceCall.jsx` now uses an explicit persisted chain for `mode='test'`: save interview →
    grade saved transcript → save `grade` + `qa` back to that interview doc → then call
    `onQaResult()`. Save failure, grading failure, and grade-save failure each get their own retry
    UI state and do not complete Phase 3.
  - New pure helpers in `src/lib/phases.js` (`isActiveQaInterview`, `latestQaForDept`) centralize
    the "active QA" rule: must have `qa`, match department, and not be `qaArchived`.
  - New Firestore helper `archiveQaAttempts(navigatorId, department, reason)` marks active QA
    interviews as archived (`qaArchived`, `qaArchivedAt`, `qaArchivedReason`, `qaArchivedBy`)
    instead of deleting them, and supervisor department reset now calls it after `clearResult()`.
  - Navigator/supervisor QA history now keeps archived QA attempts visible for audit, but they no
    longer drive Phase 3 completion or the "latest Call QA Test" card.
  - Added tests for archived-QA filtering, QA-archive scoping, and the no-grade/no-save path when
    interview save fails.
- **Verification:** `npm test` → **444 passing / 21 files**; `npm run build` passed (existing
  Firebase chunk-size warning only); `git diff --check` clean.

### 2026-07-08 — Role-app tab behavior tests (test-only)
- **Context:** Role-app coverage stopped at `roleApps.smoke.test.jsx` (shell mount + gate/session
  routing). The next coverage milestone was per-tab behavioural coverage of `SupervisorApp` and
  `NavigatorApp` — real tab transitions and per-view empty states, not just "renders without crashing".
- **Changes (test-only — no production behavior touched):**
  - New `src/components/roleApps.behavior.test.jsx` (16 tests). Firebase reports configured; `db.js`
    subscriptions yield empty arrays and getters/writers resolve empty by default, with per-test
    `getResult`/`getInterviews` overrides to simulate stored data; `apiFetch` is inert (never
    resolves); `session.js` is mocked. jsdom gaps (`matchMedia`, `ResizeObserver`,
    `IntersectionObserver`, `AudioContext`, `navigator.mediaDevices.getUserMedia`) are stubbed so the
    indirectly-imported `VoiceCall` cannot throw and no microphone is ever requested.
  - **SupervisorApp flows covered:** default Overview shell + wired subscriptions; switching to
    Matrix / Navigators / Training / Questions / SOPs tabs; every tab renders on empty Firestore data
    without crashing; clicking "View dashboard" on a seeded roster row opens NavigatorDetail.
  - **NavigatorApp flows covered:** department picker with no restored dept; selecting Pediatrics with
    no prior result lands on the phase hub; all-three-phases-complete lands on the dashboard (PASS QA
    card); dashboard renders mocked domain scores; My Training renders a plan from a stored result;
    Practice tab shows the voice/chat chooser without starting audio; My History renders on empty
    history; the dept-switch pill returns to the department picker.
  - Assertions target visible headings/roles and stable structural text (no snapshots, no exact-copy
    coupling).
- **Verification:** `npm test` green (444 tests, 21 files), `npm run build` clean, `git diff --check`
  clean. No production component, `firestore.rules`, `server.js`, API handler, or `package.json` change.

### 2026-07-08 — Server-side supervisor session (pilot auth hardening)
- **Context:** `SUPERVISOR_PASSCODE` shipped in the public frontend bundle (`src/data/config.js`)
  and `apiFetch` echoed it back as `body.secret`; `api/_auth.js` validated against
  `GENERATION_SECRET || SUPERVISOR_PASSCODE`. Once bundled, that value protected nothing. This is
  a **pilot hardening step, not full production auth** — there is still no per-navigator server
  identity (that needs real Firebase Auth).
- **Change — server:** New signed-session layer in `api/_auth.js` using Node `crypto` HMAC-SHA256:
  `createSessionToken`/`verifySessionToken` (tamper + expiry checked), cookie helpers
  (`serializeSessionCookie`/`clearSessionCookie`/`parseCookies`/`readSession`, HttpOnly · SameSite=Lax
  · Path=/ · Max-Age 10h · Secure behind HTTPS via `isSecureRequest`), `checkSupervisorPasscode`
  (constant-time). New endpoints `POST /api/supervisor-login` (passcode → Set-Cookie) and
  `POST /api/logout` (clear cookie), mounted in `server.js` (login rate-limited). Two gates:
  `validateSession` (supervisor-only: `generate-scenarios`, `refine-sop` — requires the cookie) and
  `validateSecret` (navigator/shared endpoints — **pilot-grade OPEN**, rate-limited; a valid
  supervisor session also passes). `isValidSecret` (WS voice relay) is likewise open pilot.
- **Change — client:** `apiFetch` no longer injects `SUPERVISOR_PASSCODE`; it sends
  `credentials: 'same-origin'` so the session cookie rides along. `VoiceCall` WS start no longer
  sends the passcode. `Start`'s `SupervisorGate` calls `/api/supervisor-login` (falls back to the
  bundled passcode when `/api` is unreachable, e.g. `npm run dev`). `App.signOut` calls
  `/api/logout` (best-effort) before clearing the local session.
- **Endpoint policy:** supervisor-only = session required; navigator/practice = open + rate-limited
  (documented pilot-grade — requiring a session there would break practice/coaching/Call-QA flows).
  Env flags: `SUPERVISOR_PASSCODE_SERVER`, `SESSION_SIGNING_SECRET`, `ALLOW_LEGACY_API_SECRET`,
  `REQUIRE_SUPERVISOR_SESSION` (see `.env.local.example`).
- **Tests:** rewrote `api/_auth.test.js` (session pipeline, cookies, both gates); new
  `api/supervisor-login.test.js` (login/logout); updated `src/lib/apiFetch.test.js` (no secret +
  credentials) and `src/components/roleApps.smoke.test.jsx` (login endpoint + dev fallback paths).
- **Constraints honored:** no merge, no deploy (DRAFT PR); `firestore.rules` untouched; no new deps.
- **Follow-up (2026-07-08, same branch):** synced stale security docs/comments to the new model —
  CLAUDE.md apiFetch/deployment/security notes (no more "apiFetch injects the passcode" or
  "GENERATION_SECRET not needed — falls back to SUPERVISOR_PASSCODE"), and the stale header comments
  in `generate-scenarios.js` / `refine-sop.js` / `live-relay.js`. Added `REQUIRE_SUPERVISOR_SESSION`
  toggle tests (`validateSecret` + `isValidSecret`, env restored after each).
- **Verification (local):** `npm ci` ✓; `npm test` → **424 passing / 20 files** (was 421);
  `npm run build` passed (existing Firebase chunk-size warning only); `git diff --check` clean.
  **GitHub Actions CI: success on PR #8 latest head commit.**

### 2026-07-08 — Role-app smoke tests (App / Start / SupervisorApp / NavigatorApp)
- **Context:** Role-app integration coverage was the long-standing test gap (the four top-level
  shells were the only untested area). Added lightweight smoke coverage — "renders without
  crashing" + basic gate/routing — without deep-testing individual tabs.
- **Change:** New `src/components/roleApps.smoke.test.jsx` (8 tests). Mocks `src/lib/firebase.js`
  (configured), `src/lib/db.js` (all subscriptions are no-ops that yield empty data; all
  getters/mutators resolve empty — zero network), and `src/lib/session.js` (so App can restore a
  chosen session on mount). Covers: Start renders the role picker; the supervisor passcode path
  accepts the correct code and rejects a wrong one; SupervisorApp mounts its shell + wires live
  subscriptions against empty data; NavigatorApp routes to the department-select entry; and App
  restores supervisor/navigator sessions into the correct lazy-loaded shell (and shows Start with
  no session). No production code changed; jsdom's missing IntersectionObserver is tolerated by
  `useInView` so no polyfill was needed.
- **Verification:** `npm test` → **403 passing across 19 files** (was 395/18); `npm run build` →
  passed with the existing Firebase chunk warning; `git diff --check` → clean.

### 2026-07-08 — Add GitHub Actions CI test/build gate
- **Context:** Owner explicitly approved adding a minimal GitHub Actions workflow so every pull
  request and `main` push runs the normal verification commands, but nothing deploys from GitHub.
- **Change:** Added `.github/workflows/ci.yml` with a single `verify` job on `ubuntu-latest`.
  It triggers on `pull_request` to `main` and `push` to `main`, runs `npm ci`, `npm test`, and
  `npm run build`, and stops there. No Firebase secrets, no Railway steps, no deploy automation.
- **CI follow-up:** PR #6's first Actions run failed in `npm ci` before tests/build because the
  current lockfile pulls transitive packages whose engines require `^20.19.0 || ^22.12.0 || >=24.0.0`.
  The workflow now uses Node 24 explicitly while `package.json` still declares `>=20.0.0`.
- **Docs:** Updated `CLAUDE.md` current-state / workflow notes to reflect that CI now exists as a
  simple PR/main verification gate while Railway remains the separate deploy path.
- **Verification:** `npm test` → **395 passing across 18 files**; `npm run build` → passed with the
  existing Firebase chunk warning; `git diff --check` → passed with line-ending warnings only.

### 2026-07-07 — PR #5 follow-up: encoding cleanup and migration safety
- **Context:** Draft PR review found `CLAUDE.md` / `docs/HISTORY.md` mojibake, a supervisor-load migration that would keep scanning after success, and balanced audit generation that could still count archived refill-heavy items.
- **Fix:** Repaired both docs to clean UTF-8 without BOM and verified zero hits for the reviewer-specified mojibake markers (U+00C3, U+00C2, U+00E2, and replacement-character variants). `runContentQualityFixesMigration()` now checks a version marker before scanning, records completion counts, and skips overwriting `q-int-1` / `q-obgyn-int-1` when the live docs already pass content guards. Balanced audit coverage now ignores archived audits in both the helper and supervisor generation path. `firestore.rules` now allows signed-in pilot access to `contentMigrations/{docId}` so the marker write can succeed.
- **Verification:** `npm test` → **395 passing** across 18 files; `npm run build` → clean with the existing large Firebase chunk warning; `git diff --check` → clean (Windows line-ending notices only).

### 2026-07-07 — Content-quality reliability fix: lookup-order neutrality, balanced audits, refill grading
- **Context:** Owner requested a reliability pass on live assessment content after pilot feedback: lookup-order questions were grading personal workflow preference, Spot the Error was overproducing refill scenarios, and standard refill grading was incorrectly treating PE status as a hard blocker.
- **Lookup-order fix:** `q-int-1` and `q-obgyn-int-1` were rewritten to test correct chart / patient safety instead of phone-first vs DOB-first. Shared `src/lib/contentGuards.js` now blocks generated questions or audits that grade lookup order without a safety/privacy reason. `QuestionBank.jsx` and `AuditBank.jsx` surface blocked flags and disable Activate/Restore for them. `runContentQualityFixesMigration()` in `db.js` patches the two live seed docs in Firestore only if their current content still fails guards, archives any non-archived question/audit that trips the new guards with `archivedReason: 'content-quality-fix-2026-07'`, and records a `contentMigrations/2026-07-content-quality-fixes-v2` marker after success so supervisor loads do not rescan repeatedly.
- **Spot the Error diversity fix:** new taxonomy `src/data/auditWorkflows.js`; audit docs now carry `workflowType`, `errorKind`, and `difficulty`. `/api/generate-audit` accepts workflow steering (`workflowType`, `avoidWorkflowTypes`) and returns the extra metadata. `SupervisorApp.jsx` now generates balanced audit batches by least-covered non-archived workflow type unless the supervisor explicitly requests a specific workflow. `AuditBank.jsx` shows workflow coverage within the selected domain and warns when one workflow dominates. `SpotTheError.jsx` now round-robins bank items by `workflowType` in single-domain mode so five-item runs do not collapse into repeated refill transcripts.
- **Refill / PE correction:** hardcoded Pediatrics SOP fallback in `api/_sop-context.js` no longer says standard refills cannot be processed when PE is not current. Generation and grading prompts (`generate-scenarios`, `generate-audit`, `interview-turn`, `grade-interview`, `grade-call-qa`) now explicitly treat standard refill success as medication name + preferred pharmacy + out-of-med priority + correct TE routing + no clinical advice / no promised approval, and explicitly forbid requiring PE verification unless the scenario makes PE status the governing rule.
- **Tests:** added `src/lib/contentGuards.test.js`, `src/data/auditWorkflows.test.js`, `src/components/spotTheError.test.js`; extended `api/generate-audit.test.js`, `api/grade-call-qa.test.js`, and `src/lib/db.test.js`. Suite now **395 passing tests across 18 files**.
- **Verification:** `npm test` → **395 passing**; `npm run build` → clean with the existing chunk-size warning.

### 2026-07-07 — Fix mojibake in NavigatorApp.jsx (Practice chooser emoji + punctuation)
- **Context:** The F26 commit saved `NavigatorApp.jsx` with UTF-8 content mis-decoded as
  Windows-1252 and re-encoded (double-encoded UTF-8 + a stray BOM). The Practice chooser
  rendered garbage glyphs instead of the mic/chat emoji, and 15 other spots (em-dashes,
  ellipses, the  unsaved-result banner) were garbled.
- **Fix:** Byte-level re-decode of the whole file (cp1252 reverse map  UTF-8), BOM stripped.
  Only `NavigatorApp.jsx` was affected in `src/` and `api/`.
- **Verification:** `npm test`  381 passing; `npm run build`  clean.

### 2026-07-07 — 3-phase assessment flow (F26)
- **Context:** Owner request to stop treating Multiple choice / Spot the Error / Call QA Test as three sibling choices and instead make them one sequenced department assessment.
- **Decisions:** No data-model change; each phase keeps writing what it already wrote. Completion stays **derived, never stored**: MCQ from `resultsByType.mcq`, Spot from `resultsByType.spot`, QA from the latest department-scoped interview doc that has a `qa` field. The old chooser became `PhaseHub`; department select now lands on the hub until all 3 phases are done; coaching and full-profile Spot return to the hub while phases remain; completed phases can be retaken without re-locking later phases; the Practice tab drops the graded QA card so Phase 3 cannot be completed out of order; legacy `__qa` result docs remain fetchable for history but do not count toward phase completion.
- **Files:** new `src/lib/{phases,phases.test}.js`, `src/components/PhaseHub.jsx`; edited `src/components/{NavigatorApp,components.test}.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test`  **381 passing** across **15 files**; `npm run build`  clean with the existing chunk-size warning.

### 2026-07-07 — Audit follow-ups: department scope, QA isolation, API throttles
- **Context:** Follow-up from a production-readiness audit. Goal was to fix concrete bugs and pilot
  hardening gaps without rebuilding the app's auth model in one oversized pass.
- **Bugs fixed:**
  - `saveResult` now writes the current result and `resultHistory` snapshot in one Firestore batch,
    avoiding split-brain saves and duplicate retry history.
  - Completions now carry `department`; navigator and supervisor reads filter completions to the
    active department, with legacy docs treated as Pediatrics.
  - Navigator mentor floor scores now call `getFloorScores(department)`, returning the latest
    projected result per navigator for that department and deduping by `navigatorId`.
  - Mentor pairings now carry/filter by `department`, preventing same-domain collisions between
    Pediatrics and OB/GYN.
  - `adaptiveTrainingRecommendations` checks `INTERVIEW_SCORE_BANDS.strong` instead of the
    nonexistent `.good`, so weak graded interviews keep call practice as the next step.
  - `seedQuestionsIfEmpty` now seeds missing seed IDs instead of no-oping whenever any question doc
    exists, so future department seeds can be added safely.
  - Call QA Test no longer writes a synthetic six-domain `results` doc; it remains a separate
    QA/readiness scorecard on the interview doc until the QA rubric is domain-tagged.
- **Production hardening:**
  - `server.js` now uses a 100kb JSON limit globally and a 20mb parser only for `/api/refine-sop`.
  - Added tiny dependency-free in-memory rate limits to REST AI routes.
  - `live-relay.js` imports `WebSocket` explicitly from `ws`, caps active voice sessions at 2 per IP,
    and closes calls after 10 minutes.
  - SOP-grounded authoring/scoring handlers now await `sopContextForFresh(department)` so a newly
    activated live SOP is used on the first request when Firestore is reachable.
- **Not changed:** real Firebase role auth, hashed navigator PINs, and CI workflow creation remain
  production work. The attempted GitHub Actions workflow was blocked by the environment because it
  creates persistent external automation; add it only with explicit owner approval.
- **Verification:** `npm test` → 363 passing; `npm run build` → clean with the existing Firebase
  chunk-size warning; `node --check` on all edited API/server files.
- **Files:** new `api/_rate-limit.js`; edited `server.js`, `api/{_sop-context,_sop-store,generate-scenarios,generate-audit,grade-interview,grade-call-qa,interview-turn,sequence-path,live-relay}.js`,
  `src/lib/{db,db.test,scoring,scoring.test}.js`, `src/components/{NavigatorApp,SupervisorApp}.jsx`,
  `CLAUDE.md`.

### 2026-07-06 — Codebase refactor & stability audit (no user-facing behavior change intended)
- **Context:** Owner requested a full reliability/maintainability pass — find bugs, fragile
  logic, duplication, and weak error handling; fix safely without changing product behavior.
  A 6-agent audit (standards, duplication, logging, secrets, tests, dependencies) drove the pass.
- **Bugs fixed:**
  - `api/sequence-path.js` and `api/refine-sop.js` mapped EVERY non-fatal Gemini failure to 502
    (`result.status  502` — auth/exhausted results carry no `.status`), so rate-limit
    exhaustion returned 502 instead of 429. Both also lacked the empty-keys guard; both had a
    stray `model:` field inside the request body (the model lives in the URL) and a dead local
    `MODEL` constant.
  - Key-leak risk in server logs: `_gemini-client.js` logged the raw thrown fetch error (whose
    cause/stack can embed the `key=<KEY>` request URL) and `live-relay.js` logged the upstream
    WS error message (same URL-key pattern). New exported `redactKeys()` strips `key=` query
    params before logging.
- **Consistency/DRY (all 9 Gemini handlers):**
  - New `rotationFailure(result, overrides)` in `api/_gemini-client.js` — the single mapping of a
    failed rotation to HTTP per the documented contract (fatal→502, auth→500, exhausted→429).
    Handlers that previously had no auth branch (auth fell into 429) now correctly return 500
    on all-keys-403; per-endpoint user-facing copy preserved via overrides.
  - `validateSecret` now runs BEFORE the `getApiKeys()` guard in every handler (7 handlers
    previously revealed server-config state to unauthenticated callers); the keys guard itself
    standardized to `if (!keys.length)` and added where missing.
  - `api/grade-interview.js` grade clamping extracted to exported pure `coerceGrade(parsed)`
    (identical behavior, now unit-testable like its grade-call-qa siblings).
  - Scoring rule unified: `optionPoints(question, optionId)` is now exported from
    `src/lib/scoring.js` as THE canonical per-option scoring rule; the two internal duplicates
    (`earnedPoints`, a second `optionPoints`) and one inline copy inside `buildDossier` collapse
    onto it, and the inline re-implementations in `Coaching.jsx`, `MyHistory.jsx`,
    `QuestionBank.jsx`, and `api/generate-coaching.js` (`buildDigest`) now import it.
  - `api/generate-coaching.js` local `domainName` arrow replaced by the `domainName` export from
    `src/data/questions.js`.
  - `Interview.jsx`/`SpotTheError.jsx` inline AbortError message shaping replaced with the
    existing `fetchErrorMessage` helper (helper hardened to tolerate null errors).
  - `NavigatorApp.jsx` silent `catch {/* non-critical */}` around the two `saveCompletion` sites
    now logs (`console.error`) so a failing completions collection is visible in the console.
- **Hygiene:** `.gitignore` gains generic secret patterns (`.env`, `.env.*` with
  `!.env.local.example`, `*.pem`, `*.key`, `*.p12`, `service-account*.json`).
- **Tests:** 328 → **358** passing, 11 → **14** files. New: `src/lib/apiFetch.test.js`
  (apiFetch success/error paths, `fetchErrorMessage`, `runPooled` order/rejection/concurrency),
  `api/_auth.test.js` (`validateSecret`/`isValidSecret` — the previously untested security gate),
  `api/grade-interview.test.js` (`coerceGrade`). Extended: `_gemini-client.test.js`
  (+`rotationFailure`, +`redactKeys`), `scoring.test.js` (+`optionPoints`).
- **Intentionally NOT changed:**
  - The `'pediatrics'` literal defaults in `db.js` and the API handlers stay literals — they are
    the legacy back-compat key for pre-multi-department docs/clients, not "the default
    department"; if `DEFAULT_DEPT` ever changes, these must still read pediatrics.
  - Vite stays on 5.4.21 (known moderate advisories; the fix is a semver-major jump to Vite 8 —
    out of scope for a stability pass; recorded in §11 tech debt).
  - `[live-relay] upstream closed` log kept (documented ops signal); `api/_sop-store.js` direct
    Firestore access kept (the server can't import the client-only db.js — documented exception);
    tracked `SOP Guide.pdf` left alone (removal is an owner call).
- **Verification:** `npm test` → **358 passing** (14 files); `npm run build` → clean;
  `node --check` on all touched api files → OK.
- **Files:** edited `api/{_gemini-client,generate-scenarios,generate-coaching,interview-turn,
  grade-interview,grade-call-qa,generate-audit,coach-audit,sequence-path,refine-sop,live-relay}.js`,
  `src/lib/{scoring,apiFetch}.js`, `src/components/{Coaching,MyHistory,QuestionBank,Interview,
  SpotTheError,NavigatorApp}.jsx`, `.gitignore`, test files as above, `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-06 — F25 hardening: confidence/review layer, context-aware grading, decision-support pass/fail
- **Context:** Owner asked for an audit + hardening of the Call QA grading so management can trust
  it as a decision-support tool — reliability, context-awareness, evidence, and pass/fail safety
  over raw scoring. Audit findings on the existing pipeline: the deterministic core was sound, but
  (1) auto-fail reports whose quote didn't verify were **silently dropped** (a possible safety
  event vanished), (2) there was **no confidence layer** — every call got a confident PASS/FAIL,
  (3) standalone "Aizer" mis-hearings ("Izer") weren't in the glossary (only two-word phrases),
  (4) the grader prompt didn't demand scenario-conditional judgment or SOP-rule citations, and
  (5) improvement notes didn't carry the transcript quote.
- **Review layer (`assessQa` in `api/_qa-rubric.js`, new):** a PURE, deterministic
  confidence + supervisor-review assessment on top of the scorecard — no model call. Returns
  `{ recommendation: 'pass'|'needs_review'|'fail', confidence: 'high'|'medium'|'low',
  safetyRisk: 'none'|'elevated'|'critical', reviewFlags: [{id,label,detail}] }`. Flags:
  `low-transcript-confidence` (≥3 glossary-corrected turns or too-short call),
  `unverified-evidence` (grader quotes not found in the transcript), `possible-unsafe-behavior`
  (auto-fail reported but unverified — now surfaced instead of dropped; forces needs_review +
  critical risk), `thin-coverage` (>25 rubric points NA), `safety-criterion-missed`
  (`SAFETY_CRITICAL_CRITERIA` = verify-three, verify-before-access, know-rule, doc-te — a passing
  score over a safety miss becomes needs_review), `borderline-score` (within `QA_REVIEW_MARGIN`=5
  of the pass mark), `requires-supervisor-judgment` (verified auto-fail). Two confidence hits →
  low confidence → needs_review. `scoreQa` now also returns `unverifiedAutoFails`.
- **Handler (`grade-call-qa.js`):** uses new `correctTranscriptWithStats` (corrected-turn count =
  transcript-quality signal); attaches `review` + `correctedTurns` to the stored `qa`; prompt
  gained a **CONTEXT-AWARE JUDGMENT** block (routing depends on patient state — pregnant vs
  non-pregnant vs MFM; refill completeness incl. out-of-med priority; lab calls must be routed,
  never interpreted; escalation triggers; multi-child calls must not conflate patients) and a rule
  that NOT_MET notes must **name the specific SOP rule** so supervisors can coach from them.
- **Glossary (`_qa-glossary.js`):** standalone org-name aliases (`izer`, `iser`, `eiser`, `ayzer`,
  `eyzer`, `aizor`, `aiser` → Aizer) ordered after the two-word phrases so "Izer Health" still
  becomes "Aizer Health"; new `correctTranscriptWithStats` counts changed turns.
- **Evidence-based feedback:** `buildGradeProjection` now appends the verified transcript quote to
  each strength/improvement and auto-fail line, and appends a `FLAGGED FOR SUPERVISOR REVIEW (…)`
  sentence to the stored summary when the recommendation is needs_review — so the flags travel
  into the interview doc the supervisor panel already renders.
- **UI:** `VoiceCall.jsx` test results show a NEEDS REVIEW verdict (amber) when flagged, plus a
  "Supervisor review flags" card (confidence + safety risk + each flag). `NavigatorDetail.jsx` QA
  badge gains a `NEEDS REVIEW` variant and the expanded grade panel lists the review flags.
  New `.qa-result--review` / `.qa-reviewflags*` / `.qa-log-badge--review` styles.
- **Pass/fail safety model:** the AI result is decision support — a verified auto-fail still
  recommends fail but carries a supervisor-confirmation flag; borderline, low-confidence,
  unconfirmed-unsafe, and safety-miss-while-passing results all recommend supervisor review
  instead of a confident verdict. Domain-score feed unchanged (scores stay deterministic).
- **Verification:** `npm test` → **328 passing** (11 files; +20 regression tests covering
  Izer→Aizer standalone, correction stats, unverified auto-fail retention, all review flags,
  borderline/safety-miss recommendations, evidence quotes in feedback, and the context-judgment
  prompt block); `npm run build` → clean; `node --check` on the 3 edited api files.
- **Files:** edited `api/{_qa-rubric,grade-call-qa,_qa-glossary}.js` + both QA test files,
  `src/components/{VoiceCall,NavigatorDetail}.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete (code). Supervisor grade override (writing a final human verdict back to
  the doc) remains the planned next step; the review flags give supervisors the trigger list.

### 2026-07-03 — F25 QA fairness pass: SOP transcript glossary + context-aware grading
- **Context (pilot feedback):** two linked complaints about the Call QA Test. (1) The grader was
  **too literal / context-blind** — it failed Closing because the navigator didn't say "thank you"
  even though the caller had already thanked them and the call closed naturally. (2) The Gemini Live
  **transcription has no domain vocabulary**, so it mis-heard SOP proper nouns ("Aizer Health" →
  "Isr Pediatrics", "49 Forest Road", provider/queue names, "PE"), and the literal grader then
  penalized the navigator (e.g. Opening −3 for the org name) for terms they actually said right.
  Owner's constraint: correct the transcription toward the closest SOP reference **without making
  it hallucinate words**. Decisions taken via question: **fairness fixes only** (keep verification /
  scope / SOP-knowledge hard) and apply the correction on the **grading transcript** (not live
  captions).
- **Transcript glossary (`api/_qa-glossary.js`, new):** a curated, department-aware glossary of the
  SOP's canonical terms (org name, locations, provider surnames, queues, hospital). `correctText` /
  `correctTranscript` snap mis-hearings to canonical via (1) explicit alias phrases (fixes "Isr
  Pediatrics" → "Aizer Health", "peds encounter" → "PEDS Encounters") and (2) a conservative
  single-word fuzzy pass (Levenshtein ratio ≥ 0.82, distinctive proper nouns ≥ 6 chars only,
  whole-word replace). **No-hallucination guarantee:** output is bounded to the glossary — an
  unmatched span is left exactly as transcribed; ordinary conversation is untouched.
  `glossaryPromptBlock` hands the grader the canonical spellings + abbreviation equivalences (PE =
  physical exam, TE = telephone encounter, OV = office visit, GS = Good Samaritan, …) so a synonym
  or correct term never costs a criterion.
- **Grading (`api/grade-call-qa.js`):** the handler now `correctTranscript`s the call BEFORE
  building the prompt and scoring, so both the model verdicts and the evidence-verification gate see
  the corrected text. The system instruction gained scoped **FAIRNESS RULES** (don't fail a
  criterion on a mis-transcribed / synonymous proper noun; accept a natural mutual close for the
  closing pleasantry) that explicitly leave verification, scope/HIPAA, routing, scheduling, and
  SOP-knowledge strict. `_qa-rubric.js` reworded `close-anything-thanks` to accept a courteous
  natural close (exact scripted wording no longer required); points unchanged.
- **Verification:** `npm test` → **308 passing** (11 files; +16 `_qa-glossary` tests); `npm run
  build` → clean (known Firebase chunk warning only); `node --check` on the new/edited api files.
  Glossary tests cover the reported cases (Isr Pediatrics → Aizer Health, provider near-spelling,
  ordinary text untouched, no out-of-glossary output).
- **Not changed:** live captions / the saved interview transcript keep the raw text (grading-only
  scope, per the decision); advisory `grade-interview` is untouched but `_qa-glossary` is reusable
  there later.
- **Files:** new `api/{_qa-glossary,_qa-glossary.test}.js`; edited `api/{grade-call-qa,_qa-rubric}.js`,
  `CLAUDE.md`.
- **Status:** Complete (code). Needs an in-browser voice-call run to confirm end-to-end on the
  real transcription, as with the rest of F22/F25.

### 2026-07-03 - F25: Call QA Test promoted to first-class navigator assessment
- **What changed:** Added **Call QA Test** as the third card in `NavigatorApp`'s
  `AssessmentTypeChooser` (after department selection), alongside Multiple choice and Spot the
  Error. It launches the existing `VoiceCall mode='test'` flow, keeps the Practice-tab entry
  intact, and returns to the navigator dashboard from the test review screen.
- **Domain score feed (later 2026-07-03, superseded 2026-07-07):** QA results now also write `results` +
  `resultHistory` with `assessmentType:'qa'` and a `__qa` result-doc suffix. Because the QA rubric
  is not domain-tagged yet, `scoreQaAcrossDomains(qa)` applies the one full-call QA score to all
  six domains from either Call QA entry point. Domain-practice analytics still ignore `interviews`
  with `qa` so the random call scenario domain cannot satisfy a training/path step.
- **Dashboard UI:** Navigator dashboard now shows the latest department-scoped Call QA Test as a
  small PASS/FAIL card with score, date, and Retake button. `saveInterview` now stores
  `department` for new chat/voice/QA interview docs; old docs continue to fall back to Pediatrics.
- **Verification:** `npm test` -> **292 passing** (10 files); `npm run build` -> clean (existing
  Firebase chunk-size warning only).
- **Files:** edited `src/components/{NavigatorApp,VoiceCall,Interview}.jsx`,
  `src/lib/{db,scoring,scoring.test}.js`, `src/styles.css`, `CLAUDE.md`.

### 2026-07-03 — F25: Call QA Test — hard rubric-graded voice test (owner-provided quality guide)
- **Context:** Owner wants the voice practice call to double as a real, RELIABLY-graded pass/fail
  test — "actually really really hard", no vague scoring — and provided the call quality guide
  (`Aizer_Health_Navigator_Quality_Guide_SOP.pdf`, scanned/no text layer; transcribed via Gemini
  native PDF input, the same mechanism F24 uses).
- **Why the old grading couldn't be the test:** `grade-interview` asks Gemini for one holistic
  0–100 against prose bands at temp 0.3 — the same call can plausibly score 68 or 81 across runs.
  The fix is structural, not prompt-tuning: **the model classifies, the code scores.**
- **What was built:**
  - `api/_qa-rubric.js` — the guide's 100-point scorecard as data: 9 categories / 20 binary
    criteria + 3 auto-fails (HIPAA/verification · clinical scope · conduct), `QA_PASS_THRESHOLD
    = 85`, and the pure pipeline: `verifyEvidence` (fragment-split, role-label-stripped
    normalized matching), `validateQaResponse`, `scoreQa` (trust gates + deterministic math),
    `buildGradeProjection` (maps the scorecard onto the existing interview `grade` shape).
    Guide quirks resolved: timing metrics (<5s answer, 11s dead air) aren't transcript-observable
    → folded into observable call-control criteria; Closing 5-vs-10 contradiction → 5 (the
    100-point scorecard is authoritative).
  - `api/grade-call-qa.js` (`POST /api/grade-call-qa`) — Gemini returns ONLY per-criterion
    MET/NOT_MET/NA verdicts + verbatim evidence quotes at **temperature 0** (structured JSON,
    no lite-model fallback, one retry on malformed shape). Trust gates in code: MET with
    unverifiable evidence → NOT_MET; NA on a core criterion → NOT_MET; an auto-fail stands only
    with verified evidence (anti-hallucination) and zeroes the score. Pass = ≥85, zero auto-fails.
  - UI: `VoiceCall.jsx` `mode='test'` — hard-test copy, QA grading (60s timeout), results screen
    with PASS/FAIL banner, auto-fail cards (quoted offending line), per-category bars, "Points
    you lost" list. Third `PracticeChooser` card (🎯 Call QA Test). `updateInterviewGrade(id,
    grade, qa)` stores the full scorecard on the interview doc; supervisor `NavigatorDetail`
    shows a "QA TEST · PASS/FAIL" badge (grade breakdown renders via the existing panel).
- **Live verification (real keys):** a strong fixture call graded **twice with identical verdicts
  on all 20 criteria** (the determinism claim, demonstrated); a bad fixture call (read lab
  results, gave med advice, sarcasm, no verification) → score 0, FAIL. First smoke run exposed
  two evidence-gate fairness bugs — model quotes stitched from multiple turns / prefixed with
  role labels were being rejected, and auto-fail evidence was filtered the same way — fixed by
  fragment-splitting `verifyEvidence` (any genuine 2+ word fragment verifies) + a
  single-contiguous-quote prompt rule.
- **Verification:** `npm test` → **290 passing** (10 files; +28 QA pipeline tests);
  `npm run build` → clean; `node --check` on both new api files; live smoke test above.
- **Files:** new `api/{_qa-rubric,grade-call-qa,grade-call-qa.test}.js`; edited `server.js`,
  `src/lib/db.js`, `src/components/{VoiceCall,NavigatorApp,NavigatorDetail}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete. QA test results also feed the capability matrix as a full-profile score
  snapshot. Supervisor grade override remains the planned backstop.

### 2026-07-03 — Gemini quota diagnosis + flash-lite overflow lane (free-tier stopgap)
- **Context:** Owner asked why the pilot exhausted the 4-key rotation so fast despite low daily
  volume. Live key probes (tiny generateContent bursts against the real keys) established the
  facts: (1) the 4 keys ARE independent quota pools — key #0 rate-limited while keys 1-3 kept
  returning 200, so rotation works; (2) **the free-tier limit is now 5 RPM per project per model**
  (the 429 body reports `generate_content_free_tier_requests limit=5` — Google's Dec-2025 quota
  cut halved the old 10), so the whole pool is ~20 requests/min; (3) exhaustion was per-minute
  burst pressure (a pre-audit-bank Spot = 6 heavy calls/min from ONE navigator; a practice chat =
  1 call per message), never the daily cap; (4) `gemini-2.5-flash-lite` has a **separate**
  per-model quota bucket on the same keys but its free tier intermittently 503s ("high demand") —
  a cushion, not guaranteed capacity.
- **What changed (all stopgap until paid-tier billing is approved for full deployment):**
  - `api/_gemini-client.js` — `MODEL` + new `LITE_MODEL` (`gemini-2.5-flash-lite`) are exported;
    `callGemini` takes a `model` param; `geminiWithRotation` accepts `models: [...]` and tries
    every key on the primary model first, then every key on each fallback model (per-model quota
    buckets). Default stays single-model — no behavior change for handlers that don't opt in.
    New `quotaInfo()` parses the 429 body so Railway logs now say WHICH quota tripped
    (metric, limit value, per-minute vs per-DAY) instead of a bare status code.
  - `api/interview-turn.js` — init + turn calls opt into `models: [MODEL, LITE_MODEL]` (roleplay
    is conversational, unscored; a lighter model beats a 429 mid-call).
  - `api/generate-coaching.js` — same opt-in (advisory prose; client silently drops it on 429).
  - Scored/authoring endpoints (grading, scenario/audit generation, refine-sop, sequence-path)
    deliberately do NOT fall back — quality gate kept.
  - **Follow-up (same day): per-key cooldown.** A key that 429s now sits out for the
    `retryDelay` Gemini's 429 body specifies (default 30 s when absent), per model, so
    concurrent/subsequent requests skip known-limited keys instead of wasting a round-trip
    re-learning it. Module-level `cooldowns` Map + exported `resetCooldowns()` test hook.
    If every key+model is cooling, the rotation returns `exhausted` instantly with zero
    network calls (callers already map that to 429 "try again shortly"). Latency win only —
    capacity is unchanged. +4 cooldown tests (skip, healthy-key routing, retryDelay expiry,
    per-model independence).
- **Path to real capacity (owner decision):** enable billing on one Google project (Tier 1 ≈
  hundreds+ RPM; ~$1-2/day at pilot volume), put that key first in `GEMINI_API_KEYS`, keep free
  keys behind it as rotation backup. Zero code change needed. Free-tier stacking is confirmed
  a dead end (5 RPM per extra account).
- **Verification:** `npm test` → **262 passing** (9 files; +5 model-fallback and +4 cooldown
  rotation tests); `npm run build` → clean; `node --check` on the 3 edited api files → OK.
- **Files:** `api/{_gemini-client,_gemini-client.test,interview-turn,generate-coaching}.js`,
  `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-03 — Pilot-feedback pass (6-7 navigator soft launch)
- **Context:** The owner launched the webapp to 6-7 navigators and collected feedback
  ("Knowledge Check Webapp Bugs And Feature Tweaks.docx", untracked). This pass addressed 6 of
  the 9 items; the remaining 3 are: add more keys to `GEMINI_API_KEYS` in Railway (owner action,
  no code), colour-scheme feedback (content unknown — needs specifics), and Railway cold-start
  (infra-side; the in-repo part was fixed here via code-splitting).
- **1 · Practice caller switched language mid-call** (one navigator's chat "turned into indian"):
  `buildSystemInstruction()` in `api/interview-turn.js` had NO language rule, so nothing stopped
  Gemini drifting into Hindi at roleplay temperatures. Added a CRITICAL English-only rule (covers
  BOTH the text chat and the voice call — the live relay reuses the same persona builder) and an
  "everything in English" line in the init prompt.
- **2 · Voice/chat practice review never appeared:** grading failures in `VoiceCall.jsx` and
  `Interview.jsx` were swallowed (console.error → reviewed screen with a bare "—"), and the
  transcript/docId were discarded so nothing could be retried. Both components now keep the saved
  transcript + doc id, explain the failure ("the reviewer may be busy"), and offer a **"Try the
  review again"** button that re-calls `/api/grade-interview` and writes the grade back to the
  interview doc. `VoiceCall` also resets stale grade state when starting a new call.
- **3 · "Spot the Error" was slow (40–70 s) with unrealistic scenarios → pre-generated audit
  bank:** new Firestore `audits` collection (same draft→active review-gate model as the question
  bank). `db.js`: `subscribeAudits`, `getActiveAudits(dept)`, `saveDraftAudits`, `activateAudit`,
  `archiveAudit`, `deleteAudit` (+3 db tests). New supervisor UI `AuditBank.jsx` (rendered under
  the Question Bank in the Questions tab): per-domain active-coverage read-off, pooled generation
  (2 concurrent via `runPooled`, now exported from `apiFetch.js`), full-transcript review with the
  planted error highlighted, activate/archive/delete. `SpotTheError.jsx` now draws items from the
  bank first (instant, shuffled, no repeat within an assessment) and only live-generates domains
  the bank can't cover. `generate-audit.js` prompt gained REALISM RULES (specific ordinary
  requests grounded in SOP visit types/queues, natural phone speech, plausible rushed-agent
  mistakes — not cartoonish ones, near-miss distractor turns, English only). Rule added to
  `firestore.rules` — deployed to `quarterly-knowledge-check` on 2026-07-03.
- **4 · MCQ best answer too obvious:** `generate-scenarios.js` prompt gained a DISTRACTOR QUALITY
  block — every wrong option must be a plausible near-miss failing on a specific SOP detail, all
  options the same length/tone (no longest-answer tell), at least one distractor more
  cautious-sounding than the best answer, two-plus options tempting without SOP knowledge.
  Existing weak questions still need regeneration + curation through the Question Bank.
- **5 · Navigators couldn't review answers / see history:** new `MyHistory.jsx` + "My history"
  navigator tab. Panel 1: attempt history from `resultHistory` (first navigator-facing read of
  it) — every snapshot for the active dept, newest first, per-domain level chips. Panel 2:
  answer-by-answer review of the latest MCQ from the stored `answers` on the result doc (same
  rendering as post-check Coaching; answers to since-retired questions are skipped with a note).
- **6 · Welcome page slow to appear:** code-split at both seams. `App.jsx` lazy-loads
  `SupervisorApp`/`NavigatorApp` via `React.lazy` + `Suspense`; `Start.jsx` imports
  `firebase.js`/`db.js` **dynamically** (roster fetch + PIN save) so the Firebase SDK leaves the
  entry chunk. Entry JS: **889 kB → 197 kB** (62 kB gzip); Firebase (684 kB) + each role app now
  load as separate lazy chunks. Railway cold-start remains a possible second cause (infra).
- **Verification:** `npm test` → **253 passing** (9 files; +3 audit-bank db tests);
  `npm run build` → clean, chunks split as above; `node --check` on the 3 edited api handlers.
- **Files:** new `src/components/{AuditBank,MyHistory}.jsx`; edited `api/{interview-turn,
  generate-audit,generate-scenarios}.js`, `src/components/{VoiceCall,Interview,SpotTheError,
  SupervisorApp,NavigatorApp,Nav,Start,App}.jsx`, `src/lib/{db,db.test,apiFetch}.js`,
  `firestore.rules`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete (code). Owner actions: deploy rules; generate + activate audit transcripts
  per domain in the new bank; add more Gemini keys; report what the colour-scheme feedback was.

### 2026-07-03 — F24 upgrade: PDF upload, fidelity audit, SOP tab redesign
- **Context:** Owner review of the first SOP manager: "bland and generic", questioned whether
  "Build with AI" can be trusted, and flagged the missing file-upload option. All three addressed
  in one pass (scope approved by owner).
- **PDF upload:** `/api/refine-sop` now accepts `file` (base64 PDF ≤10 MB) as the source for both
  modes, passed to Gemini **natively as a document part** — no text-extraction library, works on
  scanned PDFs. TXT/MD files are read client-side into the paste area; Word gets an
  "export as PDF" hint. `server.js` JSON limit 1mb → 20mb. New pure `validateSopFile`.
- **Fidelity audit (the trust answer):** every AI draft now gets a second Gemini pass (temp 0.1)
  comparing the draft against the source: `audit = { omissions[], inventions[] }`. Shown on the
  draft as a chip (✓ passed / ⚠ N findings) with amber/red detail panels; persisted on the draft
  doc (new `notes`/`changes`/`audit` fields in `saveSopDraft`) so the report survives reload.
  Best-effort — audit failure returns null and never blocks the draft. New pure `validateSopAudit`.
- **Redesign (`SopManager.jsx` + `.sops*`/`.sopdoc*`/`.sop-*` CSS rewritten):** drag-and-drop
  upload zone; active-version hero with pulsing LIVE badge + meta chips; SOP bodies rendered as a
  **parsed document** (ALL-CAPS headings → numbered styled sections, rules as marked rows) with
  collapse/fade instead of a grey `<pre>`; drafts/archived as a **version timeline** with status
  dots; spinner status line during AI runs; reduced-motion safe.
- **Verification:** `npm test` → **250 passing** (9 files; +12 for the new validators);
  `npm run build` → clean; **live smoke test**: posted the real in-repo `SOP Guide.pdf` (115 KB)
  through build mode → structured 6-domain SOP + 3 review notes + audit reporting **8 omissions /
  0 inventions** — the audit correctly caught provider-affiliation details the restructuring
  dropped, demonstrating exactly the trust layer the owner asked for.
- **Files affected:** `api/refine-sop.js`, `api/refine-sop.test.js`, `server.js`,
  `src/lib/db.js`, `src/components/SopManager.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 — Navigator self-created PINs
- **What changed:** Supervisors now add navigators by name only. A roster row with a blank `pin`
  prompts the navigator to create a 4-digit PIN at the Start gate after choosing their name; that
  PIN is saved back through `updateRosterEntry`. Existing PIN rows still use the old PIN check.
- **Why:** Navigators should be able to create their own passcodes instead of relying on a
  supervisor-assigned code.
- **Tests:** Added component coverage for first-login PIN creation and existing-PIN login, plus a
  `db.js` check that `addToRoster` can create blank-PIN rows.
- **Files affected:** `src/components/Start.jsx`, `src/components/Navigators.jsx`,
  `src/lib/db.js`, `src/components/components.test.jsx`, `src/lib/db.test.js`, `README.md`,
  `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 — Welcome page premium redesign
- **What changed:** Reworked the Start gate from generic explanatory copy to a premium first
  screen: product-name hero, concise readiness/capability language, stable summary chips, an
  animated lightweight capability-map preview, stronger role cards, and overflow-safe domain tiles.
- **Why:** The old opening line ("development and fit, not pass/fail") no longer matched how the
  check is being used, and made the page feel generic.
- **Follow-up 2026-07-02:** Removed the variable scenario-count chip, changed the eyebrow to
  "Knowledge & Adaptability", animated the map preview bars, and fixed long domain labels colliding
  with blurbs at tablet/mobile widths.
- **Verification:** `npm test` → **238 passing**; `npm run build` → clean (existing large-chunk
  warning only).
- **Files affected:** `src/components/Start.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 — Firebase deploy manifest for Firestore rules/indexes
- **What changed:** Added root `firebase.json` pointing Firestore deploys at `firestore.rules`
  and `firestore.indexes.json`.
- **Why:** The local rules already allow the new `sops` collection, but the live project still
  needs the pending C1 deploy. Without `firebase.json`, `firebase deploy --only
  firestore:rules,firestore:indexes` may not know which local files to publish from this repo.
- **Verification:** `firebase.cmd deploy --project quarterly-knowledge-check --only
  firestore:rules,firestore:indexes` completed successfully; `node scripts/reset-pilot-data.mjs
  --delete` then completed cleanly on retry (first pass hit a transient `resultHistory`
  permission-denied while rules propagated).
- **Status:** Complete. C1 is active in the live Firebase project.

### 2026-07-02 — F24: SOP Manager (adder / builder / refiner)
- **What changed:** Department SOPs moved from hardcoded strings to live, supervisor-managed,
  versioned Firestore data with AI-assisted authoring. See the F24 feature entry (§4) for the full
  design. Highlights:
  - New `sops` Firestore collection + `db.js` CRUD (`subscribeSops`, `saveSopDraft`, `updateSop`,
    `activateSop` — batch-archives the previous active version — `archiveSop`, `deleteSop`) +
    `firestore.rules` entry.
  - New `api/_sop-store.js`: the Express server now reads Firestore (first time ever) via the
    firebase web SDK with defensive init and a 60s sync cache, so `sopContextFor()` stays
    synchronous and zero AI-handler call sites changed. Resolution: live active SOP → hardcoded
    context → Pediatrics.
  - New `POST /api/refine-sop` (build = structure raw document into the 6-domain layout; refine =
    merge new material into the current SOP with typed change flags). `validateSopRefineResponse`
    exported pure; `server.js` JSON limit 100kb → 1mb.
  - New supervisor "SOPs" tab (`SopManager.jsx`): active/draft/archived versions, inline confirms,
    import panel (verbatim / Build with AI / Refine), proposal preview with change chips.
- **Verification:** `npm test` → **238 passing** (9 files; +10 refine-sop tests); `npm run build`
  → clean; `node --check` on all new/edited api files; **live smoke test** against a local server
  + real Gemini keys: 401/400 validation paths, build mode (structured a raw BH guide, flagged the
  thin intake section), refine mode (caught the psych-nurse → provider-direct contradiction,
  added the refill-continuity rule, preserved all untouched rules, left crisis routing alone).
- **Known gate:** resolved. The live project now has Anonymous auth enabled and current
  `firestore.rules` + `firestore.indexes.json` deployed (wired by root `firebase.json`).
- **Files affected:** new `api/{_sop-store,refine-sop,refine-sop.test}.js`,
  `src/components/SopManager.jsx`; edited `src/lib/db.js`, `api/_sop-context.js`, `server.js`,
  `firestore.rules`, `firebase.json`, `src/components/{SupervisorApp,Nav}.jsx`, `src/styles.css`,
  `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 — Domain redesign: 6 job-aligned Patient Navigator domains (+ pilot data reset)
- **Context:** The owner provided a comprehensive Patient Navigator role description (cross-
  department inbound call handlers: classify → route → schedule → protect scope/privacy →
  document; Peds/OB-GYN/BH/IM; Intermedia + eCW + Teams). The old 6 domains were pediatric-SOP-
  shaped ("Sites & Routing", "Provider Matching", "Insurance & Eligibility") and didn't match the
  job. Decisions taken with the owner: use 6 new domains (not the 7 capability areas verbatim —
  "adaptability under complexity" belongs to the competency axis), reset pilot data, domains
  before the SOP-manager feature.
- **New DOMAINS** (`src/data/questions.js`): `intake` — Call Opening & Identification (dept-
  adaptive lookup: parent-phone-first for Peds, DOB-first for adult depts, family accounts);
  `classification` — Call Classification (scheduling vs clinical question vs refill vs lab vs
  urgent vs wrong-department vs needs-approval); `routing` — Routing & Escalation (TE queues,
  dept sub-routing, soft transfers, urgent paths); `scheduling` — Scheduling & Appointment Rules;
  `boundaries` — Scope & Privacy (no advice/results/promises, caller authorization);
  `documentation` — Documentation & Follow-through (TE destination + fields, reason fields,
  entry conventions). Refills are deliberately NOT a domain — a refill call exercises
  classification + routing + documentation, so it appears as scenario content across domains.
- **Seed banks rewritten:** Pediatrics **21** questions (best old questions re-tagged/re-IDed,
  new ones authored for intake/classification/boundaries/documentation from the role doc — e.g.
  multi-child family calls, refill→PEDS Encounters queue with HIGH PRIORITY when out, no promised
  approvals, complete refill-TE fields). OB/GYN **16** questions (sanitized as before — role
  labels only) encoding the current floor routing table: pregnant/pregnancy-related → **OB
  Portal**, non-pregnant GYN visit issue → **PSS OB**, established MFM patient → **the MFM
  coordinator**; plus DOB-first lookup and third-party privacy scenarios. Total seed 32 → **37**.
- **`src/data/training.js`:** all 6 modules rewritten for the new domains (still flagged mockup).
- **`api/_sop-context.js`:** new exported `NAVIGATOR_ROLE_CONTEXT` (distilled from the role
  description, sanitized: OB names → role labels; BH psych-nurse routing treated as outdated per
  the doc — questions/refills go provider-direct). `sopContextFor(deptId)` now prepends it to the
  department SOP, so all 7 AI features ground in the real role model + current routing rules.
- **Pilot data reset** (owner-approved): new `scripts/reset-pilot-data.mjs` (web SDK +
  `.env.local`, dry-run by default, `--delete` to execute, per-collection permission tolerance).
  Deleted live `results` (5) and the old `questions` bank (23). `resultHistory`/`completions`/
  `pairings` were blocked by the then-deployed old rules (unauthenticated access denied) —
  *(resolved later the same day: after the C1 activation — see the "Firebase deploy manifest"
  entry above — the script was re-run and all collections cleared).* New bank auto-seeds from
  `ALL_SEED_QUESTIONS` on next app load. Old `interviews` docs keep old domain tags (render as
  raw ids — cosmetic; clear manually if desired).
- **Also:** `stress/quota-probe.mjs` domain list updated. Tests derive from `DOMAINS`
  dynamically, so no test-file changes were needed.
- **Files affected:** `src/data/{questions,questions-obgyn,training}.js`, `api/_sop-context.js`,
  `stress/quota-probe.mjs`, new `scripts/reset-pilot-data.mjs`, `CLAUDE.md`.
- **Verification:** `npm test` → **228 passing** (8 files); `npm run build` → clean (known
  large-bundle warning); `node --check api/_sop-context.js` → OK; reset script dry-run + delete
  executed against the live project.
- **Next (agreed with owner):** SOP manager (adder/builder/refiner) — Firestore `sops`
  collection + supervisor editor UI + AI refine endpoint + DB-backed `sopContextFor`.
- **Status:** Complete.

### 2026-07-01 — Pre-rollout hardening (C1/C4/H1/H2/M1/H3) + stress harness + load results
- **Context:** Readiness audit ahead of a ~20-navigator rollout flagged the privacy/role model as
  UI-only. This pass closes the top items and adds a repeatable stress harness that measures real
  Gemini-quota and concurrency ceilings.
- **C1 — Firebase Anonymous Auth + hardened rules:** `src/lib/firebase.js` now signs every visitor
  in with `signInAnonymously` and exports an `authReady` promise that **never rejects** (a failed
  sign-in logs and resolves `false` so the app keeps working under the current open rules).
  `src/lib/db.js` gates every read/write behind `authReady` (via aliased `fb*` primitives wrapped in
  auth-gated versions — zero call-site churn) and defers every `onSnapshot` behind `authReady` via a
  new `liveQuery()` helper. `firestore.rules` rewritten to require `request.auth != null` on all 9
  collections, with a documented SAFE DEPLOY ORDER (enable Anonymous auth → ship app code → THEN
  deploy rules). **Honest limit:** anonymous auth has no per-user identity, so this stops anonymous
  internet scraping but not a determined signed-in navigator — real Auth + role claims is still the
  next step. `db.test.js` updated (mock `authReady`; 5 subscription tests made async).
- **C4 — stop broadcasting all results to navigators:** new `getFloorScores()` returns a one-time,
  minimized `{ name, scores }` projection (drops peers' raw `answers`, competency detail,
  navigatorId). `NavigatorApp` uses it instead of the full-collection `subscribeResults` live stream.
  Residual (peers' scores still reach the client for mentor matching) noted for future server-side
  computation.
- **H1 — `firestore.indexes.json`** declaring the `resultHistory (navigatorId, department)`
  composite index `getResultHistory` requires (`firebase deploy --only firestore:indexes`).
- **H2 — visible save-failure + retry:** `NavigatorApp` surfaces a banner instead of swallowing
  `saveResult` failures; `persistResult`/`retrySave` wrap all three save sites (MCQ, Spot, mini-check).
- **M1 — in-progress check persistence:** `Check.jsx` takes a `persistKey`, restoring/saving answers
  + step to `sessionStorage` (survives refresh); cleared on submit/cancel; step clamped to the live
  bank. Wired for the main MCQ check only.
- **H3 — bounded Spot fan-out:** `SpotTheError` full-profile generation runs through a `runPooled`
  limiter (max 2 concurrent `/api/generate-audit`) instead of firing all 6 at once.
- **Stress harness (new `stress/` + `playwright.stress.config.js`):** `stress/quota-probe.mjs`,
  `stress/voice-ws-probe.mjs`, `stress/load.spec.js`. Scripts: `test:stress`, `stress:quota`,
  `stress:voice`. NOTE: Node `fetch`/`ws` must target `127.0.0.1` not `localhost` (undici picks IPv6
  `::1`; the server listens IPv4).
- **Measured ceilings (live keys, 2026-07-01):**
  - **Gemini generateContent rotation:** clean 100% up to **8 concurrent** heavy calls; first
    `429 "All Gemini keys are rate-limited"` at **12 concurrent**; majority-fail by 16–20 (each heavy
    call ~11–23s). ⇒ with H3 (~2 calls/navigator) ~**4 navigators** can start a full Spot at once;
    coaching (1/navigator) tolerates ~**8 simultaneous** MCQ finishes before falling back to
    rule-based. The MCQ check uses NO AI in its critical path, so it never breaks.
  - **Voice relay (`/api/live`):** 5/5 concurrent sessions reached `ready` with no server errors, but
    only 1/5 delivered caller audio in-window — the Gemini **Live preview** tier is the bottleneck,
    not the relay. ⇒ cap concurrent voice calls to a few, or leave off preview.
  - **20 concurrent navigators, full MCQ+coaching:** **20/20 completed end-to-end**, ~126s wall, no
    crashes; AI endpoints degraded gracefully (429/400 → fallback). Observed non-blocking console
    signal: `getInterviews: Missing or insufficient permissions` in the LIVE project — reinforces that
    Anonymous auth must be enabled and the new rules deployed together.
- **Gates:** `npm test` → **228 passing** (8 files); `npm run build` → clean.
- **Files:** `src/lib/{firebase,db,db.test}.js`, `firestore.rules`, new `firestore.indexes.json`,
  `src/components/{NavigatorApp,Check,SpotTheError}.jsx`, new `stress/*` +
  `playwright.stress.config.js`, `package.json`, `CLAUDE.md`.
- **Status:** Code complete + stress-validated. **Owner action to activate C1:** enable Anonymous
  auth in the Firebase console, confirm the deployed app still reads data, THEN
  `firebase deploy --only firestore:rules,firestore:indexes`. *(Completed 2026-07-02 — see the
  "Firebase deploy manifest" entry: Anonymous auth enabled, rules + indexes deployed, verified
  live.)*

### 2026-07-01 — Playwright end-to-end test harness added
- **What changed:** Added Playwright so browser flows can actually be verified locally (the app's
  Firebase/Gemini/Web-Audio paths were previously "not verifiable headlessly").
  - `@playwright/test` dev dependency + Chromium browser installed (browsers live in the user-level
    `ms-playwright` cache, not the repo).
  - `playwright.config.js` — `testDir: './e2e'`, headless Chromium, and a `webServer` that runs
    `npm run build && npm start` and waits on `/api/health` (so tests hit the real Express server +
    `/api` routes + `.env.local`, exactly like Railway). `reuseExistingServer: true`.
  - `e2e/smoke.spec.js` — Start gate renders + wrong supervisor passcode is rejected.
  - `e2e/supervisor.spec.js` — signs in with the public pilot passcode (`0200`) and confirms the
    management shell loads, exercising the **live Firebase subscriptions** end to end.
  - `e2e/navigator.spec.js` — signs in as a real test navigator (roster name + PIN), reaches the
    MCQ/Spot chooser, completes an MCQ end to end (→ coaching → dashboard), and — the headline
    coverage — **takes a full live-Gemini Spot the Error assessment, then an MCQ, and asserts both
    results coexist and the dashboard toggle switches between them**. This is the browser proof of the
    "MCQ + Spot coexist" feature.
  - `vite.config.js` — Vitest `include` pinned to `src/**` + `api/**` so it ignores `e2e/` (which
    uses `@playwright/test`, not Vitest). `npm run test:e2e` runs the Playwright suite.
  - `.gitignore` — Playwright artifacts (`test-results/`, `playwright-report/`, …).
- **Gates now:** `npm test` (228 Vitest unit) · `npm run test:e2e` (6 Playwright e2e) · `npm run build`.
- **Note:** the navigator specs write to live Firestore and the Spot journey calls live Gemini, so
  they need `.env.local` (Firebase + `GEMINI_API_KEYS`). The navigator credential is a pre-deploy
  test account; the supervisor passcode is the public pilot one. Swap both before any real rollout.
- **Files affected:** new `playwright.config.js`, `e2e/{smoke,supervisor,navigator}.spec.js`; edited
  `package.json`, `vite.config.js`, `.gitignore`, `CLAUDE.md`.
- **Verification:** `npm run test:e2e` → **6 passed** (incl. the live take-both-and-switch journey);
  `npm test` → **228 passed** (unchanged).
- **Status:** Complete.

### 2026-07-01 — MCQ + Spot the Error results coexist (take/switch either)
- **What changed:** A navigator can now hold **both** an MCQ result and a Spot the Error result per
  department, take the other type after finishing one, and switch which one their dashboard reflects
  — instead of the second overwriting the first (owner request: "keep both separately", entry point
  on the dashboard).
  - **Storage (`db.js`):** result docs are now keyed by assessment type — MCQ keeps the legacy
    `${navigatorId}__${department}` key (full back-compat); Spot the Error uses
    `${navigatorId}__${department}__spot`. New `resultDocId()` helper; `getResult` and `saveResult`
    take an `assessmentType` param (`'mcq'` default) and stamp `assessmentType` on the doc + history
    snapshot; `clearResult` now deletes both docs (+ the legacy plain-id doc for pediatrics).
  - **Navigator (`NavigatorApp.jsx`):** single `ownResult` state replaced by `resultsByType`
    `{ mcq, spot }` + `activeType`; `ownResult` is derived. `handleDeptSelect` loads both types and
    defaults the view to the most recent. New `AssessmentBar` on the dashboard: a **MCQ ⇄ Spot
    toggle** (when both exist) + a **"Take the other / Retake"** button → the chooser. `handleSubmit`
    writes `mcq`; `handleSpotComplete` writes `spot` in full mode and merges into the **active** type
    in training mode; the mini-check likewise re-saves the active type. The chooser badges which types
    are already completed.
  - **Supervisor (`SupervisorApp.jsx`):** `subscribeResults` now returns up to two docs per
    navigator+department, so results are **deduped to the most recent** per navigator+department
    before building the matrix / cross-dept strip — the matrix still shows one current row per person.
  - **Tests:** `db.test.js` `clearResult` cases updated for dual-doc deletion (228 passing).
- **Known limitation:** `resultHistory` now interleaves MCQ and Spot snapshots, so trend lines mix
  both assessment types (not filtered by type yet). Acceptable for the pilot.
- **Files affected:** `src/lib/{db,db.test}.js`, `src/components/{NavigatorApp,SupervisorApp}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` → **228 passing** (8 files); `npm run build` → clean. Browser
  click-through (take both, toggle, supervisor dedup) not run headlessly.
- **Status:** Complete.

### 2026-07-01 — Ponytail installed for Codex usage reduction (local only — NOT an app change)
- **What changed:** Installed `DietrichGebert/ponytail` for the repo owner's Codex environment to
  bias future agent work toward smaller, reused, stdlib/native-first changes. Because `git` is not
  available on this Windows PATH, the repo was downloaded as a GitHub zip to
  `~/.codex/marketplaces/ponytail-main`, registered as a local Codex marketplace, and installed as
  `ponytail@ponytail` version `4.8.4`.
  - **Mode:** `full` was initialized via Ponytail's activation hook, which emitted `PONYTAIL:FULL`
    and wrote the plugin data mode flag.
  - **Important:** This is user-level Codex tooling only. It changes how future agents choose
    implementations; it does not change the app, its runtime, or deploy output.
- **Files affected:** `CLAUDE.md` only.
- **Status:** Complete.

### 2026-07-01 — Assessment-type chooser: MCQ vs. full-profile Spot the Error
- **What changed:** Added a top-level choice of assessment. After a navigator picks a department,
  a new `typeselect` view (`AssessmentTypeChooser` in `NavigatorApp.jsx`) offers **Multiple choice**
  (the existing MCQ `check`) or **Spot the Error** (a new full-profile assessment, view `spotfull`).
  Both feed the capability matrix.
  - `SpotTheError.jsx` generalised to two modes via `domains` (array) + `mode` props:
    **`full`** = one item per domain across all 6 (backfills a failed-gen domain to 0 for a complete
    profile); **`domain`** = the existing `SPOT_ASSESSMENT_SIZE`-item single-domain training launch.
    Each item now carries its own `domainId` (shown as a tag); the review adds a per-domain breakdown
    in full mode. `onComplete` now hands back a `{ domainId: percent }` map + the mode.
  - `scoring.js` — new pure `scoreSpotTheErrorByDomain(graded)` (`[{domainId,correct}]` →
    `{domainId: percent}`); 2 tests added (`scoring.test.js`, 226 → 228).
  - `NavigatorApp.jsx` — `handleAuditComplete(domainId, score)` replaced by
    `handleSpotComplete(domainScores, mode)`: full → replace the whole profile and land on the
    dashboard; domain → merge just that domain and return to training. `handleDeptSelect`'s no-result
    branch now routes to `typeselect` (was `check`); the MCQ `check` cancel returns to `typeselect`;
    the dept switcher is hidden during `spotfull` (as it already was during `check`).
  - `styles.css` — per-domain breakdown rows on the results screen.
- **Design choices (with owner):** full-profile covers **all domains, 1 item each** (fast, coarse
  0/100 per domain); chooser sits **after** department selection.
- **Files affected:** `src/lib/{scoring,scoring.test}.js`, `src/components/{SpotTheError,NavigatorApp}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` → **228 passing** (8 files); `npm run build` → clean (known large
  main-bundle warning only). Browser click-through against live Gemini keys not run headlessly.
- **Status:** Complete.

### 2026-07-01 — F16 "Spot the Error" → scored, matrix-feeding assessment
- **What changed:** Converted "Spot the Error" from advisory-only training into a real, scored
  assessment whose result feeds the per-domain capability rating (owner request). Design decisions
  taken with the owner: **feed the domain score**, **multiple items** (`SPOT_ASSESSMENT_SIZE = 5`),
  **click-accuracy scoring only** (no AI grading).
  - `src/lib/scoring.js` — new pure `scoreSpotTheError(picks)` → share of items found correctly
    (0–100), on the same scale as the main check. 3 tests added (`scoring.test.js`, 223 → 226).
  - `src/data/config.js` — `SPOT_ASSESSMENT_SIZE = 5`.
  - `src/components/SpotTheError.jsx` — rewritten as an item-by-item assessment: `loading` (fires
    N `/api/generate-audit` calls in parallel via `Promise.allSettled`, keeps what succeeds) →
    `active` (one click per item, correct/wrong reveal + Next) → `review` (score + level badge +
    per-item breakdown) → `saving` → `done`. Removed the hint/shake, the reflection textarea, and
    the AI-coaching step (those were training affordances). No longer calls `saveCompletion`
    itself — the parent orchestrates the save.
  - `src/components/NavigatorApp.jsx` — `handleAuditComplete(domainId, score)` is now async and
    merge-saves the domain score into the result doc (overwrites only that domain, preserves
    competency scores + answers, appends a `resultHistory` trend point) and records a
    `kind:'practice'` completion — mirroring the mini-check merge pattern. Updates local `ownResult`/
    `allDeptResults` immediately so the dashboard/matrix reflect the new rating without a round-trip.
  - `src/styles.css` — assessment styles (progress pill, wrong-pick red reveal, per-item feedback,
    results scorecard with level-coloured score, per-item review list).
- **Not touched but now dead:** `api/coach-audit.js` + the `POST /api/coach-audit` route are no
  longer wired (reflection step removed). Left in place; flagged in F16 notes.
- **Files affected:** `src/lib/{scoring,scoring.test}.js`, `src/data/config.js`,
  `src/components/{SpotTheError,NavigatorApp}.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` → **226 passing** (8 test files); `npm run build` → clean (known
  large main-bundle warning only). Browser click-through of the assessment flow not run headlessly.
- **Status:** Complete.

### 2026-07-01 — Learning Loop: trim inline feedback chips to signal-only
- **What changed:** `FeedbackControls` (the inline chips on adaptive next steps, question
  improvement signals, flagged questions, and supervisor-visible interview grades) no longer renders
  **Approve** / **Reject**. It now shows only **Helpful / Inaccurate / Adjust**. Approve/Reject were
  ambiguous inline — they only logged a `supervisorFeedback` status string and did nothing
  actionable, yet visually implied they approved the recommendation. Those two actions belong solely
  to proposals in the Learning Loop **Human review queue**, where Approve actually creates a draft
  question and advances the proposal. `feedbackInsights` still treats `approved` as a positive status
  (tolerates any legacy docs); no scoring/feedback-math change.
- **Files affected:** `src/components/FeedbackControls.jsx`, `CLAUDE.md`.
- **Verification:** `npm test` → **223 passing** (8 test files); `npm run build` → clean.
- **Status:** Complete.

### 2026-07-01 — Learning Loop click feedback UX fix
- **What changed:** Feedback and proposal buttons in the Learning Loop now show visible state instead
  of failing silently. `FeedbackControls` displays `Saving...`, then `Saved`, or `Could not save`.
  `LearningLoop` and `QuestionBank` show queued/approved/rejected status messages and surface Firestore
  save errors so local misconfiguration or network issues are obvious.
- **Why:** In localhost testing, clicking Helpful/Inaccurate/Queue Proposal appeared to do nothing
  because the original implementation wrote to Firestore without any success or error affordance.
- **Files affected:** `src/components/{FeedbackControls,LearningLoop,QuestionBank}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` → **223 passing** (8 test files); `npm run build` → clean with the
  known large main-bundle warning.
- **Status:** Complete.

### 2026-07-01 — Learning Loop dead recomputation cleanup
- **What changed:** Removed an unused `computeQuestionHealth(questions, results)` call inside
  `buildLearningSignals()`. Question health is still computed by `buildQuestionImprovementSuggestions()`;
  this only removes redundant work from the Learning Loop render path.
- **Files affected:** `src/lib/scoring.js`, `CLAUDE.md`.
- **Verification:** `npm test` → **223 passing** (8 test files).
- **Status:** Complete.

### 2026-07-01 — Adaptive learning feedback loop (controlled intelligence layer)
- **What changed:** Added a controlled, human-reviewed learning loop that uses stored data to produce
  explainable recommendations and improvement proposals without silently changing production logic.
  - `src/lib/scoring.js`: new pure helpers `buildLearningSignals`, `buildQuestionImprovementSuggestions`,
    `adaptiveTrainingRecommendations`, and `feedbackInsights`. They analyze result history, current
    answers, question health, completions, interviews, and supervisor feedback, returning ranked
    evidence and reasons only.
  - `src/lib/db.js` + `firestore.rules`: added `supervisorFeedback` and `learningProposals`
    collections. Feedback records store target type/id, status, note/context, and timestamp.
    Proposals store type/title/target/payload/reasons/status and require supervisor review.
  - New UI: `LearningLoop.jsx` supervisor tab plus `FeedbackControls.jsx`. Supervisors can review
    adaptive next steps, queue training/question proposals, mark advisory output helpful/inaccurate/
    needs-adjustment/approved/rejected, and approve or reject pending proposals.
  - Question improvement loop: flagged question-health signals can be queued as revision proposals;
    approving a question proposal creates a draft question only (`source: 'learning-loop'`), preserving
    the existing activation gate.
  - AI prompt improvement: `generate-coaching` and `sequence-path` accept optional learning evidence
    (prior results, completions, interviews, feedback summaries) so advisory coaching/path rationales
    can become more specific over time.
- **Files affected:** `src/lib/{scoring,scoring.test,db,db.test}.js`, `firestore.rules`,
  `api/{generate-coaching,sequence-path}.js`, `src/components/{LearningLoop,FeedbackControls,
  SupervisorApp,Nav,QuestionBank,NavigatorDetail,Coaching,MyTraining}.jsx`, `src/styles.css`,
  `CLAUDE.md`.
- **Verification:** `npm test` → **223 passing** (8 test files); `node --check` on
  `api/generate-coaching.js` and `api/sequence-path.js`; `npm run build` → clean with the known
  large main-bundle warning.
- **Status:** Complete.

### 2026-07-01 — Doc consistency fix (stale department references)
- **What changed:** Corrected two stale lines in this CLAUDE.md and de-duplicated the global file.
  - §14 "Common pitfalls" said *"the live check only assesses Pediatrics (`ASSESSED_DEPT`)"* — now
    correctly states **Pediatrics and OB/GYN** are assessed (`ASSESSED_DEPTS` / `isAssessed(id)`),
    consistent with F10 and §8.
  - §9 data-modules list undersold `src/data/departments.js` (`DEPARTMENTS`, `ASSESSED_DEPT`) — now
    lists the real exports (`ASSESSED_DEPTS`, `DEFAULT_DEPT`, `isAssessed`, `departmentName`, with
    `ASSESSED_DEPT` as a back-compat alias), verified against the source.
  - The user-global `C:\Users\t.1223\CLAUDE.md` held a full stale copy of this project's knowledge
    base (2026-06-24: "Quarterly Knowledge Check", GitHub Pages, Pediatrics-only, 38 tests, Firebase
    "in design"), which injected contradictory context every session. Replaced with a short pointer
    to this authoritative file.
- **Files affected:** `CLAUDE.md` (§9, §14, this entry); `C:\Users\t.1223\CLAUDE.md` (global — now a pointer).
- **Verification:** exports confirmed via grep of `src/data/departments.js`; docs-only change (no code touched).
- **Status:** Complete.

### 2026-06-30 — Local Codespace migration bundle guide
- **What changed:** Added a local migration guide and bundle script for moving the full Codespace
  state to a local machine before Codespace quota expires. The guide explicitly calls out the
  important ignored/local files that are not recoverable from GitHub alone: `.env.local`,
  `roo-code-settings.json`, `OB GYN SOP.pdf`, `Pediatrics_SOP_Updated.pdf`, in-repo `.claude/`, and
  user-level `/home/codespace/.claude` + `/home/codespace/.codex` state. The script writes private
  timestamped tarballs under `migration-bundles/`, includes `.git` and ignored local files, excludes
  regenerable `node_modules`, emits a manifest plus SHA-256 checksums, and ignores bundle output in
  `.gitignore` so private archives are not committed by accident.
- **Files affected:** new `LOCAL_MIGRATION.md`, new `scripts/create-migration-bundles.sh`,
  `.gitignore`, `CLAUDE.md`.
- **Verification:** `bash -n scripts/create-migration-bundles.sh`.
- **Status:** Complete.

### 2026-06-30 — Live voice call freshness pass: opener, department, transcript quality
- **What changed:** The real-time voice call now carries the generated `openingLine` from
  `/api/interview-turn` into the `/api/live` WebSocket start payload, and the relay includes it in
  the Gemini Live system instruction. `buildSystemInstruction()` is now department-aware, so OB/GYN
  voice calls no longer inherit the old pediatric-hardcoded caller context. `VoiceCall.jsx` also
  normalizes streaming transcription fragments before showing captions or saving/grading the call,
  avoiding glued-together words from raw Live API transcript chunks.
- **Why:** The call could feel stale because the init endpoint generated a fresh opener that the
  Live session ignored, forcing Gemini to invent a second opener from colder context. Department
  hardcoding also made non-pediatric calls feel less current. Cleaner transcript assembly improves
  both live captions and the transcript sent to grading.
- **Files affected:** `api/interview-turn.js`, `api/live-relay.js`, `src/components/VoiceCall.jsx`,
  `api/api-handlers.test.js`, `CLAUDE.md`.
- **Verification:** `node --check api/interview-turn.js`; `node --check api/live-relay.js`;
  `npm test` → **210 passing** (8 test files). Browser mic/playback still needs Chrome/Edge
  confirmation because Web Audio capture is not verifiable in the headless codespace.
- **Status:** Complete.

### 2026-06-30 — Add Codex bootstrap file for new-chat context
- **What changed:** Added a tracked root `AGENTS.md` that tells new Codex sessions to read
  `CLAUDE.md` first, treat it as the project source of truth, inspect relevant live files before
  editing, preserve the main architecture boundaries, and update `CLAUDE.md` with any project
  change. Removed `AGENTS.md` from `.gitignore` so this bootstrap travels with the repo instead of
  being a fragile local-only file.
- **Why:** New chats do not automatically inherit conversation memory. A Codex-native bootstrap
  file gives each fresh session a reliable first instruction without duplicating the full project
  knowledge base.
- **Files affected:** `AGENTS.md`, `.gitignore`, `CLAUDE.md`.
- **Verification:** Docs/bootstrap-only change; no runtime tests needed.
- **Status:** Complete.

### 2026-06-30 — Fix: dev-path/action-center contract bugs + stale README claims
- **What changed:** Fixed several follow-on issues discovered during a full repo orientation pass:
  - `api/sequence-path.js` had its `validateSecret` guard inverted, so valid "Personalize my path"
    calls returned before responding. The handler now matches the other Gemini endpoints.
  - Adaptive paths now treat `interview` as a supported AI-sequenced step kind end to end:
    `validateSequenceResponse`, the Gemini prompt, `MyTraining.jsx` labels/actions, and navigator
    evidence loading all know about practice-call steps.
  - Mini-check completions no longer count as Spot-the-Error practice completions. Passed
    mini-check result saves preserve/merge existing answer and competency context instead of
    replacing competency scores with a 4-question subset.
  - `buildActionCenter` now returns the fields its UI renders (`score`, `interviewId`,
    `canTeachCount`) and only treats practice completions as clearing required practice training.
  - `NavigatorDetail` now passes real completion records into `trainingImpact` and `buildDossier`.
  - Replaced undefined `var(--border)` CSS references with the existing `--line` token.
  - Updated `README.md` to reflect Railway + Express API, current AI endpoints, and Pediatrics +
    OB/GYN live-check scope instead of the older Vercel/Pediatrics-only description.
- **Files affected:** `api/sequence-path.js`, `api/sequence-path.test.js`, `api/_auth.js`,
  `src/lib/{scoring,scoring.test}.js`, `src/components/{ActionCenter,MyTraining,NavigatorApp,NavigatorDetail,SupervisorApp}.jsx`,
  `src/styles.css`, `README.md`, `CLAUDE.md`.
- **Verification:** `npm test` → **208 passing** (8 test files); `npm run build` → clean with the
  known large main-bundle warning (~891 kB minified JS).
- **Status:** Complete.

### 2026-06-30 — Fix: voice call dropped on first mic frame (deprecated `mediaChunks` format)
- **What changed:** With audio finally flowing (after the suspended-AudioContext fix), the Gemini
  Live session closed the instant the first mic frame arrived: `code 1007 — realtime_input.
  media_chunks is deprecated. Use audio, video, or text instead.` The relay was forwarding mic
  audio as `realtimeInput: { mediaChunks: [{mimeType, data}] }`, which newer Live models
  (`gemini-3.1-flash-live-preview`) reject. Changed to the current single-Blob form
  `realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data } }` in `api/live-relay.js`.
  This also explains the earlier "no caller audio": the session died right after `ready`, before
  the opening line could stream back.
- **How it was found:** added server-side `[live-relay]` logs + an on-screen "caller audio chunks"
  counter and live captions in `VoiceCall.jsx`; the relay log showed the exact 1007 close reason.
  (Also surfaced an operational gotcha: a stale `npm start` left port 3000 bound, so later
  `npm start`s hit `EADDRINUSE` and the browser kept hitting old code — kill with `pkill -f server.js`.)
- **Verification:** new headless test (`relay-audio-test.mjs`, PORT 3100) sends mic frames through
  the relay after `ready` — session now **survives** and streams **182KB** of caller audio +
  transcript back (previously closed 1007 with 0 audio). `npm test` → 206; `node --check` OK.
- **Files affected:** `api/live-relay.js` (format fix), `src/components/VoiceCall.jsx` (live
  captions), `src/styles.css`. **Owner confirmed working in Chrome** (full call: heard the caller,
  spoke back, saw captions). The temporary diagnostics (on-screen chunk counter, per-frame
  console logs) were removed in the same pass — kept the lifecycle/error logs in `live-relay.js`
  (connect/disconnect/upstream-closed) since those are useful ops signal in Railway logs, and kept
  live captions in `VoiceCall.jsx` as real UX, not just a diagnostic.
- **Status:** Complete. Real-time voice practice call works end to end.

### 2026-06-30 — Fix: voice call connected but mic/audio were silent (suspended AudioContext)
- **What changed:** After the previous env-loading fix, the voice call reached the active screen
  but produced no audio either direction — mic didn't engage, no caller audio played. Root cause:
  `VoiceCall.jsx` created both `AudioContext`s (`inCtx`/`outCtx`) **after** awaiting a network
  round-trip (scenario generation) and the mic permission prompt. By that point Chrome's autoplay
  policy had very likely started both contexts in `'suspended'` state — and a suspended context
  renders **no** audio at all: `ScriptProcessorNode.onaudioprocess` never fires (mic never sends),
  and scheduled `AudioBufferSource`s for caller playback just sit queued (silence). Neither
  direction logs an error; it just does nothing, which matches exactly what was reported.
- **Fix:** explicit `await Promise.all([inCtx.resume(), outCtx.resume()])` immediately after
  creating the contexts in `startCall()`. `resume()` still succeeds here because it's running
  inside the same gesture chain as the "Start voice call" click (promise/async chains without a
  `setTimeout` don't break Chrome's transient-activation window for `resume()`, even though the
  *initial* suspended-or-not state was already decided unfavorably). Added a guard: if either
  context still isn't `'running'` after resume, show "Audio is blocked by the browser — click
  again" and return to setup, rather than silently failing a second time.
- **Files affected:** `src/components/VoiceCall.jsx`.
- **Verification:** `npm test` → 206 passing; `npm run build` → clean. **Not browser-verified** —
  audio-context suspend/resume behavior can't be exercised in the headless codespace; needs an
  owner test in Chrome/Edge to confirm mic + playback now work.
- **Status:** Complete (code); awaiting browser confirmation.

### 2026-06-30 — F22: Real-time voice practice call (Gemini Live API) — replaced the TTS first attempt
- **Context:** An earlier attempt this session bolted one-shot Gemini TTS (`/api/speak`) + browser
  Web-Speech STT onto the chat `Interview.jsx`. It felt glitchy (auto-send on pauses, caller text
  appearing before its audio, no call rhythm). Owner flagged that chat + voice in one UI was the
  wrong call. That attempt was **fully reverted** (`git checkout` of `Interview.jsx`/`server.js`;
  `api/speak.js` + `src/lib/pcmAudio.js` + its test deleted) and rebuilt on the Live API.
- **What changed:** New real-time voice call as its own screen, with a chooser separating it from
  the text chat.
  - **`api/live-relay.js` (new):** `ws` `WebSocketServer` at `/api/live`, attached to the Express
    http server via `attachLiveRelay(server)` in `server.js`. Relays browser ⇄ Gemini Live
    (`BidiGenerateContent` WSS) so the key stays server-side. Builds the patient persona with
    `buildSystemInstruction()` (reused from `interview-turn.js`), validates the secret with the new
    `isValidSecret()` helper in `_auth.js`, model
    `gemini-3.1-flash-live-preview`, with input+output transcription enabled.
    Small JSON protocol (`start`/`audio`/`ready`/`transcript`/`interrupted`/`turnComplete`/`error`).
  - **`src/components/VoiceCall.jsx` (new):** mic capture (`getUserMedia` → `ScriptProcessorNode`
    → downsample 16kHz PCM16 → relay), gapless 24kHz playback via scheduled `AudioBufferSource`s,
    barge-in flush on `interrupted`, speaking/listening orb, end → `saveInterview` →
    `/api/grade-interview` → same reviewed screen as the chat call.
  - **`src/components/NavigatorApp.jsx`:** `PracticeChooser` (voice vs chat) + `practiceMode` state
    routing the Practice tab to `<VoiceCall>` or `<Interview>`; resets on leaving the tab via a
    `useEffect` placed **with the other hooks above the early returns** (a first cut put it after
    the `deptselect`/`loading` early returns, which violated the Rules of Hooks — clicking a
    department changed the hook count between renders and blanked the page; fixed by hoisting it).
  - **`src/styles.css`:** `.practice-choice*` cards + `.voicecall*` orb/pulse (reduced-motion safe).
  - **`package.json`:** `ws` added.
  - **Local-dev env fix (`load-env.js`):** `node server.js` never loaded `.env.local` (only Vite
    did, for build-time `VITE_*`), so a plain local `npm start` ran with **no `GEMINI_API_KEYS`** →
    every `/api/*` AI call 500'd "not configured" → the voice/chat call showed "Could not set up
    the call scenario." New `load-env.js` (imported first by `server.js`) calls native
    `process.loadEnvFile('.env.local')` when present — no-op on Railway (vars injected, file
    absent) and on Node < 20.12 (guarded). Reminder: `/api` (incl. the `/api/live` WS) only runs
    under `npm start`/Railway — **not** `npm run dev` (Vite, no proxy configured).
- **Model note:** initially built on `gemini-2.5-flash-native-audio-preview-09-2025`, then
  switched to **`gemini-3.1-flash-live-preview`** (gemini-3 Live) after a `listModels` check showed
  it available + a setup handshake confirmed it. `gemini-3.5-flash` was raised as a candidate but
  it's text-only (no `bidiGenerateContent`) so it can't drive the voice call; it was also 503-ing
  ("high demand") on the free tier at the time, a reason the REST `MODEL` stayed on `gemini-2.5-flash`.
- **Verification:** `npm test` → **206 passing** (8 test files — back to pre-attempt count after
  removing `pcmAudio.test.js`); `npm run build` → clean; `node --check api/live-relay.js`,
  `server.js` → OK. **Live API verified before and after building:** (1) `listModels` — enumerated
  the `bidiGenerateContent` models on the key; (2) full-turn probe — setup → text prompt → 163KB
  audio + output transcript; (3) **relay round-trip** on the final gemini-3 Live model — node
  client → our `/api/live` relay → Gemini → `ready` + 250KB caller audio + transcript, key never
  leaving the server. In-browser mic capture/playback is **not** verifiable in the headless
  codespace and must be tested in Chrome/Edge.
- **Status:** Complete. Server relay live-verified; **owner confirmed working end-to-end in
  Chrome** (mic, caller voice, captions) after two follow-on fixes — see the two 2026-06-30
  history entries above this one (suspended `AudioContext` + deprecated `realtimeInput.mediaChunks`
  format).

### 2026-06-30 — Fix: "Personalize my path" button did nothing (instant-abort bug)
- **What changed:** `MyTraining.jsx` called `apiFetch('/api/sequence-path', {...})` with no
  `timeoutMs` argument. `apiFetch` did `setTimeout(() => controller.abort(), undefined)`, and a
  `setTimeout` with an `undefined` delay fires on the next tick (treated as 0 ms) — so the
  `AbortController` aborted the fetch before it could complete. The `AbortError` was swallowed by
  the silent `catch` in `handlePersonalize`, so the button just reset and nothing visible happened.
  Two fixes: (1) pass a 25 s timeout at the call site (matches the other Gemini-backed callers);
  (2) root-cause guard — `apiFetch`'s `timeoutMs` now defaults to `30_000`, so any future caller
  that omits it gets a sane timeout instead of an instant abort.
- **Files affected:** `src/components/MyTraining.jsx`, `src/lib/apiFetch.js`, `CLAUDE.md`.
- **Verification:** `npm run build` → clean.
- **Status:** Complete.

### 2026-06-30 — Added ARCHITECTURE.md (maintenance/panic guide — docs only)
- **What changed:** New top-level `ARCHITECTURE.md` written for the "something is down in 6 months
  and I need to know where to look" moment. Plain-language, non-exhaustive, aimed at a non-expert
  maintainer. Sections: (1) what the app does, (2) the stack, (3) 3 end-to-end data flows
  (take-the-check, supervisor dashboard, AI feature), (4) **the seams** — the 5 connection points
  that actually break (browser→Firestore, browser→Railway `/api`, server→Gemini, Railway hosting,
  the fake PIN/passcode auth boundary), each with "what failure looks like" + "what to check first",
  (5) a load-bearing-vs-peripheral file map, (6) a literal down-the-checklist debug + rollback guide,
  (7) an honest "risky smells" list (fake auth + open Firestore rules, browser-talks-to-DB-directly,
  SOP PDFs, 21-feature scope creep, no CI). Read-only documentation pass — **no `src/`, `api/`,
  config, or build file was touched.**
- **Files affected:** new `ARCHITECTURE.md`; `CLAUDE.md` (this entry).
- **Verification:** N/A (docs only; grounded in a direct read of `server.js`, `src/lib/{db,firebase,
  apiFetch,session}.js`, `src/data/config.js`, `api/_gemini-client.js`, `api/_auth.js`,
  `api/generate-coaching.js`, `src/components/{Start,App}.jsx`, `firestore.rules`, and the role-app
  subscription wiring — not assumptions).
- **Status:** Complete.

### 2026-06-30 — Drop the branch/PR ceremony (main-first workflow)
- **What changed:** Removed the feature-branch enforcement from the in-repo SAW harness. This is a
  solo project with no CI and Railway auto-deploy on push to `main`, so the branch → PR → self-merge
  loop was pure ceremony — every PR was reviewed by no one and merged seconds later. Work now commits
  straight to `main`.
  - `.claude/settings.json` — removed three hooks: the "you're on main" UserPromptSubmit warning, the
    "block push to main" PreToolUse blocker, and the "/pre-pr before gh pr create" reminder. **Kept**
    the commit-format reminder and the block-push-with-uncommitted-changes guard (cheap insurance,
    not branch ceremony).
  - `CLAUDE.md` §14 — harness bullet rewritten to describe the main-first flow; the `/start-work`,
    `/pre-pr`, `/end-work` slash commands still exist but are optional (they don't fire on their own).
    §14 "Required workflows" already described committing + pushing to `main` directly, so it's now
    consistent rather than contradicted by the hooks.
- **Rationale:** A branch only earns its keep when something gates the merge (a reviewer or CI). With
  neither, branches added 4 steps around a 1-step push. If `npm test` ever runs as a GitHub Actions
  check on PRs, revisit — at that point the PR gate becomes worth the ceremony.
- **Files affected:** `.claude/settings.json`, `CLAUDE.md`.
- **Status:** Complete.

### 2026-06-29 — F17–F21: Longitudinal trends, dossier, action center, adaptive dev paths, mentor matching
- **What changed:** Five new capability-platform features turning Knowledge Check into the standing
  quarterly instrument described in the vision. All builds are complete; no mockup stubs.
  - **F17 — Longitudinal trends:** new `resultHistory` Firestore collection (append-only snapshot
    on every `saveResult`); `buildTrend`, `trainingImpact`, `teamTrend` pure functions; `Sparkline.jsx`
    (inline SVG, no dep); trend panel in `NavigatorDetail` (per-domain sparklines + delta badges,
    lazy-fetched on mount); team-trend widget in `Overview` (floor solidPlusRate + avgReadiness);
    `subscribeResultHistory` live subscription wired into `SupervisorApp`.
  - **F18 — Evidence dossier:** `buildDossier` maps each answered question to its competency,
    recording what was chosen vs best answer + rationale; competency cards in `NavigatorDetail` are
    now expandable; `answers` + `questions` threaded from both role apps.
  - **F19 — Action center:** `buildActionCenter` produces 5 category arrays (critical gaps, training
    overdue, declining trends, failed practice, ready-for-more); new `ActionCenter.jsx` supervisor
    tab + `subscribeInterviews` live subscription in `SupervisorApp`.
  - **F20 — Adaptive dev paths:** `buildDevPath` computes 5-step paths per weak domain (coaching →
    practice → module → mini-check) with done/next/todo status; `MyTraining.jsx` rewritten as a
    path stepper with "Personalize my path" button that calls the new `api/sequence-path.js` Gemini
    endpoint (temp 0.3, structured JSON, `validateSequenceResponse` tested); mini-check mode in
    `Check.jsx` via `miniDomain` + `limit` props (domain-filtered, saves completion + history point
    on pass); `minicheck` view wired in `NavigatorApp`.
  - **F21 — Mentor matching:** `buildMentorMatches` load-balances Learning/Solid mentees to
    least-loaded Can-Teach mentors (capped at `MENTOR_MAX_LOAD = 3`); `pairingOutcomes` enriches
    saved pairings with score delta; `pairings` Firestore collection + `savePairing` /
    `subscribePairings` / `updatePairingStatus`; new `Mentorship.jsx` supervisor tab.
  - **Foundation (Phase 0):** `resultHistory` + `pairings` Firestore rules added; `MENTOR_MAX_LOAD`,
    `MINICHECK_SIZE`, `MINICHECK_PASS`, `TREND_SYNTH_POINTS` added to `config.js`.
  - **Tests:** 197 → **206** (8 test files); added `sequence-path.test.js` (9 tests for
    `validateSequenceResponse`); 9 new `buildTrend`/`trainingImpact`/`teamTrend` tests; 5 dossier
    tests; 8 action-center tests; 6 dev-path tests; 5 mentor-match tests; 3 pairing-outcomes tests.
- **Files affected:** new `src/components/{Sparkline,ActionCenter,Mentorship}.jsx`,
  `api/sequence-path.js`, `api/sequence-path.test.js`; edited `src/lib/{scoring,scoring.test,db}.js`,
  `src/data/config.js`, `src/components/{NavigatorDetail,Overview,MyTraining,Check,NavigatorApp,SupervisorApp,Nav}.jsx`,
  `src/styles.css`, `firestore.rules`, `server.js`.
- **Verification:** `npm test` → **206 passing** (8 test files); `npm run build` → clean;
  `node --check api/sequence-path.js` → OK.
- **Status:** Complete.

### 2026-06-29 — Practice call: remove the domain picker (choice-friction cleanup)
- **What changed:** The Practice call (`Interview.jsx`) setup screen used to make the navigator pick
  one of 6 domains before starting. Removed the picker — the setup screen is now just a one-line
  description + "Start practice call". `startInterview` picks a random domain client-side purely to
  anchor the AI scenario (the API still requires a valid `domainId`; practice scores are advisory and
  never feed the matrix, so the specific domain is cosmetic). First of a planned set of
  choice-friction cleanups requested by the owner.
- **Scope note:** "Spot the Error" was intentionally left alone — its domain comes from the
  navigator's training plan context (a "Practice scenario" button per assigned weak domain), which is
  meaningful, not a free picker.
- **Files affected:** `src/components/Interview.jsx`, `CLAUDE.md`.
- **Verification:** `npm run build` → clean.
- **Status:** Complete.

### 2026-06-29 — Fix: navigator duplicated in supervisor cross-department strip
- **What changed:** The "Strength by department" strip (`departmentMatrix`) in the supervisor
  Overview listed a navigator who took two departments as **two separate rows** (one per result
  doc). Root cause: `SupervisorApp` mapped *each* `activeResults` doc into its own `departmentMatrix`
  sample, and a navigator with two dept checks has two result docs (composite keys
  `${navigatorId}__pediatrics` and `${navigatorId}__obgyn`). Fixed by grouping `activeResults` by
  `navigatorId` and merging each navigator's dept scores into a single sample before calling
  `departmentMatrix` — so one navigator = one row with all their department columns populated.
- **Scope note:** The main capability Matrix (`deptRows`/`buildMatrixRows`) was already correct —
  it filters to one department, so it never double-listed. Only the cross-department strip was affected.
- **Files affected:** `src/components/SupervisorApp.jsx`.
- **Verification:** `npm test` → 158 passing; `npm run build` → clean.
- **Status:** Complete.

### 2026-06-23 — Initial prototype build
- **What changed:** Scaffolded Vite+React app; data layer (`config`, `questions`, `navigators`);
  `scoring.js`; components Start/Check/Results/Matrix/Nav; full stylesheet; README.
- **Files affected:** entire initial `src/` tree, `package.json`, `vite.config.js`, `index.html`.
- **Reason:** Deliver the lean prototype from the brief.
- **Result:** End-to-end flow working; 6 domains / 20 questions; matrix + read-offs. (commit `2f72cf1`)

### 2026-06-23 — Analytics dashboards
- **What changed:** Added Team Overview, Navigators list, per-navigator dashboard; `floorStats`,
  `domainDistribution`, `mentorSuggestions`; clickable matrix rows; nav tabs.
- **Files affected:** `App.jsx`, `Nav.jsx`, new `Overview.jsx`/`Navigators.jsx`/`NavigatorDetail.jsx`,
  `scoring.js`, `styles.css`. *(Folded into subsequent commits.)*
- **Reason:** Make it useful to management beyond a raw matrix.
- **Result:** Floor + individual analytics; mentor suggestions.

### 2026-06-23 — Auto-assign training
- **What changed:** `training.js` catalog, `TRAINING_RULES`, training logic, Training tab,
  per-navigator "Assigned training".
- **Files affected:** `data/training.js`, `data/config.js`, `lib/scoring.js`, `components/Training.jsx`,
  `NavigatorDetail.jsx`, `Nav.jsx`, `App.jsx`, `styles.css`.
- **Reason:** Turn weak points into assigned action.
- **Result:** Required/Stretch assignments by weak point.

### 2026-06-23 — Previewable mockup training modules
- **What changed:** Added lesson content + key takeaways to each module; module preview screen;
  Preview buttons; "assigned because <domain> is at <level>" reasons.
- **Files affected:** `data/training.js`, new `components/TrainingModule.jsx`, `Training.jsx`,
  `NavigatorDetail.jsx`, `App.jsx`, `styles.css`. (commit `2041a08`)
- **Reason:** Make training previewable for the demo.
- **Result:** Clickable, previewable modules with cohorts.

### 2026-06-23 — Traffic-light level colors
- **What changed:** Recolored `LEVELS` to red/amber/green.
- **Files affected:** `data/config.js`. (commit `3d4e5d0`)
- **Reason:** Urgency encoding requested by user.
- **Result:** Consistent traffic-light coloring app-wide.

### 2026-06-23 — Department dimension
- **What changed:** Added `departments.js`; restructured `navigators.js` to per-department scores;
  `deptSamples`/`departmentOverall`/`departmentMatrix`; `DeptBar`; cross-department grid in
  Overview; per-department strip in NavigatorDetail.
- **Files affected:** new `data/departments.js`, `data/navigators.js`, `lib/scoring.js`, new
  `components/DeptBar.jsx`, `App.jsx`, `Overview.jsx`, `Matrix.jsx`, `Navigators.jsx`,
  `Training.jsx`, `NavigatorDetail.jsx`, `styles.css`. (commit `13fa39b`)
- **Reason:** Measure strength across departments.
- **Result:** Department-scoped app; Pediatrics live, 3 mockup departments.

### 2026-06-23 — Deployment to GitHub Pages
- **What changed:** Set Vite `base` for builds; published `dist/` to `gh-pages`.
- **Files affected:** `vite.config.js`; `gh-pages` branch.
- **Reason:** Stable public showcase URL.
- **Result:** Live at https://travis-holt.github.io/QuarterKnolwdge/.

### 2026-06-23 — Added this CLAUDE.md knowledge base
- **What changed:** Created the comprehensive project knowledge base.
- **Files affected:** `CLAUDE.md`.
- **Reason:** Permanent project memory + onboarding doc.
- **Result:** Single source of truth established (this file).

### 2026-06-23 — First automated tests (scoring.js)
- **What changed:** Added Vitest as the test runner and a unit-test suite covering all 18 exports
  of `lib/scoring.js` (scoring, level mapping, matrix build, read-offs, department views, training
  assignment, mentor suggestions). Added `test`/`test:watch` npm scripts. Fixtures are built from
  the real data modules and level boundaries are asserted relative to `THRESHOLDS`, so the tests
  survive future tuning of the config "knobs".
- **Files affected:** new `src/lib/scoring.test.js`, `package.json` (scripts + `vitest` devDep).
- **Reason:** Pay down the top technical-debt item — the pure logic was highly testable and had
  zero coverage.
- **Result:** 38 tests passing (`npm test`); production build unaffected (test file is excluded
  from the app bundle).

> **Note on dates:** all work above was completed in a single session dated **2026-06-23**.
> Git commit short-SHAs are referenced where a discrete commit exists; some incremental work was
> folded into later commits.

### 2026-06-24 — Post-review robustness fixes (subscription errors + duplicate names)
- **What changed:** Two issues found in a systematic code review were fixed.
  1. **Silent Firestore subscription errors (moderate):** `subscribeRoster` and `subscribeResults`
     in `db.js` now accept an optional `onError` callback (defaulting to `console.error`).
     `SupervisorApp.jsx` passes a shared handler that sets `subscribeError` state and renders a
     red banner: *"Lost connection to the database — data may be stale."* `NavigatorApp.jsx` logs
     the error (mentor suggestions silently stop updating — non-critical for the pilot).
  2. **Duplicate navigator names (minor):** `AddNavigatorForm` in `Navigators.jsx` now receives
     the live `roster` prop and performs a case-insensitive name-equality check before calling
     `addToRoster`. Shows *"A navigator with that name already exists."* inline.
- **Files affected:** `src/lib/db.js`, `src/components/SupervisorApp.jsx`,
  `src/components/NavigatorApp.jsx`, `src/components/Navigators.jsx`, `src/styles.css`
  (`.subscribe-error` banner style added).
- **Verification:** `npm test` → 38 passing; `npm run build` → clean.

### 2026-06-24 — Firebase pilot design complete; implementation plan written
- **What happened:** Full design session completed. Spec and implementation plan written,
  reviewed, and committed.
- **Key decisions locked:**
  - **Persistence:** Firebase/Firestore (free Spark tier). Two collections: `roster` + `results`,
    both UUID-keyed (never name-keyed — no typo/collision risk).
  - **Identity:** Navigator selects name from supervisor-managed roster dropdown + creates a
    4-digit PIN if none exists yet (otherwise enters the existing PIN). Supervisor enters hardcoded
    passcode from `config.js`.
  - **Role split:** `navigator` (own dashboard: per-domain breakdown, strengths/gaps, mentor
    suggestions, assigned training) and `supervisor` (full matrix/overview/training, live via
    `onSnapshot`).
  - **Session:** `src/lib/session.js` owns all localStorage state; exposes `{ role, name,
    navigatorId }` contract; swappable for real auth with no downstream changes.
  - **Sample data:** `SAMPLE_NAVIGATORS` removed. Matrix starts empty; fills with real submissions.
  - **Roster management:** Supervisor adds navigators by name in the Navigators tab; each
    navigator creates their PIN at first sign-in. Roster shows all members including "Not yet taken"
    state.
- **Design doc:** `docs/superpowers/specs/2026-06-24-firebase-pilot-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-06-24-firebase-pilot-plan.md`
- **Status:** Design complete. (Implementation followed — see next entry.)

### 2026-06-24 — Firebase pilot IMPLEMENTED (all code, awaiting Firebase config)
- **What changed:** Built the entire Firebase pilot end to end (Phases 1–9 of the plan). The app is
  now a role-based multi-user webapp backed by Firestore.
  - **New libs:** `src/lib/firebase.js` (defensive init — never crashes the app if config is
    absent), `src/lib/db.js` (all Firestore reads/writes: roster + results), `src/lib/session.js`
    (isolated localStorage session).
  - **Start gate** (`Start.jsx`): role select → navigator (roster dropdown + PIN create/login) /
    supervisor (passcode). Existing PINs are validated against the roster entry; blank PINs are
    set by the navigator through `updateRosterEntry`; passcode against `SUPERVISOR_PASSCODE`.
  - **Role split:** `App.jsx` reduced to a thin session/role router. New `SupervisorApp.jsx`
    (live `onSnapshot` results + roster, full management views) and `NavigatorApp.jsx` (own
    dashboard + my-training only; structurally no route to team views).
  - **Roster management:** `Navigators.jsx` gained an "Add navigator" form (name → `addToRoster`)
    and shows "Not yet taken" for roster members without a submission.
  - **Navigator privacy:** `NavigatorDetail` renders mentor names as plain text (no drill-in) and
    hides the back button when used as a navigator's own dashboard; `TrainingModule` hides the
    cohort list for navigators (`showCohort={false}`); new `MyTraining.jsx` for the navigator's
    own plan. `Check.jsx` gained `hideName`/`greetingName` (navigator is already identified).
  - **Sample data removed:** `SAMPLE_NAVIGATORS` deleted; matrix starts empty and fills from
    Firestore. New `EmptyState.jsx` covers no-submissions, non-assessed-department, and
    not-configured cases. `Footer.jsx` extracted (sample-data wording removed). `Results.jsx`
    removed (navigator now lands directly on the richer dashboard).
  - **Config/setup:** `SUPERVISOR_PASSCODE` added to `config.js`; `.env.local.example` and
    `firestore.rules` added; `firebase` SDK added to `package.json`.
- **Files affected:** new `src/lib/firebase.js`, `src/lib/db.js`, `src/lib/session.js`,
  `src/components/{SupervisorApp,NavigatorApp,Start,Navigators,Nav,Check,NavigatorDetail,
  TrainingModule,MyTraining,EmptyState,Footer,Matrix}.jsx`, `src/App.jsx`, `src/data/{config,
  navigators}.js`, `src/styles.css`, `.env.local.example`, `firestore.rules`, `package.json`.
  `src/lib/scoring.js` and `scoring.test.js` unchanged.
- **Verification:** `npm test` → 38 passing; `npm run build` → clean; `npm run dev` → all modules
  transform and serve (200). Defensive Firebase init verified to not crash without config.
- **Status:** Code complete and **deployed to GitHub Pages**. Firebase project is live (`quarterly-knowledge-check`); `.env.local` is configured; supervisor and navigator flows verified working end-to-end.

### 2026-06-24 — Competency engine + Gemini scenario generation on Vercel (Phases 1a–1d)
- **What changed:** Turned the check into a two-axis, scenario-based competency platform that grows
  its own question bank from the SOP via Gemini.
  - **1a — Vercel migration:** `vite.config.js` base → `/`; added `vercel.json` + `api/health.js`;
    retired the gh-pages base-path hack.
  - **1b — Competency engine:** new `src/data/competencies.js` (9 competencies). All 18 seed
    questions upgraded to per-option `points`+`rationale` and `competencies` tags (and renamed
    `QUESTIONS` → `SEED_QUESTIONS`, with a back-compat alias). `scoring.js` refactored:
    `scorePerDomain(answers, questions)` is now points-based, new `scorePerCompetency()` +
    `competencyDistribution()`, `buildMatrixRows()` carries both axes. New `Coaching.jsx`
    (rule-based post-check feedback); competency panels on `NavigatorDetail` + `Overview`;
    `db.saveResult` stores `competencyScores`. Tests 38 → **46**.
  - **1c — Question bank in Firestore:** new `questions` collection + `db.js` CRUD
    (`subscribeQuestions`, `getActiveQuestions`, `saveDraftQuestions`, `activate/archive/delete/
    updateQuestion`, `seedQuestionsIfEmpty`). `Check`/`NavigatorApp` read the **active** bank (seed
    fallback). New supervisor `QuestionBank.jsx` + `QuestionEditor.jsx` (review gate) + "Questions"
    nav tab. `firestore.rules` extended.
  - **1d — Gemini generation:** `api/generate-scenarios.js` (gemini-2.5-flash, structured JSON,
    validate/repair, multi-key rotation on 429/503) + `api/_sop-context.js`. Supervisor "Generate"
    → drafts → review → activate. (2.0-flash returns a free-tier limit of 0 on the project keys, so
    2.5-flash is used.)
- **Files affected:** new `api/{generate-scenarios,health,_sop-context}.js`, `vercel.json`,
  `src/data/competencies.js`, `src/components/{Coaching,QuestionBank,QuestionEditor}.jsx`; edited
  `src/lib/{scoring,scoring.test,db}.js`, `src/data/questions.js`,
  `src/components/{Check,NavigatorApp,SupervisorApp,NavigatorDetail,Overview,Nav}.jsx`,
  `src/styles.css`, `vite.config.js`, `firestore.rules`, `.env.local.example`.
- **Verification:** `npm test` → **46 passing**; `npm run build` → clean; `npm run dev` → 200;
  `node --check` on all `api/*` → OK.
- **Status:** Code complete. **[ASSUMPTION]** Awaiting owner to link Vercel + set `GEMINI_API_KEY`
  / `GENERATION_SECRET`; until then the in-app Generate button is the only feature that needs the
  backend — the rest runs on the existing Firebase config.

### 2026-06-25 — Railway deployment: Express server + build fixes
- **What changed:** Migrated hosting from Vercel → Railway. Three rounds of build fixes were
  needed before the Railway pipeline passed.
  - **Migration:** `server.js` (Express 5, serves `dist/` + mounts `/api/*` handlers),
    `railway.toml` (Railpack config: build + start + nixpacksConfigPath), `express` dep +
    `"start"` script + `"engines": {"node":">=20.0.0"}` in `package.json`.
  - **Express 5 wildcard fix:** SPA catch-all initially written as `app.get('*', …)`. Express 5
    (path-to-regexp v8) rejects a bare `*` wildcard — requires a named param. Changed to
    `app.get('/*splat', …)`.
  - **Node version (Round 1):** Railway defaulted to Node 18; vitest@4 + vite@8 require Node 20+.
    Fixed: added `"engines": {"node":">=20.0.0"}` to `package.json` to tell Nixpacks/Railpack to
    select Node 20.
  - **Lockfile sync (Round 2):** Previous partial `npm install` runs left the lockfile missing
    esbuild@0.28.1 entries. Fixed: wiped `node_modules` + `package-lock.json` and ran a clean
    `npm install` to fully regenerate the lockfile with both esbuild@0.21.5 (vite@5 dep) and
    esbuild@0.28.1 (vitest@4 dep).
  - **EBADPLATFORM (Round 3):** The clean lockfile includes all platform-specific esbuild
    optional packages (netbsd-arm64, darwin-arm64, win32-x64, …). `npm ci` on Railway's Linux
    x64 fails when it encounters packages for incompatible platforms, even if they're optional.
    Fixed: `nixpacks.toml` overrides Railpack's install step from `npm ci` to `npm install`, which
    gracefully skips incompatible optional packages.
- **Files affected:** new `server.js`, `railway.toml`, `nixpacks.toml`; `package.json`,
  `package-lock.json`.
- **Verification:** `npm test` → 46 passing; `node --check server.js` OK; pushed to `main`;
  Railway build in progress (nixpacks.toml override awaiting confirmation).
- **Status:** Code complete; awaiting Railway deploy confirmation.

### 2026-06-25 — Full SOP context + remove GENERATION_SECRET requirement
- **What changed:** Two improvements to the Gemini scenario generation pipeline.
  1. **Full SOP context (`api/_sop-context.js`):** replaced the old distilled ~50-line summary with
     the complete final SOP ("Pediatrics Department.pdf" — 12 pages). Now includes every provider's
     exact booking rules (slot durations, double-booking constraints, demographic comfort, specialist
     schedules), the full referral decision tree (PE UTD/not-UTD × in/out-of-Aizer's 5 specialties ×
     emergency/non-emergency), Sally Carilli escalation triggers, all insurance indicators and
     plan-specific rules, immunization/lab routing with nurse schedules, arrival instruction nuances,
     family/sibling booking mechanics, and the full contact directory. Gemini now has sufficient
     grounding to generate high-specificity scenario questions for every domain.
  2. **Remove GENERATION_SECRET env var requirement (`api/generate-scenarios.js`):** the server now
     falls back to `SUPERVISOR_PASSCODE` (imported from `src/data/config.js`) when `GENERATION_SECRET`
     is not set. The client already sends `SUPERVISOR_PASSCODE` as the secret — there was never a
     meaningful distinction. Eliminates the need for an extra Railway Variable.
- **Files affected:** `api/_sop-context.js` (full rewrite), `api/generate-scenarios.js`
  (import `SUPERVISOR_PASSCODE`; fallback logic replacing the hard error).
- **Verification:** `node --check api/generate-scenarios.js` → OK; `node --check api/_sop-context.js` → OK.
- **Status:** Complete. `GEMINI_API_KEYS` (already set in Railway) is the only server-side variable
  needed for generation to work; no `GENERATION_SECRET` required.

### 2026-06-25 — SOP replaced with Pediatrics_SOP_Updated.pdf (pure replacement)
- **What changed:** `api/_sop-context.js` fully replaced using **only** content from
  `Pediatrics_SOP_Updated.pdf` (Aizer Health Organization Operational Procedures v1.0). No content
  from the old `SOP Guide.pdf` is carried forward.
  - **Providers:** Correct names and details — Dina Faiden (formerly Donna Deck, not Dick), Lazar
    Khaimov, Robin Aschkenasy, Tamar Dachoh, Chana Heintz, Lily Namanworth — with languages and
    patient caps exactly as in the updated document.
  - **New appointment types:** Tongue Tie (within 5 weeks; refer out if child is older), Weight Check
    (TE to Sally Carilli if PE up to date), Lactation (30 min OV; Robin/Tamar/Chana only), Early
    Intervention (TE to PEDS TELEPHONE ENCOUNTER queue), WIC forms (TE or OV with reason "HEMO").
  - **Full 9-scenario TE guide:** step-by-step for lab results (black lock rule), medical questions,
    shots/immunizations, ENT/nutritionist, referrals, controlled substance follow-ups, digital imaging,
    specialty care (Vision/Speech/PT-OT/Podiatry = transfer only, no TE), and medication refills
    (HIGH PRIORITY tag if patient is completely out).
  - **PE frequency calculator and consequences block** per the new SOP.
  - Source reference in §1 updated from `SOP Guide.pdf` to `Pediatrics_SOP_Updated.pdf`.
- **Files affected:** `api/_sop-context.js` (full rewrite), `CLAUDE.md` (§1 + §7).
- **Verification:** `node --check api/_sop-context.js` → OK; `npm test` → 46 passing.
- **Status:** Complete. All AI features (scenario generation, coaching, interview, audit) now ground
  against the updated SOP only.

### 2026-06-25 — Interview caller consistency fix
- **What changed:** Gemini was hallucinating inconsistent facts mid-call (e.g., stating a birthday
  of August 2017 in one turn, then saying "he just turned 6" two turns later). Root cause: at
  temperature 0.8 the model generated factual answers fresh each turn without cross-checking its own
  history.
  - Added a `CRITICAL` consistency rule to `buildSystemInstruction` in `api/interview-turn.js`:
    Gemini is now explicitly told to check its prior turns before answering any factual question about
    the caller (names, dates, ages, insurance, provider, reason for calling, etc.).
  - Reduced turn temperature from 0.8 → 0.5 to reduce free-form generation that diverges from the
    established conversation history.
- **Files affected:** `api/interview-turn.js`.
- **Verification:** `node --check api/interview-turn.js` → OK; `npm test` → 46 passing.
- **Status:** Complete.

### 2026-06-26 — OB/GYN live check: multi-department architecture (F10 Phase 2)
- **What changed:** Made OB/GYN a genuine live check alongside Pediatrics. Navigators now pick
  their department at check-start; results, questions, and all AI features are scoped per dept.
  **Hard constraint met:** all authored OB/GYN content uses sanitized generic role labels only
  (no real names, phone numbers, or portal credentials — the repo is public).
  1. **`src/data/departments.js`:** added `ASSESSED_DEPTS = ['pediatrics', 'obgyn']`,
     `DEFAULT_DEPT`, `isAssessed(id)` helper; kept `ASSESSED_DEPT` as back-compat alias.
  2. **`src/data/questions.js`:** domain names/blurbs neutralized (IDs unchanged);
     `SEED_QUESTIONS_OBGYN` imported + re-exported; `ALL_SEED_QUESTIONS` combined export added;
     `department: 'pediatrics'` injected on all Pediatrics seed questions.
  3. **New `src/data/questions-obgyn.js`:** 14 sanitized OB/GYN seed questions across all 6
     domain IDs; generic role labels only ("the MFM nurse", "the MFM director", etc.).
  4. **`api/_sop-context.js`:** added `SOP_CONTEXT_OBGYN` (sanitized OB/GYN grounding distilled
     from the owner-provided SOP), `SOP_CONTEXTS` map, `sopContextFor(deptId)` accessor; kept
     `SOP_CONTEXT` back-compat alias.
  5. **`api/generate-scenarios.js`:** already used `sopContextFor` (done in previous session).
  6. **`api/interview-turn.js`, `api/grade-interview.js`, `api/generate-audit.js`:** switched from
     `SOP_CONTEXT` to `sopContextFor(department)`, extracted `department = 'pediatrics'` from
     request body.
  7. **`src/lib/db.js`:** `getActiveQuestions(dept)` filters by dept; `saveResult` and `getResult`
     use composite key `${navigatorId}__${department}` (with Pediatrics legacy fallback);
     `clearResult(id, dept)` likewise; `seedQuestionsIfEmpty` seeds `ALL_SEED_QUESTIONS`;
     `saveDraftQuestions` stamps dept on each draft; all doc comments updated.
  8. **`src/lib/scoring.js`:** `departmentMatrix` now uses `liveResult.department  'pediatrics'`
     (was hardcoded to `ASSESSED_DEPT`); removed now-unused `ASSESSED_DEPT` import.
  9. **`src/lib/scoring.test.js`:** updated `departmentMatrix` live-taker test, added OB/GYN
     live-taker case, legacy-no-dept case, and new `isAssessed` test suite. **46 → 50 tests**.
  10. **`src/components/NavigatorApp.jsx`:** added `activeDept` state + `deptselect` view (dept
      picker with "Live check" badge cards); all DB calls and API features scoped to `activeDept`;
      seed fallback per dept via `SEED_BY_DEPT` map.
  11. **`src/components/SupervisorApp.jsx`:** uses `deptIsAssessed(selectedDept)` and `DEFAULT_DEPT`;
      seeds `ALL_SEED_QUESTIONS`; filters `activeResults` by dept for the matrix; `handleGenerate`
      + `saveDraftQuestions` pass `selectedDept`; `handleResetResult` passes dept.
  12. **`src/components/DeptBar.jsx`:** `isAssessed(d.id)` for live badge (both depts now show it);
      updated note text.
  13. **`src/components/QuestionBank.jsx`:** filters displayed questions by `selectedDept` prop.
  14. **`src/components/Interview.jsx`, `SpotTheError.jsx`:** accept `department` prop and pass to
      all API call bodies.
  15. **`src/components/Check.jsx`:** `deptName` prop surfaces in the greeting line.
  16. **`src/styles.css`:** `.dept-select` styles added (department picker card grid).
- **Files affected:** `src/data/departments.js`, `src/data/questions.js`,
  **new** `src/data/questions-obgyn.js`, `api/_sop-context.js`, `api/interview-turn.js`,
  `api/grade-interview.js`, `api/generate-audit.js`, `api/generate-scenarios.js`,
  `src/lib/db.js`, `src/lib/scoring.js`, `src/lib/scoring.test.js`,
  `src/components/{NavigatorApp,SupervisorApp,DeptBar,QuestionBank,Interview,SpotTheError,Check}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` → **50 passing**; `npm run build` → clean; `node --check` on all
  4 edited API handlers → OK. OB/GYN content grep confirmed zero leaked names/phone numbers.
- **Status:** Complete.

### 2026-06-26 — Question Health / SOP Drift flags
- **What changed:** Added automatic health indicators to every active question in the Question Bank.
  After a question has been answered 10+ times, a colored health dot appears next to it:
  green (healthy ≥20% correct), red (Review Required <20% correct). A question with <10 responses
  shows a gray dot ("not enough data yet").
  - **`saveResult` in `db.js`:** now stores an `answers: { [questionId]: optionId }` field on every
    result doc. Legacy docs without the field are silently skipped by the health computation.
  - **`NavigatorApp.jsx`:** passes the raw `answers` map (already available in `handleSubmit`)
    as the new 6th argument to `saveResult`.
  - **`computeQuestionHealth(questions, results)` in `scoring.js`:** pure function that iterates
    result docs with `answers`, counts responses and correct picks per question, and derives
    `{ responseCount, correctCount, correctRate, canTeachCount, canTeachFailCount, status }` for
    each question. Also tracks "Can-Teach signal" — when navigators who scored ≥85 in that question's
    domain also get it wrong, the alert text says "X of Y Can-Teach navigators also missed this —
    the SOP may not match floor practice."
  - **`QuestionBank.jsx`:** accepts new `results` prop; calls `computeQuestionHealth(active, results)`;
    renders health indicator in each active question's header row. Flagged questions get a subtle
    red-tint border + an alert banner above the scenario text with the specific stats.
  - **`SupervisorApp.jsx`:** passes `deptResults` (already filtered to active roster + selected dept)
    to `QuestionBank`.
  - **`styles.css`:** new `.qhealth`, `.qhealth__dot--{healthy,review,insufficient}`, `.qhealth__badge`,
    `.qhealth__alert`, `.qbank__item.is-flagged` rules.
  - **`scoring.test.js`:** 10 new tests for `computeQuestionHealth` covering: insufficient threshold,
    healthy boundary, review flag, legacy-doc skipping, missing-question skipping, can-teach tracking,
    multi-question independence, empty inputs.
- **Files affected:** `src/lib/{scoring,scoring.test,db}.js`,
  `src/components/{NavigatorApp,QuestionBank,SupervisorApp}.jsx`, `src/styles.css`.
- **Verification:** `npm test` → **60 passing**; `npm run build` → clean.
- **Status:** Complete.

### 2026-06-26 — Navigator department switcher UX fix
- **What changed:** Navigators were previously locked to the department they picked at login —
  there was no way to switch to another department (e.g., to see OB/GYN results after taking
  Pediatrics) without signing out and back in. Fixed in two layers:
  1. **Nav pill:** `Nav.jsx` accepts `activeDeptName` + `onChangeDept` props and renders a small
     pill button (warm clay accent style) showing the current dept name with a ⇄ icon. Hidden
     during `check` and `coaching` views so navigators can't abandon mid-quiz. `NavigatorApp.jsx`
     passes these through an updated `Shell` component; clicking calls `handleChangeDept` which
     resets dept-specific state and returns to `deptselect`.
  2. **Clickable dept cards:** `NavigatorDetail.jsx` accepts a new `onChangeDept(deptId)` prop.
     In the "Strength across departments" `deptstrip`, assessed non-current dept cards render as
     `<button>` elements (`is-switchable` class) — clicking jumps directly to that dept via
     `handleDeptSelect`, which checks for an existing result and lands on `dashboard` or `check`.
     Non-assessed depts stay as `<div>` (not clickable). An assessed dept with no result yet
     shows "Take the check →" as its label instead of "— not assessed". `isAssessed` imported
     from `departments.js` in `NavigatorDetail`.
  - **`styles.css`:** `.nav__dept-switch` pill + `.deptstrip__item.is-switchable` hover/press
    states (lift + accent border on hover).
- **Files affected:** `src/components/{Nav,NavigatorDetail,NavigatorApp}.jsx`, `src/styles.css`.
- **Verification:** `npm test` → 60 passing; `npm run build` → clean.
- **Status:** Complete.

### 2026-06-26 — Rebrand to Cruciby — Forged Under Pressure *(reverted 2026-06-29)*
- **What changed:** Full product rebrand from "Quarterly Knowledge Check" to **Cruciby — Forged Under Pressure**.
- **Status:** Reverted — see entry below.

### 2026-06-28 — `generate-audit` validation refactor + extra API-handler tests
- **What changed:** Extracted the response-validation logic of `api/generate-audit.js` into a pure,
  exported `validateAuditResponse(parsed)` helper (returns `{ data }` | `{ error }`; no I/O), and
  routed the handler through it — behaviour and status codes unchanged. Added two more `api/` test
  files on top of the 2026-06-26 audit pass: `api/generate-audit.test.js` (covers
  `validateAuditResponse` — valid shape, incomplete transcript, bad/missing errorIndex, Patient-turn
  fallback to nearest Agent turn, sanitisation) and `api/_gemini-client.test.js` (`getApiKeys` env
  parsing + `geminiWithRotation` with a stubbed `fetch`). Tests **130 → 158** (7 test files).
  Also added the ponytail agent-tooling files to `.gitignore`.
- **Files affected:** `api/generate-audit.js`; **new** `api/generate-audit.test.js`,
  `api/_gemini-client.test.js`; `.gitignore`; `package-lock.json`.
- **Verification:** `npm test` → **158 passing**; `npm run build` → clean.
- **Status:** Complete.

### 2026-06-26 — Code-audit pass: DRY cleanup, test coverage expansion, Vite CVE patch
- **What changed:** Systematic code-quality pass driven by a 6-agent audit. All 16 tasks completed.
  1. **`src/data/questions.js`:** exported `domainName(id)` helper; removed 9 identical inline copies
     from 9 component files (`Coaching`, `Check`, `Matrix`, `MyTraining`, `NavigatorDetail`,
     `Overview`, `QuestionBank`, `Training`, `TrainingModule`).
  2. **`src/lib/scoring.js`:** `scorePerDomain` and `scorePerCompetency` now default `answers` to `{}`
     (previously crashed on `undefined` input). `earnedPoints` already had an `options.` guard
     (added in prior session). Fixes a latent crash if called with no arguments.
  3. **`src/lib/apiFetch.js` (new):** shared client helper encapsulating AbortController timeout,
     Content-Type header, `SUPERVISOR_PASSCODE` injection, error-body parsing, and `AbortError` name
     preservation. Used by `Interview.jsx`, `SpotTheError.jsx`, `Coaching.jsx`, `SupervisorApp.jsx`.
  4. **`api/_auth.js` (new):** `validateSecret(req, res)` — shared secret-validation helper for all
     6 Gemini handlers (replaces the identical 3-line block copy-pasted across them). The
     `GENERATION_SECRET || SUPERVISOR_PASSCODE` fallback now lives in one place.
  5. **`api/_gemini-client.js`:** added startup validation (warn if no keys configured); truncates
     error-body before logging to cap log noise.
  6. **`Coaching.jsx`:** standardised from `.then()/.catch()` to `async/await` for consistency with
     the rest of the codebase; replaced raw fetch with `apiFetch`.
  7. **Vite:** upgraded from 5.4.11 → **5.4.21** (latest v5 patch — fixes 3 CVEs: `server.fs.deny`
     bypass, path traversal, NTLMv2 hash disclosure).
  8. **Test coverage (130 tests, 5 test files):**
     - `scoring.test.js`: 9 new malformed-input edge-case tests (`undefined answers`, missing
       `options` field, unknown `domainId`, unknown competency tag, etc.).
     - `src/lib/session.test.js` (new, 12 tests): localStorage round-trips, overwrite behaviour,
       corrupt JSON graceful return, unavailability handling via `vi.stubGlobal`.
     - `api/api-handlers.test.js` (new, 30 tests): `sanitize` (generate-scenarios), `buildDigest`
       (generate-coaching), `buildSystemInstruction` + `buildContents` (interview-turn) — all now
       exported with `export` keyword.
     - `src/components/components.test.jsx` (new, 15 tests, `@vitest-environment jsdom`):
       `EmptyState` pure render, `Footer` pure render, `Nav` supervisor/navigator tabs, active-state
       class, click handlers, dept-switch pill show/hide.
     - `src/lib/db.test.js` (new, 18 tests): Firebase + Firestore fully mocked via `vi.hoisted()`;
       tests composite-key construction in `saveResult`/`clearResult`, data shapes, legacy fallback
       reads, `subscribeRoster` mapping and error-callback routing.
  9. **Test infrastructure:** `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` added
     as devDeps; `src/test-setup.js` (jest-dom/vitest extension + `afterEach(cleanup)`); `test`
     config in `vite.config.js` (`setupFiles`); `@vitest-environment jsdom` pragma in component tests.
  10. **Fragile test fixes** (from prior audit): `readinessTally` empty-matrix case, `trainingPlan`
      named-navigator positional assertion, `mentorSuggestions` redundant `if` guard removed.
- **Files affected:** `src/data/questions.js`; `src/lib/{scoring,scoring.test,session.test,db.test}.js`;
  **new** `src/lib/{apiFetch,session.test,db.test}.js`; **new** `api/{_auth,api-handlers.test}.js`;
  **new** `src/components/components.test.jsx`, `src/test-setup.js`; edited
  `src/components/{Coaching,Interview,SpotTheError,SupervisorApp}.jsx`; all 6 Gemini `api/*.js`
  handlers; `api/_gemini-client.js`; `vite.config.js`; `package.json`/`package-lock.json`.
- **Verification:** `npm test` → **130 passing** (5 test files); `npm run build` → clean;
  `node --check` on all 6 Gemini handlers + `_auth.js` → OK.
- **Status:** Complete.

### 2026-06-29 — Rename back to Knowledge Check; logo removed
- **What changed:** Reverted the 2026-06-26 Cruciby rebrand and the 2026-06-28 logo addition.
  The displayed product name is **Knowledge Check** everywhere; no logo image is rendered. The
  git repo name (`QuarterKnolwdge`) is unchanged. During the push a rebase conflict was resolved:
  the remote had added a favicon link alongside the Cruciby title — the favicon was kept, the name
  was changed.
  - `index.html` — `<title>` → `Knowledge Check`; favicon `<link>` retained from remote commit.
  - `Nav.jsx` — logo `<img>` removed; brand button text → `Knowledge Check`.
  - `Footer.jsx` — footer line → `Knowledge Check` (tagline removed).
  - `Start.jsx` — logo `<img>` removed; eyebrow → `Knowledge Check` (tagline removed).
  - `CLAUDE.md` — header, §1, §7 rebrand entry updated.
  - **Note:** `styles.css` retains dead `@keyframes logo-float` / `.start__logo` / `.nav__logo`
    rules from the 2026-06-28 commit — harmless but can be cleaned up.
- **Files affected:** `index.html`, `src/components/{Nav,Footer,Start}.jsx`, `CLAUDE.md`.
- **Verification:** `npm run build` → clean.
- **Status:** Complete.

### 2026-06-29 — ponytail agent tooling installed (local only — NOT an app change)
- **What changed:** Installed the **ponytail** token-reduction plugin
  (github.com/DietrichGebert/ponytail) for the repo owner's Claude Code environment. **No repo/app
  file changed** — it lives entirely in `~/.claude/` (runtime in `~/.claude/plugins/ponytail/`,
  hook wiring in `~/.claude/settings.json`). The app's `.gitignore` already treats ponytail as
  "agent tooling, not part of the app." Documented here only so future agents know it's active.
  - **Mechanism:** a `SessionStart` hook injects ponytail's "laziness ladder" ruleset (favour
    reuse / stdlib / one-liners over new abstractions) into context **autonomously every session**
    — no trigger needed; default mode `full`. A `UserPromptSubmit` hook tracks mode.
  - **Control (typed as a normal prompt):** `/ponytail lite|full|ultra|off`, or `stop ponytail`
    / `normal mode` to disable. Statusline shows `[PONYTAIL:<MODE>]`.
- **Files affected:** none in-repo (this §7 note + the §14 bullet are the only repo edits).
- **Status:** Complete. See also the `ponytail-installed` agent memory.

### 2026-06-29 — SAFe Agentic Workflow harness installed (in-repo `.claude/`, tailored to this stack)
- **What changed:** Installed a tailored adaptation of the **SAFe Agentic Workflow** harness
  (github.com/bybren-llc/safe-agentic-workflow) into the repo's `.claude/` directory. This is
  **agent-workflow tooling, not an app change** — no `src/`, `api/`, or build file was touched.
  SAW ships for a Linear + Docker + Postgres-RLS + Stripe + multi-reviewer team stack; every piece
  was rewritten for this project's actual stack (React/Vite + Firebase + Railway + Vitest, solo dev,
  `main` branch, gates `npm test` / `npm run build`). ~40 irrelevant SAW files (Linear sync, Docker
  deploy, RLS/Stripe skills, remote-rollback, etc.) were intentionally **not** copied.
  - **Commands (8)** in `.claude/commands/`: `start-work`, `end-work`, `pre-pr`, `check-workflow`,
    `quick-fix`, `retro`, `search-pattern`, `update-docs` — all reference npm gates and `main`, no Linear.
  - **Agents (5)** in `.claude/agents/`: `fe-developer`, `qas`, `system-architect`, `tech-writer`,
    `rte` — grounded in this codebase's modules, conventions, and the CLAUDE.md-update rule.
  - **Skills (4)** in `.claude/skills/`: `safe-workflow`, `pattern-discovery`, `testing-patterns`,
    `git-advanced` — added alongside the existing BizOps/dev skills already in that dir (untouched).
    `.gitignore` line 9 (`skills/`) normally keeps skills out of git by repo convention, but for
    codespace-migration safety they were **force-added** (`git add -f .claude/skills`) in a follow-up
    commit, so all 57 skill files (the 4 harness skills + existing BizOps/dev packs) are now committed.
  - **Config:** `.claude/team-config.json` (real values, no placeholders), `.claude/settings.json`
    (guardrail hooks: warn on `main`, block push-to-`main`, block push with uncommitted changes,
    remind `/pre-pr` before `gh pr create`, session-end uncommitted-work check), `.claude/README.md`.
  - **Incidental fix:** `src/components/components.test.jsx` Footer test still asserted the old
    "Cruciby" brand name (stale since the 2026-06-29 rename) — updated to "Knowledge Check".
  - **Sensitive files excluded + gitignored:** `roo-code-settings.json` (holds a live Cloudflare
    API key) and `OB GYN SOP.pdf` / `Pediatrics_SOP_Updated.pdf` (likely patient/provider PII) were
    **not** committed — this is a public repo. All three were added to `.gitignore` and must be
    preserved by manual download before the codespace expires. (`SOP Guide.pdf` was already tracked
    pre-session and is left as-is.)
- **Files affected:** new `.claude/{README.md,team-config.json,settings.json}`,
  `.claude/commands/*.md` (8), `.claude/agents/*.md` (5), `.claude/skills/**` (4 harness skills +
  existing packs, force-added); edited `.gitignore`,
  `src/components/components.test.jsx` (Cruciby→Knowledge Check), `CLAUDE.md`.
- **Delivery:** branch `chore/install-saw-harness` → PR #1 (3 commits: harness, skills, gitignore).
- **Verification:** `npm test` → **158 passing** (Footer test fixed); harness is config/docs only.
- **Status:** Complete.

### 2026-06-26 — Remove Gemini/AI branding from UI
- **What changed:** Stripped all visible references to "Gemini" and "AI" from the navigator and
  supervisor-facing UI. The underlying features are unchanged; only the labels are removed.
  - `Coaching.jsx` — removed "AI" badge from the personalised coaching heading (skeleton + loaded state).
  - `SpotTheError.jsx` — removed "AI Coach" badge above the coaching reply text.
  - `Interview.jsx` — replaced "Gemini plays a patient caller" with "A simulated patient caller will join";
    "get an AI score" → "get a score"; "Gemini is scoring your performance" → "Reviewing your performance".
  - `QuestionBank.jsx` — removed the `via {source}` tag that showed "via gemini" on generated question cards.
- **Files affected:** `src/components/{Coaching,Interview,SpotTheError,QuestionBank}.jsx`.
- **Verification:** `npm run build` → clean.
- **Status:** Complete.

### 2026-06-26 — Craft pass: shared Gemini client + latent CSS-var bug fix
- **What changed:** A focused quality refactor from a craft review (no behaviour changes to the
  happy path; one latent rendering bug fixed).
  1. **Extracted `api/_gemini-client.js`** — `getApiKeys`, `callGemini`, `geminiWithRotation`, the
     `ROTATABLE` set, and the `MODEL` constant were copy-pasted across all 6 Gemini handlers and had
     **diverged** (two handlers had a clean `geminiWithRotation` helper; three inlined the loop; one
     tracked auth failures the others lacked). Now one module. `geminiWithRotation(keys, body,
     {label})` returns a normalized result the caller maps to HTTP: `{ok:true,text}` |
     `{ok:false,reason:'fatal',status}` (→502) | `{ok:false,reason:'auth'}` (→500, used by
     generate-coaching) | `{ok:false,reason:'exhausted'}` (→429). Every handler's existing status
     codes and error strings were preserved. All 6 handlers (`generate-scenarios`,
     `generate-coaching`, `interview-turn`, `grade-interview`, `generate-audit`, `coach-audit`) now
     import from it.
  2. **Latent CSS-var bug fixed.** The interview score colours used `var(--can-teach)` /
     `var(--solid)` / `var(--learning)` and some new CSS used `var(--level-canteach)` etc. — **none
     of those variables were ever defined** (the matrix colours cells via inline JS from
     `LEVELS[…].color`, not CSS vars), so the score colours silently fell back to default text
     colour. Fixed by defining `--level-learning/solid/canteach` in `styles.css :root` (kept in sync
     with `LEVELS`) and routing both `Interview.jsx` and `NavigatorDetail.jsx` through a new
     `interviewScoreColor(score)` helper in `config.js`.
  3. **Magic score-bands centralised.** The 75/60 green/amber/red thresholds (duplicated in two
     components) moved to `INTERVIEW_SCORE_BANDS` + `interviewScoreColor()` in `config.js`. This is a
     separate scale from the capability `THRESHOLDS` (60/85) by design — documented in config.
  4. **Prompt input caps.** `grade-interview.js` now caps the transcript at 40 turns × 1500 chars
     each; `coach-audit.js` caps the reflection + model explanation at 2000 chars each. Bounds the
     token budget and trims the prompt-injection surface (output is advisory, but cheap insurance).
  5. **Redundant condition** `phase === 'loading' || (phase === 'loading' && genError)` in
     `SpotTheError.jsx` simplified to `phase === 'loading'`.
- **Files affected:** new `api/_gemini-client.js`; edited all 6 `api/*` Gemini handlers,
  `src/data/config.js`, `src/styles.css`, `src/components/{Interview,NavigatorDetail,SpotTheError}.jsx`.
- **Verification:** `npm test` → 46 passing; `npm run build` → clean; `node --check` on all handlers
  → OK; runtime `import()` smoke-test of all 6 handlers + the shared client → resolves;
  `interviewScoreColor` returns the right band var for 80/65/40/null; confirmed no `--can-teach`
  refs remain and `--level-*` vars are in the built bundle.
- **Status:** Complete.

### 2026-06-25 — Interview discard option + AI grading after save (F15 Phase 2)
- **What changed:** Two navigator-requested additions to the practice call feature.
  1. **Discard option:** the single "End call" button is replaced by two header buttons —
     **"Save & get feedback"** (primary) and **"Discard"** (ghost). Discarding shows a
     "Session discarded — nothing was saved" screen and calls `reset()` without touching Firestore.
  2. **AI grading:** after saving, the client calls the new `POST /api/grade-interview` endpoint
     and transitions through a `grading` phase (spinner + "Reviewing your call…"). The `reviewed`
     screen shows: a large color-coded score (green ≥75, amber ≥60, red <60), a 2–3 sentence
     summary, a "What you did well" card (green left-border, 2–4 bullets), and a "What to work on"
     card (amber left-border, 2–4 bullets). Grade is also written back to the Firestore interview
     doc via `updateInterviewGrade` so supervisors see it in the navigator's Practice sessions panel.
  - **New file:** `api/grade-interview.js` — Gemini proxy (temp 0.3, structured JSON schema,
    same key rotation pattern). Grounds judgment solely in `SOP_CONTEXT`; clamps score 0–100;
    validates output before returning `{ grade: { score, summary, strengths[], improvements[] } }`.
  - **`server.js`:** new `POST /api/grade-interview` route; dead `createRequire` import removed.
  - **`src/lib/db.js`:** `updateInterviewGrade(id, grade)` added.
  - **`NavigatorDetail.jsx`:** interview-log header row shows a score badge (color-coded); expanded
    body shows the full grade breakdown (score, summary, strengths, improvements) above the transcript.
  - **`styles.css`:** new rules for discard glyph variant, `interview__end-actions` flex group,
    grading spinner, review screen (`interview__review`, `interview__score-card`, `interview__feedback-card`),
    score badge (`interview-log__score-badge`), and grade breakdown (`interview-log__grade*`).
- **Files affected:** new `api/grade-interview.js`; edited `server.js`, `src/lib/db.js`,
  `src/components/{Interview,NavigatorDetail}.jsx`, `src/styles.css`.
- **Verification:** `npm test` → 46 passing; `npm run build` → clean; `node --check` on both
  `api/grade-interview.js` and `server.js` → OK.
- **Status:** Complete.

### 2026-06-25 — Code review: findings documented
- **What reviewed:** F13 (AI Coaching), F15 (Interview), F16 (Spot the Error + completions), Roster
  CRUD, and the interview consistency fix. Full checklist pass across all 5 API handlers, `server.js`,
  `db.js`, `SpotTheError`, `Interview`, `Coaching`, `MyTraining`, `firestore.rules`.
- **No blocking findings.** Moderate and minor findings documented:
  - **◆ Dead import** — `createRequire` imported in `server.js:6` but never used.
  - **◆ DRY violation** — `getApiKeys`, `callGemini`, `geminiWithRotation`, and `ROTATABLE` duplicated
    identically across all 5 `api/` handlers. Should be extracted to `api/_gemini-client.js`. The
    `generate-coaching.js` version has richer `authFailures` tracking that the other 4 lack.
  - **◆ Zero test coverage** for new features (F13, F15, F16): `SpotTheError`, `Interview`,
    `Coaching`, `MyTraining`, the three new API handlers, and four new `db.js` exports.
  - **◇ Redundant condition** in `SpotTheError.jsx:157`:
    `if (phase === 'loading' || (phase === 'loading' && genError))` → simplifies to
    `if (phase === 'loading')`.
  - **◇ Prompt injection** — `navigatorAnswer` / `modelExplanation` / `name` inserted verbatim into
    the `coach-audit` Gemini prompt. Output is advisory-only; blast radius = one coaching note
    visible to the attacker only. Low severity for pilot; add length cap + session token before
    production.
- **Recommendation:** ship as-is; address DRY extraction and dead import before the next feature
  cycle; test coverage is the highest unresolved tech debt.
- **No files changed** (findings only — no fixes in this session).

### 2026-06-25 — Premium "refined-light" visual overhaul (design system + motion)
- **What changed:** A non-functional, presentation-layer redesign elevating the app to a polished
  SaaS feel while keeping the warm ivory/clay identity (chosen over a dark theme for trust/fit).
  No business logic, data shapes, or routing changed.
  - **Design tokens (`styles.css` `:root`):** extended palette (surfaces, ink tiers, accent
    strong/deep), an elevation scale (`--shadow-xs…lg`, `--shadow-glow`, focus `--ring`), gradient
    tokens (`--grad-accent` etc.), glass tokens (`--glass-bg/border/blur`), a radius scale, and
    motion tokens (`--ease-out/spring`, `--dur-1/2/3`). All **existing variable names preserved**
    so the rest of the sheet kept working.
  - **Atmosphere:** layered warm radial mesh on `body`, a slow-drifting ambient glow
    (`body::before`, `ambient-drift`), and an ultra-faint SVG-noise overlay (`body::after`).
  - **Type:** Inter loaded via `index.html` (system-font fallback retained); tighter display scale.
  - **Primitives:** layered `.card` (top-sheen `::before`, `--interactive` lift, `--glass`
    variant), gradient `.btn--primary` with spring press + `:focus-visible` ring, animated
    `.linkbtn` underline, frosted sticky `.nav` with gradient app-mark, elevated dept pills, depth
    on tags/chips/inputs, global input focus rings.
  - **Motion utilities (new, dependency-free):** `src/lib/useInView.js` (IntersectionObserver),
    `src/lib/useCountUp.js` (rAF ease-out), and components `src/components/Reveal.jsx` +
    `CountUp.jsx`. CSS helpers `.reveal/.is-in`, `.view-enter`, `.stagger > *`. **No animation
    library added** (bundle already large; CSS + tiny hooks cover the brief).
  - **Screens:** Start gate (gradient hero, glass role cards w/ icons + hover reveal, staggered
    domain list, skeleton loading state), Matrix (depth pills + cell hover, row hover, live-row
    glow, staggered read-offs), Overview (KPI widgets with **count-up** + accent rail, gradient
    bars), plus `view-enter`/`stagger` entrances on Navigators/NavigatorDetail/Training/MyTraining/
    Coaching/Check/QuestionBank/TrainingModule and a premium `EmptyState` (glyph) + `.skeleton`
    loaders.
  - **A11y/perf:** `prefers-reduced-motion` neutralises animations **and delays**; animations use
    transform/opacity (GPU); color still paired with text labels.
- **Files affected:** new `src/lib/{useInView,useCountUp}.js`, `src/components/{Reveal,CountUp}.jsx`;
  edited `index.html`, `src/styles.css`, and `src/components/{Start,Matrix,Overview,EmptyState,
  NavigatorDetail,Navigators,Training,MyTraining,Coaching,Check,QuestionBank,TrainingModule}.jsx`
  (Nav restyled via CSS only).
  `lib/scoring.js`, data modules, and `scoring.test.js` untouched.
- **Verification:** `npm test` → **46 passing**; `npm run build` → clean; built app serves 200
  (root + CSS); new tokens/fonts confirmed in the bundle.
- **Status:** Complete (code). Presentation-only; safe to deploy with the rest.

### 2026-06-25 — Roster CRUD: edit, deactivate, reset with confirmation gate
- **What changed:** Filled the CRUD gap in the roster layer — previously navigators could be added
  but not edited, deactivated, or had their result cleared. Explicitly excluded fabricated
  performance editing, permissions, and bulk operations (see §6 decisions for rationale).
  - **`db.js`:** three new exports — `updateRosterEntry(id, patch)` (name/PIN patch),
    `setRosterStatus(id, 'active'|'inactive')` (soft deactivation), `clearResult(navigatorId)`
    (deletes result so navigator can retake; roster entry untouched).
  - **`Navigators.jsx`:** rewritten. Cards are now `<div>` (not `<button>`) with an explicit "View
    dashboard →" button inside, removing the invalid button-in-button HTML. Each card gets a
    "Manage" button revealing: **Edit name/PIN** (inline form, pre-filled, dup check excluding self),
    **Reset result** (only if they have a result), and **Deactivate** / **Reactivate**. All
    destructive actions (deactivate, reset, reactivate) require an inline confirmation prompt before
    executing. Inactive navigators shown in a separate "Inactive" section at the bottom of the tab
    with a dashed, de-emphasised card style.
  - **`SupervisorApp.jsx`:** four new handlers (`handleUpdateNavigator`, `handleDeactivateNavigator`,
    `handleReactivateNavigator`, `handleResetResult`). Inactive navigators are now filtered out of
    `activeResults` before `buildMatrixRows` — deactivated team members don't skew floor gaps,
    can-teach tallies, or training cohorts.
  - **`Start.jsx`:** navigator dropdown in the sign-in gate now filters out `status === 'inactive'`
    roster members so deactivated navigators can't sign in.
  - **`styles.css`:** new `.nav-card__footer`, `.nav-card__manage*`, `.nav-card__confirm*`,
    `.nav-card__edit-form`, `.nav-card--inactive`, `.nav-inactive-section*` rules.
- **Design decisions held:** score editing refused (preserves measurement integrity); permissions
  refused (no auth system to back it); bulk actions refused (pilot scale doesn't warrant the risk);
  activity history deferred to the quarter-over-quarter roadmap item.
- **Files affected:** `src/lib/db.js`, `src/components/Navigators.jsx`, `src/components/SupervisorApp.jsx`,
  `src/components/Start.jsx`, `src/styles.css`.
- **Verification:** `npm test` → **46 passing**; `npm run build` → clean.
- **Status:** Complete.

### 2026-06-25 — Interview transcripts in supervisor NavigatorDetail
- **What changed:** Supervisors can now read a navigator's practice session transcripts from
  within the navigator's detail panel.
  - **`SupervisorApp.jsx`:** computes `selectedNavigatorId = roster.find(m => m.name === selected).id`
    and passes it as `navigatorId` to `<NavigatorDetail>`.
  - **`NavigatorDetail.jsx`:** accepts optional `navigatorId` prop; adds `useState`/`useEffect`
    to fetch `getInterviews(navigatorId)` on mount (sorted newest-first). New "Practice sessions"
    panel renders a collapsible list — domain tag, caller name, response count, date — with
    an expandable transcript view (patient lines left, navigator lines right with accent tint).
    Panel is hidden when `navigatorId` is absent (navigator's own dashboard in `NavigatorApp`).
  - **`styles.css`:** `.interview-log*` rules for the supervisor panel.
- **Files affected:** `src/components/NavigatorDetail.jsx`, `src/components/SupervisorApp.jsx`,
  `src/styles.css`.
- **Verification:** `npm test` → 46 passing; `npm run build` → clean.
- **Status:** Complete.

### 2026-06-25 — AI interview simulation: roleplay phase
- **What changed:** Navigators can now practice handling a patient call in the "Practice" tab.
  Gemini acts as a patient caller — the navigator types responses turn by turn, and Gemini stays
  in character using a `system_instruction` seeded with the caller's scenario and SOP context.
  - **New file:** `api/interview-turn.js` — two-mode handler: init call generates a scenario +
    opening line via structured JSON schema (temperature 0.9 for variety); subsequent turn calls
    reconstruct the full conversation history into Gemini's alternating `user`/`model` format
    (with a synthetic `BEGIN_CALL` seed turn so the patient opens the call) and continue as the
    patient at temperature 0.8.
  - **`server.js`:** new `POST /api/interview-turn` route.
  - **`src/components/Interview.jsx`:** setup → loading → active (chat bubbles, typing-dots
    animation, auto-scroll, 20 s AbortController timeout per call) → saving → done. Transcript
    saved to Firestore on "End call"; non-blocking (failure doesn't block the done screen).
  - **`src/lib/db.js`:** `saveInterview` and `getInterviews` added; `INTERVIEWS` collection
    constant; header comment updated to reflect all four collections.
  - **`src/components/Nav.jsx`:** "Practice" tab added for navigator role.
  - **`src/components/NavigatorApp.jsx`:** `Interview` imported; `interview` view wired in.
  - **`src/styles.css`:** full chat UI — setup domain grid, header card, scrollable chat window,
    patient/navigator bubbles (different alignment + colors), typing-dot animation,
    input row, done screen.
- **Design decision:** Open-answer scores are advisory only and do not feed the capability matrix.
  Phase 2 (criterion-based grading + supervisor override) is planned but not yet built — the
  roleplay phase ships first as the high-value, low-risk piece.
- **Files affected:** new `api/interview-turn.js`, `src/components/Interview.jsx`; edited
  `server.js`, `src/lib/db.js`, `src/components/{Nav,NavigatorApp}.jsx`, `src/styles.css`.
- **Verification:** `npm test` → 46 passing; `npm run build` → clean; `node --check
  api/interview-turn.js` → OK.
- **Status:** Complete (roleplay only).

### 2026-06-25 — "Spot the Error" QA audit training + completion tracking (F16)
- **What changed:** Added the "Flight Simulator" QA audit exercise to the training section.
  Navigators read an AI-generated flawed agent transcript, click the error message, write a
  reflection, receive AI coaching, and earn a completion badge. Supervisors see "✓ Practiced"
  badges on the training dashboard and navigator detail panels.
  - **New API files:** `api/generate-audit.js` (Gemini generates flawed transcript + errorIndex +
    hint + modelExplanation via structured JSON schema, temp 0.8); `api/coach-audit.js` (Gemini
    coaches the navigator's written reflection, temp 0.4 — advisory only, never blocks).
  - **New component:** `src/components/SpotTheError.jsx` — 7-phase flow with shake animation on
    wrong clicks, hint reveal, reflection textarea, AI coaching skeleton, model-answer reveal,
    and non-blocking Firestore save.
  - **New Firestore collection:** `completions` — `{ navigatorId, name, domainId, completedAt }`.
    `db.js` gained `saveCompletion`, `getCompletions`, `subscribeCompletions`.
  - **`server.js`:** two new POST routes (`/api/generate-audit`, `/api/coach-audit`).
  - **`firestore.rules`:** `completions` + `interviews` collections added (both `allow read, write: if true`).
  - **`MyTraining.jsx`:** rewritten to accept `onStartAudit` + `completedDomains`; each training
    item now has "Practice Scenario" / "Practice again" button + "✓ Practiced" badge.
  - **`NavigatorApp.jsx`:** `SpotTheError` imported + `audit` view wired; `getCompletions` fetched
    on mount; `handleAuditComplete` updates local `completedDomains` Set immediately on done.
  - **`SupervisorApp.jsx`:** `subscribeCompletions` live subscription added; `completionMap`
    derived; passed to `Training` (with `roster`) and `NavigatorDetail`.
  - **`Training.jsx`:** `completionMap` + `roster` props; `hasPracticed(name, domainId)` helper;
    "✓ Practiced" badge in by-navigator assignments.
  - **`NavigatorDetail.jsx`:** `completedDomains` prop; badge in "Assigned training" panel.
  - **`styles.css`:** full SpotTheError UI (transcript bubbles, shake animation, hint box, reflect
    panel, coaching panel, model-answer block, done screen); practiced badges.
- **Verification:** `npm test` → 46 passing; `npm run build` → clean; `node --check` on both new
  API files → OK.
- **Status:** Complete.

### 2026-06-25 — Generative AI coaching (Phase 2, first feature)
- **What changed:** Added a second coaching layer that runs Gemini asynchronously after a navigator
  submits a check — producing a 2–3 sentence personalised coaching note per weak competency, grounded
  in the authored option rationales (not free-form SOP knowledge). The rule-based layer is unchanged
  and always present as the baseline/fallback.
  - **New file:** `api/generate-coaching.js` — Gemini proxy (same key rotation + `SUPERVISOR_PASSCODE`
    gate as `generate-scenarios`). Builds a concise digest of only the missed/partial questions with
    their chosen rationale vs best rationale as grounding context. Calls `gemini-2.5-flash` at
    temperature 0.4. Validates output: only known competency IDs with non-empty strings kept. Returns
    `{ coaching: { [compId]: "note" } }`. Advisory only — never writes to Firestore or affects scores.
  - **`server.js`:** new `POST /api/generate-coaching` route.
  - **`Coaching.jsx`:** fires the fetch on mount; shows an `AI`-badged skeleton card while loading;
    renders coaching notes (one item per weak competency, accent-rail style) above the per-question
    review when ready; silently omits the section if the call fails or returns empty.
  - **`styles.css`:** new `.coaching__ai*` rules (badge, skeleton, list, item, comp label, note).
- **Files affected:** new `api/generate-coaching.js`; edited `server.js`, `src/components/Coaching.jsx`,
  `src/styles.css`.
- **Verification:** `npm test` → **46 passing**; `npm run build` → clean; `node --check
  api/generate-coaching.js` → OK; `node --check server.js` → OK.
- **Status:** Complete. Deploys on next push to `main`.

### 2026-06-28 — Branding integration: Logo and favicon *(logo reverted 2026-06-29)*
- **What changed:** Added a favicon (`public/favicon.png`) + logo (`public/logo.png`) for the
  Cruciby branding. Favicon link added to `index.html`; logo `<img>` tags added to `Nav.jsx` and
  `Start.jsx`; `@keyframes logo-float` + `.start__logo`/`.nav__logo` CSS added to `styles.css`.
- **Status:** Partially reverted 2026-06-29 — favicon retained; logo `<img>` tags removed from
  Nav.jsx and Start.jsx; `public/logo.png` and the float CSS remain in the repo (orphaned).
