---
description: Check and update CLAUDE.md and other docs for the current work
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

Review current work and update all affected documentation.
CLAUDE.md is the mandatory maintainer — no change is "done" without it.

## Documentation Assessment

### 1. Identify What Changed

```bash
git diff origin/main --name-only
```

Categorize changes:
- New feature → update §4 Feature Inventory
- Architecture change → update §5
- Technical decision → update §6
- Bug fix → update §12 if fixing a known issue
- Any code change → §7 history entry + §8 state

### 2. CLAUDE.md Mandatory Sections

For every non-trivial change, update:

| Section | When |
|---|---|
| §4 Feature Inventory | Feature added, changed, or completed |
| §5 Architecture | New file, new pattern, new dependency |
| §6 Technical Decisions | A meaningful design decision was made |
| §7 Development History | Every session — dated entry with what/why/files |
| §8 Current System State | Test count, feature state, known issues, counts |
| §11 Roadmap | Planned item completed, new item added |
| §12 Bugs & Known Issues | Bug fixed or new bug found |
| §13 Lessons Learned | Non-obvious lesson discovered |
| §14 AI Agent Context | Pitfall or convention future agents must know |
| §15 Current Priorities | Completed items ticked, new priorities added |

### 3. Check Other Docs

- **README.md** — if `npm` commands, env vars, or setup changed
- **firestore.rules** — if a new Firestore collection was added (and document it in §9)
- **.env.local.example** — if a new env var is required

### 4. Execute Updates

For each doc section needing update:
1. Read the current content
2. Make precise edits — don't rewrite sections that are still accurate
3. Keep dates absolute (e.g., `2026-06-30`, not "today")

### 5. Verify

```bash
git diff -- CLAUDE.md  # confirm changes look right
npm test               # confirm nothing broken
```

## Success Criteria

- ✅ §7 has a new dated entry describing this session's changes
- ✅ §8 reflects current test count, feature states, and system state
- ✅ §15 priorities are current
- ✅ No stale information left in any updated section
