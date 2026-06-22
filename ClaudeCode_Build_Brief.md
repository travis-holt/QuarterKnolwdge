# Build Brief — Quarterly Knowledge Check Prototype

## What I'm asking you to build

A **single, self-contained web app prototype** that demonstrates a "quarterly knowledge check" for a team of patient navigators (contact-centre agents who handle patient calls), and the **capability map** it produces. This is a **prototype to demo to management** — not a production tool. It should run locally / as a self-contained app with no external services, no backend accounts, no auth provider, no real database. In-memory or local state is fine. Sample data is expected.

I will provide, separately, our **SOP / scheduling protocol and rules** document. **Use that document as the source for the knowledge domains and the scenario questions.** Read it, identify the natural knowledge domains within it, and generate realistic scenario-based questions from it. Do not invent domains independently of the SOP — derive them from what the SOP actually contains. You will understand the real content better from that document than from any guess in this brief, so let it drive the domains and question content.

---

## Core concept (so the build makes sense)

The check tests **application, not recall** — scenario questions ("a patient calls wanting X, situation is Y, what do you do?"), not trivia. Every question is **tagged to a domain**. Scoring therefore produces a **score per domain, per person** — never a single overall number. Those per-domain scores populate a **capability matrix**: navigators as rows, domains as columns, each cell showing one of three levels — **Learning / Solid / Can-Teach**. The matrix is the centrepiece; everything else feeds it.

Framing throughout the UI: this is **"development and fit, not pass/fail."** No language of passing, failing, ranking-to-punish, or discipline. It should read as a development tool people *want* to be on.

---

## Scope — the lean prototype

Build these, and only these:

### 1. Take-the-check flow (interactive)
- A navigator can **take the check live** in the browser — click through the scenario questions and submit.
- Questions are **multiple choice**, each visibly **tagged with its domain**.
- Pull the questions and domains from the SOP I provide. Aim for ~2–3 questions per domain, ~15–20 total. If the SOP is large, pick the most floor-relevant domains.
- On submit, the answers **auto-score per domain** (% correct within each domain).

### 2. Scoring → level mapping
- Convert each per-domain score into a level:
  - **Learning** (lower band), **Solid** (mid band), **Can-Teach** (top band).
- Use sensible thresholds (e.g. <60 Learning, 60–84 Solid, 85+ Can-Teach) — make the thresholds easy to find/change in the code.

### 3. The capability matrix (the hero screen)
- Grid: **rows = navigators, columns = domains, cells = level (colour-coded).**
- Pre-populate with **sample navigators** (invent ~6 realistic first names) so the matrix looks full, then have the **live check-taker's results appear as a new/updated row** so the demo shows the pipeline end to end: take check → matrix updates.
- Colour discipline: three clear levels, one warm accent doing the emphasis.

### 4. Read-offs from the matrix (the "so what")
On or beside the matrix, surface these automatically:
- **Column gaps** — highlight any domain where most navigators are "Learning" (a floor-wide training priority).
- **Can-Teach roster** — for each domain, list who can teach it.
- **Readiness signal** — tally each navigator's count of "Can-Teach" cells (a data-backed "who's ready for more" indicator).

---

## What NOT to build (out of scope for the prototype)
- No real Google Forms / Sheets integration, no external APIs.
- No authentication, user accounts, or roles.
- No persistent database or server backend (in-memory / local state only).
- No admin CMS for editing questions in-app — questions can live in a config file/array in the code.
- No multi-tenant, no real patient data, no company names or logos.

Keep it lightweight on purpose. "Runs as a single self-contained app, start in seconds" is the goal — that lightweight quality is itself part of the pitch.

---

## Design / tone
- Calm, professional, credible — an **internal product explainer for management**, not a flashy consumer app.
- Warm, understated palette: soft neutral/ivory background, a single warm clay/terracotta accent, near-black text. Three matrix levels clearly distinguishable.
- The matrix is the visual centrepiece — give it the cleanest, most prominent treatment.
- Clear, minimal, readable. No clutter.

---

## Suggested screens / flow
1. **Start** — one line explaining the check ("a short quarterly check — real scenarios, development and fit, not pass/fail") and a "Take the check" button.
2. **Check** — one scenario question per step (or a clean single-page list), each domain-tagged, multiple choice.
3. **Your results** — the taker's per-domain scores and levels.
4. **Capability matrix** — the full grid with sample navigators + the taker's row, plus the three read-offs (column gaps, can-teach roster, readiness tally).

A simple nav to move between "Take the check" and "View the matrix" is enough.

---

## Acceptance criteria (how I'll know it's right)
- [ ] I can take the check in the browser and submit it.
- [ ] Questions and domains are derived from the SOP I provide, and each question shows its domain tag.
- [ ] Submitting produces a **per-domain** score, not a single total.
- [ ] Per-domain scores map to **Learning / Solid / Can-Teach** with thresholds that are easy to change in code.
- [ ] The **matrix** renders with sample navigators and updates with my taken result.
- [ ] The matrix surfaces **column gaps**, a **can-teach roster**, and a **readiness tally** automatically.
- [ ] No external services, accounts, or backend required — it just runs.
- [ ] Tone and palette match: calm, professional, ivory + clay, matrix as the hero.

---

## Notes
- All navigators and any data are illustrative samples — no real people or patient data.
- Thresholds, sample navigator names, and the question set should all be easy to locate and edit in the code, so I can tweak them before the demo.
- **Wait for / use the SOP document I provide to generate the domains and scenario questions — that content is the source of truth for what the check actually tests.**
