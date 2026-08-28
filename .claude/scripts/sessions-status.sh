#!/usr/bin/env bash
# Show plantas sessions (active + optionally recent closed) with their Claude session info.
# Usage: sessions-status.sh [recent_count]   (default 0 = active only)
set -euo pipefail

recent="${1:-0}"
[[ -z "$recent" ]] && recent=0

main_path=$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')

if [[ "$recent" -gt 0 ]]; then
  sessions=$(plantas list --json --recent "$recent" 2>/dev/null)
else
  sessions=$(plantas list --json 2>/dev/null)
fi

claude_info() {
  local wt="$1"
  local slug
  slug=$(echo "$wt" | sed 's|/|-|g')
  local proj_dir="$HOME/.claude/projects/$slug"
  if [[ -d "$proj_dir" ]]; then
    local latest
    latest=$(ls -t "$proj_dir"/*.jsonl 2>/dev/null | head -1)
    if [[ -n "$latest" ]]; then
      local sess mtime
      sess=$(basename "$latest" .jsonl | cut -c1-8)
      mtime=$(date -r "$latest" "+%m-%d %H:%M" 2>/dev/null || echo "?")
      echo -e "$sess\t$mtime"
      return
    fi
  fi
  echo -e "-\t-"
}

{
  echo -e "ID\tSTATE\tBRANCH\tFOCUS\tCLAUDE\tLAST"

  if [[ -n "$main_path" ]]; then
    branch=$(git -C "$main_path" branch --show-current 2>/dev/null || echo "?")
    IFS=$'\t' read -r sess mtime < <(claude_info "$main_path")
    echo -e "(main)\tactive\t$branch\t-\t$sess\t$mtime"
  fi

  echo "$sessions" | jq -r '.active[]? | "\(.id)\tactive\t\(.branch)\t\(.focus)\t\(.worktree)"' \
    | while IFS=$'\t' read -r id state branch focus wt; do
        IFS=$'\t' read -r sess mtime < <(claude_info "$wt")
        echo -e "$id\t$state\t$branch\t$focus\t$sess\t$mtime"
      done

  echo "$sessions" | jq -r '.closed[]? | "\(.id)\tclosed\t\(.branch)\t\(.focus)\t\(.worktree)"' \
    | while IFS=$'\t' read -r id state branch focus wt; do
        IFS=$'\t' read -r sess mtime < <(claude_info "$wt")
        echo -e "$id\t$state\t$branch\t$focus\t$sess\t$mtime"
      done
} | column -t -s$'\t'
