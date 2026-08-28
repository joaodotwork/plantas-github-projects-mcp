#!/usr/bin/env bash
# Stop hook: at end of each turn, record any files this session has touched.
set -euo pipefail

input=$(cat)
session_id=$(jq -r '.session_id' <<<"$input")
cwd=$(jq -r '.cwd' <<<"$input")

log_file="$cwd/.claude/cross-session.log"
[[ -d "$(dirname "$log_file")" ]] || exit 0

# Porcelain v1 lines are "XY PATH" (3-char status prefix). Strip it via substr,
# unwrap renames ("ORIG -> NEW" → NEW), then drop .claude paths. awk (not
# `grep -v`) keeps this pipefail-safe on empty input, and substr preserves
# filenames containing spaces — `$2` would have truncated them.
files=$(git -C "$cwd" status --porcelain 2>/dev/null \
       | awk '{ sub(/^.../, ""); sub(/.* -> /, ""); if ($0 !~ /^\.claude/) print }' \
       | head -20 | paste -sd, -)
[[ -z "$files" ]] && exit 0

short="${session_id:0:8}"

# Skip if the last 'files' entry for this session has the same list (dedupe noise).
last_files=""
if [[ -f "$log_file" ]]; then
  last_files=$(jq -r --arg s "$short" '
    select(.session==$s and .type=="files") | .files
  ' "$log_file" 2>/dev/null | tail -1)
fi
[[ "$files" == "$last_files" ]] && exit 0

ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
branch=$(git -C "$cwd" branch --show-current 2>/dev/null || echo "")

jq -nc --arg ts "$ts" --arg s "$short" --arg b "$branch" --arg f "$files" \
  '{ts:$ts,type:"files",session:$s,branch:$b,files:$f}' >> "$log_file"
