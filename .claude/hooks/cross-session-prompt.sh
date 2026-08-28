#!/usr/bin/env bash
# UserPromptSubmit hook: record this session's prompt and inject a digest of
# other active Claude sessions' recent activity into the conversation.
set -euo pipefail

input=$(cat)
session_id=$(jq -r '.session_id' <<<"$input")
cwd=$(jq -r '.cwd' <<<"$input")
prompt=$(jq -r '.prompt // ""' <<<"$input")

log_file="$cwd/.claude/cross-session.log"
mkdir -p "$(dirname "$log_file")"

ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
branch=$(git -C "$cwd" branch --show-current 2>/dev/null || echo "")
short="${session_id:0:8}"

jq -nc --arg ts "$ts" --arg s "$short" --arg b "$branch" \
       --arg p "$(printf '%.200s' "$prompt")" \
  '{ts:$ts,type:"prompt",session:$s,branch:$b,prompt:$p}' >> "$log_file"

cutoff=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
       || date -u -d '1 hour ago' +"%Y-%m-%dT%H:%M:%SZ")

digest=$(jq -r --arg me "$short" --arg cut "$cutoff" '
  select(.session != $me and .ts > $cut) |
  "[\(.ts[11:16]) \(.session) \(.branch)] \(.type): \(.prompt // .files)"
' "$log_file" 2>/dev/null | tail -10)

if [[ -n "$digest" ]]; then
  ctx=$'## Other active Claude sessions (last 1h)\n'"$digest"
  jq -nc --arg ctx "$ctx" \
    '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
fi
