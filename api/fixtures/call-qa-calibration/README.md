# Call QA calibration fixtures

Only sanitized local fixtures belong here. The committed JSON files are
`source: "synthetic-example"` examples and are excluded from every real-world
accuracy and readiness calculation.

Human pilot fixtures must use `source: "human-pilot"`, contain at least two
independent pseudonymous reviewers, and include completed adjudication. Never
copy production Firestore documents into this directory. Remove names, contact
details, document IDs, credentials, tokens, and real patient information before
creating a fixture.

Real terminal capture/grading failures use `source: "operational-pilot"`. They
may represent only `abandoned`, `capture_incomplete`, or `grade_failed`
attempts and omit human review, model output, and transcript data. If a
transcript or turn counts are included, their roles, text, and counts are still
validated. Operational fixtures count only toward capture reliability and
safety gates; they never count as grading accuracy or automation sample volume.

For grading fixtures, every reviewer, the adjudicated result, and the model run
must include all 20 rubric criteria exactly once. Use `NA` for inapplicable
criteria; partial label sets are rejected. Capture/grading fields and transcript
role counts must match the PR #32 state machine.

See `docs/CALL_QA_CALIBRATION.md` for the schema and reviewer workflow.

Runtime scenarios are PRIVATE (Admin-only Firestore `callQaScenariosPrivate`).
Fixtures reference calibration scenario descriptors: the committed
`synthetic-*` descriptors from `api/_qa-calibration-scenarios.js` (explicitly
`nonProduction: true`, `calibrationAuthority: "none"`,
`evidenceUse: "synthetic-rehearsal-only"`), or — for real operator runs — a
metadata-only private-bank manifest passed via `--private-manifest` (an ignored
local file; never committed; private instance fields such as opening lines,
briefings, grading context, hidden facts, or caller case files are rejected by
the manifest validator). Synthetic-example fixtures must carry the three
non-production marks. Coverage run without a private manifest honestly reports
`runtime-bank-evidence-missing`; the anonymous aggregate minimum counts alone
are never treated as runtime coverage evidence.
