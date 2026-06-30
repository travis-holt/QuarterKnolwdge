# ARCHITECTURE.md — the "something is down and I'm panicking" guide

> This is the map for future-you. Something broke, you haven't looked at this
> code in months, and you need to know **where to look first**. Read section 6
> ("How to debug when it's down") first if the site is actually down right now.
> The rest gives you the mental model.
>
> Plain-language on purpose. You don't need to remember how any of this works —
> this file remembers it for you.

---

## 1. What this app does

It runs a quarterly "knowledge check" for **patient navigators** (call-centre
agents who handle patient calls). Navigators answer scenario questions, and the
app turns their answers into a **per-skill capability map** — never one overall
grade — so a supervisor can see who's strong where, who can mentor whom, and what
training to assign. It also has AI-powered extras (practice phone calls, coaching
notes, "spot the mistake" exercises) that use Google's Gemini AI behind the scenes.

---

## 2. The stack

Think of the app as **four moving parts**: the screen (frontend), the helper server
(backend), the data store (database), and the AI service (external). Here's each
piece and the one job it owns.

| Piece | Technology | What it's responsible for |
|---|---|---|
| **Frontend** (the screens) | React 18 + Vite | Everything the user sees and clicks. Built into plain static files that get served to the browser. |
| **Styling** | One hand-written CSS file (`src/styles.css`) | All visual styling. No framework. |
| **Backend** (helper server) | Node.js + Express 5 (`server.js`) | Does two things: (1) serves the built frontend files, (2) handles the `/api/*` calls that need to talk to Gemini secretly. |
| **Database** | Google Firebase / Firestore | Stores all data: navigators, results, questions, etc. Lives in Google's cloud, not on our server. The browser talks to it **directly**. |
| **AI service** | Google Gemini (`gemini-2.5-flash`) | Powers coaching, practice calls, and "spot the error". Called only from our backend so the API key stays secret. |
| **Hosting** | Railway | Runs `server.js` in a always-on container. Auto-deploys every time you push to the `main` branch on GitHub. |
| **"Auth"** | None real — PIN + passcode (pilot-grade) | Navigators pick their name + type a 4-digit PIN; supervisors type a shared passcode. This is **not real security** (see section 4). |

**Key mental model:** the browser talks to **two** things directly — our Railway
server (for AI stuff) **and** Firebase (for all data). Firebase is not behind our
server. That's unusual and matters for debugging (see section 4).

---

## 3. Data flow — the critical paths

### Path A — A navigator takes the check and their results save

1. Navigator signs in at the **Start gate** → [src/components/Start.jsx](src/components/Start.jsx) checks their PIN against the roster.
2. They land in [src/components/NavigatorApp.jsx](src/components/NavigatorApp.jsx), pick a department, and the app fetches that department's live questions via `getActiveQuestions(dept)` in [src/lib/db.js](src/lib/db.js). **If that fetch fails or returns nothing, it falls back to the built-in seed questions** in `src/data/questions.js` — so the check still runs even if the database is unreachable.
3. They answer questions in [src/components/Check.jsx](src/components/Check.jsx) and submit.
4. `handleSubmit` in `NavigatorApp.jsx` runs the answers through the pure scoring functions in [src/lib/scoring.js](src/lib/scoring.js) (`scorePerDomain`, `scorePerCompetency`) — **this is where the numbers are calculated, all in the browser**.
5. It calls `saveResult(...)` in `db.js`, which writes **two things** to Firestore: the result document (overwrites on retake) and an append-only history snapshot.
6. Supervisors see it instantly because [src/components/SupervisorApp.jsx](src/components/SupervisorApp.jsx) has a **live subscription** (`subscribeResults`) — Firestore pushes the new data to their open screen automatically.

> **Where data lands:** Firestore `results` collection (keyed `navigatorId__department`) and `resultHistory` collection.

### Path B — A supervisor opens the dashboard

1. Supervisor enters the passcode at the gate → loads `SupervisorApp.jsx`.
2. On mount it opens **several live subscriptions** at once (`subscribeResults`, `subscribeRoster`, `subscribeCompletions`, `subscribeResultHistory`, `subscribeInterviews`, `subscribePairings`) — all in `db.js`.
3. Raw data flows into the pure functions in `scoring.js` (`buildMatrixRows`, `columnGaps`, etc.) which compute the capability matrix and read-offs **in the browser**.
4. If any subscription errors (e.g. connection lost), a red banner shows: *"Lost connection to the database."*

> **Where data comes from:** all Firestore, pushed live. No backend involved at all in this path.

### Path C — An AI feature runs (e.g. post-check coaching)

1. A component (e.g. [src/components/Coaching.jsx](src/components/Coaching.jsx)) calls `apiFetch('/api/generate-coaching', {...})` from [src/lib/apiFetch.js](src/lib/apiFetch.js). This automatically attaches the shared secret.
2. The request hits **our Railway server** → `server.js` routes it to [api/generate-coaching.js](api/generate-coaching.js).
3. The handler checks the secret (`api/_auth.js`), builds a prompt, and calls Gemini via the shared client [api/_gemini-client.js](api/_gemini-client.js), which holds the **secret API keys** (never sent to the browser) and rotates through them if one is rate-limited.
4. Gemini's answer is validated and returned to the browser as JSON.
5. **AI output is advisory only** — it never changes a score or writes to the database. If it fails, the feature silently degrades (e.g. shows the basic rule-based coaching instead).

> **Where data comes from:** Google Gemini, via our server. The browser never sees the API keys.

---

## 4. The seams (where things break) — **most important section**

A "seam" is where two parts connect. These are the only places things actually
break. For each: what it is, what failure looks like, and **what to check first**.

### Seam 1 — Browser → Firebase/Firestore (the big one)
- **What it is:** The browser reads/writes all data directly to Firestore. Every call goes through [src/lib/db.js](src/lib/db.js) — nothing else touches Firestore.
- **What failure looks like:** Empty dashboards, "not connected" messages, the red "Lost connection to the database" banner, or new results not showing up.
- **Check first:**
  1. Is Firebase even configured? Open the browser console — if you see *"Firebase init failed"* or the app shows "not configured", the `VITE_FIREBASE_*` variables are missing. **These are baked in at build time**, so they must be set in **Railway Variables before a build runs**. (See [src/lib/firebase.js](src/lib/firebase.js).)
  2. Is the Firebase project itself up? Go to the [Firebase console](https://console.firebase.google.com) → your project → Firestore. Can you see the data?
  3. Did the **security rules** get changed? [firestore.rules](firestore.rules) currently allows all reads/writes. If someone tightened them, legitimate calls will start failing with permission errors.

### Seam 2 — Browser → our Railway server (`/api/*` AI calls)
- **What it is:** AI features POST to `/api/...` on our server. Client side is [src/lib/apiFetch.js](src/lib/apiFetch.js); server side is [server.js](server.js).
- **What failure looks like:** Coaching/practice-call/spot-the-error features hang then fail, while the rest of the app (matrix, results) works fine. (If the *whole* site is down, it's the server itself — see Seam 4.)
- **Check first:**
  1. Hit `https://<your-railway-url>/api/health` in a browser. If it returns `{"ok":...}`, the server is up and the problem is downstream (Gemini). If it doesn't load, the **server is down** → Seam 4.
  2. Each `/api` call has a built-in timeout (15–25 seconds). A slow Gemini = a timeout error in the UI, not a crash.

### Seam 3 — Our server → Google Gemini (the AI itself)
- **What it is:** [api/_gemini-client.js](api/_gemini-client.js) calls Gemini using secret keys from the `GEMINI_API_KEYS` environment variable.
- **What failure looks like:** Only AI features fail; everything else works. Errors mention rate limits, auth, or "not configured".
- **Check first:**
  1. **Read the Railway logs** (Railway dashboard → your service → Logs). The client logs exactly which failure happened:
     - *"no GEMINI_API_KEYS... configured"* → the env var is missing in Railway.
     - *"403 ... auth/billing issue"* → the Gemini key is invalid or billing lapsed.
     - *"429 ... rate-limited"* → too many requests; usually temporary.
  2. Confirm `GEMINI_API_KEYS` is still set in Railway Variables.
- **Note:** AI failures never break core functionality. The check, scoring, and dashboards all keep working without Gemini.

### Seam 4 — Railway hosting (the server process itself)
- **What it is:** Railway runs `server.js`. If it crashes or fails to build, the **entire site** is down.
- **What failure looks like:** The whole URL is dead — nothing loads, not even the home page.
- **Check first:**
  1. Railway dashboard → your service → is it "Active" or "Crashed"? Check the **deploy logs** and **runtime logs**.
  2. Did the **last push to `main`** break the build? Railway auto-deploys every push. The most common cause of "it was working yesterday" is a bad commit. → **Roll back** (section 6).

### Seam 5 — The "auth" boundary (PIN / passcode) — *a known weak spot, not a bug*
- **What it is:** [src/components/Start.jsx](src/components/Start.jsx) checks PINs (stored in Firestore) and the supervisor passcode (hard-coded as `SUPERVISOR_PASSCODE` in [src/data/config.js](src/data/config.js), which is in the public repo).
- **What failure looks like:** This doesn't "break" — but understand it's **not real security**. Anyone reading the public source can see the supervisor passcode, and the Firestore rules let anyone with the project URL read/write data.
- **Why it's OK for now:** It's a trusted pilot with no sensitive data. **Before any real/public launch**, you must add Firebase Auth and rewrite `firestore.rules`. This is the #1 thing to fix before going to production.

---

## 5. File map

**Load-bearing** = changing it carelessly can break the app. **Peripheral** = safer to touch.

### The spine (load-bearing — be careful)
| File | What it does |
|---|---|
| [server.js](server.js) | The Railway entry point. Serves the site + routes all `/api` calls. If this won't start, the whole site is down. |
| [src/lib/firebase.js](src/lib/firebase.js) | Connects to Firebase. Reads the `VITE_FIREBASE_*` config. |
| [src/lib/db.js](src/lib/db.js) | **The only file that talks to the database.** Every read/write goes through here. If data is misbehaving, look here. |
| [src/lib/scoring.js](src/lib/scoring.js) | **All the math.** Turns answers into scores, levels, the matrix, training assignments, mentor matches. Pure logic, heavily tested. Has the most unit tests. |
| [src/data/config.js](src/data/config.js) | The "knobs": score thresholds, level colors, the supervisor passcode, training rules. Edit values here, not in components. |
| [src/App.jsx](src/App.jsx) | Decides which screen to show based on who's signed in (navigator vs supervisor vs the gate). |
| [api/_gemini-client.js](api/_gemini-client.js) | Holds the Gemini keys + retry logic. Shared by all 7 AI endpoints. |
| [api/_auth.js](api/_auth.js) | Shared secret check for the AI endpoints. |

### The two role-apps (load-bearing — these wire everything together)
| File | What it does |
|---|---|
| [src/components/SupervisorApp.jsx](src/components/SupervisorApp.jsx) | The whole supervisor experience: opens all the live data subscriptions, owns the management views. |
| [src/components/NavigatorApp.jsx](src/components/NavigatorApp.jsx) | The whole navigator experience: take the check, see your own results, practice. |
| [src/components/Start.jsx](src/components/Start.jsx) | The sign-in gate (PIN / passcode). |
| [src/components/Check.jsx](src/components/Check.jsx) | The actual quiz UI. |

### Data files (peripheral-ish — content, not logic)
| File | What it does |
|---|---|
| [src/data/questions.js](src/data/questions.js) | Domains + the built-in seed questions (the fallback if the DB has none). |
| [src/data/questions-obgyn.js](src/data/questions-obgyn.js) | OB/GYN seed questions. |
| [src/data/competencies.js](src/data/competencies.js) | The 9 skill "competencies". |
| [src/data/training.js](src/data/training.js) | Mockup training module content. |
| [src/data/departments.js](src/data/departments.js) | The 4 departments + which ones are "live". |
| [api/_sop-context.js](api/_sop-context.js) | The reference text (SOP) that grounds every AI feature. |

### The AI endpoints (peripheral — each one is one feature; if it breaks, only that feature breaks)
`api/generate-scenarios.js`, `generate-coaching.js`, `interview-turn.js`,
`grade-interview.js`, `generate-audit.js`, `coach-audit.js`, `sequence-path.js`,
`health.js`. Each is a self-contained AI feature.

### The rest of `src/components/*.jsx`
Individual screens/widgets (Matrix, Overview, Mentorship, ActionCenter, etc.).
**Peripheral** — breaking one breaks one screen, not the app.

### Config & deploy files (don't touch unless deploying)
`railway.toml`, `nixpacks.toml`, `vite.config.js`, `package.json`,
`firestore.rules`. See section 6 if a deploy breaks.

---

## 6. How to debug when it's down — literal checklist

Work top to bottom. Stop when you find the culprit.

### Step 0 — Narrow it down: which part is broken?
- **Whole site won't load at all** → it's the **server** (Railway). Go to Step 3.
- **Site loads, but dashboards are empty / data won't save** → it's the **database** (Firebase). Go to Step 2.
- **Site + data work, but AI features fail** → it's **Gemini**. Go to Step 4.
- **Not sure** → open the browser's **Developer Console** (right-click → Inspect → Console tab) and read the red errors. They almost always name the culprit.

### Step 1 — Is the server up?
- Visit `https://<your-railway-url>/api/health`. Returns `{"ok":...}` → server is fine. Doesn't load → server is down → Step 3.

### Step 2 — Is the database up?
- Go to [Firebase console](https://console.firebase.google.com) → your project → Firestore Database. Can you see collections (`roster`, `results`, …) with data? If not, the project has a problem.
- Check the browser console for *"Firebase init failed"* or permission errors.
- If permission errors: check [firestore.rules](firestore.rules) hasn't been tightened.
- Confirm `VITE_FIREBASE_*` are still set in **Railway Variables** (they get baked into the build — a missing one means the deployed site can't reach Firebase even though your local copy can).

### Step 3 — Read the server logs / is the latest deploy broken?
- Railway dashboard → your service → **Deployments** and **Logs**.
- Is the service "Active" or "Crashed"? Did the latest build fail?
- Read the runtime logs — `server.js` and the Gemini client print clear error lines.

### Step 4 — Is Gemini the problem?
- Railway **Logs** will say exactly: missing keys, `403` (auth/billing), or `429` (rate limit).
- Confirm `GEMINI_API_KEYS` is set in Railway Variables.

### Step 5 — Roll back to the last working version
Railway auto-deploys every push to `main`, so a bad commit = a bad site. Two ways back:
- **Easiest (no code):** Railway dashboard → Deployments → find the last green/working deploy → **"Redeploy"** (or "Rollback") that one.
- **Proper fix (in code):** revert the bad commit and push:
  ```bash
  git revert HEAD        # undoes the most recent commit as a new commit
  git push origin main   # Railway auto-deploys the fix
  ```
  (`git log --oneline` first to confirm which commit broke things.)

### Step 6 — Before you push any fix
```bash
npm test          # must pass (the scoring math is well-covered)
npm run build     # must be clean (catches most deploy-breaking errors)
```
If both pass locally, the deploy will almost certainly succeed.

---

## 7. Things that smell risky (honest list)

Ranked roughly by how much they'd matter if you were trying to keep this thing
alive and simple.

1. **The "auth" is fake.** The supervisor passcode is hard-coded in a **public** repo
   ([config.js](src/data/config.js)), and the database rules
   ([firestore.rules](firestore.rules)) let **anyone** read/write. Fine for a private
   pilot, a real liability for anything public. This is the single most important
   thing to fix before a real launch — and the one most likely to bite you. (Both
   files openly admit this in their comments.)

2. **The browser talks to the database directly.** There's no backend protecting the
   data — any logic that says "navigators can't see X" is enforced only by *hiding
   the button*, not by real permissions. Combined with #1, the data is effectively
   open. This is a common pattern for prototypes but is the thing a maintainer most
   often misunderstands ("why can't I just add a server-side check?" — because there's
   no server-side data layer; everything goes browser→Firebase).

3. **Two SOP PDFs sit in the repo and may contain real patient/provider info.**
   `Pediatrics_SOP_Updated.pdf` and `OB GYN SOP.pdf` are in the project folder and
   are gitignored *now*, but the AI grounding text in `api/_sop-context.js` is derived
   from them. Double-check nothing sensitive ever got committed to git history.

4. **The app does a LOT for a "quarterly check".** It has grown 21 features: trends,
   dossiers, an action center, adaptive dev paths, mentor matching, practice calls,
   AI grading, "spot the error", question-health drift detection… If maintainability
   were the only goal, **most of these could be cut**. The genuinely load-bearing core
   is: take the check → score it → show the matrix → assign training. Everything else
   is optional surface area. If something obscure breaks and you don't use it, consider
   deleting the feature rather than fixing it.

5. **Seven Firestore collections + composite keys.** Results are keyed
   `navigatorId__department`, with a legacy-fallback read path for older records (see
   `getResult` in [db.js](src/lib/db.js)). The fallback logic is the kind of thing that
   quietly rots — it exists to support data created before a migration. If you ever
   wipe the old data, you can delete the fallback branches and simplify.

6. **Levels are recalculated everywhere, never stored.** This is actually a *good*
   decision (change a threshold in config.js and everything updates), but it means the
   "answer" to "what level is this person" lives only in [scoring.js](src/lib/scoring.js).
   Don't ever duplicate that math in a component — always call `scoreToLevel()`.

7. **Some dead code.** CLAUDE.md notes orphaned CSS (`.start__logo`, `logo-float`) and a
   `public/logo.png` no longer used, left over from a reverted rebrand. Harmless, but
   it's the kind of thing that makes you doubt whether other code is live. Safe to delete.

8. **No CI.** Nothing runs the tests automatically before a deploy. Railway will happily
   deploy a commit that fails `npm test`. Until you add a GitHub Action, **you are the
   CI** — run `npm test && npm run build` before every push (section 6, Step 6).

---

*If you read only one thing in a panic: section 6, Step 0 tells you which of the
three parts is broken; section 4 tells you what to check for that part. The
fastest fix for "it was working yesterday" is almost always Railway → redeploy
the last working version (section 6, Step 5).*
