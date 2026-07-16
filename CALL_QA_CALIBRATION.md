# Call QA calibration status

PR 3 builds offline calibration, coverage reporting, statistical readiness
gates, optional explicitly confirmed live evaluation, and a pure shadow
clean-pass evaluator.

Current committed evidence:

- 3 synthetic examples
- 0 human pilot fixtures
- readiness: `INSUFFICIENT_DATA`

That result is expected. Synthetic fixtures and the deterministic regression
corpus do not prove real-model or real-transcription accuracy.

Run:

```bash
npm run qa:calibrate
npm run qa:coverage
```

Reports are written to the gitignored
`artifacts/call-qa-calibration/` directory. The full operating procedure,
metrics, gates, reviewer workflow, privacy rules, and live-mode safeguards are
in [docs/CALL_QA_CALIBRATION.md](docs/CALL_QA_CALIBRATION.md).

PR 3 does not enable automatic final verdicts, store audio, or access production
data.
