# Agent Bootstrap

This repo's project knowledge base is `CLAUDE.md`.

Before doing any project work in a new chat/session:

1. Read `CLAUDE.md` first.
2. Treat `CLAUDE.md` as the source of truth for product intent, architecture, history, current state, and priorities.
3. Inspect the relevant live files before editing, because code may be newer than memory.
4. Keep the established boundaries:
   - Pure scoring/read-off logic stays in `src/lib/scoring.js`.
   - Firestore reads/writes stay in `src/lib/db.js`.
   - Client `/api` calls go through `src/lib/apiFetch.js`.
   - Gemini keys and Gemini calls stay server-side.
   - Levels are derived, not stored.
5. For any code, behavior, architecture, decision, bug, or goal change, update `CLAUDE.md` in the same change.

Useful verification defaults:

- Run `npm test` for logic/API/component coverage.
- Run `npm run build` before handing back user-facing or deployable changes.
