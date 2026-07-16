# Quarterly Knowledge Check

A web app that runs a quarterly "knowledge check" for patient navigators and renders the
**capability map** it produces. Application-based scenario questions are scored on **two axes** —
6 SOP **domains** (the topic) and 9 **competencies** (how a navigator thinks, decides, and
communicates) — each mapped to three levels (**Learning / Solid / Can-Teach**). Framing
throughout: *development and fit, not pass/fail.*

It's a real multi-user app: navigators sign in, take the check, and get **rule-based coaching**;
supervisors watch the capability map fill in live, and can **generate new scenarios from the SOP
with Gemini**, review them, and activate them. Data persists in Cloud Firestore; Gemini calls run
through the Express API server in this repo, so the API key never reaches the browser.

## Run it locally

```bash
npm ci
npm run dev
```

Then open the printed local URL (default http://localhost:5173).

Without Firebase config the app boots to a friendly "not connected" state — see setup below.
Secure sign-in and every AI/API feature require the Express server:

```bash
npm run build
npm start
```

## Firebase setup (required to take it live)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add a **Web App** (the `</>` icon) — no Firebase Hosting needed.
3. Enable **Firestore Database** and initialize **Firebase Authentication**. No public sign-in
   provider is needed; the app uses server-minted custom tokens.
4. Copy `.env.local.example` → `.env.local` and fill in the `VITE_FIREBASE_*` values from
   Project Settings → Your apps → SDK setup. (`.env.local` is gitignored.)
5. Create Firebase Admin credentials (Project Settings → Service Accounts) and set the downloaded
   JSON as the server-only `FIREBASE_SERVICE_ACCOUNT_JSON` value. Never commit that JSON.
6. Set server-only `SUPERVISOR_PASSCODE_SERVER` and `SESSION_SIGNING_SECRET`.
7. Run `npm run build && npm start` and verify both navigator and supervisor sign-in.
8. Apply [`firestore.rules`](firestore.rules) only after the identity-enabled server is live.

Navigator PINs are verified server-side and stored only as salted scrypt hashes. Firebase role and
ownership claims—not the browser's local session—authorize APIs, WebSockets, and Firestore.

## Gemini scenario generation (optional — for the Question Bank)

The supervisor **Questions** tab can generate scenario drafts from the SOP. Coaching, practice
calls, audits, voice relay, and path personalization also call Gemini through the Express API so
the API key stays server-side.

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Set the **server-only** `GEMINI_API_KEYS` env var (one or more keys, comma-separated; requests
   rotate across keys/models). `GEMINI_REQUEST_TIMEOUT_MS` optionally changes the 25-second
   per-upstream-call timeout. See [`.env.local.example`](.env.local.example).
3. `npm run dev` serves the Vite frontend only. Run `npm run build && npm start` when you need the
   local Express `/api` routes, or use the Railway deployment.

Generated scenarios always land as **drafts**; nothing goes live until a supervisor activates it.

## Roles & flow

The Start screen asks **"I'm a navigator"** or **"I'm a supervisor."**

- **Supervisor** (passcode) lands on the team **Overview** and has the full management app:
  Overview · Matrix · **Navigators** (add people to the roster) · Training ·
  Questions · Action center · Mentorship. Everything updates live as navigators submit.
- **Navigator** picks their name from the roster. If no PIN is set yet, they create their own
  4-digit PIN there; returning navigators enter that PIN. First time → they take the
  check, then get a **coaching review** (answer-by-answer, with the best answer and why, plus
  competency strengths/gaps), then land on their personal dashboard (per-domain **and**
  per-competency breakdown, strengths, growth areas, suggested mentors, assigned training).
  Returning → straight to the dashboard. They see **only their own data** — **My results**,
  **My training**, and their own practice exercises.

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
| Production supervisor passcode | Server env `SUPERVISOR_PASSCODE_SERVER` |
| Level thresholds, level labels/colors, palette | [src/data/config.js](src/data/config.js) |
| Domains + seed scenario questions (derived from the SOP) | [src/data/questions.js](src/data/questions.js) |
| Competency taxonomy (the 9 competencies) | [src/data/competencies.js](src/data/competencies.js) |
| Training catalog (placeholder courses — swap in real materials) | [src/data/training.js](src/data/training.js) |
| Training auto-assign rules (which levels get Required/Stretch) | [src/data/config.js](src/data/config.js) |
| Scoring (both axes), read-offs, analytics + training logic | [src/lib/scoring.js](src/lib/scoring.js) |
| Firestore reads/writes (roster · results · questions) | [src/lib/db.js](src/lib/db.js) |
| Gemini API handlers + SOP grounding | [api](api), [api/_sop-context.js](api/_sop-context.js) |
| Session (localStorage) | [src/lib/session.js](src/lib/session.js) |

The domains and seed questions are derived from the team SOP (`SOP Guide.pdf`, Aizer Health
Pediatric Department). To re-key the check to a different SOP, edit `DOMAINS` in `questions.js`,
refresh `api/_sop-context.js`, and either edit `SEED_QUESTIONS` or generate a fresh bank from the
**Questions** tab; scoring, levels, matrix, and read-offs follow automatically.

## Build, test, deploy

```bash
npm test            # Vitest unit tests for the scoring logic (both axes)
npm run test:rules  # Firestore authorization emulator suites
npm run build       # production build to dist/
npm run qa:calibrate # offline Call QA calibration/readiness report
npm run qa:coverage  # offline Call QA scenario/workflow coverage
# deploy: Railway uses railway.toml/nixpacks.toml.
# Set env vars in Railway: VITE_FIREBASE_* (client build) and
# FIREBASE_SERVICE_ACCOUNT_JSON + SUPERVISOR_PASSCODE_SERVER +
# SESSION_SIGNING_SECRET + GEMINI_API_KEYS/GEMINI_API_KEY (server-only).
```

Call QA calibration is offline by default and uses only sanitized local fixtures.
See [docs/CALL_QA_CALIBRATION.md](docs/CALL_QA_CALIBRATION.md). The committed
examples are synthetic and the current readiness result is intentionally
`INSUFFICIENT_DATA`; no automatic final verdict is enabled.

## Browser end-to-end tests (Playwright)

Two clearly separated Playwright suites:

- **`tests/e2e/` — the routine SAFE suite** (`npm run test:e2e` / `test:e2e:safe`). A **CI-safe
  product walkthrough + demo smoke** that walks the app like a real supervisor/navigator before a
  management demo. It is **read-only**: it never submits an assessment, saves a result, starts a
  mic/voice call, or triggers a live Gemini generation, so it is safe to run repeatedly — including
  against the live Railway URL. Data-backed navigator steps **skip gracefully** when the backend has
  no data (e.g. a Firebase-less build).
- **`e2e/` — the DEEP live-data suite** (`npm run test:e2e:deep`). Drives the full F26 3-phase
  navigator flow (PhaseHub → Phase 1 MCQ → Phase 2 Spot the Error) and **writes results to
  Firestore + calls Gemini**. Run it deliberately against a **local server with `.env.local`** —
  never point it at a shared/live deployment.

```bash
# first-time browser install
npx playwright install chromium          # add --with-deps on Linux/CI

npm run test:e2e                          # routine SAFE suite (builds + starts local server)
npm run test:e2e:safe                     # same as above (explicit)
npm run test:e2e:deep                     # DEEP suite: writes Firestore + calls Gemini (local only)
npm run test:e2e:all                      # both suites

# Run the SAFE suite against the live Railway deployment (no local server, no writes):
PLAYWRIGHT_BASE_URL=https://quarterknolwdge-production.up.railway.app npm run test:e2e:safe
```

> Only the SAFE suite is meant to run against a live URL. Do **not** run `test:e2e:deep` (or
> `test:e2e:all`) against a shared deployment — it submits assessments and calls Gemini.

Failures retain a **screenshot, video, and trace** (`playwright-report/` + `test-results/`); open
the last run with `npx playwright show-report`. Remote runs should set `E2E_NAV_PIN` and
`E2E_SUPERVISOR_PASSCODE` to dedicated test credentials; do not commit production secrets.

The live check currently assesses **Pediatrics** and **OB/GYN**; Adult Medicine and Behavioral
Health remain placeholders until they get their own SOP-backed question sets. All navigator data is
real (from Firestore) — there are no sample navigators.
