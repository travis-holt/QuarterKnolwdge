#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_NAME="$(basename "$ROOT")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-"$ROOT/migration-bundles/$STAMP"}"

mkdir -p "$OUT_DIR"

WORKSPACE_ARCHIVE="$OUT_DIR/quarterknowledge-workspace-$STAMP.tar.gz"
AGENT_ARCHIVE="$OUT_DIR/codespace-agent-home-state-$STAMP.tar.gz"
MANIFEST="$OUT_DIR/MANIFEST.txt"
SUMS="$OUT_DIR/SHA256SUMS.txt"

echo "Creating workspace archive..."
tar \
  --ignore-failed-read \
  --warning=no-file-changed \
  --exclude="$ROOT_NAME/node_modules" \
  --exclude="$ROOT_NAME/migration-bundles" \
  -czf "$WORKSPACE_ARCHIVE" \
  -C "$ROOT/.." \
  "$ROOT_NAME"

home_paths=()
[[ -d /home/codespace/.claude ]] && home_paths+=("home/codespace/.claude")
[[ -d /home/codespace/.codex ]] && home_paths+=("home/codespace/.codex")
[[ -d /home/codespace/.config/gh ]] && home_paths+=("home/codespace/.config/gh")

if ((${#home_paths[@]})); then
  echo "Creating user-level agent state archive..."
  tar \
    --ignore-failed-read \
    --warning=no-file-changed \
    -czf "$AGENT_ARCHIVE" \
    -C / \
    "${home_paths[@]}"
else
  echo "No user-level agent directories found; skipping agent archive."
fi

{
  echo "QuarterKnolwdge local migration bundle"
  echo "Created UTC: $STAMP"
  echo "Repo root: $ROOT"
  echo
  echo "Git HEAD:"
  git -C "$ROOT" rev-parse HEAD || true
  echo
  echo "Git status:"
  git -C "$ROOT" status --short || true
  echo
  echo "Workspace archive:"
  basename "$WORKSPACE_ARCHIVE"
  echo "Includes the repo working tree, .git, ignored local files, .env.local, in-repo .claude, SOP PDFs, and roo-code-settings.json."
  echo "Excludes node_modules and migration-bundles."
  echo
  echo "Agent home archive:"
  if [[ -f "$AGENT_ARCHIVE" ]]; then
    basename "$AGENT_ARCHIVE"
    printf '%s\n' "${home_paths[@]}"
  else
    echo "not created"
  fi
  echo
  echo "Sensitive contents warning:"
  echo "These archives may contain API keys, auth tokens, local sessions, and SOP files. Keep them private."
} > "$MANIFEST"

(
  cd "$OUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./*.tar.gz > "$SUMS"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 ./*.tar.gz > "$SUMS"
  else
    echo "No sha256 tool found; checksum file not created." >&2
  fi
)

echo
echo "Migration bundles created in:"
echo "$OUT_DIR"
echo
echo "Files:"
ls -lh "$OUT_DIR"
