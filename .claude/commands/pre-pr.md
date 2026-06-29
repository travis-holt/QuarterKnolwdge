---
description: Run complete validation before creating a PR — must all pass
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

You are preparing to create a Pull Request for Knowledge Check. Execute all validation steps in order.

## Validation Checklist

### 1. Tests (BLOCKER)

```bash
npm test
```

All tests must pass. Fix any failures before continuing.

### 2. Production Build (BLOCKER)

```bash
npm run build
```

Build must be clean with no errors or warnings that weren't there before.

### 3. API Handler Syntax (BLOCKER — if any `api/` files changed)

```bash
node --check api/generate-scenarios.js
node --check api/generate-coaching.js
node --check api/interview-turn.js
node --check api/grade-interview.js
node --check api/generate-audit.js
node --check api/coach-audit.js
```

### 4. No Uncommitted Changes (BLOCKER)

```bash
git status
```

Working tree must be clean. Commit everything or discard before pushing.

### 5. Up to Date with Main (BLOCKER)

```bash
git fetch origin
git log HEAD..origin/main --oneline
```

If behind, rebase: `git rebase origin/main`

### 6. Commit Message Quality Check

```bash
git log origin/main..HEAD --oneline
```

Each commit should:
- Follow `type(scope): description` format
- Describe WHY, not just WHAT

### 7. CLAUDE.md Updated (BLOCKER — non-trivial changes)

```bash
git diff origin/main -- CLAUDE.md
```

Verify §7 has a new dated history entry and §8 reflects current state.

### 8. Security Sanity Check

Grep for anything that shouldn't be committed:

```bash
grep -r "VITE_FIREBASE_" src/ --include="*.js" --include="*.ts" | grep -v ".env" || true
grep -rE "gemini|GEMINI" src/ --include="*.js" --include="*.jsx" | grep -v "test" || true
```

`GEMINI_API_KEYS` must never appear in `src/` — it lives only in Railway Variables.

## PR Description Template

```markdown
## Summary
- [bullet: what changed and why]
- [bullet: ...]

## Test plan
- [ ] npm test passes (N tests)
- [ ] npm run build clean
- [ ] Manually verified [key flow]
- [ ] CLAUDE.md updated

🤖 Generated with Claude Code
```

## Success Criteria

- ✅ All 5 blockers cleared
- ✅ CLAUDE.md current
- ✅ PR description drafted
- ✅ Ready to `git push && gh pr create`
