# Grading Invariants — Knowledge Check

> **Status:** binding. Every future change to any scoring path (MCQ check, Spot the
> Error, Call QA, QA domain/competency projections, supervisor verdicts) must preserve
> these invariants. The executable half lives in
> [`src/lib/gradingInvariants.test.js`](../src/lib/gradingInvariants.test.js) and the
> deterministic grading-pipeline corpus harness
> [`api/_qa-grading-corpus.test.js`](../api/_qa-grading-corpus.test.js) — if one of
> those tests fails after your change, re-read this document before "fixing" the test.
>
> Last updated: 2026-07-14.

## 0. Evidence integrity & model auditability (PR-1, 2026-07-14)

These six statements are binding across the whole Call QA pipeline:

1. **Navigator-behavior evidence must originate from ONE navigator turn.** Verification
   (`verifyEvidence(transcript, quote, { role: 'navigator', requireSingleTurn: true })`,
   or the `verifyNavigatorEvidence` shorthand) matches a normalized, in-order,
   contiguous substring inside a single navigator turn. No unordered word bag, no
   cross-turn stitching, no matching against the concatenated full transcript.
2. **Caller/patient wording can never award navigator credit, verify a navigator
   auto-fail, or validate an evidence-based negative judgment.** `patient` and
   `caller` are equivalent caller-side aliases and are never treated as `navigator`.
3. **Evidence cannot be stitched across turns.** A quote spanning two navigator
   turns, combining a caller and navigator turn, or reconstructed from ellipsis-
   joined fragments does not verify.
4. **Evidence-based negative findings without verified evidence are UNRESOLVED.** A
   `NOT_MET` with `basis: 'EVIDENCE'` whose quote fails navigator verification stays
   provisionally `NOT_MET` (never becomes `MET`) but is marked
   `unresolved: true` (`unresolvedReason: 'negative-evidence-not-verified'`), forces
   `recommendation: 'needs_review'`, and — when the criterion is safety-critical —
   raises `safetyRisk` to at least `elevated`. It is never presented as observed.
5. **Scored Call QA uses ONE recorded model.** The endpoint pins a single grader
   model (`CALL_QA_GRADER_MODEL`, default `MODEL`), rotates only across API keys,
   never falls back to a different model, and retries malformed output on the same
   pinned model. Every stored result records `qa.gradingMetadata` = `{ model,
   rubricVersion, promptVersion, scenarioVersion, gradedAt }`, all server-owned.
6. **Unreviewed AI recommendations are never displayed as final verdicts.** The
   navigator-facing immediate result and the stored-attempt history badge always
   mark an un-reviewed result as an AI recommendation pending supervisor review
   (`qaAiResultLabel` / `qaHistoryBadgeLabel`); only a supervisor `qaFinalReview`
   produces `FINAL`/`OVERRIDDEN PASS`/`FAIL`.

Every grader criterion carries a `basis` (`EVIDENCE` | `ABSENCE`). MET is always
`EVIDENCE` with a verified navigator quote. An OBSERVED wrong/unsafe miss is
`NOT_MET`/`EVIDENCE` with a quoted navigator line; a behavior that never happened is
`NOT_MET` (or `NA`)/`ABSENCE` with empty evidence. `validateQaResponse` rejects any
other combination so the existing malformed-response retry runs. The raw validated
model judgment is preserved on every scored criterion as `modelJudgment` (and on every
repair as `originalVerdict`/`originalBasis`/`originalNote`/`originalEvidence`), so a
trust-gate change or repair never erases what the grader actually said.

## 1. The evidence model (Call QA)

The Call QA pipeline is designed so that **no single component is trusted alone**:

```
voice transcript
  → glossary correction        (deterministic, bounded to a curated glossary — never invents words)
  → pinned Gemini grader @ temp 0  (ONE recorded model; verdict MET/NOT_MET/NA + BASIS
                                EVIDENCE/ABSENCE + a navigator evidence quote; NEVER a score)
  → validation                 (shape check: all 20 criteria, verdict/basis/evidence legality,
                                known auto-fail ids)
  → fairness repairs           (deterministic, whitelist-only, evidence-gated — see §3)
  → trust-gated scoring        (MET without a verified navigator quote → NOT_MET; NA on core →
                                NOT_MET; a NOT_MET/EVIDENCE whose quote can't be verified in a
                                navigator turn → unresolved; auto-fail stands only with verified
                                navigator evidence and zeroes the score; modelJudgment preserved)
  → deterministic conflicts    (model-POSITIVE error protection: MET verdicts that contradict the
                                routing policy, and deterministic unsafe-language signals — see §3a)
  → review assessment          (deterministic flags → pass / needs_review / fail recommendation;
                                any unresolved negative forces needs_review)
  → grading metadata           (server-owned model + rubric/prompt/scenario versions + gradedAt)
  → supervisor final verdict   (human decision stored beside, never over, the AI result;
                                un-reviewed results are shown as AI recommendations, never final)
```

Each layer distrusts the previous one in a specific direction:
- The **grader** may hallucinate → the evidence gate kills fabricated MET quotes and
  fabricated auto-fails (an unverified auto-fail never fails the navigator, and never
  disappears silently — it becomes a `possible-unsafe-behavior` review flag).
- The **grader** may be a literalist (fail natural wording, demand PE/TE phrases) →
  the repair layer may overturn exactly two criteria under strict evidence gates.
- The **grader** may be routing-blind or lenient (mark MET with a real quote on a call
  that mis-routes, hedges, over-promises, or gives clinical advice) → the deterministic
  conflict layer flags the contradiction and forces `needs_review` on an
  otherwise-confident pass. Findings never change verdicts or scores.
- The **repair layer** may be wrong → repairs are logged with the grader's original
  verdict/note/evidence, surfaced to supervisors, and an outcome-flipping repair
  forces `needs_review`.
- The **score** may sit at the pass boundary → the borderline band (±`QA_REVIEW_MARGIN`)
  forces `needs_review`, which also absorbs round-up-to-85 edge cases.

## 2. Universal invariants (all scoring systems)

| # | Invariant | Enforced by |
|---|-----------|-------------|
| U1 | Every assessment score is an integer on the 0–100 scale. | `gradingInvariants.test.js` |
| U2 | Levels (`learning`/`solid`/`canTeach`) derive ONLY from `scoreToLevel()` with `THRESHOLDS = {learning: 60, canTeach: 85}`. No component re-derives bands inline. | `gradingInvariants.test.js`, code convention |
| U3 | There is never a single overall grade; every signal is per-domain (and per-competency where tagged). | product decision (CLAUDE.md §6) |
| U4 | Scoring functions are pure and deterministic: same inputs → identical outputs. No scoring math inside components or prompts. | corpus determinism test, `gradingInvariants.test.js` |
| U5 | The AI never produces a number that becomes a score. MCQ/Spot scores come from authored point values and click accuracy; Call QA scores come from deterministic rubric math over binary verdicts. (`grade-interview` practice scores are advisory-only and never feed any assessment.) | pipeline design, F25 |
| U6 | Call QA results (score, pass/fail, domain projections) never feed the capability matrix. They are a QA-only signal until the owner explicitly bridges them. | `qaDomainScoring.js` contract |

## 3. Call QA repair-layer invariants

The fairness repairs exist for exactly one purpose: overturning **known grader
false-negative styles** (demanding PE verification on standard refills; demanding
literal "TE"/"Telephone Encounter" wording). They are deliberately narrow.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| R1 | Repairs may touch ONLY the criteria in `REPAIRABLE_CRITERIA` (`know-rule`, `doc-te`), and only in the direction NOT_MET → MET. Nothing may ever be repaired downward. | `gradingInvariants.test.js` |
| R2 | Repairs never add, remove, or alter auto-fails, and a verified auto-fail always zeroes the test regardless of repairs. | `gradingInvariants.test.js` |
| R3 | Every repair is recorded in `qa.repairs` with the rule id, the new evidence quote, and the grader's ORIGINAL verdict, note, and evidence — supervisors can always reconstruct what the grader said. | corpus harness, unit tests |
| R4 | Repair evidence must use the **department + authoritative `workflowType` routing policy**. Pediatrics refill = PEDS Encounters; Pediatrics referral = Pediatrics referral owner; OB/GYN non-pregnant GYN and pregnancy scheduling = PSS; OB/GYN results/clinical questions = TE/message to nursing/clinical staff. A destination accepted for one workflow is neither globally accepted nor globally rejected. | routing-policy unit tests |
| R5 | Questions, offers, hypotheticals, historical checks, caller lines, destination-less commitments, and generic "team" wording are never enough when the workflow requires a specific queue/person. | corpus `question-not-commitment`; unit tests |
| R6 | Call-level validation uses the **final committed routing decision**. Correct→wrong never repairs; wrong→correct repairs only when the later line explicitly corrects the earlier commitment; two unexplained conflicting destinations never repair. Line and call validation share one destination vocabulary. | adversarial contradiction tests |
| R6a | Any over-promise or clinical-advice signal blocks repairs. Safe language is excluded — but **only within its own clause**: "I can't promise approval" is not a promise, and "I can't tell you if it's safe — that's for the nurse" is scope discipline; "I can't promise timing, but I guarantee approval today" IS an over-promise, and "that's for the nurse, but take twice the dose" IS clinical advice. Detection is clause-aware (split on sentence boundaries, semicolons, em dashes, but/however/although/meanwhile). | clause-aware unit tests; corpus `unsafe-mixed-*` |
| R6b | Hedged/uncertain routing language ("I think…", "I'm not sure whether…", "might", "may", "probably", "supposed to"…) is never a routing commitment and never supports a repair. Confident valid commitments ("I will send this to PEDS Encounters", "PEDS Encounters will follow up", "Actually, PEDS Encounters is the correct queue") remain accepted. | hedging unit tests; corpus `hedged-routing` |
| R7 | Missing required workflow details block repairs. For the standard pediatric refill PE repair, the call must be COMPLETE: medication name, preferred pharmacy, callback details, AND out-of-medication/urgency handling, plus a safe accepted route. Any missing signal blocks the repair. | corpus `incomplete-refill-no-pharmacy`; completeness unit tests |
| R8 | The PE repair requires a STRICTLY PE-only grader complaint, checked positively: after normalization, every token of the note must be a PE term or generic failure scaffolding — any substantive residue (urgency, "out", callback, pharmacy, queue, promise…) blocks the repair. The doc-te repair requires a POSITIVELY scoped literal-TE/absent-action complaint (must reference TE/route/send/message/log/forward and contain no wrongness, missing-detail, urgency, destination, or incompleteness complaint). Generic "did not say" / "not documented" notes are NOT sufficient. | `isStrictPeOnlyFailure` / `isLiteralTeWordingFailure` unit tests |
| R9 | A repair that flips the outcome (would have failed without the repaired points) forces `recommendation: needs_review` with the `repair-changed-outcome` flag. Repairs are decision support, not the final word. | `assessQa` unit tests, corpus `good-refill-natural` literalist |
| R10 | Every repairable criterion is also in `SAFETY_CRITICAL_CRITERIA`, so an UNREPAIRED miss on it still flags a passing call for review — the repair layer cannot become the only scrutiny those criteria get. | `gradingInvariants.test.js` |

### §3a — Deterministic conflict layer (model-positive error protection)

The repair layer guards against grader FALSE NEGATIVES. The deterministic conflict
layer (`evaluateQaDeterministicFindings`) guards against grader FALSE POSITIVES —
know-rule/doc-te marked MET on a call whose committed route the routing policy knows
is wrong, contradictory, ambiguous, or missing, or where a deterministic
over-promise / clinical-advice signal exists.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| C1 | A deterministic conflict is NOT a fairness repair: findings never touch verdicts, scores, auto-fails, or `qa.repairs`. The model's original criteria and score are preserved for auditability. | `gradingInvariants.test.js` I-CONFLICT |
| C2 | A model-positive verdict that contradicts the authoritative routing policy can never become a confident silent pass: findings force `recommendation: needs_review` (flags `model-routing-conflict` / `deterministic-safety-conflict`) whenever the result would otherwise pass confidently. | corpus lenient cases; `finalizeQaResult` unit tests |
| C3 | Findings are persisted on `qa.deterministicFindings` (type, reason, evidence, destinationId, affectedCriteria) and rendered to supervisors in the "Deterministic grading conflicts" section — they may force review but must never be hidden. | corpus aggregate test; `navigatorDetail.override.test.jsx` |
| C4 | The shared `assessQa` review contract accepts deterministic findings and forces `needs_review` without changing the model score or criteria. | `api/grade-call-qa.test.js` |
| C5 | Findings never upgrade or soften a fail; they only remove unwarranted confidence from a pass. | `finalizeQaResult` unit tests |

Routing policies intentionally marked review-only because the repository sources do not
establish one exact destination: Pediatrics `records_forms`, `urgent_symptom_boundary`, and
`wrong_department_unclear_request`, plus OB/GYN `wrong_department_unclear_request`.
Those workflows receive no outcome-improving routing repair; a potentially outcome-changing
routing uncertainty is flagged for supervisor review.

## 4. Review-layer invariants

### Routing authority and calibration limits

Routing authority is strictly ordered: (1) owner-confirmed floor operations, (2)
explicit non-conflicting department SOP rules, (3) the trusted curated Call QA
scenario, then (4) generic/sanitized repository language only when consistent.
The server resolves the scenario ID and policy; browser metadata cannot alter it.
Owner-confirmed deterministic routes are PEDS Encounters for pediatric refills,
Anisa for pediatric referrals, PSS OB for non-pregnant GYN, OB Portal for
pregnancy, Rebecca for MFM, and OB Portal or the scenario's explicit clinical
TE/message path for OB/GYN results. Pediatric records/forms (apart from trusted
subtype rules), urgent symptoms, unclear requests, and unknown/conflicting OB
workflows are review-only.

Routing decisions distinguish navigator commitments, destination mentions,
corrections, questions/offers/history, and negations. A clear correction can
inherit the prior action without repeating its verb; unresolved contradictions
cannot repair. The deterministic grading-pipeline regression corpus uses
simulated grader profiles and the captured-response replay fixture only. It
does not prove live Gemini accuracy. TODO: calibrate with de-identified real
Gemini outputs.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| V1 | A verified auto-fail → score 0, `pass: false`, recommendation `fail`, and a supervisor-confirmation flag. | rubric tests |
| V2 | An UNVERIFIED auto-fail never fails the navigator and never vanishes: it becomes `possible-unsafe-behavior`, `safetyRisk: 'critical'`, recommendation `needs_review`. | corpus `unsafe-hallucinated-autofail` |
| V3 | A pass over a safety-tagged miss, a borderline score (±5 of the pass mark), low transcript confidence, or an outcome-flipping repair is always `needs_review` — never a confident verdict. | corpus borderline cases |
| V4 | `QA_REVIEW_MARGIN ≥ 1`, so a raw ratio that rounds up to exactly the pass mark always lands in the review band. | `gradingInvariants.test.js` |
| V5 | The grading API resolves workflow/scoring metadata from the server-owned curated scenario id. Missing, unknown, department-mismatched, or scenario-mismatched ids disable repairs and add `unverified-scenario-metadata` with `needs_review`; browser-supplied workflow/scoring arrays are not grading authority. | metadata-integrity unit tests |

## 5. Supervisor-layer invariants

| # | Invariant | Enforced by |
|---|-----------|-------------|
| S1 | Supervisor decisions are stored BESIDE the AI result, never over it: practice overrides in `gradeOverride`, Call QA verdicts in `qaFinalReview`; the original `grade` and `qa` fields are never overwritten. | `gradingInvariants.test.js`, `qaFinalReview.test.js`, override tests |
| S2 | Reading or rendering a final verdict never mutates the stored session. | `gradingInvariants.test.js` |
| S3 | Supervisor overrides require a reason; confirm actions must agree with the AI verdict; NEEDS-REVIEW sessions are override-only. | `qaFinalReview` UI tests |

## 6. Calibration evidence: three distinct layers

### Deterministic repair/scoring regression corpus

[`api/_qa-grading-corpus.js`](../api/_qa-grading-corpus.js) holds ~28 full-call cases
across seven categories — good, borderline, unsafe, incomplete, natural
phrasing/transcription, question-vs-commitment, and ambiguous intent — each with a
expected outcome (`pass` / `fail` / `review`) and one or more **simulated** grader
temperaments (`accurate`, `literalist`, and `lenient` — the routing-blind
false-positive-prone grader that marks real failures MET), plus paraphrase variants
and glossary mis-hearing variants. The harness runs every case × profile × variant
through the real pipeline and measures:

- **false pass** — truth `fail` graded as a confident `pass` recommendation;
- **false fail** — truth `pass` graded as a confident `fail` recommendation;
- **review miss** — truth `review` given any confident verdict;
- **silent pass** — truth `fail` passing without at least a review flag.

**All four counts must be zero for these deterministic fixtures.** A `needs_review` escape is acceptable
for hard cases (that is the design: uncertainty goes to a human); a confident wrong
verdict is not. The corpus was validated against the pre-hardening repair layer and
correctly failed the prior implementation on contradiction, generic-destination, and
cross-workflow cases. This validates the deterministic pipeline against authored
expectations; it does **not** independently validate live Gemini judgment.

### Captured real-model calibration fixtures

[`api/fixtures/qa-model-capture.example.json`](../api/fixtures/qa-model-capture.example.json)
defines the replay format: `formatVersion`, capture provenance (`captureType`, `capturedAt`,
`model`), trusted scenario id + request context, transcript, untouched `rawModelResponse`, and
expected pipeline outcome. The checked-in item is explicitly `simulated-example`, not a real
Gemini capture. When real responses are captured, set `captureType: "real-model"`, record the
actual model/timestamp, and never hand-edit `rawModelResponse`. The replay test runs stored output
through validation → repairs → scoring → review without a live API call in CI.

### Live model evaluation

Live evaluation calls the configured Gemini model against a held-out call set and measures the
model's judgment itself. It is network-, model-, quota-, and date-dependent, so it is not part of
deterministic CI. A green corpus/captured-fixture replay cannot substitute for a periodic live
evaluation run; the repo does not yet provide an automated live-evaluation harness.

**When you change grading behavior:** add corpus cases FIRST for the behavior you
are changing (both the fixed direction and the abuse direction), confirm they fail,
then change the code. Never weaken a corpus expectation to make a change pass
without owner sign-off.

## 7. Cross-system consistency audit (2026-07-10)

Findings from auditing MCQ, Spot the Error, Call QA, QA projections, and supervisor
verdicts side-by-side. Differences listed here are **intentional**; anything not
listed that diverges is a bug.

| Property | MCQ check | Spot the Error | Call QA | QA projections |
|---|---|---|---|---|
| Unit of credit | option points 0–100 (partial credit) | binary click per item | binary criterion, rubric-weighted | criterion points split across tags |
| Scale | 0–100 int | 0–100 int | 0–100 int | 0–100 int per tag |
| Levels | `scoreToLevel` | `scoreToLevel` | pass/fail at 85 + level colors for display | `scoreToLevel` for display |
| Feeds capability matrix | yes | yes | **no** (QA-only) | **no** (QA-only) |
| AI in the scored path | no (authored bank) | no (authored/curated bank; AI only generates *candidates* behind a review gate) | verdicts only, trust-gated | derived from Call QA |
| Supervisor layer | none | none | `qaFinalReview` (confirm/override + reason) | inherits |

Intentional quirks, documented so nobody "fixes" them blind:

1. **Spot full-profile mode is coarse by design** — one item per domain scores 0 or
   100 per domain (owner chose speed over granularity).
2. **`QA_PASS_THRESHOLD` (85) numerically equals `THRESHOLDS.canTeach` (85).** They
   are separate knobs that happen to align on "mastery = 85". Changing either is a
   product decision; the invariants test pins both values so a change is conscious.
3. **MCQ and Spot have no supervisor override layer.** Only AI-touched scores
   (practice grades, Call QA) carry override machinery, because authored-bank
   scoring has no AI error mode to correct. If MCQ/Spot overrides are ever added,
   they must follow S1 (store beside, never over).
4. **Auto-fail zeroing** exists only in Call QA and its projections — MCQ/Spot have
   no safety dimension per item.

## 8. Change checklist

Before merging any change that touches grading:

1. `npm test` green — including the corpus harness and `gradingInvariants.test.js`.
2. New grading behavior → new corpus cases (fix direction AND abuse direction),
   verified to fail before the change.
3. If a repair rule is added: it must satisfy R1–R10 (whitelist, direction, logging,
   evidence gates, review-on-flip) and get corpus cases for its abuse direction.
4. If a threshold changes: update §2/§4 here, `gradingInvariants.test.js`, and
   CLAUDE.md in the same commit.
5. Update this document's tables and the CLAUDE.md maintenance sections.
