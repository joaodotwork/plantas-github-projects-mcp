# AI Agent Session Guide for Plantas + Seiva

Welcome! This project uses **Plantas** (session management) with **Seiva** (context management).

## 🚨 MEMORIZE THESE COMMANDS - You will use them frequently!

**Core Plantas Commands (EXACT SYNTAX - Commit to Memory):**

```bash
# Check what sessions exist (ALWAYS run this first!)
plantas list

# Start a new session (quoted description is REQUIRED!)
plantas start <id> "<description>" [branch] [areas] [--issue <number>]

# End a session when done
plantas end <id>

# Check current session status
plantas status
```

**Command Syntax Rules:**
- Session description MUST be quoted: `"description"` ✅ not `description` ❌
- Optional parameters in square brackets: `[branch]` `[areas]`
- Session ID: short, no spaces (e.g., `auth`, `fix-bug`, `A`, `B`)
- Use `--issue <number>` to associate with a GitHub issue

**Real Examples to Remember:**
```bash
plantas start auth "Implement user authentication" feat/auth "src/auth/**" --issue 123
plantas start bugfix "Fix navigation issues" fix/nav
plantas start A "Quick admin fixes"
plantas end auth
```

## Quick Start for AI Assistants

1. **ALWAYS check active sessions first:**
   ```bash
   plantas list
   ```
   See what sessions are active and their focus areas. Use `plantas list --active` for a cleaner view.

2. **Read the context:**
   ```
   Read .claude/context.md
   Read .claude/sessions.json
   ```
   This gives you project state, tech stack, and recent activity (~2k tokens vs 30-50k full scan).

   **Note:** context.md is auto-generated and gitignored — regenerated on each commit.
   sessions.json IS committed to git and uses union merge strategy for cross-session coordination.

3. **Use plantas commands for session management** - See memorized syntax above!

## 🪝 Automatic Context Updates (Post-Commit Hook)

**context.md regenerates automatically after EVERY commit via post-commit hook.**

**What happens when you commit:**
1. Git runs your commit
2. Post-commit hook calls `plantas context --quiet`
3. context.md is regenerated from repo state (tech stack, key files, work streams, sessions)

**What this means for you as an AI Agent:**
- ✅ **You NEVER need to manually update context.md** — it's fully auto-generated
- ✅ context.md is gitignored — no commit amending, no merge conflicts
- ✅ Run `plantas context` manually if you need a fresh snapshot
- ✅ Run `plantas context --human` for a human-readable version

## Session Management Commands

**IMPORTANT**: Always use plantas commands for session operations. Never manually manipulate worktrees or sessions.json.

**Keep `.plantas.config.json` committed.** It records which config dir this repo
uses (`.claude/` for `--seiva`, otherwise `.plantas/`). If it goes missing or
becomes malformed, plantas falls back to detecting the directory that holds
`sessions.json` and warns that it guessed; if both candidates hold one, it
refuses to guess and uses the default — which may not be the directory this repo
actually uses. Run `plantas init` to write the file back.

### Starting a Session
When the user wants to start working on something new:
```bash
plantas start <session-id> "<description>" [optional-branch] [optional-areas] [--issue <number>] [--from <ref>]

# Examples:
plantas start auth "Implement user authentication" feat/auth "src/auth/**" --issue 45
plantas start bugfix "Fix navigation issues" fix/nav
plantas start feature "Add new dashboard"
plantas start menu "Print-ready PDFs" feat/menu --from dev    # cut from dev, not HEAD
```

**Where does the new branch come from?** By default, whatever `HEAD` the *main
checkout* happens to be sitting on. That is fine while `main` is the only
long-lived branch and wrong the moment a repo grows an integration branch.

- `--from <ref>` (alias `--base`) sets the branch point explicitly.
- A bare name resolves **remote-first** — `--from dev` uses `origin/dev`, not a
  possibly-stale local `dev`. Use `refs/heads/dev` to force the local branch,
  or `PLANTAS_NO_FETCH=1` to skip the fetch. Tags and SHAs work as given.
- The branch point is **always printed**, flag or not:
  `✓ Branched from: origin/dev (4bad370 dev: integration work)`. Read it — a
  wrong base is cheap to fix now and expensive to fix at merge time.
- It is recorded as `baseRef` in `sessions.json`, and `plantas merge` reuses it
  when resolving what to merge.

**Claude's persistent memory is shared with the main checkout.** Memories live at
`~/.claude/projects/<path-key>/memory`, keyed by absolute path, so each worktree
would otherwise get its own empty store and a memory written in one session would
be invisible everywhere else. `plantas start` symlinks the worktree's store to the
main checkout's, so `MEMORY.md` and every memory file are shared across all
sessions. Opt out with `"sessions": { "shareMemory": false }`. An existing real
memory directory is never replaced.

**In a repo where PRs target an integration branch, pass `--from`.** Otherwise
the session silently branches from production and the mistake surfaces later as
a conflict or as missing code.

### Ending a Session
When work is complete and the user wants to cleanup:
```bash
plantas end <session-id>

# Example:
plantas end auth

# Skip confirmations (for scripts):
plantas end auth --force

# Terminate processes still running out of the worktree (SIGTERM, then SIGKILL):
plantas end auth --kill-orphans

# Also delete the leftovers it would otherwise preserve and list:
plantas end auth --purge
```

`plantas end` now does two things before and after removing the worktree:

- **Orphaned processes.** A dev server started inside the worktree survives its
  removal, keeps holding its port, and reports a cwd that no longer exists. The
  next session then silently takes the *next* port, so nothing errors and the
  orphans stack up. `end` scans for them and prints PID, command and listening
  sockets. **Report-only by default** — pass `--kill-orphans` to terminate them.
- **Leftovers.** `git worktree remove` refuses to delete directories holding
  ignored or untracked content, and a read-only build directory makes it fail
  *after* de-registering the worktree — which is how empty husks survived while
  `git worktree list` considered them gone. `end` sweeps empty dirs, ignored
  build output, and tracked files it has verified byte-identical to the branch.
  Anything else — untracked non-build files, modified tracked files, `.env`,
  logs — is **preserved and listed**, and the output says `DIRECTORY REMAINS`
  rather than claiming success. `--purge` deletes those too.

`--force` skips confirmation prompts only. It deliberately implies neither
`--kill-orphans` nor `--purge`.

**The session branch is deleted if it is fully merged** into the integration
branch — resolved the same way `plantas merge` resolves its target, so "merged"
means the same thing in both commands. A branch with unmerged commits is **kept**
and the reason is printed; so is one checked out in another worktree.
`--keep-branch` opts out entirely. Cleanup never destroys unmerged work.

### Checking Sessions
Before starting work, always check what's active:
```bash
plantas list              # See all active and recent sessions
plantas list --active     # Only active sessions
plantas list --table      # Compact table output
plantas list --json       # Machine-readable JSON
plantas list --recent 5   # Active + last 5 closed
plantas status            # Current session status
```

### What NOT to Do

❌ **Never manually:**
- Run `git worktree add/remove` directly
- Edit sessions.json file
- Delete session directories manually
- Run `git merge` in session worktrees (use `plantas merge` instead)
- Run `git pull` in main when coordination files are dirty (use `plantas sync` instead)
- Commit with `--no-verify` in a worktree created by plantas ≤2.11.x (see the staging note below)

### Staging in a session worktree

**`git add -A` is safe.** The config dir in a worktree is a real directory, exactly
as git checked it out — there is no symlink standing at a tracked path, so there is
nothing dangerous to stage. `git commit --no-verify` is safe too.

Only **gitignored** files are linked to the main checkout (`context.md`,
`settings.local.json`, `cross-session.log`). A symlink at an ignored path is
invisible to git. `sessions.json` is deliberately *not* linked — it is tracked, and
linking it would put a symlink back at a tracked path. plantas reads and writes the
main checkout's copy directly.

> **Worktrees created by plantas ≤2.11.x** still have the whole config dir
> symlinked, and for those `git add -A` *is* destructive — it stages the symlink
> plus a deletion of every tracked file beneath it. A `pre-commit` guard catches it
> at commit time, but `--no-verify` skips the guard. In an old worktree, stage
> explicitly. `plantas doctor` reports which kind you have.

✅ **Always:**
- Use `plantas start` to begin new work
- Use `plantas end` to cleanup
- Use `plantas sync` to pull into main worktree
- Use `plantas merge` to merge branches in session worktrees
- Use `plantas list` to check status
- Let plantas handle all session lifecycle operations

## Keeping Branches in Sync

### In the main worktree: `plantas sync`

After merging a session PR on GitHub, your main worktree often has an uncommitted
`sessions.json` (updated by hooks). A plain `git pull` will fail because git aborts
before the merge driver kicks in.

(`context.md` is **gitignored** — it is a snapshot of local repo state that the
post-commit hook regenerates on every commit, so it never participates in a pull,
a merge, or a PR diff.)

```bash
# From the main repo directory:
plantas sync
```

This auto-stashes coordination files → pulls with `--no-rebase` (so union merge
applies) → pops the stash. No extra commits, no manual stashing.

**Options:**
- `-r, --remote <name>` — remote to pull from (default: `origin`)
- `-b, --branch <name>` — branch to pull (default: current branch)
- `-f, --force` — run even if you're in a worktree

### In session worktrees: `plantas merge [branch]`

Session worktrees have a symlinked `.claude/` (or `.plantas/`) directory.
A plain `git merge` fails because git can't stash paths beyond a symlink.

```bash
# From a session worktree:
plantas merge              # merges your integration branch (resolved, see below)
plantas merge origin/dev   # explicit — always unambiguous
plantas merge feat/other   # merge any branch
```

This temporarily removes the symlink → restores real tracked files → runs
`git merge` → re-creates the symlink. If there are merge conflicts, the symlink
is still restored so you can resolve them normally. The swap is protected by
`try/finally` and SIGINT/SIGTERM handlers, so a Ctrl-C mid-merge still restores
the symlink.

**Which branch does a bare `plantas merge` merge?** It is resolved in order, and
it refuses rather than guessing:

1. the branch you passed explicitly;
2. the current branch's configured upstream;
3. `integrationBranch` in `.plantas.config.json` — defaults to the repo's
   default branch, so single-branch repos need no configuration;
4. the ref this worktree was branched from (`baseRef` in `sessions.json`).

If none of those resolve it errors and names the candidates. **In a repo where
`main` is production and another branch (e.g. `dev`) is the integration branch,
set `integrationBranch` and prefer passing the ref explicitly** — merging the
wrong branch is a valid git operation, so it cannot fail loudly.

**IMPORTANT:** In session worktrees, always use `plantas merge` instead of
`git merge` to avoid the symlink stash failure. Never repair a worktree's config
dir by hand (`rm -rf .claude && ln -s …`) — run `plantas doctor --fix`, which
detects a config dir that should be a symlink but isn't and restores it, keeping
a backup of whatever it replaced.

## Session Workflow

**When user asks to start new work:**
1. Check what's already active: `plantas list`
2. Start the new session: `plantas start <id> "<description>" [branch] [areas]`
3. Read context.md (project understanding)
4. Work in the session worktree

**During work:**
- Make changes within your focus areas
- Commit regularly to git
- context.md auto-updates via git hooks
- Use `plantas list` to see other active sessions
- Use `plantas merge` to pull in changes from main (not `git merge`)

**When user asks to end session:**
1. Ensure work is committed
2. Run: `plantas end <session-id>`
3. Confirm when prompted (or use --force to skip)

**After merging a session PR on GitHub:**
1. From the main repo: `plantas sync` to pull latest without coordination file conflicts

## Token Optimization

- ✅ Read context.md first (~2k tokens)
- ✅ Use grep/glob for targeted searches
- ✅ Read specific files only when needed
- ❌ Avoid full codebase scans

## When Context Gets Full (Compression Time)

When the conversation context approaches limits, run `plantas context` to get a fresh snapshot.
context.md is auto-generated — no need to manually maintain it.

## Cross-Session Awareness (if installed)

If this project was set up with `plantas init --seiva --cross-session`, parallel
Claude sessions across worktrees share a realtime awareness channel:

- Each prompt you submit is logged to `.claude/cross-session.log`, and a digest of
  the **other** sessions' last-hour activity is injected into your context
  automatically — you start each turn already knowing what the others are doing.
- Use these slash commands to look across the whole worktree fleet:
  - `/plantas:tail [N]` - recent cross-session log entries (default 20)
  - `/plantas:status [recent_N]` - plantas sessions and their Claude session IDs
  - `/plantas:search <term>` - grep transcripts across all worktrees

This is the **conversation-layer** complement to the git-layer coordination
(committed `sessions.json`). See `.claude/CROSS_SESSION.md` for details.

## Resources

### Command Reference
- `plantas list` - List all active and recent sessions (`--table`, `--json`)
- `plantas start <id> "<desc>" [branch] [areas]` - Start a new session (`--issue`, `--from <ref>`)
- `plantas end <id> [--force]` - End a session and cleanup (`--kill-orphans`, `--purge`, `--keep-branch`)
- `plantas context` - Generate context.md (`--human`, `--refresh`)
- `plantas sync` - Pull latest, auto-stashing coordination files (main worktree)
- `plantas merge [branch]` - Merge a branch, handling symlinked config dirs (worktrees)
- `plantas rebuild [--dry-run]` - Rebuild sessions.json from git history
- `plantas status` - Show current session status
- `plantas doctor` - Check installation, dependencies, config-dir integrity and the commit guard
- `plantas doctor --fix` - Repair a worktree config dir that should be a symlink but isn't
- `plantas init --seiva` - Initialize in a new project
- `plantas init --seiva --cross-session` - ...plus realtime cross-session awareness
- `/plantas:tail` · `/plantas:status` · `/plantas:search` - Cross-session slash commands (if installed)

---
Made with 🌱 by Plantas + 🌊 Seiva
