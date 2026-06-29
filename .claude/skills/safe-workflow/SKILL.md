---
name: safe-workflow
description: Knowledge Check development workflow — branch naming, commit format, validation gates, PR process. Use when starting work, committing, branching, or asking about contribution conventions.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# SAFe Workflow — Knowledge Check

## When This Skill Applies

Invoke when:
- User is starting work on a new task
- User is about to commit or push
- User asks about branch naming or commit format
- User is preparing a PR
- User asks "how should I do this?" about workflow

## Branch Naming

**Format**: `type/short-description`

| Type | When |
|---|---|
| `feat/` | New feature or enhancement |
| `fix/` | Bug fix |
| `chore/` | Cleanup, refactor, maintenance |
| `docs/` | Documentation only |
| `test/` | Tests only |

Examples:
```
feat/supervisor-grade-override
fix/scoring-undefined-answers
chore/cleanup-orphaned-css
docs/update-obgyn-sop-context
```

**Anti-patterns** (reject these):
```
main-new-stuff      # no type prefix
temp                # not descriptive
travis-feature      # personal naming
wip                 # not descriptive
```

## Commit Message Format

**Format**: `type(scope): description`

| Type | When |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change without behaviour change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build, deps, config, cleanup |

**Scope** = the main module/area changed: `scoring`, `interview`, `db`, `api`, `nav`, `matrix`, `training`, `claude`, etc.

Examples:
```
feat(interview): add supervisor grade override UI
fix(scoring): defend against undefined answers input
test(db): add composite key construction tests
docs(claude): update §7 history entry for OB/GYN launch
chore(css): remove orphaned logo-float keyframes
refactor(api): extract validateAuditResponse to pure function
```

Co-author line (always include when Claude commits):
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

## Validation Gates (in order)

1. `npm test` — all tests must pass (158+ as of 2026-06-29)
2. `npm run build` — Vite production build must be clean
3. `node --check api/<file>.js` — if any `api/` file was edited

Never skip any gate. Fix failures before pushing.

## CLAUDE.md Update (MANDATORY)

Before any commit is "done":
- §7 dated history entry written
- §8 current state reflects the change
- §15 priorities updated

## PR Workflow

1. Run `/pre-pr` command — all gates must be green
2. Push branch: `git push origin <branch>`
3. Create PR via `gh pr create` with the standard template
4. User merges (user is final authority — never force-push or merge yourself)
5. Railway auto-deploys on merge to `main`

## Branch Base

Always branch from latest `main`:
```bash
git checkout main && git pull origin main
git checkout -b feat/new-thing
```

Never branch from another feature branch unless explicitly coordinating with the user.
