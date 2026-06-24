# Quarterly Knowledge Check

A web app that runs a quarterly "knowledge check" for patient navigators and renders the
**capability map** it produces. Application-based scenario questions are scored **per domain**,
mapped to three levels (**Learning / Solid / Can-Teach**), and laid out in a capability matrix.
Framing throughout: *development and fit, not pass/fail.*

As of the **Firebase pilot**, it's a real multi-user app: navigators sign in and take the check;
supervisors watch the capability map fill in live. Data persists in Cloud Firestore. The site is
still a static build (no custom server) and runs on GitHub Pages.

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

## Roles & flow

The Start screen asks **"I'm a navigator"** or **"I'm a supervisor."**

- **Supervisor** (passcode) lands on the team **Overview** and has the full management app:
  Overview · Matrix · **Navigators** (add people to the roster, each with a 4-digit PIN) · Training.
  Everything updates live as navigators submit.
- **Navigator** picks their name from the roster and enters their PIN. First time → they take the
  check, then land on their personal dashboard (per-domain breakdown, strengths, growth areas,
  suggested mentors, assigned training). Returning → straight to the dashboard. They see **only
  their own data** — two tabs: **My results** and **My training**.

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

Everything is **knowledge-only** — derived purely from check results. No operational KPIs, tenure,
site, or prior-quarter data are invented.

## Where to tweak

| What | File |
| --- | --- |
| Supervisor passcode | [src/data/config.js](src/data/config.js) (`SUPERVISOR_PASSCODE`) |
| Level thresholds, level labels/colors, palette | [src/data/config.js](src/data/config.js) |
| Domains + scenario questions (derived from the SOP) | [src/data/questions.js](src/data/questions.js) |
| Training catalog (placeholder courses — swap in real materials) | [src/data/training.js](src/data/training.js) |
| Training auto-assign rules (which levels get Required/Stretch) | [src/data/config.js](src/data/config.js) |
| Scoring, read-offs, analytics + training logic | [src/lib/scoring.js](src/lib/scoring.js) |
| Firestore reads/writes | [src/lib/db.js](src/lib/db.js) |
| Session (localStorage) | [src/lib/session.js](src/lib/session.js) |

The questions and domains are derived from the team SOP (`SOP Guide.pdf`, Aizer Health Pediatric
Department). To re-key the check to a different SOP, edit `DOMAINS` and `QUESTIONS` in
`questions.js`; everything else (scoring, levels, matrix, read-offs) follows automatically.

## Build, test, deploy

```bash
npm test                          # Vitest unit tests for the scoring logic
npm run build                     # production build to dist/
npx gh-pages -d dist --dotfiles   # publish dist/ to the gh-pages branch
```

The live check currently assesses **Pediatrics** only; the other departments show empty states
until they get their own question sets. All navigator data is real (from Firestore) — there are no
sample navigators.
