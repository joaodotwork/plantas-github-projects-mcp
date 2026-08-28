---
description: Show plantas sessions (active by default) with their Claude session IDs
argument-hint: [recent_count]
allowed-tools: Bash(bash .claude/scripts/sessions-status.sh:*)
---

!`bash .claude/scripts/sessions-status.sh "$ARGUMENTS"`
