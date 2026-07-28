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
must label every rubric criterion exactly once — the criteria of the profile the
fixture's RECORDED `modelRun.rubricVersion` resolves to (see the provenance
compatibility matrix below), NOT necessarily the department's CURRENT profile.
Since 2026-07-21 the rubric is department-based (`getQaRubricProfile(department)`),
so a NEW OB/GYN fixture (`qa-rubric-obgyn-v1`) is validated against the OB/GYN
profile, a NEW Pediatrics fixture against the shared/Pediatrics profile, and a
GENUINE HISTORICAL OB/GYN fixture recorded under the shared rubric
(`qa-rubric-v2`) is validated against that shared rubric and accepted as
historical evidence. A criterion id that does not belong to the profile the
recorded version resolves to fails validation
("unknown rubric criterion for this department"), as does a `modelRun.rubricVersion`
that resolves to no profile OR is incompatible with the department per the matrix
below. A fixture whose department has no rubric profile cannot be calibrated at
all. Use `NA` when a criterion is inapplicable. Partial criterion maps, unknown
criteria, and duplicate model criteria are invalid. Adjudicated outcomes are also
exact:

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
`identityEvidence` array, conditional-criteria wording), moving `CALL_QA_PROMPT_VERSION`
from `call-qa-grader-v3` to `call-qa-grader-v4`; the verification-integrity correction pass
then changed the model-visible contract again (patient-identity ownership rules for name
claims, explicit spoken-DOB guidance, and a requirement to answer every auto-fail id with a
quote when triggered), moving it to `call-qa-grader-v5`; and the identity-coherence correction
pass (2026-07-22) made the identity contract CALLER-ONLY (the schema no longer advertises a
navigator role) and required the three identifiers to belong to ONE patient, moving it to
`call-qa-grader-v6`; correction pass #4 then made the negative auto-fail contract explicit
(`triggered: false` requires empty evidence and note), moving it to
**`call-qa-grader-v7`**. The live contract smoke then found a model-visible contradiction:
identity instructions said not to populate free-text `evidence`, while the shared response shape
requires every `MET` verdict to include a non-empty quote. The correction requires a real caller
quote for a MET identity response but keeps the structured `identityEvidence` array as the sole
source of identity credit, moving the prompt to `call-qa-grader-v8`. The pilot
assessment-observability correction (2026-07-24) then changed the model-visible grader contract again —
the grader now receives a NAVIGATOR-VISIBLE CHART block and must judge chart-dependent decisions only
against it, while **`hiddenChartState` is STRUCTURALLY ABSENT from the model-visible grader context —
not merely reframed**: the prompt emits no hidden-chart block and `buildScenarioContextFromAttempt`
does not pass the field into `buildTrustedGradingScenario` at all, so the grader never receives chart
facts the navigator could not see (it remains server-side in the immutable attempt snapshot for trusted
audit provenance). `sched-recap` is described as
CONDITIONAL (NA when the correct workflow books no appointment), and `listen-gather` is scoped to
caller-observable information gathering — moving the prompt to **`call-qa-grader-v9`**. The post-merge
pilot reliability correction (2026-07-27) makes caller-volunteered ordinary workflow facts count as
collected unless the SOP requires reconfirmation and requires an independent criterion-specific basis for
each deduction, moving the prompt to **`call-qa-grader-v10`**. Identity performance is now derived from
the captured transcript; a complete identity that differs from the server-owned simulator identity is a
separate supervisor-review integrity signal, not a name-recovery rule or score deduction.
The OB/GYN
criteria, points, category weights, applicability flags and auto-fails are unchanged, so the rubric
stays `qa-rubric-obgyn-v1`. The server-only candidate, name-field, DOB-ownership, and HIPAA chronology
checks, and the deterministic caller role-break fail-safe, do not independently require a prompt bump.

**Provenance compatibility (2026-07-22).** A GRADED fixture is validated against the rubric its
RECORDED `modelRun.rubricVersion` maps to — never the current department profile — and its
(department, rubricVersion, promptVersion) tuple must satisfy an explicit compatibility matrix
(`callQaProvenanceCompatible` in `api/_qa-calibration.js`). A genuine pre-profile OB/GYN record
graded under the shared `qa-rubric-v2` (with the old `close-survey` / `close-anything-thanks`
closing ids) validates its criteria under that shared rubric and is accepted as historical
human-pilot evidence. Impossible tuples are rejected: `obgyn` + `qa-rubric-obgyn-v1` under v3 (the
OB/GYN profile did not exist before v4), and a NEW OB/GYN run claiming the shared rubric under v7.
An unknown recorded rubric or prompt version fails closed. The compatibility policy:

| Department | Rubric version | Legitimate prompt versions |
|---|---|---|
| `pediatrics` | `qa-rubric-v2` | any supported (v3–v10) |
| `obgyn` | `qa-rubric-v2` (historical shared) | v3 only |
| `obgyn` | `qa-rubric-obgyn-v1` | v4, v5, v6, v7, v8, v9, v10 |

**Interpretable is not the same as producible (corrected 2026-07-21).**
`SUPPORTED_CALL_QA_PROMPT_VERSIONS` lists every version this build can still INTERPRET in a
stored record (v3–v10). It previously read as though a fixture could simply declare any
of them, while `validateModelRun` in fact required an exact match with the current version —
a contradiction the second review flagged. The policy is now explicit and enforced:

| Fixture kind | Accepted prompt versions |
|---|---|
| `human-pilot` (genuine graded stored evidence) | any **supported stored** version |
| `synthetic-example` (authored now) | the **current** version only |
| `operational-pilot` (terminal capture/grade failure) | **no `modelRun` at all** — it is ungraded, so it carries no prompt/rubric/model version |
| anything else | rejected — fails closed |

**Correction (2026-07-22):** an `operational-pilot` fixture is a terminal abandoned /
capture-incomplete / grade-failed attempt. It has NO `modelRun`, so it declares no prompt,
rubric, or model version and it is never a "stored evidence" carrier of a historical version —
it contributes only to capture-reliability and safety gates, never to grading-accuracy or
version populations.

A synthetic example may not claim to be output from a retired prompt, because that would
manufacture a historical population that never existed. Genuine stored evidence records what
actually happened and keeps its own version. Populations still never blend: the report
breaks down prompt version, a multi-version population displays
`MIXED CALIBRATION POPULATION`, and readiness requires one version population to satisfy
every gate on its own (`requireSinglePromptVersion`). Two helpers express the split —
`isSupportedStoredPromptVersion()` and `isCurrentPromptVersion()`.

**Re-baselining.** `call-qa-grader-v10` (like the v4/v5/v6/v7/v8/v9 moves before it, and like
`qa-rubric-obgyn-v1`) re-baselines OB/GYN calibration: evidence gathered under an earlier
prompt is a separate population and cannot be pooled with v10 evidence. This has no effect
on current readiness, because there are still zero human-pilot fixtures.

## Simulated-caller integrity

The scored Call QA caller is an AI roleplaying a patient. A deterministic detector
(`detectCallerRoleBreak`, `api/_qa-caller-integrity.js`) scans server-captured CALLER turns for
explicit meta/AI/safety-disclaimer role breaks (declaring itself an AI, acknowledging the simulation,
or reciting an AI-policy medical/safety disclaimer a real patient would never volunteer). On a hit the
grading pipeline sets `qa.callerIntegrity.roleBreak = true`, adds a `simulated-caller-role-break`
supervisor review flag, and forces `needs_review` — the navigator is never auto-failed because the
simulated patient malfunctioned. This never changes a rubric verdict or a score.

An attempt whose transcript carries a simulated-caller integrity failure is **invalid for a confident
automatic decision**. Such an attempt is not usable as clean calibration or automation-readiness
evidence: a genuinely captured role-break attempt is `needs_review`, so it is not a confident model
verdict, and the reproduced invalid pilot attempt must not be counted as calibration evidence. Human
adjudicators should exclude any attempt flagged with a caller role break from grading-accuracy counts,
recording it (if at all) only as a capture/roleplay-reliability observation.

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

These states are automation/readiness evidence, not a merge gate for a controlled
supervisor-reviewed pilot. Such a pilot may run before the formal human calibration sample minimum
is reached, provided final employee decisions remain supervisor-authoritative. Thresholds are not
lowered for pilot use: until the population qualifies, readiness remains `INSUFFICIENT_DATA`.

The last state is still not authorization for production auto-finalization. A
separate explicitly approved PR is required; no automatic finalization is authorized by this PR.

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
`api/_qa-grading-versions.js` (`call-qa-grader-v10`), re-exported by
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

## Non-production live contract smoke

```bash
CALL_QA_LIVE_SMOKE_API_KEY=dedicated-non-production-key npm run qa:live-contract-smoke
```

The plural `CALL_QA_LIVE_SMOKE_API_KEYS` is also supported and takes precedence when it holds at
least one usable key; a set-but-empty plural variable falls back to the singular (correction pass
#5 — the earlier nullish-coalescing resolver masked a populated singular key). This command
deliberately does **not** read the application's `GEMINI_API_KEY(S)` pool. It runs **24** synthetic
semantic cases (correction pass #6 — ten explicit HIPAA/chronology cases; the 2026-07-24 pilot
correction — two navigator-visible-chart cases) against the pinned scored
grader model with static SOP context, no Firestore or private-bank access, no provisioning, and no
patient identifiers in output. Each case asserts the complete privacy-relevant scorecard state —
verdicts plus, where applicable, `qa.autoFails`, `qa.unverifiedAutoFails`, the
`deterministic-privacy-conflict` flag, `qa.review.recommendation`, and `qa.review.safetyRisk`. Every
EARLY-DISCLOSURE case is gated on a PRIVACY-SPECIFIC result — a verified af-hipaa with a non-pass
recommendation, or a `deterministic-privacy-conflict` that is a mandatory `needs_review` with
`safetyRisk: 'critical'` — never a generic fail from an unrelated criterion, so a case can never
report PASS while the scorecard hides a false auto-fail or a needed critical review. It is contract
evidence only: it has no calibration, release-automation, or scoring-authority effect.

**A prompt bump must be matched by real NEW coverage (2026-07-24).** Re-running the v7/v8
identity/privacy cases under a `v9` label proves nothing about the v9 chart and applicability rules,
so the gate gained two cases that exercise exactly the reproduced pilot defect. Both build their
grader context through the real `buildTrustedGradingScenario` with a SYNTHETIC navigator-visible chart
(authored in the script — nothing is read from or derived from the private bank) whose `activeOrders`
and `futureAppointments` are EXPLICITLY empty and whose `openEncounters` is deliberately omitted, so
the missing-vs-explicit-empty distinction is exercised live. Neither case supplies `hiddenChartState`.

* **`21-no-order-correct-no-booking`** — the navigator verifies identity, reads the chart, explains no
  ultrasound order is on file, does NOT book, and routes a clarification to the OB clinical team. The
  case asserts `sched-recap` is **NA**, that `listen-gather` is **not** failed because the decisive fact
  came from the chart rather than the caller, and that `know-rule`/`sched-flow` do not punish the
  correct no-booking outcome.
* **`22-no-order-wrong-booking`** — same caller and same visible chart, but the navigator wrongly books
  the scan. The case asserts the wrong outcome IS captured by `sched-flow` and/or `know-rule` while
  `sched-recap` stays **NA**, so a booking that should never have existed is never double-penalized.

All 22 prior identity/chart cases are retained. The v10 cases are:

* **`23-transfer-volunteered-gestational-age`** — caller states gestational age before the navigator
  asks any intake question; transfer workflow uses and documents it without a redundant question. The
  case rejects a `listen-gather` or `doc-reason` miss solely for not asking again.
* **`24-transfer-repetitive-pregnancy-question`** — identical volunteered fact, but the navigator later
  re-asks whether the caller is pregnant. This is an Active Listening contrast while documentation and
  knowledge remain independently judged.

**Measure the exit code from ONE invocation.** The gate makes 24 sequential upstream calls, and the
free-tier quota is per-key-per-model, so running the command twice back to back to "confirm" the exit
code reliably trips HTTP 429 and produces a FAILED run that says nothing about the contract. Use
`npm run qa:live-contract-smoke; echo $?` once. A run whose `[FAIL]` lines all read
`unusable grader response: The grader is busy right now` (after `status=429`) is a **quota exhaustion,
not a contract failure** — it carries no semantic signal in either direction and must be re-run cold
rather than reported as a gate result. This flakiness is long-standing: the v8 full run previously
failed cases 15 and 20 for the same reason.

The merge/release gate requires **both** exit 0 and the exact marker
`LIVE_CONTRACT_SMOKE_VERIFIED`. A malformed or semantically wrong run exits nonzero and prints
`LIVE_CONTRACT_SMOKE_FAILED`. A missing dedicated key exits with distinct nonzero status and
prints `LIVE_CONTRACT_SMOKE_NOT_RUN`. Developers may use `--allow-skip`, which exits 0 and prints
`LIVE_CONTRACT_SMOKE_SKIPPED`, but that marker can never satisfy the gate. Stubbed transport tests
verify orchestration only and must never be reported as a successful live model run.

The current committed calibration population still contains no qualifying human-pilot evidence,
so readiness remains `INSUFFICIENT_DATA`. On 2026-07-24, the owner approved the implemented
OB/GYN rubric: 100 total points, 85 pass, verification at 10/100, and an unproven verification
miss routed to `needs_review` rather than automatic zero; a positively verified HIPAA auto-fail may
still zero the call. This records policy authority only and does not change criteria, weights,
thresholds, auto-fail definitions, or readiness requirements.

## Private scenario compatibility and release sequencing (2026-07-24)

The pilot correction adds a SCHEMA requirement to the private OB/GYN Call QA bank. Every active
OB/GYN scenario in `callQaScenariosPrivate` must declare an explicit
`requiresNavigatorChartContext: true | false`, and any scenario whose correct workflow depends on
chart facts must additionally carry a `navigatorChartState`. The currently provisioned population
predates that schema, so a scenario without the field FAILS CLOSED — the relay returns
scenario-unavailable and creates no attempt. That is the intended safe behavior (it refuses to
administer a test the navigator cannot pass observably), but it means merging or deploying this change
BEFORE the bank is made compatible would take scored OB/GYN Call QA offline.

The required order is therefore:

1. Finish the code corrections. 2. Independent code review. 3. CI / offline validation.
4. Dedicated non-production live v9 smoke passes. 5. **Stop.**
6. Obtain **explicit owner authorization** to update private scenario data.
7. Update/provision compatible OB/GYN private scenarios via the trusted operator provisioning tool.
8. Verify the CURRENT production runtime safely ignores the new additive fields and stays operational.
9. Verify the private scenario documents validate. 10. Final independent merge review.
11. Obtain **separate explicit merge authorization**. 12. Merge / deploy.

Provisioning authorization and merge authorization are **separate decisions**; successful provisioning
is not itself permission to merge. Provisioning remains an operator action performed outside this
repository: no production Firestore content is ever exported into the repo, no private scenario
contents are published, and no scenario data may be fabricated or inferred from anything other than the
trusted authoring source.

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
