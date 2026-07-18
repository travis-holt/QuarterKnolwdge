# Call QA calibration status

PR 3 builds offline calibration, coverage reporting, statistical readiness
gates, optional explicitly confirmed live evaluation, and a pure shadow
clean-pass evaluator.

Current committed evidence:

- 3 synthetic examples
- 0 human pilot fixtures
- 0 operational pilot fixtures
- readiness: `INSUFFICIENT_DATA`

That result is expected. Synthetic fixtures and the deterministic regression
corpus do not prove real-model or real-transcription accuracy.

The runtime scenario bank is private (Admin-only Firestore
`callQaScenariosPrivate`); calibration references committed non-production
synthetic descriptors or an ignored local private-bank manifest, and coverage
reports `runtime-bank-evidence-missing` until a real manifest is supplied. The
grader prompt version is `call-qa-grader-v3`, owned by
`api/_qa-grading-versions.js`. The private bank has NOT been provisioned; fresh
private provisioning (8 Pediatrics / 15 OB/GYN minimum, with caller case files)
remains a required operator step before deployment.

Calibration policy v2 requires complete rubric labels, valid PR #32 capture
states, meaningful pass/fail/review populations, and non-zero statistical
denominators. Shadow policy v2 remains diagnostic-only and requires verified
server metadata plus a complete rubric result.

Real terminal operational failures may be added as sanitized
`source: "operational-pilot"` fixtures. They affect capture reliability and
safety gates only; they do not increase grading-accuracy or automation sample
counts.

Run:

```bash
npm run qa:calibrate
npm run qa:coverage
npm run qa:pilot-smoke
```

`qa:pilot-smoke` is a separate 15-case synthetic/rehearsed Monday management
check. Its `PILOT_SMOKE_VERIFIED` status has no calibration or automation
authority. The future production automation gate remains the independently
human-reviewed 200-call policy.

Reports are written to the gitignored
`artifacts/call-qa-calibration/` directory. The full operating procedure,
metrics, gates, reviewer workflow, privacy rules, and live-mode safeguards are
in [docs/CALL_QA_CALIBRATION.md](docs/CALL_QA_CALIBRATION.md).

PR 3 does not enable automatic final verdicts, store audio, or access production
data.
