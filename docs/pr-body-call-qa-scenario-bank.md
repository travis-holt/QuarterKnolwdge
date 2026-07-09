# Add curated Call QA Test scenario bank

Phase 3 Call QA assessments now anchor on a curated, department-specific scenario
bank instead of relying only on generic/random generation. The AI caller and the
deterministic rubric grader receive the same curated scenario context so facts and
expectations stay consistent within a call.

## Scenario bank structure

New `src/data/callQaScenarios.js` exports `CALL_QA_SCENARIOS`. Each scenario carries:

- `id`, `department`, `title`
- `workflowType`, `difficulty`
- `primaryDomainId`, `domainIds`, `competencyIds`
- `callerName`, `openingLine`, `scenario` (caller anchor facts)
- `expectedActions` (good navigator behavior)
- `criticalMisses` (safety / privacy / scope / routing / documentation failures)
- `scoringNotes` (fairness guidance for the grader)

All content is sanitized — no real patient data, no real provider names, no company
branding, no phone numbers or PII.

## Departments covered

- **Pediatrics** — 8 scenarios
- **OB/GYN** — 8 scenarios

Across 13 workflow types: new-appointment scheduling, scheduling change, prescription
refill, referral, records/forms (documentation), test-result / medical-advice boundary,
urgent-symptom boundary, wrong-department / unclear request, multiple-sibling family
lookup, insurance/eligibility confusion, new GYN visit, pregnancy-related visit, and
MFM-related request — i.e. lookup/intake, scheduling, routing, refill, referral,
clinical-boundary escalation, privacy-sensitive, wrong-department, urgent escalation,
and documentation nuance.

## How scenario selection works

- `getCallQaScenarios(department)` — curated scenarios for a department (safe empty
  array for unknown/mockup departments).
- `getCallQaScenarioById(id)` — lookup for history rendering.
- `selectCallQaScenario({ department, priorAttempts, now })` — deterministic given its
  inputs; avoids recently-used QA scenario ids when possible, falls back gracefully when
  all have been used recently. No unseeded randomness in the tested path.
- `callQaScenarioCoverage(department)` — coverage read-off.

`VoiceCall.jsx` (test mode only) selects a curated scenario, passes its anchor facts to
the existing `/api/interview-turn` caller init, and stores compact scenario metadata on
the saved interview doc.

## How the grader / caller receive scenario context

- The caller (Gemini Live / interview-turn) is anchored by the scenario's `openingLine`
  and `scenario` facts, so it stays consistent instead of inventing a colder opener.
- The deterministic Call QA rubric in `grade-call-qa` is unchanged; the scenario's
  `expectedActions` / `criticalMisses` are passed through as the minimal context bridge
  so the grader understands what good performance means for the selected call.
  `buildCallQaGradingScenario(scenario, metadata)` appends a plain-text
  "GRADING CONTEXT" block (title / workflow / difficulty + expected behaviors +
  critical misses) to the scenario string sent to `/api/grade-call-qa`. Metadata is
  threaded `runQaPersistenceSequence → gradeSavedAttempt → gradeQaRequest`. When no
  curated metadata exists (generated calls), the original scenario is sent unchanged.

## Persistence / history

`saveInterview(..., metadata)` now stores compact scenario metadata (`scenarioSource`,
`qaScenarioId`, `qaScenarioTitle`, `workflowType`, `difficulty`, `domainIds`,
`competencyIds`). Older docs without scenario ids still render safely (nullable fields;
no data migration).

## Safety guarantees

- No real patient data, no real provider names, no company branding.
- **No changes** to MCQ/Spot scoring, matrix scoring, `resultHistory`, `firestore.rules`,
  or auth/session code.
- The deterministic Call QA rubric is not rewritten — only a minimal scenario-context
  bridge was added.
- AI/API/Firebase are mocked in tests; no real Firebase writes.

## Local verification

- `npm test` → **462 passing**, 23 test files
- `npm run build` → clean
- `git diff origin/main...HEAD --check` → clean

New tests: `src/data/callQaScenarios.test.js` covers Pediatrics + OB/GYN validity,
unique ids, required fields, workflow diversity, and deterministic selection
(recent-avoidance + graceful fallback). Consumer wiring covered in
`components.test.jsx` / `db.test.js`.

## Changed files (vs `main`)

`CLAUDE.md`, `docs/HISTORY.md`, `src/components/NavigatorApp.jsx`,
`src/components/NavigatorDetail.jsx`, `src/components/VoiceCall.jsx`,
`src/components/components.test.jsx`, `src/components/roleApps.smoke.test.jsx`,
`src/data/callQaScenarios.js`, `src/data/callQaScenarios.test.js`,
`src/lib/db.js`, `src/lib/db.test.js`.

## Draft PR · no merge · no deploy

Open as a **draft**. Do not merge. No deployment as part of this change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
