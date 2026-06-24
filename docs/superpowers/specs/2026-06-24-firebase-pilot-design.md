# Firebase Pilot Design — Quarterly Knowledge Check

**Date:** 2026-06-24
**Status:** Approved (Sections 1 & 2) — implementation plan pending
**Scope:** Convert the static prototype into a real multi-user webapp for a small pilot (~3–10 navigators). No backend server; stays on GitHub Pages.

---

## Section 1 — Architecture (Approved)

### Persistence
- **Firebase / Firestore** (free Spark tier).
- Real-time, no server needed, compatible with GitHub Pages static hosting.
- Each navigator's result is one Firestore document, keyed by name.

### Identity / Auth
- **No login system.** Navigators type their name; supervisors enter a hardcoded passcode.
- Passcode stored in `src/data/config.js` as `SUPERVISOR_PASSCODE` — never committed to a public variable; for the pilot this is acceptable (small trusted team).

### Roles
Two distinct roles with structurally separate views:
- **Navigator** — sees only their own results, training, and mentor suggestions.
- **Supervisor** — sees the full matrix, overview, navigators list, and training tab (all fed live from Firestore).

### Sample data
`SAMPLE_NAVIGATORS` removed entirely. The matrix starts empty and fills with real submissions. A friendly empty state is shown until the first navigator submits.

### Access
Laptop only (no mobile optimisation required for this pilot).

### Real-time sync
Navigator submits → Firestore document written → supervisor's dashboard updates live via `onSnapshot` listener. No manual refresh required.

### Re-take
Same name submits again → Firestore document overwritten (clean re-take). No version history for the pilot.

### Files that will change
| File | Change |
|---|---|
| `src/lib/firebase.js` | New — Firebase app init + Firestore instance |
| `src/lib/db.js` | New — Firestore read/write helpers (`saveResult`, `subscribeResults`) |
| `src/lib/session.js` | New — localStorage session layer (`getSession`, `setSession`, `clearSession`) |
| `src/App.jsx` | Role-branched router; reads session; subscribes to Firestore |
| `src/components/Start.jsx` | Becomes the role gate |
| `src/components/Nav.jsx` | Navigator variant (2 tabs) vs supervisor variant (full) |
| `src/data/navigators.js` | `SAMPLE_NAVIGATORS` removed |
| `src/data/config.js` | Add `SUPERVISOR_PASSCODE` |
| `.env.local` | Firebase config (gitignored) |

### Files that will NOT change
`src/lib/scoring.js`, `src/lib/scoring.test.js`, and all other view components — they receive real Firestore-sourced rows instead of sample rows, but their prop APIs are unchanged.

---

## Section 2 — Role Flow (Approved)

### 2.1 Start screen gate

The Start screen opens with an explicit **role selector**: "I'm a navigator" / "I'm a supervisor."

- **Navigator** → name entry sub-screen
- **Supervisor** → passcode entry sub-screen (validated against `SUPERVISOR_PASSCODE`)

A wrong passcode shows an inline error and stays on the gate. Never reveals whether the input "almost" matched.

Session is persisted in `localStorage` via `src/lib/session.js`. On return visits, `App` reads the session and skips the gate, landing the user directly on their view.

### 2.2 Navigator path

```
Pick "Navigator" → enter name → check Firestore for that name
   ├─ No prior result  → take the check → submit → personal dashboard
   └─ Prior result      → personal dashboard directly (full analysis, no retake prompt)
```

**Personal dashboard** — the returning-navigator landing and the post-submit destination:
- Per-domain breakdown (worst → best order)
- Strengths (Can-Teach domains) and growth areas (Learning domains)
- Assigned training: Required modules (Learning domains) + Stretch modules (Solid domains)
- Training content will use real SOP-based lessons (to be provided by owner)

**Navigator Nav** — 2 tabs only:
- **My results** — the personal dashboard
- **My training** — full module content for their assigned modules

Plus a **Switch user** link to clear the session and return to the Start gate.

Navigator has no route to the matrix, overview, navigators list, DeptBar, or any other navigator's data. The restriction is structural — the routes don't exist in the navigator's router — not just hidden UI.

### 2.3 Supervisor path

```
Pick "Supervisor" → enter passcode → (valid) → Overview
```

Supervisor lands on **Overview** (floor KPIs + domain distribution + cross-department strength). Full Nav available: Overview · Matrix · Navigators · Training, plus DeptBar department selector. All views fed live from Firestore via `onSnapshot`.

Plus a **Sign out** link to clear the session and return to the Start gate.

### 2.4 Access matrix

| Capability | Navigator | Supervisor |
|---|---|---|
| Own results & training | ✅ | ✅ (any navigator's) |
| Other navigators' data | ❌ | ✅ |
| Capability matrix | ❌ | ✅ |
| Team Overview | ❌ | ✅ |
| Navigators list | ❌ | ✅ |
| Training tab (full) | ❌ | ✅ |
| DeptBar (department switch) | ❌ | ✅ |
| Take the check | ✅ | — |
| My results tab | ✅ | — |
| My training tab | ✅ | — |

### 2.5 Session persistence

`src/lib/session.js` is the single owner of all session state. It reads/writes `localStorage` and exposes a stable contract:

```js
getSession()            // → { role: 'navigator'|'supervisor', name } | null
setSession(role, name)  // call after successful role entry
clearSession()          // "Switch user" / "Sign out"
```

`App` calls `getSession()` on mount. If a session exists, the gate is skipped.

**Migration path:** when this moves to a hosted product with real auth (Firebase Auth, etc.), only `session.js` internals change. The `{ role, name }` contract and all downstream code stays identical. localStorage does not touch Firestore — data and session are fully decoupled.

### 2.6 Firestore data shape

```js
// Collection: results
// Document ID: navigator name (lowercased + trimmed for consistency)
{
  name: "Sarah Chen",          // display name as entered
  submittedAt: Timestamp,
  scores: {
    scheduling: 80,
    referrals: 45,
    insurance: 90,
    // ... one entry per domain id
  }
}
```

Levels (`learning` / `solid` / `canTeach`) are **never stored** — always derived client-side by `scoreToLevel()` from `scoring.js`. Thresholds stay tunable without a data migration.

---

## Open Items (not blocking Section 1 & 2 implementation)

- **Firebase project** — owner to create at console.firebase.google.com and provide the config object for `.env.local`.
- **Real training content** — SOP-based lesson content to replace mockup modules; owner to provide additional SOPs.
- **Real per-department question sets** — other departments need their own SOPs before going live.
- **Retake flow** — currently no retake from the personal dashboard. Add as a follow-on once the ground floor is stable.
- **Section 3+** — empty state design, error states (Firestore offline), Firestore security rules.
