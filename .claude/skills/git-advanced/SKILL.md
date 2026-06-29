---
name: git-advanced
description: Advanced git operations for Knowledge Check — rebase, conflict resolution, history cleanup, force-push safety. Use when rebasing, resolving conflicts, or doing non-standard git operations.
user-invocable: false
allowed-tools: Read, Bash, Grep
---

# Git Advanced — Knowledge Check

## When This Skill Applies

- Rebasing a branch onto latest `main`
- Resolving merge conflicts
- Cleaning up commit history before PR
- Recovering from a bad state
- Push failures

## Rebase onto Latest Main (standard)

```bash
git fetch origin
git rebase origin/main
```

If conflicts arise:
1. Read the conflict markers carefully — understand BOTH sides
2. Resolve keeping the intended behaviour (not just "take ours" or "take theirs")
3. `git add <resolved-file>` then `git rebase --continue`
4. Verify: `npm test && npm run build`

## Force-Push Safety

`--force-with-lease` only — never bare `--force`:

```bash
git push --force-with-lease origin <branch>
```

`--force-with-lease` fails if someone else pushed to the branch. `--force` would silently overwrite them. Use `--force-with-lease` always.

**Never force-push to `main`** — that's a Railway-deployed production branch.

## Undo Patterns

| Situation | Safe command |
|---|---|
| Unstage a file | `git restore --staged <file>` |
| Discard uncommitted changes to a file | `git restore <file>` |
| Undo last commit (keep changes) | `git reset HEAD~1` |
| Undo last commit (discard changes) | `git reset --hard HEAD~1` ← destructive, confirm first |
| Fix last commit message | `git commit --amend --no-edit` ← only if not pushed |

## Conflict Resolution Rules for This Project

- **CLAUDE.md conflicts**: always prefer the version with the most complete §7 entry — merge both sides' history entries, don't discard either
- **package-lock.json conflicts**: accept one side, then run `npm install` to regenerate — never hand-merge a lockfile
- **`src/styles.css` conflicts**: merge both sides' new rules; CSS conflicts are usually additive

## Checking What Will Be in a PR

```bash
git log origin/main..HEAD --oneline    # commit list
git diff origin/main..HEAD --stat      # files changed
git diff origin/main..HEAD             # full diff
```

## Stashing Work in Progress

```bash
git stash push -m "description of WIP"
# ... switch branches or pull ...
git stash pop
```

## History Cleanup (interactive rebase — local branch only)

Only before first push:
```bash
git rebase -i origin/main
```

This lets you squash fix-up commits, reword messages, or reorder. Never rebase commits that have already been pushed to the remote.

## Common Failure Recoveries

**Push rejected (not fast-forward)**:
```bash
git fetch origin && git rebase origin/main
git push origin <branch>
```

**Accidentally committed to main locally**:
```bash
git branch feat/rescue-my-work      # save the commits
git reset --hard origin/main        # reset main to remote
git checkout feat/rescue-my-work    # continue on feature branch
```
