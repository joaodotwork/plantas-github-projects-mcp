#!/usr/bin/env bash
# Pretty-print the last N entries of the cross-session log.
# Usage: sessions-tail.sh [count]   (default 20)
set -euo pipefail

n="${1:-20}"
[[ -z "$n" ]] && n=20

# Anchor to the repo root so this works from any worktree subdirectory, not
# just where the slash command happened to be invoked.
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
log_file="$root/.claude/cross-session.log"
[[ -f "$log_file" ]] || { echo "no cross-session.log yet"; exit 0; }

tail -n "$n" "$log_file" | jq -r '
  "[\(.ts[11:16]) \(.session) \(.branch)] \(.type): \(.prompt // .files)"
'
