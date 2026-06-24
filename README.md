# Quarterly Knowledge Check

A web app that runs a quarterly "knowledge check" for patient navigators and renders the
**capability map** it produces. Application-based scenario questions are scored on **two axes** —
6 SOP **domains** (the topic) and 9 **competencies** (how a navigator thinks, decides, and
communicates) — each mapped to three levels (**Learning / Solid / Can-Teach**). Framing
throughout: *development and fit, not pass/fail.*

It's a real multi-user app: navigators sign in, take the check, and get **rule-based coaching**;
supervisors watch the capability map fill in live, and can **generate new scenarios from the SOP
with Gemini**, review them, and activate them. Data persists in Cloud Firestore; the Gemini call
runs in a Vercel serverless function (the API key never reaches the browser).

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed local URL (default http://localhost:5173).

Without Firebase config the app boots to a friendly "not connected" state — see setup below.

## Firebase setup (required to take it live)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add a **Web App** (the `</>` icon) — no Firebase Hosting needed.
3. Enable **Firestore Database** (Build → Firestore Database → Create).
4. Copy `.env.local.example` → `.env.local` and fill in the `VITE_FIREBASE_*` values from
   Project Settings → Your apps → SDK setup. (`.env.local` is gitignored.)
5. Apply the security rules in [`firestore.rules`](firestore.rules) (paste into Firestore → Rules).
6. Change `SUPERVISOR_PASSCODE` in [src/data/config.js](src/data/config.js) from the placeholder.
7. Restart `npm run dev`.

> The pilot has **no real authentication** (name + PIN for navigators, a passcode for supervisors).
> That's acceptable for a small trusted pilot with no sensitive data; replace with Firebase Auth
> before any production use.

## Gemini scenario generation (optional — for the Question Bank)

The supervisor **Questions** tab can generate scenario drafts from the SOP. This calls Gemini
through a serverless function so the API key stays server-side.

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Set two **server-only** env vars (NOT `VITE_`-prefixed): `GEMINI_API_KEY` and
   `GENERATION_SECRET` (set the secret equal to your `SUPERVISOR_PASSCODE`). See
   [`.env.local.example`](.env.local.example).
3. The `/api` functions only run on Vercel or under `vercel dev` — plain `npm run dev` serves the
   app but not `/api`, so the Generate button needs `vercel dev` locally (or a deploy).

Generated scenarios always land as **drafts**; nothing goes live until a supervisor activates it.

## Roles & flow

The Start screen asks **"I'm a navigator"** or **"I'm a supervisor."**

- **Supervisor** (passcode) lands on the team **Overview** and has the full management app:
  Overview · Matrix · **Navigators** (add people to the roster, each with a 4-digit PIN) · Training.
  Everything updates live as navigators submit.
- **Navigator** picks their name from the roster and enters their PIN. First time → they take the
  check, then get a **coaching review** (answer-by-answer, with the best answer and why, plus
  competency strengths/gaps), then land on their personal dashboard (per-domain **and**
  per-competency breakdown, strengths, growth areas, suggested mentors, assigned training).
  Returning → straight to the dashboard. They see **only their own data** — **My results** and
  **My training**.

A supervisor must **add a navigator to the roster first** (Navigators tab) before that person can
sign in.

## Screens (supervisor)

- **Overview** — floor-wide KPIs, capability-by-domain distribution, training priorities, floor
  strengths, and who's ready for more.
- **Matrix** — the capability matrix (hero) + read-offs: column gaps, can-teach roster, readiness.
- **Navigators** — the full roster (with "Not yet taken" for those who haven't submitted) and an
  **Add navigator** form. Click anyone who's taken the check to open their dashboard.
- **Training** — auto-assigned training: **Required** where a navigator is at Learning, **Stretch**
  where they're Solid. Shown as per-domain cohorts and per navigator.
- **Questions** — the question bank: generate scenarios from the SOP, review/edit drafts, and
  activate them. Only **active** questions appear in the navigator's check.

Everything is **knowledge-only** — derived purely from check results. No operational KPIs, tenure,
site, or prior-quarter data are invented.

## Where to tweak

| What | File |
| --- | --- |
| Supervisor passcode | [src/data/config.js](src/data/config.js) (`SUPERVISOR_PASSCODE`) |
| Level thresholds, level labels/colors, palette | [src/data/config.js](src/data/config.js) |
| Domains + seed scenario questions (derived from the SOP) | [src/data/questions.js](src/data/questions.js) |
| Competency taxonomy (the 9 competencies) | [src/data/competencies.js](src/data/competencies.js) |
| Training catalog (placeholder courses — swap in real materials) | [src/data/training.js](src/data/training.js) |
| Training auto-assign rules (which levels get Required/Stretch) | [src/data/config.js](src/data/config.js) |
| Scoring (both axes), read-offs, analytics + training logic | [src/lib/scoring.js](src/lib/scoring.js) |
| Firestore reads/writes (roster · results · questions) | [src/lib/db.js](src/lib/db.js) |
| Gemini generation prompt + SOP grounding | [api/generate-scenarios.js](api/generate-scenarios.js), [api/_sop-context.js](api/_sop-context.js) |
| Session (localStorage) | [src/lib/session.js](src/lib/session.js) |

The domains and seed questions are derived from the team SOP (`SOP Guide.pdf`, Aizer Health
Pediatric Department). To re-key the check to a different SOP, edit `DOMAINS` in `questions.js`,
refresh `api/_sop-context.js`, and either edit `SEED_QUESTIONS` or generate a fresh bank from the
**Questions** tab; scoring, levels, matrix, and read-offs follow automatically.

## Build, test, deploy

```bash
npm test            # Vitest unit tests for the scoring logic (both axes)
npm run build       # production build to dist/
# deploy: Vercel (Git-connected push, or `vercel --prod`).
# Set env vars in the Vercel project: VITE_FIREBASE_* (client) and
# GEMINI_API_KEY + GENERATION_SECRET (server-only).
```

The live check currently assesses **Pediatrics** only; the other departments show empty states
until they get their own question sets. All navigator data is real (from Firestore) — there are no
sample navigators.
