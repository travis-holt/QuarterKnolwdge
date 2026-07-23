# Grading Invariants — Knowledge Check

> **Status:** binding. Every future change to any scoring path (MCQ check, Spot the
> Error, Call QA, QA domain/competency projections, supervisor verdicts) must preserve
> these invariants. The executable half lives in
> [`src/lib/gradingInvariants.test.js`](../src/lib/gradingInvariants.test.js) and the
> deterministic grading-pipeline corpus harness
> [`api/_qa-grading-corpus.test.js`](../api/_qa-grading-corpus.test.js) — if one of
> those tests fails after your change, re-read this document before "fixing" the test.
>
> Last updated: 2026-07-23 (correction pass #7 — §0n — supersedes the candidate, DOB ownership,
> and af-hipaa chronology portions of §0m. Earlier: correction pass #6 — §0m:
> af-hipaa is driven by an INDEPENDENT transcript-wide earliest-identity chronology (not the
> model-selected claims); disclosure detection is refusal/clause-aware with unique quote mapping and
> overlap; identity claims bind to ONE discrete candidate; DOB ownership uses the exact quoted
> occurrence; lowercase surname particles survive; provider detection covers more terms and both
> grammatical directions; identity-verdict contradictions are reconciled (never a silent deduction);
> and the live smoke gates early-disclosure cases on a privacy-specific result. Earlier — correction
> pass #5 — §0l — supersedes the parts of §0k it amends:
> af-hipaa never verifies from an incomplete/omitted canonical identity, conservative name-component
> splitting, one-patient typed-answer sequences, provider full-name detection, and cross-criterion
> verdict consistency. Earlier: department-based Call QA rubric profiles; OB/GYN is the first
> dedicated department profile. Correction pass #1: real structured identity verification, a
> centralized protected-disclosure detector, an enforced validate→repair→score profile binding, and
> fail-closed handling of unknown historical rubric versions. Correction pass #2 (§0i):
> clause-level disclosure detection, patient-identity ownership for name claims,
> server-derived identity evidence, real spoken/calendar DOB parsing, strict raw-response
> validation, a truthful prompt-version policy, and metadata-less history resolving to the
> historical shared rubric. Correction pass #4 is §0k. Current grader prompt version
> `call-qa-grader-v7`; OB/GYN rubric `qa-rubric-obgyn-v1`.)

## 0k. Canonical identity chronology and live gate (2026-07-22, correction pass #4)

1. **Identity is one candidate, never a union of people.** Full patient designations remain
   discrete candidates even when they share a first name or surname. Exact repeated designations
   are deduplicated; two different candidates, multiple children, or an unresolved patient switch
   fails closed. Sequential field answers form one candidate only within a coherent uninterrupted
   patient-verification sequence. The value-free audit retains structural metadata, never
   identifier values in feedback or logs.
2. **Name fields have semantics.** *(Amended by §0l.6 — the "every remaining token is the lastName"
   rule was replaced with conservative, fail-closed splitting.)* In a full-name designation the first
   token is the permitted `firstName`; the surname is determined only for two-token names or a
   recognized bounded surname-particle run (`Maria de la Cruz` => `Maria` / `de la Cruz`); an
   ambiguous 3+-token name (`Maria Elena Alvarez`) fails closed rather than guessing. Hyphenated and
   apostrophe surnames are single tokens. A first-name question establishes only `firstName`, a
   last-name question only `lastName`, and a full-name question establishes ordered components.
   Claims may not swap, overlap, or submit the full name as either one field. Provider and
   caller-name questions establish neither field.
3. **DOB ownership is transcript-level and claim-span based.** The server starts at the submitted
   claim's verified turn, quote, value span and parsed DOB span; it does not reparse an entire turn
   and accidentally short-circuit on a phone/address. Same-designation DOBs, explicit patient or
   named-patient possessives, patient-specific questions, direct self-identification, and an
   uninterrupted bound sequence can attach a DOB. `your DOB` after a different patient is named,
   ambiguous pronouns, caller/patient competition, patient switches, and multiple candidates fail
   closed.
4. **One canonical chronology drives all privacy decisions.** *(Amended by §0l.1 — an INCOMPLETE
   canonical identity no longer verifies af-hipaa; it is uncertainty, not proof.)* `verify-three`,
   `verify-before-access`, and `af-hipaa` consume the same identity evaluation and disclosure
   chronology. A model-triggered `af-hipaa` verifies (and zeroes the call) only when its navigator
   quote exists in an identified navigator turn, that quoted span is itself a detected protected
   disclosure, canonical identity is COMPLETE and completed at or after that disclosure, and it does
   not contradict a proven "verified before access". A real quote after verification, a
   non-disclosure quote, or an incomplete/omitted canonical identity never proves the auto-fail —
   the last routes to critical review (§0l.1).
5. **A deterministic model conflict requires critical review, not speculative zeroing.** When the
   model reports `af-hipaa: false` but the bounded detector proves an auditable protected navigator
   disclosure before canonical identity completion, the server records a
   `deterministic-privacy-conflict` and requires supervisor review. It does not auto-zero: the
   detector is deliberately incomplete, and uncertain or contradictory evidence also routes to
   review. This prevents model suppression without treating a broad regex as conclusive.
6. **Negative auto-fails are exactly empty.** Before normalization, every `triggered: false`
   entry requires whitespace-only `evidence` and `note`; every `triggered: true` entry requires a
   non-empty navigator quote and a string note. Unknown, duplicate, or missing ids and non-string
   fields are malformed and receive one retry; two malformed responses make the grader unusable.
   Because this is model-visible, the prompt is **`call-qa-grader-v7`**. The rubric remains
   **`qa-rubric-obgyn-v1`** and historical grades are immutable.
7. **The live contract smoke cannot borrow production credentials or pass by skipping.** *(Amended
   by §0l.7 — the case set is now 15 and each case asserts the complete privacy-relevant state; the
   dedicated-key resolver no longer masks a populated singular key.)* It reads only
   `CALL_QA_LIVE_SMOKE_API_KEY` or `CALL_QA_LIVE_SMOKE_API_KEYS`, uses the pinned grader and the
   synthetic cases, and has no Firestore/private-bank dependency or calibration authority.
   Verified = exit 0 + `LIVE_CONTRACT_SMOKE_VERIFIED`; failure = nonzero +
   `LIVE_CONTRACT_SMOKE_FAILED`; missing key = distinct nonzero + `LIVE_CONTRACT_SMOKE_NOT_RUN`.
   `--allow-skip` is local convenience only (exit 0 + `LIVE_CONTRACT_SMOKE_SKIPPED`) and never
   satisfies a merge/release gate.

**Known boundary.** Deterministic language patterns cannot establish every disclosure or pronoun
relationship; uncertainty and contradictions remain review-only. Numeric rubric weighting still
awaits owner sign-off, and calibration remains `INSUFFICIENT_DATA` until genuine adjudicated human
evidence exists.

## 0l. af-hipaa trust, name components, sequences, provider detection, verdict consistency, live smoke (2026-07-22, correction pass #5)

The fifth independent review attacked the enforcement §0k introduced. Each invariant below has an
adversarial reproduction test (written to fail against `da26baa` before the fix) in
[`api/qaCorrectionPass5.test.js`](../api/qaCorrectionPass5.test.js). All fixes are pure server-side
enforcement or smoke/docs; there is **no model-visible contract change**, so the prompt stays
`call-qa-grader-v7` and the OB/GYN rubric stays `qa-rubric-obgyn-v1`.

1. **An incomplete canonical identity never verifies af-hipaa.** A verified automatic HIPAA fail
   zeroes the call, so it requires POSITIVE server-verifiable chronology, never a model Boolean or a
   mere ABSENCE of structured identity evidence. `af-hipaa` verifies only when its quote is a
   detected protected disclosure in an identified navigator turn AND canonical identity is COMPLETE
   and completed at or after that disclosure AND it does not contradict a proven "verified before
   access". An incomplete / missing / unprovable canonical identity (e.g. the model omitted the
   `identityEvidence` arrays on a genuinely verified call) is UNCERTAINTY: the server does not
   auto-zero; it records a `deterministic-privacy-conflict` and forces critical supervisor review.
2. **The verified caller quote is preserved for DOB ownership.** `verifyIdentifierClaim` returns the
   original verified caller quote (plus the raw value and normalized quote) rather than replacing the
   quote with the bare value. DOB ownership uses the VALUE to locate the date's position (versus name
   designations) and the QUOTE to detect ownership language, so `Her DOB is …` / `the patient's DOB
   is …` / `Maria's date of birth is …` in a caller's own multi-turn answer are credited, while a
   phone/address elsewhere in the same turn cannot short-circuit ownership and a bare DOB to a
   generic question on a third-party call still fails closed.
3. **Typed field answers belong to ONE patient sequence.** Field answers are grouped into discrete
   candidate sequences; a deterministic subject-switch cue ("second/other patient", "now for the
   other …", "switching to …") or a second full designation opens a new candidate. A first name from
   one candidate and a last name from another cannot be flattened into one identity — field answers
   spanning more than one candidate fail closed. Bare "now for your DOB" phrasing on a
   single-patient call is NOT a switch. Candidate audit metadata stays value-free.
4. **Name-component splitting is conservative and bounded.** Two tokens → first/last. A bounded,
   documented surname-particle list (`de la`, `de los`, `van der`, `von`, `del`, …) yields
   `Maria de la Cruz` → `Maria` / `de la Cruz`. Hyphenated/apostrophe surnames are single tokens.
   Any other 3+-token name (`Maria Elena Alvarez`, `Maria Elena Sofia Alvarez`) is ambiguous and
   returns null — the surname is never guessed, so a last-name claim must be grounded by a separate
   last-name exchange or route to review. A full name is never accepted as `firstName` or `lastName`.
5. **Provider full-name questions take precedence over the patient-name detector.** The provider/
   staff-name patterns accept optional field qualifiers between the clinician term and "name"
   ("your OB's last name", "the doctor's first and last name", "spell the midwife's last name") and
   an expanded clinician-term list (provider, doctor, physician, dr, nurse, midwife, NP, PA,
   clinician, specialist, surgeon, OB, OB/GYN, gynecologist). Any answer to such a question
   establishes ZERO patient-name fields, so a clinician name plus a caller DOB never satisfies
   patient identity.
6. **Verification verdicts must be logically consistent.** `verify-before-access` MET requires
   `verify-three` MET — proving the identifiers were collected before a disclosure necessarily
   proves they were collected. The impossible pair (`verify-before-access` MET while `verify-three`
   NOT_MET) is a malformed response that trips the retry; the reverse is legal (identity can complete
   after a disclosure). A verified `af-hipaa` is incompatible with a proven "verified before access".
7. **The live contract smoke asserts the COMPLETE privacy state and resolves keys correctly.** Each
   case checks the relevant verdicts AND, where privacy is at issue, `qa.autoFails`,
   `qa.unverifiedAutoFails`, the `deterministic-privacy-conflict` review flag, and
   `qa.review.recommendation` — so a case can never report PASS while the scorecard hides a false
   auto-fail, an unverified allegation, or a needed critical review. Five explicit HIPAA/chronology
   cases were added (15 cases total). The dedicated-key resolver parses the plural env var first and
   falls back to the singular only when the plural yields no usable key (a set-but-empty plural no
   longer masks a populated singular), trimming, de-duplicating, and never printing values.

## 0m. Independent identity chronology, refusal-aware disclosure, candidate binding, live-smoke privacy gates (2026-07-22, correction pass #6)

The sixth independent review attacked the enforcement §0l introduced. Each invariant below has an
adversarial reproduction test in [`api/qaCorrectionPass6.test.js`](../api/qaCorrectionPass6.test.js).
All fixes are pure server-side enforcement or smoke/docs; there is **no model-visible contract
change** (the prompt text and response schema are untouched), so the prompt stays
`call-qa-grader-v7` and the OB/GYN rubric stays `qa-rubric-obgyn-v1`. This section supersedes the
parts of §0k/§0l it amends.

1. **af-hipaa is driven by an INDEPENDENT earliest-identity chronology, never the model's selected
   claims** (amends §0l.1). `earliestCompleteIdentity(transcript)` derives, from the whole
   transcript and independently of the model, the earliest turn a complete single-patient identity
   exists. A model that submits only a LATER repetition of an identity can no longer make the server
   believe verification happened after a disclosure. af-hipaa verifies (zeroes) ONLY when that
   independent earliest identity is unambiguous and lands AT OR AFTER the first protected disclosure;
   identity independently proven BEFORE the disclosure → no zero (a model-triggered af-hipaa is then a
   surfaced false positive); ambiguous / unprovable chronology → a critical `deterministic-privacy-conflict`
   review, never an automatic zero. The SAME chronology reconciles verify-before-access (invariant 7).
2. **Disclosure detection is refusal- and clause-aware, and the af-hipaa quote must map uniquely and
   overlap** (amends §0k/§0l.2). A navigator REFUSAL that governs a protected proposition in the same
   clause ("I cannot confirm whether your appointment is Tuesday until I verify you") is
   privacy-preserving, not a disclosure; clause boundaries still separate "I cannot confirm anything,
   but your appointment is Tuesday" so a later genuine disclosure is still caught. An af-hipaa quote
   must map to exactly ONE navigator turn and ONE clause; that clause is classified (a governing
   refusal vetoes it); and the quote must itself carry the disclosure content — a detached benign
   fragment of a disclosure clause does not verify. A quote mapping to several turns/clauses fails
   closed to review.
3. **Every identity claim binds to ONE discrete candidate** (amends §0j/§0l). `resolveIdentityCandidates()`
   groups claims into candidates — a designation, or a coherent typed-field sequence bounded by
   subject-switch cues. A complete identity requires firstName, lastName, and DOB from the SAME
   candidate; a claim crossing a candidate/sequence boundary fails closed. A THIRD-PARTY designation
   and a self/patient designation with the SAME name tokens are an ambiguous subject (a caller and a
   patient who merely share a name are two people). Candidate metadata is value-free.
4. **DOB ownership uses the exact quoted occurrence.** The verified caller quote (not the first
   identical date in the turn) locates the DOB; the value is located inside that quote occurrence; a
   quote that occurs more than once in the turn fails closed. A phone/address elsewhere in the turn
   still cannot short-circuit ownership.
5. **Lowercase surname particles survive in designations** (amends §0l.6). A recognized bounded
   surname particle ("de", "la", "van") is preserved when flanked by proper-name tokens, so
   "Maria de la Cruz" keeps "de la Cruz" for `splitPersonName`; ordinary lowercase prose is still
   dropped, and ambiguous multi-token names still fail closed.
6. **Provider-name detection covers more clinician terms and both grammatical directions** (amends
   §0l.5). It recognizes OB-GYN / OB GYN / obstetrician / gynecologist (etc.) and both "the doctor's
   first and last name" and "the first and last name of your doctor". Any answer to such a question
   establishes zero patient-name fields.
7. **Identity-verdict contradictions are reconciled, never silently deducted** (amends §0l.7,
   B7 A/B/C). A NOT_MET ordered-identity criterion the server proves satisfied (independently, or by
   the model's own canonical order — e.g. no disclosure occurred), and a NOT_MET base-identity
   criterion whose own submitted array server-verifies as a complete valid identity, are CREDITED,
   marked unresolved, recorded as a `contradictionFindings` entry, and force supervisor review — never
   a silent safety-critical deduction and never a silent pass. A `verify-before-access` MET while
   `verify-three` NOT_MET remains a malformed response (retry). A verified af-hipaa is incompatible
   with a proven "verified before access".
8. **The live smoke gates every early-disclosure case on a PRIVACY-SPECIFIC result** (amends §0l.7).
   A pre-verification disclosure case passes only via a verified af-hipaa (with a non-pass
   recommendation) OR a `deterministic-privacy-conflict` that is a mandatory `needs_review` with
   `safetyRisk: 'critical'` — never a generic fail from an unrelated criterion. The set is now **20
   synthetic cases**, still keyed to `CALL_QA_LIVE_SMOKE_API_KEY(S)` only, no Firestore/private bank,
   no identifier values printed, and no calibration authority. `NOT_RUN`/`SKIPPED` never satisfy the
   gate.

## 0n. Non-null candidate binding, caller-owned DOB rejection, quoted-disclosure chronology (2026-07-23, correction pass #7)

The seventh independent review attacked three remaining implementation gaps in §0m. All have
failing-before regressions against exact head `6b876d2` in
[`api/qaCorrectionPass7.test.js`](../api/qaCorrectionPass7.test.js). These are server-side
enforcement changes only: the prompt remains `call-qa-grader-v7`, the OB/GYN rubric remains
`qa-rubric-obgyn-v1`, and Pediatrics/historical grades are unchanged.

1. **Every identifier resolves to the same non-null candidate.** A complete identity requires
   firstName, lastName, and DOB each to resolve to a candidate and all three candidate IDs to match.
   A null candidate is incompleteness, not permission to skip the binding check. Valid direct-patient
   and uninterrupted single-third-party sequences remain valid.
2. **DOB ownership is one shared deterministic decision.** Both model-evidence evaluation and
   independent transcript chronology reject explicit caller ownership (`my DOB`, `my date of birth`,
   `I was born`) for a third-party patient. Patient-linked wording (`her/his DOB`, `the patient's
   DOB`, a named-patient possessive) remains valid. When caller and patient DOBs both occur, exact
   occurrences are evaluated independently and only the patient-linked occurrence may bind.
3. **af-hipaa authority belongs to its quoted disclosure.** `classifyAfHipaaEvidence()` returns the
   uniquely mapped navigator turn, clause index, and clause. A model-triggered automatic fail may
   zero only when identity was incomplete at that quoted disclosure turn. An unrelated deterministic
   hit may create review conflict but never lends automatic-fail authority to the model quote.
   Information-request questions are not disclosures; genuine pre-verification disclosures still
   verify, post-verification disclosures do not, and ambiguous mappings remain review-only.

## 0j. Identity coherence and provenance (2026-07-22, correction pass #3)

The third independent review attacked the boundaries §0i introduced. These invariants are
binding and each has an adversarial reproduction test in
[`api/qaVerificationSubject.test.js`](../api/qaVerificationSubject.test.js) plus end-to-end
coverage in [`api/qaVerificationPipeline.test.js`](../api/qaVerificationPipeline.test.js) and
[`api/_qa-calibration.test.js`](../api/_qa-calibration.test.js).

1. **The three identifiers belong to ONE patient.** `resolvePatientSubject` resolves the single
   patient's name tokens from the whole call. A first/last name value must be a token of that
   patient's name; a DOB is attributed to the **nearest preceding name designation** in its turn,
   so a caller's own DOB stated before naming a different patient does not verify; and two
   different people designated as the patient (`ambiguous-patient-subject`) fails closed. `scoreQa`
   evaluates ONE canonical identity array and feeds BOTH `verify-three` and `verify-before-access`,
   and `validateQaResponse` rejects the two identity criteria carrying different arrays — the two
   criteria can never be credited from different identities. The evaluation carries a value-free
   `audit` record (`firstNameTurn`/`lastNameTurn`/`dobTurn`/`completedAtTurn`/`subjectConsistent`),
   never the identifier values.
2. **Name ownership is field-and-context aware, not "alphabetic tokens = a name."** A stopword set
   removes ordinary request/scheduling/clinical/weekday words; a full-person DESIGNATION (a
   self-identification or third-party designation) must be Title-cased, so a lowercase phrase like
   "I am really scared" is not treated as a rival name; the bare "who is" patient alternative is
   removed; and a provider-name question ("Who is your provider?", "the doctor's name") is
   distinguished from a patient-name question and never establishes patient identity. Single-FIELD
   answers to an explicit patient-name question are exempt from the capitalization requirement — the
   navigator's question grounds them.
3. **A one-word name answer verifies.** "First name?" → "Maria." is accepted for a caller-side name
   claim whose quote is essentially just the value; the two-word minimum still applies to all other
   evidence, and a DOB is never a single bare token.
4. **The identity contract is CALLER-ONLY everywhere.** The response schema `identityEvidence.role`
   enum is `['caller']`, the evidence-role rules no longer invite navigator turns, and
   `validateQaResponse` rejects a navigator-role identity claim. This is a model-visible change, so
   the prompt version moved to **`call-qa-grader-v6`**.
5. **A MET identity criterion needs a complete structured payload or the response RETRIES.**
   `validateQaResponse` requires a MET identity criterion to carry exactly one claim per identifier
   (firstName, lastName, dob), no duplicates; a missing/empty/partial/duplicate payload trips the
   existing same-model malformed-response retry rather than degrading into a navigator deduction.
6. **A protected-disclosure match takes PRECEDENCE over a generic safe prefix within one clause.**
   `findProtectedDisclosureInTurn` checks the protected-disclosure categories on each clause BEFORE
   treating it as benign, so "Okay your labs are normal." / "I can help you confirm your appointment
   is Tuesday." are disclosures. **Correction to §0i:** the detector's only failure mode is NOT a
   lost criterion — an UNDER-match (a phrasing no pattern catches) can leave a claimed MET standing,
   so it is a trust gate that raises the bar, not a comprehensive PHI detector.
7. **Raw validation rejects non-string `evidence`/`note`.** They are required strings; a numeric or
   object value is rejected (tripping the retry) rather than coerced to `""`, which would let a
   malformed ABSENCE criterion pass.
8. **Historical calibration resolves by the RECORDED rubric version.** `_qa-calibration.js`
   validates a graded fixture's human and model criteria against the rubric the RECORDED version
   maps to (never the current department profile), and enforces an explicit
   (department, rubricVersion, promptVersion) compatibility matrix via `callQaProvenanceCompatible`.
   A genuine OB/GYN v3 record graded under the shared `qa-rubric-v2` validates its OLD closing ids
   under the shared rubric; impossible tuples (`obgyn` + v3 + `qa-rubric-obgyn-v1`, or a NEW OB/GYN
   run claiming the shared rubric under v6) are rejected; an unknown recorded version is rejected;
   and a synthetic example must still use the current prompt version. Compatibility policy:
   `pediatrics` + `qa-rubric-v2` under any supported prompt; `obgyn` + `qa-rubric-v2` under v3 only
   (pre-profile); `obgyn` + `qa-rubric-obgyn-v1` under v4/v5/v6.

**Live model-contract gate (superseded by §0k).** The ten-case shape remains, but missing dedicated
credentials no longer skip successfully; only the exact VERIFIED contract in §0k satisfies the
pre-merge/release step.

## 0i. Verification integrity (2026-07-21, correction pass #2)

The second independent review probed the trust boundaries rather than the authored
happy-path fixtures and found seven ways the pipeline could be fooled or could mislead.
These invariants are binding and each has a reproduction test in
[`api/qaVerificationIntegrity.test.js`](../api/qaVerificationIntegrity.test.js) plus an
end-to-end fixture in
[`api/qaVerificationPipeline.test.js`](../api/qaVerificationPipeline.test.js).

1. **A protected disclosure is detected per CLAUSE, never per turn.**
   A navigator turn is split conservatively (sentence punctuation, semicolons, commas, and
   a coordinating conjunction only when a new clause actually follows) and each clause is
   classified independently. **A safe clause vetoes only itself.**
   `Let me open your chart. I can see Dr. Smith ordered an ultrasound.` is a disclosure.
   The whole turn is re-checked afterwards as a safety net for a disclosure the split
   fragmented, but only when at least one clause was not itself safe, so punctuation alone
   can never manufacture a finding. Abbreviations (`Dr.`), initials and decimals do not end
   a clause. `findProtectedDisclosure()` returns the turn index, the clause index, the
   clause text and the category, and transcript order is preserved: the first disclosure is
   the earliest matching clause in the earliest navigator turn.
2. **A name is evidence only when it is proven to be THE PATIENT'S name.**
   A name-shaped token proves only that a name was said. Every name identifier must
   (a) come from a **caller-side turn** — the navigator saying a name proves nothing about
   what the caller supplied — and (b) sit inside a span that designates the patient: a
   caller self-identification, an explicit third-party designation
   (`I'm calling for my daughter, Maria Alvarez`), or a direct answer to the navigator's
   patient-name question. A navigator self-introduction, a provider or staff name (a title
   immediately before the value disqualifies it outright), and a name merely mentioned in
   passing are all rejected with `not-a-patient-identity-context`. When a turn contains both
   a self-identification and an explicit third-party designation, **the designation wins** —
   the caller is not the patient. An authorized third party may supply the patient's
   identifiers. Ambiguous ownership never receives automatic credit; it withholds the
   criterion and the supervisor reviews it.
   *Granularity note:* identity is located to a TURN, a disclosure to a CLAUSE. When both
   fall in the same turn the two are not comparable, so `verify-before-access` requires
   identity to complete **strictly before** the disclosure turn and otherwise fails closed.
3. **An identity criterion never persists or displays model-authored evidence.**
   Scoring an identity criterion uses the structured `identityEvidence` array and ignores
   the model's free-text `evidence`, so that free text must not survive onto the scored
   criterion — otherwise a grader could submit valid claims alongside an invented quote
   ("The patient was fully verified.") and that fabricated sentence would reach the
   supervisor panel, the grade projection and coaching prose as if it had been observed.
   `scoreQa` replaces it with a **server-derived summary** built only from what the server
   re-verified, marked `evidenceSource: 'server-derived'` and rendered as a statement rather
   than a quotation. The summary is **privacy-safe**: it names which identifiers verified
   and in which turn, never the identifier values, so a patient's name and date of birth are
   not repeated back into navigator-facing feedback. The raw model claim is retained on
   `modelJudgment` for audit only.
4. **A date of birth must parse as a REAL calendar date.**
   `parseDateOfBirth` supports written and spoken forms (`March 2, 1991`, `2 March 1991`,
   `03/02/1991`, `March second nineteen ninety-one`, `the second of March nineteen
   ninety-one`) and validates the result: February 29 only in a real leap year, no
   February 30/31, no April 31, no month 13, no day 0. A phone number, an address, a bare
   year and a bare month/day are rejected. Deliberately unsupported and documented in the
   module: two-digit years, digit-by-digit dictation, and relative wording — these fall
   through to "not a date of birth", which withholds credit and routes to review rather than
   guessing. The birth-year range is **unchanged** (1800–2099); no new age policy was
   invented.
5. **Malformed model output is rejected BEFORE normalization.**
   `validateQaResponse` validates the RAW response: non-object entries, missing/non-string
   ids, unknown ids, duplicate ids, invalid verdicts, illegal basis/evidence combinations,
   malformed `identityEvidence`, and `identityEvidence` on a criterion whose profile does
   not declare the identity policy. Auto-fails must answer **every configured id exactly
   once**; unknown, duplicate, missing and malformed entries are rejected, and a triggered
   auto-fail must carry its verbatim quote. Nothing is silently filtered or overwritten, so
   a contract violation trips the existing same-model malformed-response retry instead of
   being normalized into a seemingly valid result.
6. **Being interpretable is not the same as being producible.**
   `SUPPORTED_CALL_QA_PROMPT_VERSIONS` lists the versions this build can interpret in a
   STORED record; `isCurrentPromptVersion` is what a NEW run must use. A genuine graded
   `human-pilot` record may carry any supported version; an authored `synthetic-example` must
   carry the current one, so a fixture cannot manufacture a historical population that never
   existed. An `operational-pilot` fixture is terminal and UNGRADED — it has no `modelRun` and
   therefore declares no prompt/rubric/model version at all (it feeds only capture-reliability
   and safety gates), so it is never a carrier of a historical version. Unknown versions fail
   closed, and the readiness gates keep prompt populations from blending.
7. **A metadata-less historical result uses the HISTORICAL SHARED rubric.**
   Before department profiles existed there was one rubric and every department was graded
   with it, so a stored result carrying no rubric metadata was necessarily produced by
   `qa-rubric-v2` — whatever department it belongs to. `profileForGradedAttempt` therefore
   resolves: a recorded known version → that profile (department cross-checked); a recorded
   unknown version → `null`; **no version at all → the historical shared rubric**. The
   stored department describes the CALL, not the rubric, and may no longer select a profile.
   The live scored path is unaffected because every newly graded attempt records its
   metadata.
8. **Rubric interpretability is resolved at RENDER time, never read from a stored flag.**
   `resolveQaScoringState(qa, profile?)` in
   [`src/lib/qaDomainScoring.js`](../src/lib/qaDomainScoring.js) is the single selector,
   returning `{ profile, scoringUnavailable, reason, recordedRubricVersion }`. A persisted
   `scoringUnavailable` boolean is **not** the authority — it was written by whichever build
   graded the attempt, so a record produced by a future rubric carries stale `domainScores`
   and no flag at all. An unknown recorded version always withholds the domain/competency
   projection (a stored `scoringUnavailable: false` cannot override that, and a stored
   `true` cannot suppress a resolvable version); the recorded score and raw criteria still
   render with a provenance warning, and the page never crashes on absent metadata.

## 0g. Department Call QA rubric profiles (2026-07-21)

The Call QA rubric is **department-based**. These strengthen §0/§0a–§0f and are binding for
the SCORED Call QA test.

1. **There is exactly one department → rubric resolution point.**
   `getQaRubricProfile(department)` in
   [`src/data/qaRubricProfiles.js`](../src/data/qaRubricProfiles.js) is the only place a
   department is mapped to a rubric. No `department === 'obgyn'` branch may be scattered
   through the grading pipeline; department behavior is expressed as profile DATA
   (criteria, points, applicability, auto-fails, evidence policies, grader instructions).
2. **The department comes from the server-authoritative attempt, never the browser.**
   `gradeCallQaTranscript` resolves the profile ONCE from
   `scenarioContext.department` (derived from the stored attempt) and threads that one
   object through prompt construction, response validation, repairs, scoring, category
   totals, core/NA handling, auto-fail evaluation, deterministic findings, the review
   layer, and the QA domain/competency projections.
3. **Unsupported departments FAIL CLOSED.** A department with no profile throws
   `UnsupportedQaDepartmentError`; the scored endpoint returns 422 and never calls the
   grader. A future department must never silently inherit another department's rubric,
   and there is no `?? 'pediatrics'` default anywhere in the scored path.
4. **Validation, repair and scoring are BOUND to one profile.** `validateQaResponse`
   emits an immutable `profileBinding` = `{ department, rubricVersion, signature }`.
   The signature is a deterministic fingerprint over department, version, pass
   threshold, category shape, and every criterion's points, `core` applicability,
   category, domain/competency tags, and evidence policy, plus every auto-fail's
   identity and tags, plus the safety-critical and repairable sets. **Criterion IDs
   alone are explicitly NOT profile identity** — two profiles with identical IDs but
   different weights or applicability have different signatures.
   The binding must survive the repair stage unchanged (`repairQaVerdictsForScenario`
   throws on a mismatch and returns it untouched), and `scoreQa` re-checks it before
   scoring anything. `scoreQa` additionally enforces EXACT criterion-set integrity —
   no unknown IDs, no missing IDs, no duplicates, no extras. A Pediatrics-shaped model
   response is rejected as malformed under the OB/GYN profile (triggering the existing
   retry) rather than being partially scored.
5. **Every profile totals exactly 100 points and passes at 85.** Adding or re-shaping a
   department may redistribute criteria WITHIN the 100 points but may not change the total
   or the pass threshold. Enforced across every configured profile by
   `gradingInvariants.test.js` (I-PROFILE).
6. **Repairable ⊆ safety-critical, per profile.** Invariant R10 is now checked for each
   profile independently, and every safety-critical id must exist in its own profile.
7. **Evidence is navigator-only unless a criterion explicitly opts in.** The single named
   exception is `identity-verification` (see §0h). Auto-fails may NEVER carry an evidence
   policy — an auto-fail accuses the navigator of an explicit unsafe statement and always
   requires a navigator quote.
8. **Stored results are read under the rubric that graded them, and an UNKNOWN
   version is never silently reinterpreted.** Every newly graded attempt records
   `qa.gradingMetadata.rubricDepartment` + `rubricVersion`. Three cases are strictly
   distinguished:
   - **No rubric metadata at all** (genuinely pre-versioning legacy) → the historical
     shared rubric, because that is what those records were written under. This is the
     ONLY legacy fallback.
   - **A recorded version we know** → that profile. A recorded department that
     disagrees with the version's own department is corrupt metadata → `null`.
   - **A recorded version we do NOT know** → `profileForGradedAttempt()` returns
     `null` and `resolveScoringProfile()` returns `null`. It must never become
     Pediatrics or any other current profile.

   For an unknown recorded version: `qaDomainScoreSummary()` returns an explicit
   `{ domainScores: null, competencyScores: null, scoringUnavailable: true,
   scoringUnavailableReason: 'unknown-rubric-version', recordedRubricVersion }`; the
   supervisor UI renders "Unavailable — graded with rubric version X" instead of a
   fabricated projection and does not throw; shadow automation stays ineligible
   (`incomplete-rubric-result`); and calibration rejects it as an unsupported rubric
   version. The recorded score and criteria remain visible and unchanged — only the
   derived per-domain projection is withheld. **No Firestore migration is performed and
   no historical grade is rewritten.**
9. **Calibration is department-aware.** A calibration fixture is validated against its own
   department's profile; unknown-for-this-department criterion/auto-fail ids fail
   validation. Rubric drift is measured WITHIN a department
   (`mixedRubricVersionWithinADepartment`) — two departments legitimately reporting
   different rubric versions is department identity, not a mixed population.

## 0h. Structured identity verification (2026-07-21, corrected)

A narrow, explicitly named exception to the navigator-only evidence rule of §0.1–0.3,
implemented in [`api/_qa-identity-verification.js`](../api/_qa-identity-verification.js).

> **Correction note.** The first implementation checked only that a two-word quote
> appeared somewhere in one turn. That proved nothing: it could not distinguish a first
> name from a last name from a phone number, and it could not aggregate identifiers across
> turns. A grader could mark `verify-three` MET quoting "What is your date of birth?" — a
> question the caller never answered — and the server agreed. The rules below replace it.
>
> **Second correction note (superseding parts of this section — see §0i).** The structured
> contract below still proved only that a name-SHAPED token appeared in the declared turn.
> It did not prove the token was the PATIENT'S name, so a navigator self-introduction, a
> provider surname and an unrelated mention could together satisfy all three identifiers.
> §0i.2 adds patient-identity ownership. §0i.3 additionally forbids persisting the model's
> free-text `evidence` on an identity criterion, and §0i.4 replaces the date parser
> described in point 4 below with one that accepts spoken dates and validates a real
> calendar date.

1. **Why the exception exists.** A caller frequently volunteers her own full name and date
   of birth in one sentence, or identity is established across several chronological turns.
   The proof of *which identifiers were collected* then legitimately lives in a CALLER turn,
   and a navigator-only gate would fail a navigator who did nothing wrong.
2. **The grader must submit STRUCTURED evidence, not prose.** For each identity criterion
   the response carries an `identityEvidence` array of
   `{ field: 'firstName'|'lastName'|'dob', value, role, turnIndex, quote }`. The prompt
   numbers every transcript turn `[n]` so the index is unambiguous.
3. **The server re-derives every claim; a model Boolean is never trusted.** For each claim:
   the field is known; the declared turn exists and its role matches; the quote appears
   verbatim (under the shared normalization) in THAT turn; the claimed value appears inside
   the quote; and the value is shaped like the identifier it claims to be. Any failure
   rejects that claim with a recorded reason.
4. **A date of birth must parse as a real date.** *(Superseded by §0i.4 — the parser now
   also accepts spoken forms and validates the calendar.)* `parseDateOfBirth` accepts
   month-name, full-numeric and spoken-word forms, requires a REAL calendar date, and
   explicitly rejects phone-shaped and address-shaped values, bare years, and bare
   month/day. **A phone number or a home address can therefore never satisfy DOB.**
5. **All three identifiers are required, and they must be distinct.** A first name alone or
   a last name alone never satisfies full-name verification, and the same single value
   cannot be claimed as both first and last name.
6. **Identifiers may be spread across turns.** Each field keeps its EARLIEST verified turn;
   `completedAtIndex` is the last turn needed to complete the set. A single caller sentence
   may satisfy all three.
7. **It is opt-in per criterion.** Only criteria declaring
   `evidencePolicy: 'identity-verification'` may use it — currently OB/GYN `verify-three`
   and `verify-before-access`. Caller wording can therefore never earn an unrelated
   navigator-performance criterion.
8. **MET credit only.** An evidence-based NEGATIVE remains navigator-only, so a caller's
   words can never substantiate an accusation against the navigator; an unverifiable
   negative stays `unresolved` and forces `needs_review` exactly as before.
9. **Auto-fails are never covered**, including `af-hipaa` — the disclosing line is a
   navigator line and must be quoted as one.
10. **`verify-before-access` is decided by transcript ORDER, and FAILS CLOSED.** There is
    exactly ONE protected-disclosure detector
    (`classifyProtectedDisclosure` / `findProtectedDisclosureIndex`), covering appointment
    details, prior visits, chart contents, orders, provider notes, lab/imaging results,
    prescriptions/medication records, account balances, and patient-specific clinical
    details. Generic wording ("let me open your chart", "let me check that", "I can help
    you", public office information, and verification QUESTIONS) is explicitly not a
    disclosure. The criterion is satisfied only when identity is fully verified AND
    `completedAtIndex < disclosureIndex`. When identity cannot be verified the ORDER is
    unknowable, so the criterion is not awarded and is marked `unresolved` with
    `verification-order-unverified`, which forces supervisor review. The detector can only
    REJECT a claimed MET, never create one.
11. **The verification definition has one source.** `OBGYN_VERIFICATION_IDENTIFIERS` renders
    into `verify-three`, `verify-before-access`, the `af-hipaa` auto-fail text, and the
    department grader instructions, so the regular criterion and the privacy auto-fail can
    never accept different definitions.
12. **The prompt's evidence rules are rendered from the profile.** There is no global
    "never quote a caller line" sentence — that contradicted this policy. `evidenceRoleRules`
    emits the navigator-only default, the navigator-only rules for negatives and auto-fails,
    and the identity exception ONLY for the criteria the active profile declares. A profile
    with no identity policy is told so explicitly.

Prior last-updated: 2026-07-18 (private Call QA runtime merged with PR #33 calibration
invariants; randomized server-side selection + the private callerCaseFile caller contract).

## 0f. Private Call QA runtime and caller-observable grading (2026-07-17)

These strengthen §0/§0a–§0d. All are binding for the SCORED Call QA test.

1. **The public repository contains no runtime Call QA scenario instance.**
   `src/data/callQaScenarios.js` exposes only anonymous aggregate minimum counts.
   It contains no scenario IDs/versions, caller or clinician names, opening lines,
   public briefings, workflow/difficulty, domains/competencies, rule IDs, grading
   context, hidden facts, expected actions, critical misses, or scoring notes. In
   particular, the repo exposes no opening-line-to-answer mapping.
2. **Every runtime scenario-instance field comes from the private server store.**
   The relay loads active documents from `callQaScenariosPrivate` with Firebase
   Admin. Firestore denies all client reads and writes to that collection,
   including supervisor clients. A missing, inactive, malformed, wrong-department,
   or document-ID/version-mismatched private instance fails closed; the relay does
   not fall back to public code or browser data.
3. **The server chooses the scenario, unpredictably.** Selection uses the
   authenticated navigator identity and Admin-loaded prior attempts: recently
   used scenarios are excluded first, then the server picks RANDOMLY among the
   remaining eligible scenarios (falling back to a random choice over the full
   valid set when every scenario is recent). The random source is server-side
   (injectable only for deterministic tests). Browser-supplied scenario IDs,
   prompts, history, metadata, or answer hints are ignored, and the browser can
   never predict the next scenario from bank order.
4. **Caller and browser projections are separated and allowlisted.** The scored
   caller receives `publicBriefing`, `callerName`, `openingLine`, and the
   private `callerCaseFile` — the caller's own consistent knowledge contract
   (goal, known facts, reveal rules, behavior, consistency constraints),
   validated server-side and injected only into the server-built system
   instruction. The caller never receives grader-only `hiddenChartState`,
   workflow/rule metadata, grading context, expected actions, critical misses,
   or scoring notes — chart authority is not caller knowledge. Browser
   `ready.scenario` contains only the neutral briefing (`prompt`), caller name,
   department, and primary domain; `callerCaseFile` never reaches the browser,
   the navigator history projection, or the client bundle (enforced by the
   postbuild scanner).
5. **The attempt snapshot is the permanent grading authority.** Before `ready`, the
   server stores one immutable scenario snapshot on the attempt, including identity
   and version, workflow and narrow rule-derived coverage tags, private grading
   context, provenance, hidden facts, expected actions, critical misses, and scoring
   notes. Grading reconstructs context from that stored snapshot only. It never
   joins the current private bank and never accepts browser scenario material, so a
   later rotation cannot alter an already-captured attempt.
6. **Snapshot authority fails closed.** The grader cross-checks server capture/type,
   attempt scenario ID, snapshot ID, department, version, and required private
   grading fields. Missing, incomplete, forged, or mismatched authority disables
   fairness repairs and forces supervisor review; it is never silently trusted.
7. **An attempt ID is not authorization.** `/api/grade-call-qa` verifies the
   authenticated navigator owns the attempt. Firestore rules prevent navigators
   from reading the raw server attempt, so relaying an `attemptId` reveals neither
   the transcript nor private snapshot.
8. **Navigator history is a projection, never a raw Call QA read.** Navigators
   cannot get or list server/curated/protected legacy QA attempts. Authenticated
   `/api/my-interviews` derives `navigatorId` from the token and strictly allowlists
   result/status fields. It also protects and normalizes legacy rows carrying
   `qaScenarioId` or `qa`; transcript, scenario snapshot, grading context, rubric,
   lease, and future unlisted fields stay private. Supervisors may read attempts,
   but not the private runtime bank.
9. **Practice documents cannot be forged into Call QA evidence.** A navigator cannot
   create or mutate a practice interview with server authority,
   `assessmentType:'call-qa'`, `qaScenarioId`, or `qa`. Phase 3 completion requires
   a projected/server row with `assessmentType:'call-qa'` and a saved `qa`; an
   arbitrary legacy practice payload cannot unlock the phase.
10. **OB/GYN grading is caller-observable.** Exact internal clicks, buttons, visit
    labels, queues, channels, or staff assignments never need to be narrated. A
    natural caller-facing statement of the same safe outcome counts. A fairness
    repair may correct an internal-narration-only model false negative only when a
    separate verified navigator line proves the safe caller-visible outcome and no
    substantive workflow failure, over-promise, or clinical advice is present.
11. **OB/GYN deterministic findings are explicit-contradiction-only.** Absence of an
    internal term never creates a finding or review. Explicit unsafe/wrong clauses
    are evaluated independently, so a safe disclaimer cannot hide a later unsafe
    instruction; reasons are de-duplicated and `assessQa` adds each review-flag
    category once.
12. **Private coverage metadata is honest and narrow.** Each privately provisioned
    OB/GYN scenario uses de-duplicated domain and competency unions derived from its
    referenced rules, with its primary domain included. A shared all-six-domain/
    fixed-five-competency default is forbidden.
13. **Private content must be rotated before deployment.** All formerly committed or
    published scenario instances and opening-line mappings are compromised and may
    not be reused. Fresh private provisioning that meets the anonymous minimums is a
    pre-deploy prerequisite and is intentionally outside this PR. The rules/code in
    this branch are not live until deployed.
14. **The production bundle is checked.** `npm run build` scans `dist` for private
    runtime field/store tokens and fails if the private shape crosses into the
    browser graph. Provisioning files are gitignored and must never be committed.

## 0e. Call QA calibration and shadow automation (PR 3, 2026-07-16)

These rules measure the existing pipeline without weakening §§0–0d:

1. **Synthetic regression is not human accuracy evidence.** Synthetic examples,
   deterministic corpus runs, captured model replay, adjudicated human pilots,
   optional live runs, and automation readiness are reported as separate layers.
2. **Only sanitized, adjudicated human-pilot fixtures count toward grading
   accuracy and automation sample minimums.** Each requires at least two
   independent pseudonymous reviewers; incomplete or malformed fixtures fail
   validation and are never silently skipped.
3. **Calibration is offline by default.** The normal CLI performs no model or
   Firestore call. Live grading requires `CALL_QA_CALIBRATION_LIVE=true`,
   `--live`, `--confirm-live`, and Gemini keys, and uses only local sanitized
   fixtures through the existing pinned `gradeCallQaTranscript()` path.
4. **Version populations remain isolated.** Grader, rubric, prompt, scenario,
   capture, and live voice versions are split. Mixed grader/rubric/prompt
   populations cannot be approved unless one population independently satisfies
   every gate.
5. **Small perfect samples are insufficient.** Readiness enforces coverage
   minimums and 95% Wilson intervals; observed 0/N errors are never described as
   proof of zero true risk.
6. **One false automatic auto-fail or one review miss fails the safety gate.**
   Safety-critical criterion agreement is measured from the existing
   `SAFETY_CRITICAL_CRITERIA` source.
7. **Shadow eligibility fails closed and is non-final.** It cannot change
   `qa.pass`, create/update `qaFinalReview`, alter Phase 3 completion, supervisor
   actions, capability/history scoring, training, or coaching.
8. **No audio or production-data collection is introduced.** Calibration
   fixtures are local sanitized text; there is no Firestore export/downloader.
9. **Calibration labels are complete and internally consistent.** Every human
   reviewer, adjudication, and model result labels the complete rubric exactly
   once (`NA` when inapplicable). Human recommendation/finalPass/reviewRequired
   and model recommendation/pass relationships fail closed when contradictory.
10. **Operational failures remain in capture readiness without becoming grading
    evidence.** Sanitized `operational-pilot` fixtures may omit transcript,
    human labels, and model output only for terminal abandoned,
    capture-incomplete, or grade-failed attempts. Any transcript/count data that
    exists is validated. These fixtures affect capture reliability and critical
    capture-failure gates, but never final-outcome, criterion, auto-fail accuracy,
    coverage sample, or automation minimum counts.
11. **Clean-pass consideration requires outcome diversity.** Calibration policy
    v2 requires meaningful pass, fail, and review-required populations; zero-
    denominator Wilson intervals are unavailable and cannot pass.
12. **Shadow v2 requires the full server trust chain.** Eligibility requires
    calibration policy v2, verified scenario metadata, complete rubric output,
    and server transcript metadata consistent with the attempt. It remains
    diagnostic-only and never writes a final verdict.
13. **Pilot smoke has no readiness authority.** `qa:pilot-smoke` validates only
    local synthetic/rehearsed management-test cases and Phase 3 behavior. Its
    `PILOT_SMOKE_VERIFIED` status cannot supply an approved calibration
    population, unlock shadow eligibility, or enable automatic finalization.

## 0d. Call QA checkpoint write serialization (PR 2 final merge blocker, 2026-07-15)

These strengthen §0a/§0b/§0c. All are binding for the SCORED Call QA test.

1. **Call QA checkpoint writes are serialized per session.** At most one
   `checkpointTranscript()` write is ever in flight for a call; concurrent requests
   coalesce onto a single write loop rather than launching parallel Firestore
   writes. An older checkpoint can therefore never overwrite a newer one.
2. **Coalesced checkpoints always persist the newest pending bounded snapshot.**
   The snapshot is generated when the queued write executes, so obsolete
   intermediate snapshots are never written; when a write finishes, only the newest
   pending state is re-written (not every stale intermediate).
3. **Terminal capture finalization waits for and supersedes all checkpoint work.**
   `terminateCapture()` sets `finalizing` (which blocks any new checkpoint from
   starting), cancels the trailing-checkpoint timer, drains all in-flight
   checkpoint writes, then performs `finalizeCapture()` as the LAST write.
4. **No checkpoint can modify transcript data after terminal finalization.** Once
   `finalizing`/`finalized` is set, checkpoint requests refuse to start a write, so
   nothing can overwrite the finalized `transcript` / `lastTranscriptAt` /
   `captureMetadata.*` after the terminal write.
5. **A capture acknowledgement means the terminal write is both successful AND the
   final transcript write.** `captured` is sent only after `finalizeCapture()`
   succeeds, and no checkpoint write can begin or complete after it. A checkpoint
   failure preserves dirty state (never silently forgotten) so a later checkpoint
   or the terminal finalization still persists the newest transcript; a failed
   terminal write keeps the retake behavior and never sends `captured`.

## 0c. Call QA capture integration fixes (PR 2 final merge review, 2026-07-15)

These strengthen §0a/§0b. All are binding for the SCORED Call QA test.

1. **Transcription ordering is not guaranteed at ANY point in the call**, not only
   after End Call. An input/output transcription can arrive after its
   `turnComplete`. The relay never treats raw WebSocket arrival order as speaking
   order at any point.
2. **An ordinary active-call boundary also requires a short transcription-settle
   window before the exchange is committed** (`CALL_QA_ACTIVE_TURN_SETTLE_MS`).
   `turnComplete` marks a boundary but never immediately flushes; any transcription
   during the window is added to the pending exchange and resets the window.
3. **A late transcription stays with its correct exchange.** A fragment that
   arrives after exchange N's boundary is committed as part of N (never merged into
   N+1). Each exchange is flushed navigator-first. End Call absorbs any pending
   active exchange before draining, with no duplicated lines.
4. **Staged transcript content follows the SAME bounds as committed content**
   (`MAX_QA_TURN_CHARS`, `MAX_QA_TURNS`), via one shared `boundedAppend`. Oversized
   staged strings are truncated (never silently — `turn-length-capped` is recorded)
   and a staged tail can never push the durable snapshot past the max turn count.
5. **Late staged content receives a guaranteed trailing durable checkpoint.**
   Post-boundary/drain fragments force an immediate durable checkpoint; debounced
   writes mark the checkpoint dirty and guarantee one trailing durable write, so a
   crash mid-settle cannot leave the durable copy behind memory. Before `captured`
   is sent, all pending transcript state is bounded and included in the successful
   terminal write.
6. **The browser finalization guard always exceeds the server's maximum drain +
   settle + persistence/network window.** The server computes the guard from its
   actual config (`clientFinalizeGuardMs`) and sends it in the trusted
   `ready.finalization.clientGuardMs`; the browser applies a defensive clamp and
   never trusts a client-supplied timing. A client fallback (≥ the server maximum)
   is used only if the value is missing/invalid.
7. **`captured` means the final BOUNDED transcript was successfully persisted** —
   including the latest staged content, exactly once.

## 0b. Call QA capture/finalization hardening (PR 2 merge review, 2026-07-15)

These strengthen §0a. All are binding for the SCORED Call QA test.

1. **Transcription delivery order is NOT guaranteed.** Gemini Live delivers
   `inputTranscription` and `outputTranscription` independently, and a
   transcription may arrive AFTER the associated `turnComplete`. The relay must
   never treat raw WebSocket arrival order as speaking order. Each exchange is
   staged and flushed navigator-first, so a caller output that arrives before its
   navigator input is still stored after it.
2. **Clean finalization requires a post-End boundary PLUS a quiet settle window.**
   End Call runs a bounded two-stage drain: an overall `CALL_QA_DRAIN_TIMEOUT_MS`
   deadline, and a `CALL_QA_TRANSCRIPT_SETTLE_MS` window that only elapses once a
   post-End `turnComplete` boundary has been seen AND no transcription has arrived
   for the full window (any transcription resets it). `turnComplete` alone never
   closes the capture. Hitting the overall deadline finalizes `capture_incomplete`.
3. **A capture is acknowledged only AFTER the terminal Firestore write succeeds.**
   The relay sets `finalized` only after `finalizeCapture` resolves. If that write
   fails, the browser is told the capture could not be finalized (retake) — never
   `captured`. The attempt is preserved for supervisor recovery; the failure is
   never silently swallowed.
4. **A grade returned to the browser must be the PERSISTED grade.** After losing a
   grading lease, the endpoint returns a stored grade only if the fresh attempt is
   actually `graded` with `qa`+`grade`; otherwise it returns a retryable
   409/503. It never returns the losing request's local, unpersisted model output.
5. **Grading leases require EXACT ownership.** `commitGrade`/`markGradeFailed`
   mutate grading state only when `gradingLeaseId === leaseId`. A null/missing/
   different lease id is not ownership — a stale request can never clobber a newer
   one.
6. **Existing stored grades remain readable during a grader outage.** The scored
   endpoint requires Gemini keys ONLY when it must actually invoke the model; an
   already-graded attempt returns its stored result with zero keys configured. If
   keys are missing when new grading is needed, the claimed lease is released
   (grade_failed, transcript retained) so no attempt is left in a live lease.
7. **Inactive/deleted roster members cannot start a new scored attempt.** The
   relay loads the trusted roster member (existence + `status !== 'inactive'` +
   id match) before creating an attempt. A valid-but-stale token cannot let a
   deactivated navigator begin a scored assessment; no attempt doc is created on
   rejection.
8. **Capture integrity FAILS CLOSED.** A clean capture requires BOTH
   `captureStatus === 'captured'` AND `captureMetadata.captureComplete === true`.
   Missing, contradictory, or malformed capture metadata forces `needs_review`
   (`capture-integrity-incomplete`) — it never defaults to complete.
9. **Termination provenance is accurate.** `captureMetadata.endedBy` records the
   real cause (`navigator` / `client_disconnect` / `upstream_service` /
   `server_timeout`); `drainReason` is recorded separately.
10. **Transcript truncation is never silent.** Capping a turn at
    `MAX_QA_TURN_CHARS` records a `turn-length-capped` warning before slicing, and
    the still-staged final exchange is checkpointed through the settle/debounce
    mechanism so a crash cannot leave the durable copy behind the in-memory one.

## 0a. Server-authoritative Call QA transcript (PR 2, 2026-07-14)

These ten statements are binding for the SCORED Call QA test (`mode: 'test'`).
They govern where a graded transcript comes from and who may write it; they do
not weaken any §0 evidence/model invariant, which still runs on that transcript.

1. **A scored Call QA transcript originates from the authenticated server relay**
   (`api/live-relay.js`), captured from Gemini Live's `inputTranscription`
   (navigator) / `outputTranscription` (caller). The browser never supplies it.
2. **Browser captions are a non-authoritative mirror.** The relay forwards
   `transcript` messages to the browser for live display only; a `transcript`
   message *from* the browser is ignored entirely.
3. **The scored endpoint loads the transcript by server attempt id.**
   `POST /api/grade-call-qa` accepts only `{ attemptId }`; it loads the stored
   transcript + scenario snapshot via Firebase Admin and ignores any transcript,
   scenario, department, or grader metadata a client includes alongside the id.
4. **The browser cannot read, write, or replace a scored transcript, private
   snapshot, or QA result.** `firestore.rules` forbids a navigator from reading
   protected server/curated/legacy QA attempts and from creating a document with
   `assessmentType:'call-qa'`, `captureAuthority:'server'`, or a curated QA
   scenario id or `qa`, and from mutating any field (transcript, capture state,
   scenario snapshot, grade, qa, server metadata) of a protected attempt. Navigator
   history comes through `/api/my-interviews`; all server writes go through Admin.
5. **Trusted private scenario snapshots are chosen and stored server-side.** The
   relay selects a validated active instance from `callQaScenariosPrivate` using
   authenticated identity and trusted prior attempts, then stores the immutable
   `scenarioSnapshot` before `ready`. Grading uses only that stored snapshot, so a
   later private-bank rotation cannot change the context an already-captured
   attempt was graded against.
6. **Finalization has a bounded drain protocol.** End Call signals end-of-audio
   upstream and waits at most `CALL_QA_DRAIN_TIMEOUT_MS` for a final transcription
   boundary so the last navigator utterance is not lost to socket teardown.
7. **Incomplete capture is explicit and never silently treated as complete.** A
   drain timeout, upstream drop, or unexpected browser disconnect finalizes the
   attempt as `capture_incomplete` / `abandoned` with recorded metadata. An
   `abandoned` attempt is never auto-graded; a `capture_incomplete` attempt graded
   later is forced to `needs_review` via the `capture-integrity-incomplete` flag.
8. **Legacy browser-captured attempts remain labelled legacy.** Attempts without
   `captureAuthority` are treated as legacy browser capture, never relabelled
   server-authoritative, and never bulk-migrated.
9. **Server authority protects against browser tampering — not speech-recognition
   error.** "Server-captured" means the transcript came from the trusted relay, not
   that transcription was perfect. UI wording says "captured by the call server,"
   never "perfect," and the §0 non-final supervisor-review rule still applies.
10. **Grading is idempotent and retryable via a lease.** An already-graded attempt
    returns its stored result without a second Gemini call; a prior failure keeps
    the transcript for retry; a Firestore grading lease prevents two concurrent
    requests from invoking the grader twice.

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
   `NOT_MET` with `basis: 'EVIDENCE'` whose quote fails navigator verification is
   marked `unresolved: true` (`unresolvedReason: 'negative-evidence-not-verified'`),
   forces `recommendation: 'needs_review'`, and — when the criterion is
   safety-critical — raises `safetyRisk` to at least `elevated`. The original model
   judgment is never presented as observed. **The narrow repair exception:** an
   unverifiable evidence-based negative normally stays provisionally `NOT_MET`, but a
   separate whitelist-only deterministic fairness repair backed by *independently
   verified* navigator evidence may change the **effective** verdict to `MET`. The
   repair does **not** validate the model's fabricated negative quote — the repaired
   `MET` is supported by *different, verified* navigator evidence. The original model
   judgment and its unresolved status are retained in `modelJudgment` /
   `unresolved`, and the attempt still gets `recommendation: 'needs_review'`. This
   exception applies only to the existing repair whitelist (`REPAIRABLE_CRITERIA`).
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
server attempt department
  → rubric profile resolution  (getQaRubricProfile — ONE resolution point; fails closed on an
                                unsupported department; the resolved profile is threaded through
                                every stage below, never re-imported globally)
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
  → deterministic conflicts    (model-POSITIVE error protection: Pediatrics routing-policy
                                conflicts; OB/GYN explicit contradictions; deterministic unsafe
                                language — never absence of internal narration; see §3a)
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
- The **grader** may be a literalist (fail natural wording, demand PE/TE/internal
  chart or destination phrases) → the repair layer may overturn only whitelisted
  criteria under strict evidence gates. OB/GYN repair additionally requires a
  verified, contradiction-safe caller-visible outcome.
- The **grader** may be routing-blind or lenient (mark MET with a real quote on a call
  that mis-routes, hedges, over-promises, gives clinical advice, or explicitly
  contradicts an OB/GYN rule) → the deterministic conflict layer flags the
  observed contradiction and forces `needs_review` on an otherwise-confident pass.
  Missing OB/GYN internal narration is not an observed contradiction. Findings
  never change verdicts or scores.
- The **repair layer** may be wrong → repairs are logged with the grader's original
  verdict/note/evidence, surfaced to supervisors, and an outcome-flipping repair
  forces `needs_review`.
- The **score** may sit at the pass boundary → the borderline band (±`QA_REVIEW_MARGIN`)
  forces `needs_review`, which also absorbs round-up-to-85 edge cases.

### Unverifiable evidence-based negatives and the repair exception

> An unverifiable evidence-based negative remains unresolved. It normally stays
> provisionally NOT_MET, but a separate whitelist-only deterministic fairness repair
> backed by independently verified navigator evidence may change the effective verdict
> to MET. The original model judgment and unresolved status remain preserved, and the
> attempt must still receive `recommendation: 'needs_review'`.

This is intentional and enforced by the corpus + `grade-call-qa.test.js`
("repair preserves raw model judgment and unresolved trust status"): the repair does
NOT validate the model's fabricated negative quote — the repaired MET is supported by
*different, verified* navigator evidence; the unresolved original allegation is retained
in `modelJudgment`; supervisor review stays mandatory; and it applies only to the repair
whitelist (`REPAIRABLE_CRITERIA` = `know-rule`, `doc-te`).

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
literal "TE"/"Telephone Encounter" wording; or demanding that an OB/GYN navigator
narrate an internal chart/queue/channel/staff label despite stating the equivalent
safe caller-visible outcome). They are deliberately narrow.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| R1 | Repairs may touch ONLY the criteria in `REPAIRABLE_CRITERIA` (`know-rule`, `doc-te`), and only in the direction NOT_MET → MET. Nothing may ever be repaired downward. | `gradingInvariants.test.js` |
| R2 | Repairs never add, remove, or alter auto-fails, and a verified auto-fail always zeroes the test regardless of repairs. | `gradingInvariants.test.js` |
| R3 | Every repair is recorded in `qa.repairs` with the rule id, the new evidence quote, and the grader's ORIGINAL verdict, note, and evidence — supervisors can always reconstruct what the grader said. | corpus harness, unit tests |
| R4 | Repair evidence must use the **department + authoritative `workflowType` routing policy**. Pediatrics refill = PEDS Encounters; Pediatrics referral = Pediatrics referral owner; OB/GYN non-pregnant GYN and pregnancy scheduling = PSS; OB/GYN results/clinical questions = TE/message to nursing/clinical staff. A destination accepted for one workflow is neither globally accepted nor globally rejected. | routing-policy unit tests |
| R5 | Questions, offers, hypotheticals, historical checks, caller lines, and destination-less statements are never repair evidence. Pediatrics/exact-destination policies still require their authoritative commitment. An OB/GYN caller-observable repair may accept natural "clinical team"/equivalent wording only for a workflow with a private caller-outcome matcher and only when it clearly commits to the safe outcome. | corpus `question-not-commitment`; caller-observable unit tests |
| R6 | Call-level validation uses the **final committed routing decision**. Correct→wrong never repairs; wrong→correct repairs only when the later line explicitly corrects the earlier commitment; two unexplained conflicting destinations never repair. Line and call validation share one destination vocabulary. | adversarial contradiction tests |
| R6a | Any over-promise or clinical-advice signal blocks repairs. Safe language is excluded — but **only within its own clause**: "I can't promise approval" is not a promise, and "I can't tell you if it's safe — that's for the nurse" is scope discipline; "I can't promise timing, but I guarantee approval today" IS an over-promise, and "that's for the nurse, but take twice the dose" IS clinical advice. Detection is clause-aware (split on sentence boundaries, semicolons, em dashes, but/however/although/meanwhile). | clause-aware unit tests; corpus `unsafe-mixed-*` |
| R6b | Hedged/uncertain routing language ("I think…", "I'm not sure whether…", "might", "may", "probably", "supposed to"…) is never a routing commitment and never supports a repair. Confident valid commitments ("I will send this to PEDS Encounters", "PEDS Encounters will follow up", "Actually, PEDS Encounters is the correct queue") remain accepted. | hedging unit tests; corpus `hedged-routing` |
| R7 | Missing required workflow details block repairs. For the standard pediatric refill PE repair, the call must be COMPLETE: medication name, preferred pharmacy, callback details, AND out-of-medication/urgency handling, plus a safe accepted route. Any missing signal blocks the repair. | corpus `incomplete-refill-no-pharmacy`; completeness unit tests |
| R8 | The PE repair requires a STRICTLY PE-only grader complaint, checked positively: after normalization, every token of the note must be a PE term or generic failure scaffolding — any substantive residue (urgency, "out", callback, pharmacy, queue, promise…) blocks the repair. The doc-te repair requires a POSITIVELY scoped literal-TE/absent-action complaint (must reference TE/route/send/message/log/forward and contain no wrongness, missing-detail, urgency, destination, or incompleteness complaint). Generic "did not say" / "not documented" notes are NOT sufficient. | `isStrictPeOnlyFailure` / `isLiteralTeWordingFailure` unit tests |
| R9 | A repair that flips the outcome (would have failed without the repaired points) forces `recommendation: needs_review` with the `repair-changed-outcome` flag. Repairs are decision support, not the final word. | `assessQa` unit tests, corpus `good-refill-natural` literalist |
| R10 | Every repairable criterion is also in `SAFETY_CRITICAL_CRITERIA`, so an UNREPAIRED miss on it still flags a passing call for review — the repair layer cannot become the only scrutiny those criteria get. | `gradingInvariants.test.js` |
| R11 | An OB/GYN caller-observable repair requires all of: the model's stated failure is internal-narration-only; a separate verified navigator line states the workflow's safe caller-visible outcome; the applicable private rule IDs support that outcome; and there is no other workflow failure, over-promise, or clinical advice. The repair never proves a silent click occurred and never requires an internal label aloud. | caller-observable and no-over-repair unit tests |

### §3a — Deterministic conflict layer (model-positive error protection)

The repair layer guards against grader FALSE NEGATIVES. The deterministic conflict
layer (`evaluateQaDeterministicFindings`) guards against grader FALSE POSITIVES —
know-rule/doc-te marked MET despite a deterministic contradiction or unsafe signal.
Legacy Pediatrics route policies remain conservative about wrong, contradictory,
ambiguous, or missing commitments. OB/GYN is different: only an explicit spoken
contradiction/unsafe commitment is a finding; absence of an internal system term is
not evidence that the workflow was wrong.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| C1 | A deterministic conflict is NOT a fairness repair: findings never touch verdicts, scores, auto-fails, or `qa.repairs`. The model's original criteria and score are preserved for auditability. | `gradingInvariants.test.js` I-CONFLICT |
| C2 | A model-positive verdict with a Pediatrics authoritative routing conflict or an explicit OB/GYN rule contradiction can never become a confident silent pass: findings force `recommendation: needs_review` (flags `model-routing-conflict` / `deterministic-safety-conflict`) whenever the result would otherwise pass confidently. | corpus lenient cases; `finalizeQaResult` unit tests |
| C3 | Findings are persisted on `qa.deterministicFindings` (type, reason, evidence, destinationId, affectedCriteria) and rendered to supervisors in the "Deterministic grading conflicts" section — they may force review but must never be hidden. | corpus aggregate test; `navigatorDetail.override.test.jsx` |
| C4 | The shared `assessQa` review contract accepts deterministic findings and forces `needs_review` without changing the model score or criteria. | `api/grade-call-qa.test.js` |
| C5 | Findings never upgrade or soften a fail; they only remove unwarranted confidence from a pass. | `finalizeQaResult` unit tests |
| C6 | For OB/GYN, missing `OB Verified`, `Take Action`, `High Priority`, `TE`, `OB Portal`, `Intermedia`, a clinician/staff name, or any other internal label is never a deterministic finding by itself. Natural caller-facing outcome wording is not treated as ambiguity or missing routing. | safe-natural-phrasing unit tests |
| C7 | OB/GYN explicit contradictions are evaluated clause by clause. A safe disclaimer protects only its own clause and cannot suppress a later unsafe instruction in the same turn. Duplicate reason codes are collapsed. | clause-aware contradiction tests |
| C8 | `assessQa` is the single owner of deterministic review flags and recommendation changes; each routing/safety category is emitted once. | duplicate-flag regression test |

Routing policies intentionally marked review-only because the repository sources do not
establish one exact destination: Pediatrics `records_forms`, `urgent_symptom_boundary`, and
`wrong_department_unclear_request`, plus OB/GYN `wrong_department_unclear_request`.
Those workflows receive no outcome-improving routing repair; a potentially outcome-changing
routing uncertainty is flagged for supervisor review.

## 4. Review-layer invariants

### Routing authority and calibration limits

Routing authority is strictly ordered: (1) owner-confirmed floor operations, (2)
explicit non-conflicting department SOP rules, (3) the immutable trusted private
scenario snapshot, then (4) generic repository language only when consistent.
The relay selects the private scenario; grading resolves policy from the stored
snapshot only; browser metadata and later bank changes cannot alter it.
Owner-confirmed deterministic routes are PEDS Encounters for pediatric refills,
Anisa for pediatric referrals, PSS OB for non-pregnant GYN, OB Portal for
pregnancy, Rebecca for MFM, and OB Portal or the scenario's explicit clinical
TE/message path for OB/GYN results. Pediatric records/forms (apart from trusted
subtype rules), urgent symptoms, unclear requests, and unknown/conflicting OB
workflows are review-only.

Those exact destinations are private workflow authority and repair/calibration
inputs, not a script that must be spoken to a patient. An OB/GYN navigator may state
the equivalent safe caller-visible outcome naturally; exact internal queue,
channel, button, visit-label, or staff-name narration is never required.

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
| V5 | The grading API resolves workflow/scoring metadata only from the immutable private snapshot on the server attempt. Missing/incomplete snapshots, server-authority mismatches, or ID/department/version mismatches disable repairs and add `unverified-scenario-metadata` with `needs_review`; browser fields and the current private bank are not grading authority. | snapshot-integrity unit tests |

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

1. `npm test` green — including the corpus harness and `gradingInvariants.test.js` —
   and `npm run build` green, including the private-runtime bundle scan.
2. New grading behavior → new corpus cases (fix direction AND abuse direction),
   verified to fail before the change.
3. If a repair rule is added: it must satisfy R1–R11 (whitelist, direction, logging,
   evidence gates, review-on-flip) and get corpus cases for its abuse direction.
4. Any Call QA authorization/private-store change requires `npm run test:rules`,
   including raw get/list denial, forged/legacy shapes, and private-bank denial.
5. Verify the public repo and built client contain no runtime scenario instance,
   opening-line mapping, or private provisioning artifact. Fresh private provisioning
   and compromised-content rotation are external pre-deploy prerequisites, never a
   source-control shortcut.
6. If a threshold changes: update §2/§4 here, `gradingInvariants.test.js`, and
   CLAUDE.md in the same commit.
7. Update this document, CLAUDE.md, and docs/HISTORY.md; replace any temporary
   verification placeholders before commit.
8. If a department rubric changes: bump THAT department's `rubricVersion` (never mutate a
   stored attempt), keep the profile at exactly 100 points and an 85 pass mark, satisfy
   §0g.1–9, and confirm the other departments' profiles are byte-for-byte unaffected. If a
   department is ADDED, it must be a new profile — never a fall-through to an existing one.
