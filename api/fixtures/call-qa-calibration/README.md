# Call QA calibration fixtures

Only sanitized local fixtures belong here. The committed JSON files are
`source: "synthetic-example"` examples and are excluded from every real-world
accuracy and readiness calculation.

Human pilot fixtures must use `source: "human-pilot"`, contain at least two
independent pseudonymous reviewers, and include completed adjudication. Never
copy production Firestore documents into this directory. Remove names, contact
details, document IDs, credentials, tokens, and real patient information before
creating a fixture.

See `docs/CALL_QA_CALIBRATION.md` for the schema and reviewer workflow.
