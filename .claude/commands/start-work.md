---
description: Start work on a new task with proper branch setup and acceptance criteria gate
argument-hint: [short task description]
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

You are starting work on a new task for Knowledge Check.

## Pre-Flight Checklist

### 1. Stop-the-Line: Acceptance Criteria Gate (MANDATORY)

Before touching any code, confirm:

- What is the specific goal of this task?
- What does "done" look like? (visible behaviour change, passing test, etc.)
- Is there any risk of breaking existing features?

If the task description is vague, **STOP** and ask the user to clarify before proceeding.

### 2. Git Status Check

```bash
git status
git branch --show-current
```

Verify:
- Working tree is clean (no uncommitted changes)
- Currently on `main` or a branch you own

### 3. Pull Latest Main

```bash
git checkout main && git pull origin main
```

### 4. Create Feature Branch

Branch format: `type/short-description`

Types: `feat` (new feature), `fix` (bug fix), `chore` (cleanup/maintenance), `docs` (docs only)

```bash
git checkout -b feat/description-of-work
```

### 5. Orient Yourself

Read the relevant context before writing code:

```bash
cat CLAUDE.md  # project knowledge base — always the starting point
```

Identify which files the task touches and read them before editing.

## Success Criteria

- ✅ Task scope is clear and acceptance criteria defined
- ✅ On a fresh feature branch from latest `main`
- ✅ Relevant code files read and understood
- ✅ Ready to implement

Report the branch name, the acceptance criteria you've confirmed, and any questions before starting.
