# Implementation Plan — Firebase Pilot
**Spec:** `docs/superpowers/specs/2026-06-24-firebase-pilot-design.md`
**Date:** 2026-06-24
**Stack:** React 18 + Vite, JavaScript, no TypeScript, GitHub Pages

---

## Blocker before starting Phase 2+

The owner must create a Firebase project at console.firebase.google.com and provide the config object. Until then, Phase 1 (all foundation work) can be completed, but no Firestore calls will work.

---

## Phase 1 — Foundation (no Firebase config needed)

### Step 1 — Install Firebase SDK
```bash
npm install firebase
```
Verify: `package.json` shows `firebase` in dependencies. `npm test` still green.

### Step 2 — Add `.env.local` to `.gitignore` + create template
- Add `.env.local` to `.gitignore` (keeps Firebase config out of the public repo).
- Create `.env.local.example` in repo root with placeholder keys:
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```
Verify: `.env.local` is gitignored; `.env.local.example` is committed.

### Step 3 — Create `src/lib/firebase.js`
Initialise the Firebase app and export the Firestore instance. Reads config from `import.meta.env.VITE_FIREBASE_*`.
```js
// src/lib/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
```
Verify: file exists; `npm run build` clean (env vars will be empty but build must not crash).

### Step 4 — Add `SUPERVISOR_PASSCODE` to `src/data/config.js`
Add one export at the top of the file:
```js
export const SUPERVISOR_PASSCODE = '1234'; // change before pilot launch
```
Verify: `npm test` green; `npm run build` clean.

### Step 5 — Create `src/lib/session.js`
Isolated localStorage layer. Single owner of all session state.
```js
// src/lib/session.js
const KEY = 'qkc_session';

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
}

export function setSession(role, name, navigatorId = null) {
  localStorage.setItem(KEY, JSON.stringify({ role, name, navigatorId }));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
```
Verify: manually test in browser console after `npm run dev`; `npm test` green.

---

## Phase 2 — Firestore layer (requires Firebase config in `.env.local`)

### Step 6 — Create `src/lib/db.js`
All Firestore read/write in one module. No Firestore calls anywhere else.

```js
// src/lib/db.js
import { db } from './firebase.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  onSnapshot, serverTimestamp
} from 'firebase/firestore';

const ROSTER = 'roster';
const RESULTS = 'results';

// Supervisor: add a navigator to the roster
export async function addToRoster(name, pin) {
  return addDoc(collection(db, ROSTER), { name, pin, createdAt: serverTimestamp() });
}

// Navigator gate: fetch full roster for dropdown
export async function getRoster() {
  const snap = await getDocs(collection(db, ROSTER));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Navigator gate: subscribe to roster (supervisor live view)
export function subscribeRoster(cb) {
  return onSnapshot(collection(db, ROSTER), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// Navigator: one-time read of their own result
export async function getResult(navigatorId) {
  const snap = await getDoc(doc(db, RESULTS, navigatorId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Navigator: write/overwrite result on submit
export async function saveResult(navigatorId, name, scores) {
  return setDoc(doc(db, RESULTS, navigatorId), {
    name,
    navigatorId,
    scores,
    submittedAt: serverTimestamp(),
  });
}

// Supervisor: live listener for all results
export function subscribeResults(cb) {
  return onSnapshot(collection(db, RESULTS), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
```
Verify: with `.env.local` populated, test `addToRoster` + `getRoster` manually in browser console. Confirm documents appear in Firebase console.

---

## Phase 3 — Remove sample data

### Step 7 — Strip `SAMPLE_NAVIGATORS` from `src/data/navigators.js`
Delete the export entirely. The file can be removed if it becomes empty, or kept for future use with a comment.

Update every import of `SAMPLE_NAVIGATORS` — currently only in `src/App.jsx`. Remove the import and any usage (it will be replaced by live Firestore data in Phase 5).

Verify: `npm test` green (scoring tests use their own fixtures, not SAMPLE_NAVIGATORS). `npm run build` clean.

---

## Phase 4 — Start screen gate

### Step 8 — Rework `src/components/Start.jsx`
Replace the current two-button start screen with a 3-step gate.

**Sub-screens (managed by local `step` state inside Start):**

1. **Role selector** — two large buttons: "I'm a navigator" / "I'm a supervisor"
2. **Navigator sub-screen** — dropdown of roster names + 4-digit PIN input + "Continue" button
   - Dropdown populated via `getRoster()` called on mount (or passed as prop from App)
   - PIN validated client-side against the selected roster entry's `pin` field
   - Wrong PIN → inline error message, stay on sub-screen
   - Correct PIN → call `setSession('navigator', name, id)` → call `onNavigatorEntry(id, name)`
3. **Supervisor sub-screen** — passcode input + "Continue" button
   - Validated against `SUPERVISOR_PASSCODE` from `config.js`
   - Wrong passcode → inline error, stay on sub-screen
   - Correct passcode → call `setSession('supervisor', 'Supervisor')` → call `onSupervisorEntry()`

**Props:**
```js
Start({ onNavigatorEntry(navigatorId, name), onSupervisorEntry() })
```

Verify: manually walk all three paths in `npm run dev`. Wrong PIN and wrong passcode both show errors. Correct credentials proceed.

---

## Phase 5 — App router

### Step 9 — Rework `src/App.jsx`
This is the largest change. The App now branches entirely on role.

**On mount:**
1. Call `getSession()`
2. If session exists → skip gate, set role state, load data for that role
3. If no session → show `<Start>`

**Navigator branch:**
- On `onNavigatorEntry(navigatorId, name)`: call `getResult(navigatorId)`. Store result in state.
  - If result exists → set `view = 'navigator-dashboard'`
  - If no result → set `view = 'check'`
- After check submit: call `saveResult(navigatorId, name, scores)` → set `view = 'navigator-dashboard'`
- Rows for mentor suggestions: navigator needs *other navigators' results* to find mentors. Use `subscribeResults` but filter out own row before passing to `mentorSuggestions()`.
- Navigator router views: `check` · `results` (brief) · `navigator-dashboard` · `navigator-training` · `module`

**Supervisor branch:**
- On `onSupervisorEntry()`: call `subscribeResults(cb)` + `subscribeRoster(cb)`. Store live data in state.
- Unsubscribe both listeners on unmount (return value of `onSnapshot` is the unsubscribe function).
- Build `rows` from live results exactly as today's `buildMatrixRows(results, null)` — no live result injection needed (supervisor never takes the check).
- Supervisor router views: all existing views (`overview` · `matrix` · `navigators` · `navigator` · `training` · `module`).

**State shape:**
```js
const [role, setRole] = useState(null);           // 'navigator' | 'supervisor' | null
const [navigatorId, setNavigatorId] = useState(null);
const [liveRows, setLiveRows] = useState([]);     // supervisor: live from Firestore
const [navigatorResult, setNavigatorResult] = useState(null); // navigator: own result
```

Verify: full end-to-end flow for both roles. Supervisor dashboard updates without refresh when a navigator submits in another tab.

---

## Phase 6 — Navigation

### Step 10 — Update `src/components/Nav.jsx`
Accept a `role` prop. Render two distinct variants:

**Navigator (`role === 'navigator'`):**
```
[My results]  [My training]                    [Switch user →]
```

**Supervisor (`role === 'supervisor'`):**
```
[Overview]  [Matrix]  [Navigators]  [Training]    [Sign out →]
```

"Switch user" / "Sign out" both call `clearSession()` then reset App state to show `<Start>`.

Verify: nav renders correctly for each role; Switch user / Sign out return to the gate.

---

## Phase 7 — Supervisor roster management

### Step 11 — Update `src/components/Navigators.jsx`
The supervisor sees two data sources merged: the roster (everyone) and the results (those who've submitted).

**Layout:**
- Header row: "Navigators" title + "Add Navigator" button (supervisor only)
- List: all roster entries. For each:
  - If they have a result → show their level chips (same as today)
  - If no result → show name + "Not yet taken" badge
- "Add Navigator" button opens an inline form: Name field + 4-digit PIN field + Save
  - On save: call `addToRoster(name, pin)` → form closes → live `subscribeRoster` updates the list automatically

**Props change:**
```js
Navigators({ rows, roster, deptName, onOpenNavigator, onAddNavigator })
```
`roster` is the live array from `subscribeRoster`. `rows` is the existing scored-rows array from results.

Verify: add a navigator via the form, see them appear immediately with "Not yet taken." Have them take the check; confirm the badge updates to their scores.

---

## Phase 8 — Navigator personal dashboard

### Step 12 — Wire navigator dashboard views
The existing `NavigatorDetail.jsx` already renders per-domain breakdown, strengths, growth areas, mentor suggestions, and assigned training. It receives `rows`, `name`, `deptMatrix`, etc. — all unchanged.

For the navigator role:
- `rows` = all submitted results (from `subscribeResults`, filtered) — needed for mentor suggestions
- `name` = from session
- The navigator is always viewing themselves; no "back to list" link needed — replace with nothing or "Switch user"

Check that `NavigatorDetail` renders correctly with only Firestore-sourced rows (no sample data). The component's prop API is unchanged so this should work with no edits.

**Step 13 — "My training" tab**
The navigator's "My training" tab shows their assigned training modules (same as today's `Training.jsx` but scoped to their own row). Reuse the existing `TrainingModule.jsx` for module preview.

Option: pass a single-row array `[navigatorResult]` to a simplified training view, or reuse `Training.jsx` with the single-row array. Prefer reuse.

Verify: navigator can open training modules and read lesson content.

---

## Phase 9 — Test, build, document, deploy

### Step 14 — `npm test`
Must be green. The scoring tests use their own fixtures and are unaffected by Firestore. If any test breaks, fix before proceeding.

### Step 15 — `npm run build`
Must be clean. Common failure: missing env vars at build time — Vite will substitute empty strings, which is fine (the app won't connect to Firestore without them, but the build itself must not crash).

### Step 16 — Update `CLAUDE.md`
- §4 Feature Inventory: mark Firebase pilot features as Complete
- §5 Architecture: update Backend section (no longer "none by design")
- §8 Current System State: update counts, active integrations
- §9 Codebase Knowledge: add `firebase.js`, `db.js`, `session.js` to important modules; update env vars section
- §7 Development History: add dated entry
- §15 Current Priorities: remove Firebase pilot from active work items

### Step 17 — Commit, push, redeploy
```bash
git add -p   # stage carefully — never commit .env.local
git commit
git push
npm run build
npx gh-pages -d dist --dotfiles
```
Verify the live site at https://travis-holt.github.io/QuarterKnolwdge/ works end-to-end.

---

## Implementation order summary

| Phase | Steps | Blocker |
|---|---|---|
| 1 — Foundation | 1–5 | None — start now |
| 2 — Firestore layer | 6 | Firebase config in `.env.local` |
| 3 — Remove sample data | 7 | Firebase config (app won't work without rows) |
| 4 — Start gate | 8 | Firebase config (roster dropdown needs data) |
| 5 — App router | 9 | Firebase config |
| 6 — Navigation | 10 | None (cosmetic change) |
| 7 — Roster management | 11 | Firebase config |
| 8 — Navigator dashboard | 12–13 | Firebase config |
| 9 — Ship | 14–17 | All above complete |

**Start with Phase 1 today. Hand the `.env.local.example` to the owner and ask them to create the Firebase project and fill it in. Phases 2–9 can be completed as soon as config arrives.**
