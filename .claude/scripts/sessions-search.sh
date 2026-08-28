#!/usr/bin/env bash
# Search Claude Code transcripts across all worktrees of the current repo.
# Usage: sessions-search.sh <term>
set -euo pipefail

term="${1:?usage: $0 <term>}"

declare -a paths=()
# Active worktrees (always includes the main one)
while read -r wt; do
  paths+=("$wt")
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')
# Closed plantas session worktree paths (their dirs may be gone, but transcripts persist)
while read -r wt; do
  [[ -n "$wt" ]] && paths+=("$wt")
done < <(plantas list --json --recent 999 2>/dev/null \
         | jq -r '.closed[]?.worktree' 2>/dev/null)

slugs=$(for wt in "${paths[@]}"; do echo "$wt" | sed 's|/|-|g'; done | sort -u)

declare -a files=()
while read -r slug; do
  [[ -z "$slug" ]] && continue
  for f in "$HOME/.claude/projects/$slug/"*.jsonl; do
    [[ -f "$f" ]] && files+=("$f")
  done
done <<< "$slugs"

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No Claude transcripts found for this repo's worktrees."
  exit 0
fi

hits=0
for f in "${files[@]}"; do
  matches=$(jq -r --arg t "$term" '
    select(.type=="user" or .type=="assistant") |
    ( .message.content as $c |
      if   ($c | type) == "string" then $c
      elif ($c | type) == "array"  then ($c | map(.text? // "") | join(" "))
      else "" end
    ) as $text |
    select($text | test($t; "i")) |
    "  \(.timestamp // "?")  \(.type)  \($text | gsub("\n"; " ") | .[0:180])"
  ' "$f" 2>/dev/null || true)

  if [[ -n "$matches" ]]; then
    slug=$(basename "$(dirname "$f")")
    sess=$(basename "$f" .jsonl | cut -c1-8)
    echo "── $slug / $sess ──"
    echo "$matches"
    echo
    hits=$((hits + 1))
  fi
done

if [[ $hits -eq 0 ]]; then
  echo "No matches for: $term"
else
  echo "$hits transcript(s) matched."
fi
