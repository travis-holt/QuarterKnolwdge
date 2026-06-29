# Knowledge Check — Claude Code Harness

Adapted from [SAFe Agentic Workflow](https://github.com/bybren-llc/safe-agentic-workflow) for this project's stack: React/Vite + Firebase + Railway + Vitest.

---

## Slash Commands

| Command | Purpose |
|---|---|
| `/start-work` | Branch setup + AC gate before starting a task |
| `/end-work` | Final checklist: commit, validate, update CLAUDE.md |
| `/pre-pr` | All gates must pass before creating a PR |
| `/check-workflow` | Quick health check of git/work state |
| `/quick-fix` | Fast-track for small isolated bug fixes |
| `/search-pattern <pattern>` | Find existing patterns before writing new code |
| `/update-docs` | Check and update CLAUDE.md for current work |
| `/retro` | Retrospective on the current session |

---

## Agent Profiles

| Agent | Role | When to use |
|---|---|---|
| `fe-developer` | React/CSS/scoring implementation | Building features, UI changes |
| `qas` | Test coverage + AC validation | Before any PR |
| `system-architect` | Pattern + security review | Architecture questions, pre-PR check |
| `tech-writer` | CLAUDE.md maintenance | After any non-trivial change |
| `rte` | PR creation + Railway deploy | After QAS approval |

---

## Auto-Loaded Skills

These activate automatically when relevant:

| Skill | Triggers on |
|---|---|
| `safe-workflow` | Starting work, committing, branching, workflow questions |
| `pattern-discovery` | Before adding any function, component, or endpoint |
| `testing-patterns` | Writing tests, test failures, new code paths |
| `git-advanced` | Rebase, conflicts, history cleanup, push failures |

---

## Validation Gates (in order)

```bash
npm test          # 158 tests must be green
npm run build     # Vite production build must be clean
node --check api/<file>.js   # if any api/ file changed
```

All three must pass before any commit goes to `main`.

---

## Workflow Overview

```
Start: /start-work
  → feat/* branch from latest main
  → AC confirmed

Implement: fe-developer agent
  → npm test + npm run build after every change

Review: system-architect + qas agents
  → patterns correct, tests green, ACs met

Document: tech-writer agent / /update-docs
  → CLAUDE.md §7 + §8 updated

Ship: /pre-pr → rte agent
  → git push + gh pr create
  → user merges → Railway auto-deploys
```

---

## Key Files

- `CLAUDE.md` — single source of truth for the project
- `src/lib/scoring.js` — all pure scoring/analytics logic
- `src/lib/db.js` — all Firestore reads/writes
- `src/lib/apiFetch.js` — all client-side `/api` calls
- `api/_gemini-client.js` — shared Gemini key rotation
- `api/_auth.js` — shared secret validation
- `.claude/team-config.json` — project config (no placeholders)
