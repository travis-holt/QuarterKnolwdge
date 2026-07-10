# Grading Invariants — Knowledge Check

> **Status:** binding. Every future change to any scoring path (MCQ check, Spot the
> Error, Call QA, QA domain/competency projections, supervisor verdicts) must preserve
> these invariants. The executable half lives in
> [`src/lib/gradingInvariants.test.js`](../src/lib/gradingInvariants.test.js) and the
> gold-standard corpus harness
> [`api/_qa-grading-corpus.test.js`](../api/_qa-grading-corpus.test.js) — if one of
> those tests fails after your change, re-read this document before "fixing" the test.
>
> Last updated: 2026-07-10.

## 1. The evidence model (Call QA)

The Call QA pipeline is designed so that **no single component is trusted alone**:

```
voice transcript
  → glossary correction        (deterministic, bounded to a curated glossary — never invents words)
  → Gemini grader @ temp 0     (verdicts MET / NOT_MET / NA + verbatim evidence quote; NEVER a score)
  → validation                 (shape check: all 20 criteria, known auto-fail ids)
  → fairness repairs           (deterministic, whitelist-only, evidence-gated — see §3)
  → trust-gated scoring        (MET without verifiable evidence → NOT_MET; NA on core → NOT_MET;
                                auto-fail stands only with verified evidence and zeroes the score)
  → review assessment          (deterministic flags → pass / needs_review / fail recommendation)
  → supervisor final verdict   (human decision stored beside, never over, the AI result)
```

Each layer distrusts the previous one in a specific direction:
- The **grader** may hallucinate → the evidence gate kills fabricated MET quotes and
  fabricated auto-fails (an unverified auto-fail never fails the navigator, and never
  disappears silently — it becomes a `possible-unsafe-behavior` review flag).
- The **grader** may be a literalist (fail natural wording, demand PE/TE phrases) →
  the repair layer may overturn exactly two criteria under strict evidence gates.
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
| R4 | Repair evidence must be a **committed navigator line with a positively-cleared destination**: a commitment verb ("I'll send / route / forward / put in", "the refill team will follow up") **plus** an approved destination (nurse / provider / doctor / team / queue) **and no known-wrong destination** (billing, front desk, records, referral coordinator, scheduling, specialist, OB...). "I'll send it" (destination unknown) is NOT repair evidence. | corpus `wrong-destination-commitment`, `commitment-without-destination`; unit tests |
| R5 | Questions, offers, hypotheticals, historical checks, and caller lines are never commitments: "Did you send it?", "Can you send it?", "Do you want me to send it?", "Someone should send it", and any patient-role line can never serve as repair evidence. "I'll send it." (committed, navigator) can — but still needs a destination (R4). "The refill team will follow up." is a committed future follow-up and counts. | corpus `question-not-commitment`; unit tests |
| R6 | Any over-promise, clinical-advice, or wrong-destination signal anywhere in the call blocks ALL repairs. Safe language is excluded from those signals: "I can't promise approval" is not a promise; "I can't tell you if it's safe — that's for the nurse" is not clinical advice. | corpus `unsafe-*` cases; unit tests |
| R7 | Missing required workflow details block repairs: a standard refill without medication name or preferred pharmacy is never repaired. | corpus `incomplete-refill-no-pharmacy` |
| R8 | A grader note that mixes PE with any other failure (routing, identity, scheduling, promising, advice, missing details, conflation...) is NOT "PE-only" and is never repaired. A note that says the routing was WRONG (vs. merely unworded) is never repaired. | unit tests: mixed notes / wrongness notes |
| R9 | A repair that flips the outcome (would have failed without the repaired points) forces `recommendation: needs_review` with the `repair-changed-outcome` flag. Repairs are decision support, not the final word. | `assessQa` unit tests, corpus `good-refill-natural` literalist |
| R10 | Every repairable criterion is also in `SAFETY_CRITICAL_CRITERIA`, so an UNREPAIRED miss on it still flags a passing call for review — the repair layer cannot become the only scrutiny those criteria get. | `gradingInvariants.test.js` |

## 4. Review-layer invariants

| # | Invariant | Enforced by |
|---|-----------|-------------|
| V1 | A verified auto-fail → score 0, `pass: false`, recommendation `fail`, and a supervisor-confirmation flag. | rubric tests |
| V2 | An UNVERIFIED auto-fail never fails the navigator and never vanishes: it becomes `possible-unsafe-behavior`, `safetyRisk: 'critical'`, recommendation `needs_review`. | corpus `unsafe-hallucinated-autofail` |
| V3 | A pass over a safety-tagged miss, a borderline score (±5 of the pass mark), low transcript confidence, or an outcome-flipping repair is always `needs_review` — never a confident verdict. | corpus borderline cases |
| V4 | `QA_REVIEW_MARGIN ≥ 1`, so a raw ratio that rounds up to exactly the pass mark always lands in the review band. | `gradingInvariants.test.js` |

## 5. Supervisor-layer invariants

| # | Invariant | Enforced by |
|---|-----------|-------------|
| S1 | Supervisor decisions are stored BESIDE the AI result, never over it: practice overrides in `gradeOverride`, Call QA verdicts in `qaFinalReview`; the original `grade` and `qa` fields are never overwritten. | `gradingInvariants.test.js`, `qaFinalReview.test.js`, override tests |
| S2 | Reading or rendering a final verdict never mutates the stored session. | `gradingInvariants.test.js` |
| S3 | Supervisor overrides require a reason; confirm actions must agree with the AI verdict; NEEDS-REVIEW sessions are override-only. | `qaFinalReview` UI tests |

## 6. Gold-standard corpus (measurement, not just execution)

[`api/_qa-grading-corpus.js`](../api/_qa-grading-corpus.js) holds ~20 full-call cases
across seven categories — good, borderline, unsafe, incomplete, natural
phrasing/transcription, question-vs-commitment, and ambiguous intent — each with a
ground truth (`pass` / `fail` / `review`) and one or two simulated grader
temperaments (`accurate`, `literalist`), plus paraphrase variants and glossary
mis-hearing variants. The harness runs every case × profile × variant through the
real pipeline and measures:

- **false pass** — truth `fail` graded as a confident `pass` recommendation;
- **false fail** — truth `pass` graded as a confident `fail` recommendation;
- **review miss** — truth `review` given any confident verdict;
- **silent pass** — truth `fail` passing without at least a review flag.

**All four counts must be zero, permanently.** A `needs_review` escape is acceptable
for hard cases (that is the design: uncertainty goes to a human); a confident wrong
verdict is not. The corpus was validated against the pre-hardening repair layer and
correctly failed 11 tests there (including a confident false pass from a
wrong-destination commitment), so it demonstrably detects the loopholes it guards.

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
