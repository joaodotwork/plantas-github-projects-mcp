# Cross-Session Awareness (Conversation Layer)

A realtime layer on top of plantas that lets parallel Claude Code sessions
across worktrees see each other's activity. Distinct from plantas's existing
v2.0 *git-layer* coordination (committed `sessions.json`, under a JSON-aware
merge driver): this layer is the *conversation-layer* equivalent —
what each Claude is currently prompting and touching, surfaced to the
others within the hour.

Installed by `plantas init --seiva --cross-session`.

---

## What it does

1. Every prompt typed into any session appends a JSON line to
   `.claude/cross-session.log`, and the same hook injects a digest of the
   *other* sessions' last-hour activity into the prompt context. Each
   Claude opens its turn already knowing what the others are working on.
2. At end of every turn, a Stop hook records which files this session
   touched (deduped against the previous entry, `.claude*` paths filtered).
3. Three slash commands — `/plantas:search`, `/plantas:tail`,
   `/plantas:status` — read across the whole worktree fleet beyond the
   one-hour digest the hook produces.

The whole thing rides on the fact that `plantas start` symlinks the
config dir across all worktrees to the main repo's, so a single shared
log file lives at `<repo>/.claude/cross-session.log` and every session
writes to the same file.

---

## Components

### Hooks — `.claude/hooks/`

| File | Event | Job |
|---|---|---|
| `cross-session-prompt.sh` | `UserPromptSubmit` | Append this prompt to log; emit `additionalContext` JSON containing other sessions' last-hour digest. |
| `cross-session-stop.sh` | `Stop` | Append this turn's modified-file list to log (with dedup). |

Wired in `.claude/settings.local.json` (gitignored — settings are
per-machine). The wired form is:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/cross-session-prompt.sh\""
    }]}],
    "Stop": [{ "hooks": [{ "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/cross-session-stop.sh\""
    }]}]
  }
}
```

**Why `$CLAUDE_PROJECT_DIR` rather than a relative path.** Claude Code sets
this env var per session to the worktree root, and it's stable for the
life of the session. The Stop hook in particular fires *after* all tool
calls in a turn — if any Bash tool call shifted cwd (`cd /tmp && …`),
a relative `bash .claude/hooks/…` resolves against the wrong directory and
fails with `No such file or directory`. UserPromptSubmit fires before any
tool call, so it's less exposed, but anchoring both keeps the convention
uniform.

### Wrapper scripts — `.claude/scripts/`

| Script | Purpose |
|---|---|
| `sessions-search.sh <term>` | Greps Claude transcripts across all worktrees + plantas-tracked closed sessions. Builds a slug list from `git worktree list` + `plantas list --json --recent 999`, derives `~/.claude/projects/<slug>/` paths, jq-greps user/assistant text. |
| `sessions-tail.sh [N]` | Pretty-prints the last N (default 20) entries of `cross-session.log`. |
| `sessions-status.sh [recent_N]` | Joins `plantas list --json` with each session's latest JSONL transcript path, so you can see which Claude UUID belongs to which plantas session. |

### Slash commands — `.claude/commands/plantas/`

Three Markdown files, each with frontmatter that scopes a `Bash(...)`
permission and a body that auto-executes the wrapper script via the
backtick `!` form:

| Slash | Body |
|---|---|
| `/plantas:search <term>` | `` !`bash .claude/scripts/sessions-search.sh "$ARGUMENTS"` `` |
| `/plantas:tail [N]` | `` !`bash .claude/scripts/sessions-tail.sh "$ARGUMENTS"` `` |
| `/plantas:status [recent_N]` | `` !`bash .claude/scripts/sessions-status.sh "$ARGUMENTS"` `` |

Output is injected directly into the conversation — no LLM round-trip.

### Log — `.claude/cross-session.log`

JSONL, gitignored, one line per event. Two record shapes:

```json
{"ts":"2026-04-30T17:42:11Z","type":"prompt","session":"3d0217d5","branch":"feat/x","prompt":"…first 200 chars…"}
{"ts":"2026-04-30T17:42:48Z","type":"files","session":"3d0217d5","branch":"feat/x","files":"path/a.md,path/b.md"}
```

Session ID is the first 8 chars of the Claude session UUID.

---

## Pitfalls worth knowing

- **macOS bash 3.2 has no `declare -A`.** Use `sort -u` on collected strings
  instead of associative-array dedup.
- **`set -euo pipefail` + `grep -v` returning no matches = exit 1 = killed
  script.** Use `awk '$2 !~ /^pattern/'` instead of `grep -v '^pattern'` on
  potentially-empty input.
- **First-run guards.** The Stop hook needs `[[ -f "$log_file" ]]` around
  any jq dedup lookup, otherwise the very first invocation in a session
  reads a missing file under strict mode and aborts.
- **`date -u -v-1H` is BSD; `date -u -d '1 hour ago'` is GNU.** Try BSD
  first, fall back to GNU.
- **Symlinked `.claude/` under git.** Each worker worktree shows the
  hooks/scripts/commands as deleted in `git status` (because `.claude` is
  the symlink). Expected. Plantas's `plantas merge` exists specifically to
  handle merges across this symlink.

---

## How this complements `plantas` v2.0

| Layer | Mechanism | Surfaced when |
|---|---|---|
| **git-layer** *(v2.0)* | `sessions.json` committed under a JSON-aware merge driver | Across commits, branches, days |
| **conversation-layer** *(this)* | `cross-session.log` JSONL + UserPromptSubmit injection | Within the hour, between live sessions |

Both are useful. Neither replaces the other.
