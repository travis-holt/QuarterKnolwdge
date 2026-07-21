# Call QA calibration and automation readiness

PR 3 adds a measuring instrument. It does **not** enable automatic final
pass/fail decisions, write `qaFinalReview`, or change Phase 3 completion.

## Evidence layers

| Layer | Meaning |
| --- | --- |
| Synthetic corpus | Deterministic code-regression protection against authored grader profiles. |
| Captured model fixture | Offline replay of a previously stored model response. |
| Human calibration set | Sanitized transcript compared with independent experienced human judgment. |
| Operational pilot fixture | Sanitized terminal capture/grading failure used only for reliability and safety gates. |
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
- for grading fixtures, a non-empty patient/navigator transcript, independent
  reviewer labels/adjudication, and model provenance
- for operational fixtures, a terminal capture or grading failure with whatever
  sanitized transcript/count evidence is available

For grading fixtures, every reviewer, the adjudicated result, and the model run
must label every rubric criterion exactly once — the criteria of the fixture's
OWN department. Since 2026-07-21 the rubric is department-based
(`getQaRubricProfile(department)`), so an OB/GYN fixture is validated against the
OB/GYN profile and a Pediatrics fixture against the shared/Pediatrics profile. A
criterion id that belongs to another department fails validation
("unknown rubric criterion for this department"), as does a `modelRun.rubricVersion`
that is not that department's profile version. A fixture whose department has no
rubric profile cannot be calibrated at all. Use `NA` when a criterion is
inapplicable. Partial criterion maps, unknown criteria, and duplicate model
criteria are invalid. Adjudicated outcomes are also exact:

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
- `operational-pilot`: real sanitized `abandoned`, `capture_incomplete`, or
  `grade_failed` evidence used only for capture reliability and safety gates.

The validator fails closed on unknown scenarios, department mismatch, unknown
criteria/auto-fails, invalid verdicts, duplicate reviewers, incomplete human
adjudication, unsupported capture/grading states, missing provenance, and
recursive sensitive fields.

Capture state follows PR #32 exactly. `captured` requires
`captureComplete: true`; every other capture state requires `false`.
`active` and `abandoned` may only be `not_started`. `captured` and
`capture_incomplete` may be not started, grading, graded, or grade failed.
Grading fixtures must be graded and contain the complete human/model labels.
Operational fixtures must be terminal and ungraded, contain no human/model
labels, and may omit the transcript and turn counts. When operational transcript
or count data is present, roles and counts are validated against each other.

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
capture-integrity flags. It includes both adjudicated human grading fixtures and
`operational-pilot` failures. Operational fixtures are excluded from final
outcome counts, criterion/auto-fail accuracy, scenario calibration volume, and
every automation sample minimum.

Key proportions include dependency-free 95% Wilson intervals. A perfect small
sample is not described as zero true risk.

## Version isolation

Reports split grader model, rubric version, prompt version, scenario version,
capture version, and live voice model. Multiple grader/rubric/prompt
populations display `MIXED CALIBRATION POPULATION`. Readiness is blocked unless
one version population independently satisfies every gate.

**Prompt version.** The grader prompt contract changed with the department-profile work
(profile-rendered evidence role rules, indexed transcript turns, the structured
`identityEvidence` array, conditional-criteria wording), so `CALL_QA_PROMPT_VERSION` moved
from `call-qa-grader-v3` to **`call-qa-grader-v4`**. `SUPPORTED_CALL_QA_PROMPT_VERSIONS`
lists both, so a stored v3 population remains interpretable; a fixture must still declare a
supported version, and v3 and v4 remain SEPARATE populations for readiness purposes.

**Rubric version is department-scoped (2026-07-21).** Each department carries its
own rubric profile and version, so a multi-department population legitimately
reports more than one rubric version. That is department identity, not
calibration drift, and it does not by itself mark the population mixed. Real
rubric drift is more than one rubric version WITHIN a single department, which
the report measures as `versionBreakdowns.rubricVersionByDepartment` and the
readiness gate checks via `mixedRubricVersionWithinADepartment()`. Grader model
and prompt version remain global — they should be uniform across departments.
Criterion-level metrics are computed over the union of every profile's criteria;
a case only contributes to a criterion its own department rubric defines, and
each criterion metric records the `departments` that define it. Per-department
scenario/criterion coverage uses that department's own criteria, so a criterion
that does not exist for a department is never reported as uncovered.

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

Critical capture failures include any human or operational fixture with
`captureComplete` false, `capture_incomplete`, `abandoned`, or `grade_failed`.
These attempts remain in operational metrics and in every relevant
version-population readiness evaluation; they cannot disappear merely because
they have no transcript, human labels, or model run.

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

## Private runtime bank and scenario references

Runtime Call QA scenarios are PRIVATE: every production instance lives only in
the Admin-denied Firestore collection `callQaScenariosPrivate` and the immutable
server attempt snapshot. Neither the calibration CLI nor pilot smoke ever reads
that collection, and no runtime scenario instance is committed to this repo.

Fixture `scenarioId`s therefore reference calibration descriptors, not runtime
scenarios:

- **Synthetic descriptors** (`api/_qa-calibration-scenarios.js`) are the
  default. They carry structural metadata only (department, workflow,
  difficulty, domains, competencies) and are explicitly marked
  `nonProduction: true`, `calibrationAuthority: 'none'`,
  `evidenceUse: 'synthetic-rehearsal-only'`. Committed `synthetic-example`
  fixtures must carry the same three marks.
- **A private-bank manifest** (`--private-manifest <ignored-local-path>`) is a
  metadata-only export of the provisioned private bank used by operator
  tooling. The manifest validator rejects any entry carrying private instance
  fields (opening lines, briefings, grading context, hidden chart state,
  caller case files, expected actions, critical misses, scoring notes), so
  answers cannot leak into operator tooling.

Coverage is honest about its evidence: without a private manifest the report
flags `runtime-bank-evidence-missing` for every scored-rollout department and
readiness carries a `scenarioEvidence:synthetic-only` reason — the anonymous
aggregate minimum counts are never treated as runtime coverage evidence on
their own. The scored Call QA rollout is **OB/GYN only**
(`CALL_QA_ROLLOUT_DEPARTMENTS = ['obgyn']`, minimum 15 active private
scenarios); Pediatrics is assessed (MCQ/Spot) but outside this rollout, so it
requires no private bank and never blocks coverage or readiness. With a
manifest, a rollout department below its anonymous minimum is flagged
`private-bank-below-minimum`.

Live mode (`--live --confirm-live`) grades only operator-supplied local
fixtures and requires each grading fixture to embed a sanitized
`scenarioSnapshot` (the attempt-snapshot shape); it never reads the private
Firestore bank.

The production grader prompt version has one source of truth:
`api/_qa-grading-versions.js` (`call-qa-grader-v3`), re-exported by
`api/grade-call-qa.js` and validated against fixture `modelRun.promptVersion`.

Private provisioning is a separate deliberate operator action:
`scripts/call-qa/provision-private-scenarios.mjs` reads an ignored local JSON
file, validates through the production validator (including `callerCaseFile`),
enforces the 8/15 minimums, defaults to dry-run, requires `--apply` plus an
explicit `--project`, and never prints hidden facts or answers.

## Monday management pilot smoke

```bash
npm run qa:pilot-smoke
```

This separate non-production workflow validates 15 local synthetic/rehearsed
cases across pass, fail, safety violation, needs review, incomplete capture,
abandoned capture, grade failure, both assessed departments, and Phase 3
completion/non-completion behavior. It prints `PILOT_SMOKE_VERIFIED` or
`PILOT_SMOKE_FAILED`.

Pilot smoke is a management-test readiness check only. It produces no
calibration readiness state or approved version population and can never unlock
shadow eligibility or automatic finalization. The production automation gate
remains the separate policy-v2 requirement for at least 200 independently
human-reviewed, adjudicated calls with all outcome and coverage minimums met.

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
human labels, or edits fixtures. Operational-only failures are retained in
capture reporting but are not sent to Gemini. Unit tests and CI never invoke
Gemini.

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
true`, a complete rubric result measured against the profile that ACTUALLY
graded the attempt (resolved from `qa.gradingMetadata.rubricVersion`; an
unrecognised version is never treated as complete), and server-authoritative
`qa.transcriptMetadata` whose attempt ID, capture status, capture-complete flag,
capture version, and live model match the attempt.

A shadow diagnostic may be stored as `qa.automationAssessment`, but it is
non-final. It must not alter `qa.pass`, `qaFinalReview`, completion, supervisor
actions, capability scoring, history scoring, training, or coaching.
