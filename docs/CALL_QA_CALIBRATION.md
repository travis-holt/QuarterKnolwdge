# Call QA calibration and automation readiness

PR 3 adds a measuring instrument. It does **not** enable automatic final
pass/fail decisions, write `qaFinalReview`, or change Phase 3 completion.

## Evidence layers

| Layer | Meaning |
| --- | --- |
| Synthetic corpus | Deterministic code-regression protection against authored grader profiles. |
| Captured model fixture | Offline replay of a previously stored model response. |
| Human calibration set | Sanitized transcript compared with independent experienced human judgment. |
| Live calibration run | Explicitly paid, opt-in re-grading of sanitized local fixtures. |
| Automation readiness | Operational decision based only on sufficient adjudicated human evidence. |

These layers are reported separately. Synthetic examples and the deterministic
corpus never increase the human case count or produce an accuracy claim.

## Human review workflow

1. Two experienced navigators/supervisors independently review the sanitized transcript.
2. They label every applicable rubric criterion.
3. They separately label auto-fails.
4. They provide pass/fail/review-required judgment.
5. They do not see the AI verdict before completing their labels.
6. Disagreements are adjudicated by a third authorized reviewer.
7. Only adjudicated fixtures count toward readiness.
8. Reviewer identities remain pseudonymous in committed fixtures.

## Fixture format

Fixtures live under `api/fixtures/call-qa-calibration/` and use
`formatVersion: 1`. Required top-level fields are:

- `caseId`, `source`, and `sanitized: true`
- trusted department/scenario/workflow/difficulty metadata
- server capture state and versions
- a non-empty patient/navigator transcript with at least one navigator turn
- independent reviewer labels plus adjudication
- for graded cases, model result and model/rubric/prompt/scenario provenance

Every reviewer, the adjudicated result, and the model run must label every
rubric criterion exactly once. Use `NA` when a criterion is inapplicable.
Partial criterion maps, unknown criteria, and duplicate model criteria are
invalid. Adjudicated outcomes are also exact:

- `pass` => `finalPass: true`, `reviewRequired: false`
- `fail` => `finalPass: false`, `reviewRequired: false`
- `needs_review` => `finalPass: null`, `reviewRequired: true`

Model `recommendation: pass` requires `pass: true`; `recommendation: fail`
requires `pass: false`. A `needs_review` recommendation may accompany either
underlying rubric outcome because the review layer can escalate a numerical
pass or fail.

`source` is either:

- `synthetic-example`: documentation/test data, excluded from human metrics.
- `human-pilot`: real pilot evidence after sanitization and adjudication.

The validator fails closed on unknown scenarios, department mismatch, unknown
criteria/auto-fails, invalid verdicts, duplicate reviewers, incomplete human
adjudication, unsupported capture/grading states, missing provenance, and
recursive sensitive fields.

Capture state follows PR #32 exactly. `captured` requires
`captureComplete: true`; every other capture state requires `false`.
`active` and `abandoned` may only be `not_started`. `captured` and
`capture_incomplete` may be not started, grading, graded, or grade failed.
Only graded fixtures may contain `modelRun`. Recorded navigator/caller counts
must exactly match the transcript roles.

Fixtures must not contain navigator or patient IDs, employee full names,
Firebase document IDs, email addresses, phone numbers, real patient
information, supervisor passcodes, API keys, authentication tokens, service
accounts, or Firestore credentials. Reviewer IDs use forms such as
`reviewer-a`. There is deliberately no production Firestore download script.

## Metrics

The report distinguishes:

- false pass: human fail, model confident pass
- false fail: human pass, model confident fail
- review miss: human review required, model confident pass/fail
- correct review escalation: human review required, model `needs_review`

`needs_review` is not counted as a confident false pass/fail, but it lowers
confident-decision efficiency and raises the supervisor-review rate.

Per-criterion reporting includes applicable volume, agreement, MET and NOT_MET
precision/recall, NA agreement, unresolved evidence, review escalation, and
case IDs for disagreements. Safety-critical agreement imports the existing
`SAFETY_CRITICAL_CRITERIA` source; no second safety list exists.

Auto-fail reporting includes TP/FP/FN/TN, precision, recall, agreement, review
escalations, false automatic auto-fails, and missed human auto-fails. One false
automatic auto-fail fails the safety gate.

Capture reporting uses PR #32 metadata: clean/incomplete/abandoned capture,
grade failure, transcript caps, drain timeout, missing turn completion,
low-turn-count, glossary corrections, low-transcript-confidence flags, and
capture-integrity flags.

Key proportions include dependency-free 95% Wilson intervals. A perfect small
sample is not described as zero true risk.

## Version isolation

Reports split grader model, rubric version, prompt version, scenario version,
capture version, and live voice model. Multiple grader/rubric/prompt
populations display `MIXED CALIBRATION POPULATION`. Readiness is blocked unless
one version population independently satisfies every gate.

## Readiness policy

The versioned policy is `call-qa-calibration-policy-v2` in
`api/_qa-calibration-gates.js`. Its minimums include 200 total human cases, 80
per assessed department, 8 per scenario, 10 per workflow, 95% final agreement,
at most 2% observed false passes, at most 5% observed false fails, zero review
misses, zero false automatic auto-fails, 100% auto-fail precision, at least 98%
safety-critical agreement, and at most 1% critical transcript omissions or
critical capture failures.

The v2 policy also requires at least 60 human passes, 60 human fails, and 40
human review-required cases, with every outcome class representing at least
15% of the evaluated population. All-pass, all-fail, all-review, and severely
imbalanced datasets remain insufficient regardless of total size. A Wilson
interval with a zero denominator is reported as unavailable and can never
satisfy readiness.

Critical capture failures include any human fixture with `captureComplete`
false, `capture_incomplete`, `abandoned`, or `grade_failed`. These attempts
remain in operational metrics and in every relevant version-population
readiness evaluation; they cannot disappear merely because they have no model
run.

States:

- `INSUFFICIENT_DATA`: sample or coverage is inadequate.
- `FAILS_SAFETY_GATE`: a safety, review-miss, false-auto-fail, or capture gate fails.
- `FAILS_ACCURACY_GATE`: sufficient data exists but general accuracy targets fail.
- `READY_FOR_SHADOW`: observed gates pass, but confidence bounds are not tight enough for clean-pass consideration.
- `READY_FOR_CLEAN_PASS_CONSIDERATION`: all observed, coverage, version, and confidence gates pass.

The last state is still not authorization for production auto-finalization. A
separate explicitly approved PR is required.

## Offline CLI

```bash
npm run qa:calibrate
npm run qa:coverage
npm run qa:calibrate:check
```

Useful direct options:

```bash
node scripts/call-qa/calibrate.mjs --fixtures path --output path
node scripts/call-qa/calibrate.mjs --json
node scripts/call-qa/calibrate.mjs --markdown
node scripts/call-qa/calibrate.mjs --coverage-only
node scripts/call-qa/calibrate.mjs --require-ready
```

Normal operation is deterministic and offline. It validates every JSON file,
never silently skips malformed input, and writes ignored
`artifacts/call-qa-calibration/report.json` and `report.md`. A successful report
returns exit 0 even when readiness fails; `--require-ready` requires
`READY_FOR_CLEAN_PASS_CONSIDERATION`.

With no human fixtures, the report remains `INSUFFICIENT_DATA`, shows curated
scenario coverage, and states that no real-world accuracy conclusion is
possible.

## Optional live calibration

Live mode requires all of:

```bash
CALL_QA_CALIBRATION_LIVE=true
GEMINI_API_KEYS=...
node scripts/call-qa/calibrate.mjs --live --confirm-live
```

`GEMINI_API_KEY` is also accepted. `--repeat 3` measures final-verdict,
criterion, score, review-recommendation, and auto-fail stability.

Live mode uses the pinned `CALL_QA_GRADER_MODEL` and the existing
`gradeCallQaTranscript()` service. It uses only sanitized local fixtures and
static local SOP context, runs sequentially, prints the request count before
execution, writes only ignored artifacts, and never reads/writes Firestore,
mutates interviews, starts the voice relay, captures a microphone, overwrites
human labels, or edits fixtures. Unit tests and CI never invoke Gemini.

## Shadow automation

`api/_qa-automation-policy.js` provides a pure, fail-closed clean-pass candidate
check. `CALL_QA_AUTOMATION_MODE` accepts only `off` and `shadow`; unknown values
act as `off`.

Shadow eligibility requires a clean server-authoritative capture, graded AI
pass, high-confidence pass recommendation, no safety risk, auto-fails,
unverified auto-fails, unresolved criteria, deterministic findings, fairness
repairs, review flags, capture warnings/caps, missing provenance, version
mismatch, prior final supervisor review, or calibration shortfall.

The shadow policy is `call-qa-clean-pass-shadow-v2`. It additionally requires
the supported calibration policy version, `qa.metadataIntegrity.verified ===
true`, a complete 20-criterion rubric result, and server-authoritative
`qa.transcriptMetadata` whose attempt ID, capture status, capture-complete flag,
capture version, and live model match the attempt.

A shadow diagnostic may be stored as `qa.automationAssessment`, but it is
non-final. It must not alter `qa.pass`, `qaFinalReview`, completion, supervisor
actions, capability scoring, history scoring, training, or coaching.
