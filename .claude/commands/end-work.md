---
description: Complete work session — commit, validate, update CLAUDE.md, prepare for PR
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

You are completing a work session on Knowledge Check. Execute the final checklist.

## Completion Checklist

### 1. Verify Work Status

```bash
git status
git log origin/main..HEAD --oneline
```

Is the work complete or at a safe stopping point?

### 2. Run Validation Gates

```bash
npm test          # 158+ tests must be green
npm run build     # production build must be clean
node --check api/*.js  # syntax-check any edited API handlers
```

**BLOCKER**: Fix any failures before proceeding.

### 3. Commit All Changes

Stage and commit with conventional format:

```bash
git add <specific files>  # never `git add .` — avoid accidentally staging .env or secrets
git commit -m "type(scope): what changed and why"
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Examples:
- `feat(interview): add supervisor grade override UI`
- `fix(scoring): defend against undefined answers input`
- `docs(claude): update §7 history and §8 state`

### 4. Update CLAUDE.md (MANDATORY)

**No change is "done" until CLAUDE.md is updated.** Check:

- [ ] §4 Feature Inventory — is the feature status updated?
- [ ] §7 Development History — new dated entry added?
- [ ] §8 Current System State — counts, state, known issues current?
- [ ] §15 Current Priorities — completed items ticked, new items added?

### 5. Context Preservation (if stopping mid-work)

If leaving work unfinished, document in your commit message or a comment:

```
## Session Context

### Completed
- ...

### Next Steps
1. ...

### Blockers / Questions
- ...
```

### 6. Push (if ready for PR)

```bash
git push origin <branch-name>
```

Then reference `/pre-pr` before creating the PR.

## Output Format

Provide summary:
- ✅ Validation gates passed
- ✅ All changes committed
- ✅ CLAUDE.md updated
- ✅ Ready for next session / PR creation

Include any action items for the user (PR still needed? Blockers? Follow-ups?).
