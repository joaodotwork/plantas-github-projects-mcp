---
description: Show recent cross-session log entries (default last 20)
argument-hint: [count]
allowed-tools: Bash(bash .claude/scripts/sessions-tail.sh:*)
---

!`bash .claude/scripts/sessions-tail.sh "$ARGUMENTS"`
