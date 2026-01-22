# GitHub Projects MCP Server

A Model Context Protocol (MCP) server for automating GitHub Projects v2 workflows - create projects, milestones, issues, and iterations programmatically.

**Works with:** Claude Desktop (desktop app) and Claude Code (VS Code extension)

## Features

- ✅ **Create Projects**: Set up new GitHub Projects v2 boards
- ✅ **Create Milestones**: Organize work into milestones
- ✅ **Create Issues**: Bulk create issues with milestones and labels
- ✅ **Add to Projects**: Automatically add issues to project boards
- ✅ **Iteration Fields**: Create weekly/sprint iteration fields
- ✅ **Assign Iterations**: Distribute issues across sprints
- ✅ **Sub-issue Management**: Add, remove, and reprioritize sub-issues
- ✅ **Update Status**: Change project item status with human-readable values
- ✅ **Get Info**: Retrieve repository and project metadata

## Installation

### Prerequisites

- Node.js 20+
- GitHub Personal Access Token with `repo` and `project` scopes

### Install as npm package

```bash
npm install -g plantas-github-projects-mcp
```

### Or build from source

```bash
cd github-projects-mcp
npm install
npm run build
```

## Configuration

### 1. Set up GitHub Token

Create a `.env` file or set environment variable:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

### 2. Configure Claude

**For Claude Code:**
```bash
# Using npx (published package)
claude mcp add github-projects --env GITHUB_TOKEN=ghp_your_token_here -- npx -y @joaodotwork/plantas-github-projects-mcp

# Or using local build
cd github-projects-mcp
claude mcp add github-projects --env GITHUB_TOKEN=ghp_your_token_here -- node $(pwd)/dist/index.js
```

**For Gemini CLI:**
```bash
# Using npx (published package)
gemini mcp add github-projects npx -e GITHUB_TOKEN=ghp_your_token_here -- -y @joaodotwork/plantas-github-projects-mcp

# Using local build
gemini mcp add github-projects node -e GITHUB_TOKEN=ghp_your_token_here -- $(pwd)/dist/index.js
```

**For Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json`

See [INSTALL.md](INSTALL.md) for detailed platform-specific instructions and manual configuration.

```json
{
  "mcpServers": {
    "github-projects": {
      "command": "npx",
      "args": ["-y", "plantas-github-projects-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "github-projects": {
      "command": "github-projects-mcp",
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

### 3. Restart

**Claude Desktop:** Completely quit and reopen the app

**Claude Code:** Reload VS Code window (Cmd+Shift+P → "Developer: Reload Window")

## Available Tools

### `create_project`

Create a new GitHub Projects v2 board.

**Parameters:**
- `owner` (string, required): GitHub username or organization
- `title` (string, required): Project title
- `description` (string, optional): Project description

**Example:**
```typescript
{
  "owner": "joaodotwork",
  "title": "v1.0 Production Release",
  "description": "Sprint to ship v1.0"
}
```

**Returns:**
```json
{
  "id": "PVT_kwHOAwJiCM4BNC20",
  "number": 7,
  "title": "v1.0 Production Release",
  "url": "https://github.com/users/joaodotwork/projects/7"
}
```

---

### `create_milestone`

Create a milestone in a repository.

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `title` (string, required): Milestone title
- `description` (string, optional): Milestone description
- `dueOn` (string, optional): Due date in ISO 8601 format

**Example:**
```typescript
{
  "owner": "joaodotwork",
  "repo": "dpds-arkiv",
  "title": "Epic 1: GitHub Metadata Workflow",
  "description": "Automate GitHub Projects sync (1 issue)"
}
```

**Returns:**
```json
{
  "id": "MI_kwDOPxqaGM4A3o8i",
  "number": 4,
  "title": "Epic 1: GitHub Metadata Workflow",
  "url": "https://github.com/joaodotwork/dpds-arkiv/milestone/4"
}
```

---

### `create_issue`

Create an issue with optional milestone, labels, and assignees.

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `title` (string, required): Issue title
- `body` (string, required): Issue body (markdown)
- `milestoneNumber` (number, optional): Milestone number
- `labelIds` (string[], optional): Array of label IDs
- `assignees` (string[], optional): Array of usernames

**Example:**
```typescript
{
  "owner": "joaodotwork",
  "repo": "dpds-arkiv",
  "title": "Implement GitHub Projects Sync Workflow",
  "body": "**Epic:** GitHub Metadata Workflow\n...",
  "milestoneNumber": 4,
  "labelIds": ["LA_kwDOPxqaGM8AAAACVcj5iQ"],
  "assignees": ["joaodotwork"]
}
```

**Returns:**
```json
{
  "id": "I_kwDOPxqaGM6RkGzw",
  "number": 80,
  "title": "Implement GitHub Projects Sync Workflow",
  "url": "https://github.com/joaodotwork/dpds-arkiv/issues/80"
}
```

---

### `add_issue_to_project`

Add an issue to a Projects v2 board.

**Parameters:**
- `projectId` (string, required): Project node ID
- `issueId` (string, required): Issue node ID

**Example:**
```typescript
{
  "projectId": "PVT_kwHOAwJiCM4BNC20",
  "issueId": "I_kwDOPxqaGM6RkGzw"
}
```

**Returns:**
```json
{
  "id": "PVTI_lAHOAwJiCM4BNC20zgXYZ..."
}
```

---

### `create_iteration_field`

Create an iteration field with weekly sprints.

**Parameters:**
- `projectId` (string, required): Project node ID
- `fieldName` (string, required): Field name (e.g., "Sprint")
- `duration` (number, required): Duration in days (typically 7)
- `startDate` (string, required): Start date (YYYY-MM-DD)
- `iterations` (array, required): Array of iteration definitions

**Example:**
```typescript
{
  "projectId": "PVT_kwHOAwJiCM4BNC20",
  "fieldName": "Sprint",
  "duration": 7,
  "startDate": "2026-01-20",
  "iterations": [
    { "title": "Week 1", "startDate": "2026-01-20", "duration": 7 },
    { "title": "Week 2", "startDate": "2026-01-27", "duration": 7 },
    { "title": "Week 3", "startDate": "2026-02-03", "duration": 7 }
  ]
}
```

**Returns:**
```json
{
  "id": "PVTIF_lAHOAwJiCM4BNC20zg8J544",
  "name": "Sprint",
  "configuration": {
    "iterations": [
      {
        "id": "bab3ba50",
        "title": "Week 1",
        "startDate": "2026-01-20",
        "duration": 7
      },
      ...
    ]
  }
}
```

---

### `assign_issue_to_iteration`

Assign an issue to a specific iteration.

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `projectNumber` (number, required): Project number
- `issueNumber` (number, required): Issue number
- `fieldId` (string, required): Iteration field ID
- `iterationId` (string, required): Iteration ID

**Example:**
```typescript
{
  "owner": "joaodotwork",
  "repo": "dpds-arkiv",
  "projectNumber": 7,
  "issueNumber": 80,
  "fieldId": "PVTIF_lAHOAwJiCM4BNC20zg8J544",
  "iterationId": "bab3ba50"
}
```

---

### `add_subissue`

Add a sub-issue to a parent issue.

**Parameters:**
- `issueId` (string, required): Node ID of the parent issue
- `subIssueId` (string, optional): Node ID of the sub-issue
- `subIssueUrl` (string, optional): URL of the sub-issue
- `replaceParent` (boolean, optional): Replace parent issue if one already exists

**Example:**
```typescript
{
  "issueId": "I_kwDOPxqaGM6RkGzw",
  "subIssueId": "I_kwDOPxqaGM6RkHAB"
}
```

**Returns:**
```json
{
  "success": true,
  "message": "Sub-issue added successfully"
}
```

---

### `remove_subissue`

Remove a sub-issue from a parent issue.

**Parameters:**
- `issueId` (string, required): Node ID of the parent issue
- `subIssueId` (string, required): Node ID of the sub-issue to remove

**Example:**
```typescript
{
  "issueId": "I_kwDOPxqaGM6RkGzw",
  "subIssueId": "I_kwDOPxqaGM6RkHAB"
}
```

**Returns:**
```json
{
  "success": true,
  "message": "Sub-issue removed successfully"
}
```

---

### `reprioritize_subissue`

Reprioritize a sub-issue within a parent issue.

**Parameters:**
- `issueId` (string, required): Node ID of the parent issue
- `subIssueId` (string, required): Node ID of the sub-issue to reprioritize
- `afterId` (string, optional): ID of the sub-issue to be prioritized after
- `beforeId` (string, optional): ID of the sub-issue to be prioritized before

**Note:** Specify either `afterId` OR `beforeId`, not both.

**Example:**
```typescript
{
  "issueId": "I_kwDOPxqaGM6RkGzw",
  "subIssueId": "I_kwDOPxqaGM6RkHAB",
  "afterId": "I_kwDOPxqaGM6RkHCD"
}
```

**Returns:**
```json
{
  "success": true,
  "message": "Sub-issue reprioritized successfully"
}
```

---

### `update_item_status`

Update the status of a project item using human-readable status values.

**Parameters:**
- `projectId` (string, required): Project node ID
- `itemId` (string, required): Project item node ID
- `status` (string, required): Human-readable status (e.g., "Todo", "In Progress", "Done")

**Note:** The tool automatically finds the Status field and matches the status name (case-insensitive). It will show available options if the status is not found.

**Example:**
```typescript
{
  "projectId": "PVT_kwHOAwJiCM4BNC20",
  "itemId": "PVTI_lAHOAwJiCM4BNC20zgXYZ...",
  "status": "In Progress"
}
```

**Returns:**
```json
{
  "success": true,
  "message": "Status updated to 'In Progress'",
  "itemId": "PVTI_lAHOAwJiCM4BNC20zgXYZ..."
}
```

---

### `get_repository_info`

Get repository ID, labels, and milestones.

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name

**Example:**
```typescript
{
  "owner": "joaodotwork",
  "repo": "dpds-arkiv"
}
```

**Returns:**
```json
{
  "id": "R_kgDOPxqaGA",
  "name": "dpds-arkiv",
  "labels": {
    "nodes": [
      { "id": "LA_kwDOPxqaGM8...", "name": "priority:high" },
      ...
    ]
  },
  "milestones": {
    "nodes": [
      { "id": "MI_kwDOPxqaGM4...", "number": 4, "title": "Epic 1..." },
      ...
    ]
  }
}
```

---

### `get_project_info`

Get project ID, fields, and iteration IDs.

**Parameters:**
- `owner` (string, required): Project owner
- `projectNumber` (number, required): Project number

**Example:**
```typescript
{
  "owner": "joaodotwork",
  "projectNumber": 7
}
```

**Returns:**
```json
{
  "id": "PVT_kwHOAwJiCM4BNC20",
  "title": "v1.0 Production Release",
  "number": 7,
  "fields": {
    "nodes": [
      {
        "id": "PVTIF_lAHOAwJiCM4BNC20zg8J544",
        "name": "Sprint",
        "dataType": "ITERATION",
        "configuration": {
          "iterations": [...]
        }
      },
      ...
    ]
  }
}
```

## Usage Examples

### Example 1: Create Complete Sprint Setup

```typescript
// 1. Create project
const project = await create_project({
  owner: "joaodotwork",
  title: "v1.0 Production Release",
  description: "Sprint to ship v1.0"
});

// 2. Create milestones
const milestone1 = await create_milestone({
  owner: "joaodotwork",
  repo: "dpds-arkiv",
  title: "Epic 1: GitHub Metadata Workflow",
  description: "Automate GitHub Projects sync (1 issue)"
});

// 3. Get repository info (for label IDs)
const repoInfo = await get_repository_info({
  owner: "joaodotwork",
  repo: "dpds-arkiv"
});

// 4. Create issue
const issue = await create_issue({
  owner: "joaodotwork",
  repo: "dpds-arkiv",
  title: "Implement GitHub Projects Sync Workflow",
  body: "...",
  milestoneNumber: milestone1.number,
  labelIds: [repoInfo.labels.nodes[0].id],
  assignees: ["joaodotwork"]
});

// 5. Add issue to project
await add_issue_to_project({
  projectId: project.id,
  issueId: issue.id
});

// 6. Create iteration field
const iterationField = await create_iteration_field({
  projectId: project.id,
  fieldName: "Sprint",
  duration: 7,
  startDate: "2026-01-20",
  iterations: [
    { title: "Week 1", startDate: "2026-01-20", duration: 7 },
    { title: "Week 2", startDate: "2026-01-27", duration: 7 },
    { title: "Week 3", startDate: "2026-02-03", duration: 7 }
  ]
});

// 7. Assign issue to iteration
await assign_issue_to_iteration({
  owner: "joaodotwork",
  repo: "dpds-arkiv",
  projectNumber: project.number,
  issueNumber: issue.number,
  fieldId: iterationField.id,
  iterationId: iterationField.configuration.iterations[0].id
});
```

### Example 2: Bulk Create Issues

```typescript
const issues = [
  {
    title: "Issue 1",
    body: "Description...",
    milestoneNumber: 4
  },
  {
    title: "Issue 2",
    body: "Description...",
    milestoneNumber: 5
  }
];

for (const issueData of issues) {
  const issue = await create_issue({
    owner: "joaodotwork",
    repo: "dpds-arkiv",
    ...issueData
  });

  await add_issue_to_project({
    projectId: "PVT_kwHOAwJiCM4BNC20",
    issueId: issue.id
  });
}
```

## Troubleshooting

### "401 Unauthorized" Error

- Check that your `GITHUB_TOKEN` is set correctly
- Verify the token has `repo` and `project` scopes
- Token format should be `ghp_...` (Personal Access Token)

### "Issue not found in project" Error

- Ensure the issue has been added to the project first using `add_issue_to_project`
- Verify the `projectNumber` is correct

### MCP Server Not Loading

- Check Claude Desktop config file path
- Verify JSON syntax in config file
- Restart Claude Desktop completely
- Check logs: `~/Library/Logs/Claude/mcp*.log`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test locally
node dist/index.js
```

## License

MIT

## Author

João Doria de Souza ([@joaodotwork](https://github.com/joaodotwork))

---

**Built with the MCP SDK** - Model Context Protocol for Claude Desktop
