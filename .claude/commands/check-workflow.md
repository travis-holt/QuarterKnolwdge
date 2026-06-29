---
description: Quick health check of current git/work state
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

Perform a quick workflow health check for Knowledge Check.

## Status Checks

### 1. Git State

```bash
git status
git branch --show-current
git log origin/main..HEAD --oneline
```

Report:
- Current branch and naming convention (`type/description`)
- Uncommitted changes (list them)
- Commits ahead of `main`

### 2. Validation Gates

```bash
npm test
```

If tests fail, flag them as blockers.

### 3. Up-to-Date Check

```bash
git fetch origin
git log HEAD..origin/main --oneline
```

Report how many commits behind `main` (if any). Recommend rebase if needed.

### 4. CLAUDE.md Currency

```bash
git diff HEAD -- CLAUDE.md | head -20
```

Check if any code changes in this session are not yet reflected in CLAUDE.md.

### 5. Secrets Safety

```bash
grep -r "GEMINI_API_KEY" src/ --include="*.js" --include="*.jsx" 2>/dev/null | head -5 || echo "Clean"
grep -rE "VITE_FIREBASE_[A-Z]+" src/ --include="*.js" 2>/dev/null | grep -v '\.env' | head -5 || echo "Clean"
```

## Output Format

Traffic-light summary:
- ✅ GREEN: All clear, workflow healthy
- ⚠️ YELLOW: Minor issues, can proceed with caution
- ❌ RED: Blocker — must fix before PR

List specific issues and what to do about each.
