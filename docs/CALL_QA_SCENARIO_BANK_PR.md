# Call QA Scenario Bank Foundation PR

## Purpose

This PR adds the first safe foundation for making the Phase 3 Call QA Test management-grade: a curated, inspectable scenario bank with workflow coverage and deterministic selection helpers.

It does **not** wire the bank into `VoiceCall.jsx` yet. That integration should happen in a follow-up PR after local test/build verification, because `VoiceCall.jsx` is a large live-audio component and should not be rewritten blindly through full-file replacement.

## Added

- `src/data/callQaScenarios.js`
  - 8 Pediatrics QA scenarios
  - 8 OB/GYN QA scenarios
  - workflow tags
  - difficulty tags
  - domain and competency tags
  - expected actions
  - auto-fail traps
  - routing rules
  - scoring notes
  - `getQaScenarios(department)`
  - `selectQaScenario({ department, priorAttempts })`
  - `qaScenarioCoverage(department)`

- `src/data/callQaScenarios.test.js`
  - validates required fields
  - validates unique IDs
  - validates domain/competency IDs
  - verifies 8 scenarios per live department
  - verifies workflow coverage
  - verifies selection avoids recent scenarios and favors underused workflows

## Follow-up wiring task

The next implementation PR should:

1. Import `selectQaScenario` into `VoiceCall.jsx`.
2. In `mode="test"`, select a curated scenario instead of generating a random domain/scenario.
3. Save the following fields on the interview doc:
   - `qaScenarioId`
   - `workflowType`
   - `difficulty`
   - `domainIds`
   - `competencyIds`
4. Keep practice voice calls on the existing generated scenario flow.
5. Add supervisor-visible scenario metadata in `NavigatorDetail.jsx`.

## Verification needed locally

Run:

```bash
npm test
npm run build
git diff --check
```

## Important limitation

This PR intentionally avoids modifying `CLAUDE.md` and `docs/HISTORY.md` because those are large full-file replacements through the connector. Before merge, update both docs per the project maintenance rule.
