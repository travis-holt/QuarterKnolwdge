### Follow-up: stale security docs/comments synced to the server-side session model

Addresses the review notes on PR #8 (no code-behavior change — docs, comments, and one test addition).

**Fixes**
- **CLAUDE.md current-state:** `apiFetch` now documented as sending `credentials: 'same-origin'` and **no longer injecting `body.secret`**; supervisor-only endpoints use the HttpOnly session cookie; navigator/shared endpoints stay pilot-open/rate-limited.
- **CLAUDE.md deployment/security:** removed "No `GENERATION_SECRET` needed — falls back to `SUPERVISOR_PASSCODE`". Now: `GENERATION_SECRET` is legacy-only (`ALLOW_LEGACY_API_SECRET=true`); Railway should set `SUPERVISOR_PASSCODE_SERVER` + `SESSION_SIGNING_SECRET`; if unset the app runs a pilot fallback and is not production-hardened.
- **Stale API header comments:** `api/generate-scenarios.js` (was "gated by GENERATION_SECRET shared secret"), `api/refine-sop.js` (dropped `{ secret }` from the request-body docs), `api/live-relay.js` (browser no longer sends `secret`).
- **Tests:** added `REQUIRE_SUPERVISOR_SESSION` toggle coverage — `validateSecret` rejects a missing session (401) and allows a valid supervisor session when the toggle is on; `isValidSecret` returns `false` when the toggle is on and no legacy secret is allowed. `process.env` restored after each test.

**Local verification**
- `npm ci` ✓
- `npm test` → **424 passing / 20 files** (was 421)
- `npm run build` ✓ (existing Firebase chunk-size warning only)
- `git diff --check` → clean

**Final verification**
- `npm ci`: passed
- `npm test`: **424 passing across 20 files**
- `npm run build`: passed (existing Firebase chunk-size warning only)
- `git diff --check`: clean
- GitHub Actions CI: **success**

No merge, no deploy. `firestore.rules` untouched.
