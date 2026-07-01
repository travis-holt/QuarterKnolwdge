# Local Migration Guide

Use this when the Codespace is going away and the local machine needs the full working state, not just what is pushed to GitHub.

## What Must Be Preserved

The GitHub repo is not enough. This Codespace also has important ignored/local files:

- `.env.local` - Firebase and Gemini local env vars.
- `roo-code-settings.json` - local agent/provider settings with a live API key.
- `OB GYN SOP.pdf` and `Pediatrics_SOP_Updated.pdf` - ignored SOP source files.
- `.claude/` - in-repo Claude commands, agents, settings, and skills.
- `/home/codespace/.claude/` - user-level Claude state, credentials, ponytail plugin state, file history.
- `/home/codespace/.codex/` - user-level Codex config, auth, skills, memory state, and local databases.

The migration bundles contain secrets. Do not commit them, upload them to GitHub, or share them.

## Create Bundles In Codespaces

From the repo root:

```bash
bash scripts/create-migration-bundles.sh
```

The script writes archives under `migration-bundles/<timestamp>/`:

- `quarterknowledge-workspace-<timestamp>.tar.gz`
- `codespace-agent-home-state-<timestamp>.tar.gz`
- `MANIFEST.txt`
- `SHA256SUMS.txt`

`node_modules` is intentionally excluded. Reinstall it locally with `npm install`.

## Restore On The Local Machine

Prerequisites:

- Node.js 20 or newer.
- npm.
- Git.
- A shell with `tar` support. On Windows, use WSL or Git Bash.

Restore the workspace:

```bash
mkdir -p ~/Projects
tar -xzf quarterknowledge-workspace-<timestamp>.tar.gz -C ~/Projects
cd ~/Projects/QuarterKnolwdge
```

Restore Claude/Codex user-level state into the local home directory:

```bash
tar -xzf codespace-agent-home-state-<timestamp>.tar.gz \
  -C "$HOME" \
  --strip-components=2 \
  home/codespace/.claude \
  home/codespace/.codex
```

If the local machine already has `~/.claude` or `~/.codex`, back those up before extracting.

## Verify The App Locally

From the restored repo:

```bash
npm install
npm test
npm run build
npm start
```

Open `http://localhost:3000`.

Important runtime note: `npm run dev` serves the Vite client only. The `/api` endpoints and `/api/live` WebSocket relay only run under `npm start` after `npm run build`.

## After Restore

Check these before deleting the Codespace:

- `.env.local` exists and has `VITE_FIREBASE_*`, `GEMINI_API_KEYS`, and `GENERATION_SECRET`.
- `.claude/skills` exists in the repo.
- `~/.claude` exists locally if Claude tooling needs ponytail or user-level settings.
- `~/.codex` exists locally if Codex memory/skills/auth should follow over.
- `npm test` and `npm run build` pass locally.
- `npm start` serves the app at `http://localhost:3000`.

