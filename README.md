# Quarterly Knowledge Check — Prototype

A self-contained web app that demos a quarterly "knowledge check" for patient navigators
and the **capability map** it produces. Application-based scenario questions are scored
**per domain**, mapped to three levels (**Learning / Solid / Can-Teach**), and laid out in a
capability matrix. Framing throughout: *development and fit, not pass/fail.*

No backend, no accounts, no database — in-memory state only.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (default http://localhost:5173).

## Flow

1. **Start** — what the check is, with "Take the check" and "Team dashboard" buttons.
2. **Check** — one domain-tagged scenario per step, multiple choice.
3. **Your results** — per-domain scores + levels (no single overall grade).
4. **Capability matrix** — sample navigators + your row, color-coded, with three read-offs:
   **column gaps**, the **can-teach roster**, and a **readiness tally**. Click any navigator to
   open their dashboard.

## Screens (top nav)

- **Overview** — floor-wide KPIs (Solid+ rate, domain coverage, readiness depth), a
  capability-by-domain distribution, and panels for training priorities, floor strengths, and
  who's ready for more.
- **Take the check** — the live check flow.
- **Matrix** — the capability matrix (hero) + read-offs.
- **Navigators** — a card per navigator; click through to a personal **development dashboard**
  (strengths, growth areas, per-domain detail, assigned training, suggested mentors).
- **Training** — auto-assigned training, derived from each navigator's results: **Required**
  where they're at Learning, **Stretch** where they're Solid. Shown both as per-domain cohorts
  ("run one session for these five") and per navigator.

Everything is **knowledge-only** — derived purely from check results. No operational KPIs,
tenure, site, or prior-quarter data are invented.

## Where to tweak before the demo

Everything you'd want to adjust is in plain data files:

| What | File |
| --- | --- |
| Level thresholds, level labels/colors, palette | [src/data/config.js](src/data/config.js) |
| Domains + scenario questions (derived from the SOP) | [src/data/questions.js](src/data/questions.js) |
| Sample navigators + their per-domain scores | [src/data/navigators.js](src/data/navigators.js) |
| Training catalog (placeholder courses — swap in real materials) | [src/data/training.js](src/data/training.js) |
| Training auto-assign rules (which levels get Required/Stretch) | [src/data/config.js](src/data/config.js) |
| Scoring, read-offs, analytics + training logic | [src/lib/scoring.js](src/lib/scoring.js) |

The questions and domains are derived from the team SOP (`SOP Guide.pdf`, Aizer Health
Pediatric Department). To re-key the check to a different SOP, edit `DOMAINS` and `QUESTIONS`
in `questions.js`; everything else (scoring, levels, matrix, read-offs) follows automatically.

> All navigators and data are illustrative samples — no real people or patient data.
