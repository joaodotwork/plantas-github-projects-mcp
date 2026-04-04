# Installation Guide

This MCP server works with both **Claude Desktop** (desktop app) and **Claude Code** (VS Code extension).

## 🚀 Fastest Installation (Claude Code CLI)

If you're using Claude Code, use the CLI for one-command installation using `npx`:

**Option A: Personal Access Token**
```bash
# 1. Get GitHub token from https://github.com/settings/tokens/new
#    Scopes needed: repo, project

# 2. Add to Claude Code using npx (no local installation required)
claude mcp add github-projects \
  --env GITHUB_TOKEN=ghp_your_token_here \
  -- npx -y @joaodotwork/plantas-github-projects-mcp
```

**Option B: OAuth Device Flow (auto-refreshing tokens)**
```bash
# 1. Register a GitHub OAuth App at https://github.com/settings/developers
#    Enable "Device Flow" in the app settings

# 2. Add to Claude Code with OAuth credentials
claude mcp add github-projects \
  --env GITHUB_CLIENT_ID=your_client_id \
  --env GITHUB_CLIENT_SECRET=your_client_secret \
  -- npx -y @joaodotwork/plantas-github-projects-mcp

# 3. On first run, follow the device flow prompt to authenticate in your browser
```

```bash
# Verify
claude mcp list

# Reload VS Code (Cmd+Shift+P → "Developer: Reload Window")
```

Done! Skip to verification below.

---

## 📋 Table of Contents

- [Fastest Installation (Claude Code CLI)](#-fastest-installation-claude-code-cli)
- [Manual Installation](#manual-installation)
  - [Option A: Claude Desktop](#option-a-claude-desktop-configuration)
  - [Option B: Claude Code (Manual)](#option-b-claude-code-vs-code-extension-configuration)
- [Troubleshooting](#troubleshooting)
- [Development Mode](#development-mode)

---

## Manual Installation

### 1. Get GitHub Personal Access Token

1. Go to https://github.com/settings/tokens/new
2. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `project` (Full control of projects)
3. Generate token (format: `ghp_...`)
4. **Save it securely** - you won't see it again!

### 2. Configure Claude

Choose your installation based on which Claude client you're using. We recommend using `npx` to run the server without manually managing files.

---

## Option A: Claude Desktop Configuration

Edit your Claude Desktop config file:

**macOS:**
```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows:**
```bash
code %APPDATA%\Claude\claude_desktop_config.json
```

Add the MCP server configuration:

```json
{
  "mcpServers": {
    "github-projects": {
      "command": "npx",
      "args": ["-y", "@joaodotwork/plantas-github-projects-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

**Replace:**
- `ghp_your_token_here` with your GitHub token

**Restart Claude Desktop:**

Completely quit and reopen Claude Desktop for the MCP server to load.

**Verify Installation:**

In Claude Desktop, start a new conversation and ask:

> "What MCP tools do you have available for GitHub Projects?"

You should see 17 tools:
- `create_project`
- `create_milestone`
- `create_issue`
- `add_issue_to_project`
- `create_iteration_field`
- `assign_issue_to_iteration`
- `add_iteration`
- `update_iteration`
- `add_subissue`
- `remove_subissue`
- `reprioritize_subissue`
- `update_item_status`
- `update_project_settings`
- `create_project_status_update`
- `get_project_status_updates`
- `get_repository_info`
- `get_project_info`

---

## Option B: Claude Code (VS Code Extension) Configuration

Claude Code uses a different configuration file than Claude Desktop.

### Quick Install (Recommended)

Use the Claude Code CLI to install the MCP server automatically:

```bash
claude mcp add github-projects \
  --env GITHUB_TOKEN=ghp_your_token_here \
  -- npx -y @joaodotwork/plantas-github-projects-mcp
```

**Or set token via environment variable:**

```bash
# Set token in your shell config first
export GITHUB_TOKEN=ghp_your_token_here

# Then add without hardcoding token
claude mcp add github-projects \
  --env GITHUB_TOKEN=${GITHUB_TOKEN} \
  -- npx -y @joaodotwork/plantas-github-projects-mcp
```

**Verify installation:**

```bash
claude mcp list
```

**Remove if needed:**

```bash
claude mcp remove github-projects
```

---

### Manual Configuration (Alternative)

If you prefer to edit the config file manually:

#### 1. Locate Config File

**macOS/Linux:**
```bash
code ~/.config/claude/code_config.json
```

**Windows:**
```bash
code %APPDATA%\Code\User\globalStorage\anthropics.claude-code\code_config.json
```

Or use the command palette:
1. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Claude Code: Open MCP Settings"
3. Select the command

### 2. Add MCP Server Configuration

If using manual configuration, add the server to the `mcpServers` section:

```json
{
  "mcpServers": {
    "github-projects": {
      "command": "npx",
      "args": ["-y", "@joaodotwork/plantas-github-projects-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

### 3. Reload VS Code

**Option 1: Command Palette**
1. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Developer: Reload Window"
3. Select the command

**Option 2: Quit and Reopen**
- Completely quit VS Code (`Cmd+Q` on macOS)
- Reopen VS Code

### 4. Verify Installation

In Claude Code chat panel, ask:

> "What MCP tools do you have available for GitHub Projects?"

You should see 17 tools listed.

### 5. Alternative: Use Environment Variable

Instead of hardcoding the token in config, you can use an environment variable:

**In your shell config (`~/.zshrc` or `~/.bashrc`):**
```bash
export GITHUB_TOKEN=ghp_your_token_here
```

**In Claude Code config:**
```json
{
  "mcpServers": {
    "github-projects": {
      "command": "npx",
      "args": ["-y", "@joaodotwork/plantas-github-projects-mcp"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Note:** After adding the environment variable, restart your terminal and VS Code for it to take effect.

---

## Troubleshooting

### MCP Server Not Loading

**Check logs:**

For Claude Desktop:
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

For Claude Code:
1. Open VS Code Developer Tools: `Help` → `Toggle Developer Tools`
2. Check Console tab for MCP-related errors
3. Look for messages about MCP server startup

**Common issues:**
1. **Invalid JSON in config** - Use a JSON validator
2. **Token not set** - Verify `GITHUB_TOKEN` in config
3. **Node.js not available** - Ensure `npx` is in your path

### "401 Unauthorized" Error

- **PAT:** Token is invalid or expired — generate a new one with `repo` and `project` scopes
- **OAuth:** Restart the MCP server to trigger automatic token refresh or re-authentication
- The server validates tokens at startup and shows actionable error messages

### "Cannot find module" Error

- If using local path: Check the absolute path in config
- If using npx: Ensure you have internet connection to download the package

### Claude Code Specific Issues

**MCP tools not appearing:**
1. Check that Claude Code extension is up to date
2. Verify config file path is correct for your OS
3. Try using Command Palette: "Claude Code: Restart MCP Servers"
4. Check VS Code Output panel (View → Output → Claude Code)

**Environment variable not working:**
- Make sure you restarted VS Code after setting the variable
- Launch VS Code from terminal to inherit environment: `code .`
- On macOS, you may need to restart your entire session

## Development Mode

For development (running from source):

```bash
# 1. Clone and install
git clone https://github.com/joaodotwork/plantas-github-projects-mcp.git
cd plants-github-projects-mcp
npm install

# 2. Build
npm run build

# 3. Register locally
claude mcp add github-projects-dev \
  --command "node" \
  --arg "$(pwd)/dist/index.js" \
  --env GITHUB_TOKEN=ghp_your_token_here
```
