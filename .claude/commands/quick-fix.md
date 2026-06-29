---
description: Fast-track workflow for small bug fixes
argument-hint: [brief description of the bug]
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

Execute streamlined workflow for small, isolated bug fixes.

## When to Use

- ✅ Clear, isolated bug (root cause identified)
- ✅ Change < 50 lines
- ✅ No architecture changes
- ✅ Existing tests cover the area (or a small new assertion fixes it)

**NOT for**: new features, refactors, dependency upgrades, multi-file rewrites.

## Workflow

### 1. Understand the Bug First

Before touching code:
1. Reproduce the bug (or confirm from test output)
2. Identify the root cause — grep callers, trace the real flow
3. Fix at root (one guard in the shared function > guards in every caller)

### 2. Branch

```bash
git checkout main && git pull origin main
git checkout -b fix/short-description
```

### 3. Fix + Test

Make the minimal change. Then validate:

```bash
npm test          # all existing tests must still pass
npm run build     # build must be clean
```

If you touched `api/`, also: `node --check api/<file>.js`

If the fix adds a new code path, add the smallest test that would fail without it.

### 4. Commit

```bash
git add <specific files>
git commit -m "fix(scope): what was wrong and what fixed it"
```

### 5. Push + PR

```bash
git push origin fix/short-description
gh pr create --title "fix(scope): description" --body "$(cat <<'EOF'
## Summary
- Root cause: [one sentence]
- Fix: [one sentence]

## Test plan
- [ ] npm test passes
- [ ] npm run build clean
- [ ] Manually verified [how]

🤖 Generated with Claude Code
EOF
)"
```

## Success Criteria

- ✅ Root cause fixed (not just the symptom)
- ✅ All existing tests pass
- ✅ Build clean
- ✅ PR created with clear explanation
