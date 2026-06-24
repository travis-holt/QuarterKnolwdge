# Design: Gemini-Powered Scenario-Based Competency Assessment

**Date:** 2026-06-24 · **Status:** Implemented (Phase 1a–1d)

## Problem

The Quarterly Knowledge Check was a deterministic MCQ test: one `correctOptionId` per
question, binary scoring, a single 6-SOP-domain axis, static `questions.js`. The owner wants
an intelligent, scenario-based competency assessment that measures how navigators *apply* SOP
procedures under edge cases and pressure — not just recall — and that can grow its own
question bank from the SOP.

## Decisions (made with the owner)

1. **Competency model = second axis.** Keep the 6 SOP domains AND add 9 competencies
   (SOP Knowledge, SOP Application, Critical Thinking, Customer Handling, Communication,
   Risk Management, Escalation, Compliance, Problem Resolution). Both axes are derived from
   the same answers.
2. **Multi-signal MCQ scoring.** Each option carries a `points` value (0–100, partial credit)
   and an authored SOP-referenced `rationale`, replacing binary right/wrong.
3. **Live, Gemini-powered SOP→scenario generation**, server-side.
4. **Serverless backend on Vercel.** The Gemini key lives only in the function
   (`GEMINI_API_KEY`), never the browser. Migrated hosting GitHub Pages → Vercel.
5. **Question bank in Firestore + human review gate.** Generated scenarios land as `draft`;
   the supervisor reviews/edits/activates. `scoring.js` takes questions as input.
6. **Rule-based coaching (no LLM)** after each check, built from the authored rationales.

## Architecture

- **Frontend:** React 18 + Vite, served at root on Vercel (base `/`).
- **Serverless:** `/api/generate-scenarios.js` (Gemini proxy, validates + repairs output),
  `/api/health.js`. Helpers prefixed `_` (`_sop-context.js`) so Vercel doesn't route them.
- **Firestore:** `roster`, `results` (now `+competencyScores`), and new `questions`
  (`{domainId, competencies[], scenario, options[{id,text,points,rationale}], correctOptionId,
  status:'draft'|'active'|'archived', source, createdAt}`).
- **Scoring (`lib/scoring.js`, pure):** `scorePerDomain(answers, questions)` and
  `scorePerCompetency(answers, questions)` average per-option points; `buildMatrixRows` carries
  both axes; `competencyDistribution(rows)` mirrors `domainDistribution`. Levels reuse the
  existing 3-level traffic-light system via `scoreToLevel()`.

## Components

- **Coaching.jsx** — per-question review (your choice, points, best answer, both rationales) +
  competency strengths/gaps. Shown right after submit.
- **NavigatorDetail / Overview** — competency breakdown (navigator) + competency distribution
  (supervisor), beside the existing domain views.
- **QuestionBank.jsx + QuestionEditor.jsx** — supervisor review gate: generate, review/edit,
  activate, archive, delete. Only `active` questions appear in the navigator's check.

## Data flow (generation)

Supervisor clicks Generate → client POSTs `{domainId, count, secret}` to
`/api/generate-scenarios` → function calls Gemini (structured JSON output) → validates/repairs
each question → returns drafts → client persists them via `db.saveDraftQuestions` as `draft` →
supervisor reviews and activates → navigators' checks read the active bank.

## Security (pilot-grade)

- `GEMINI_API_KEY` + `GENERATION_SECRET` are server-only env vars (never `VITE_`-prefixed).
- Endpoint gated by the supervisor passcode; output validated before it can be persisted.
- Human review gate before any AI question becomes a live assessment.
- Firestore rules remain open per-collection (no auth yet) — must add real auth before
  production.

## Out of scope (Phase 2)

AI-graded open-ended responses, AI interview simulation, generative (LLM) coaching, and finer
per-signal sub-scoring (SOP-compliance / risk / CX / efficiency broken out). The Vercel
serverless layer built here is reused for them.

## Verification

`npm test` (46 green: points scoring + competency functions), `npm run build` clean,
`npm run dev` boots. End-to-end: take check → coaching → dashboards (both axes); supervisor
generates → reviews → activates → live in a check; `GEMINI_API_KEY` absent from the bundle.
