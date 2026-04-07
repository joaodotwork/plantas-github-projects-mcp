#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { graphql } from "@octokit/graphql";
import {
  resolveAuthProvider,
  AuthenticationError,
  type AuthProvider,
} from "./auth/index.js";
import { createResilientGraphQL } from "./auth/resilient-client.js";
import {
  createIterationField,
  assignIssueToIteration,
  addIteration,
  updateIteration,
  type IterationInput,
  type AssignIterationInput,
  type AddIterationInput,
  type UpdateIterationInput,
} from "./tools/iterations.js";
import {
  updateItemStatus,
  type UpdateItemStatusInput,
} from "./tools/status.js";

// Auth provider and resilient GraphQL client (lazily initialized).
// Initialized to null but typed as non-null because ensureAuthenticated()
// is always awaited before any tool handler accesses these.
let authProvider: AuthProvider = null as any;
let githubGraphQL: typeof graphql = null as any;
let authResolved = false;
let authPromise: Promise<void> | null = null;

/**
 * Lazily resolve authentication on first tool call.
 * This avoids blocking server startup with device flow polling,
 * which can time out in environments like Claude Code.
 * Subsequent calls return the cached result immediately.
 */
async function ensureAuthenticated(): Promise<void> {
  if (authResolved) return; // already authenticated

  if (!authPromise) {
    authPromise = (async () => {
      authProvider = await resolveAuthProvider();
      githubGraphQL = createResilientGraphQL(authProvider);

      // Validate token with a lightweight query
      const login = await validateToken(githubGraphQL);
      if (!login) {
        const providerType = authProvider.type;
        // Reset so next call retries
        authProvider = null as any;
        githubGraphQL = null as any;
        authPromise = null;

        if (providerType === "pat") {
          throw new Error(
            "GITHUB_TOKEN is invalid or expired. Please set a new token and restart.",
          );
        }
        throw new Error(
          "Stored credentials are invalid. Please restart to re-authenticate.",
        );
      }

      authResolved = true;
      console.error(`Authenticated as ${login} (${authProvider.type})`);
    })();
  }

  await authPromise;
}

interface ProjectInput {
  owner: string;
  title: string;
  description?: string;
}

interface MilestoneInput {
  owner: string;
  repo: string;
  title: string;
  description?: string;
  dueOn?: string;
}

interface IssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  milestoneNumber?: number;
  labelIds?: string[];
  assignees?: string[];
}


interface AddSubIssueInput {
  issueId: string;
  subIssueId?: string;
  subIssueUrl?: string;
  replaceParent?: boolean;
}

interface RemoveSubIssueInput {
  issueId: string;
  subIssueId: string;
}

interface ReprioritizeSubIssueInput {
  issueId: string;
  subIssueId: string;
  afterId?: string;
  beforeId?: string;
}

interface UpdateProjectSettingsInput {
  projectId: string;
  title?: string;
  shortDescription?: string;
  readme?: string;
  public?: boolean;
}

interface ProjectStatusUpdateInput {
  projectId: string;
  status: "INACTIVE" | "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "COMPLETE";
  body?: string;
  startDate?: string;
  targetDate?: string;
}

// Tool definitions
const tools: Tool[] = [
  {
    name: "create_project",
    description:
      "Create a new GitHub Project (ProjectsV2). Returns the project ID and number.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "GitHub username or organization name",
        },
        title: {
          type: "string",
          description: "Project title",
        },
        description: {
          type: "string",
          description: "Project description (optional)",
        },
      },
      required: ["owner", "title"],
    },
  },
  {
    name: "create_milestone",
    description:
      "Create a milestone in a repository. Returns the milestone number and ID.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "Repository owner",
        },
        repo: {
          type: "string",
          description: "Repository name",
        },
        title: {
          type: "string",
          description: "Milestone title",
        },
        description: {
          type: "string",
          description: "Milestone description (optional)",
        },
        dueOn: {
          type: "string",
          description: "Due date in ISO 8601 format (optional)",
        },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "create_issue",
    description:
      "Create an issue with optional milestone and labels. Returns the issue number and URL.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "Repository owner",
        },
        repo: {
          type: "string",
          description: "Repository name",
        },
        title: {
          type: "string",
          description: "Issue title",
        },
        body: {
          type: "string",
          description: "Issue body (markdown)",
        },
        milestoneNumber: {
          type: "number",
          description: "Milestone number to assign (optional)",
        },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of label IDs to assign (optional)",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "Array of usernames to assign (optional)",
        },
      },
      required: ["owner", "repo", "title", "body"],
    },
  },
  {
    name: "add_issue_to_project",
    description:
      "Add an issue to a ProjectsV2 board. Returns the project item ID.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID (e.g., PVT_kwHOAwJiCM4BNC20)",
        },
        issueId: {
          type: "string",
          description: "Issue node ID",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
  {
    name: "create_iteration_field",
    description:
      "Create an iteration field on a ProjectsV2 with weekly sprints. Returns field ID and iteration IDs.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID",
        },
        fieldName: {
          type: "string",
          description: "Field name (e.g., 'Sprint', 'Iteration')",
        },
        duration: {
          type: "number",
          description: "Duration in days for each iteration (typically 7 for weekly)",
        },
        startDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format",
        },
        iterations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              startDate: { type: "string" },
              duration: { type: "number" },
            },
            required: ["title", "startDate", "duration"],
          },
          description: "Array of iteration definitions",
        },
      },
      required: ["projectId", "fieldName", "duration", "startDate", "iterations"],
    },
  },
  {
    name: "assign_issue_to_iteration",
    description:
      "Assign an issue to a specific iteration in a ProjectsV2. The issue must already be in the project.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "Repository owner",
        },
        repo: {
          type: "string",
          description: "Repository name",
        },
        projectNumber: {
          type: "number",
          description: "Project number (not ID)",
        },
        issueNumber: {
          type: "number",
          description: "Issue number",
        },
        fieldId: {
          type: "string",
          description: "Iteration field ID",
        },
        iterationId: {
          type: "string",
          description: "Iteration ID to assign to",
        },
      },
      required: [
        "owner",
        "repo",
        "projectNumber",
        "issueNumber",
        "fieldId",
        "iterationId",
      ],
    },
  },
  {
    name: "add_subissue",
    description: "Add a sub-issue to a given issue.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "The node ID of the parent issue.",
        },
        subIssueId: {
          type: "string",
          description: "The node ID of the sub-issue.",
        },
        subIssueUrl: {
          type: "string",
          description: "The URL of the sub-issue.",
        },
        replaceParent: {
          type: "boolean",
          description: "Option to replace parent issue if one already exists.",
        },
      },
      required: ["issueId"],
    },
  },
  {
    name: "remove_subissue",
    description: "Remove a sub-issue from a given issue.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "The node ID of the parent issue.",
        },
        subIssueId: {
          type: "string",
          description: "The node ID of the sub-issue to remove.",
        },
      },
      required: ["issueId", "subIssueId"],
    },
  },
  {
    name: "reprioritize_subissue",
    description: "Reprioritize a sub-issue within a given issue.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "The node ID of the parent issue.",
        },
        subIssueId: {
          type: "string",
          description: "The node ID of the sub-issue to reprioritize.",
        },
        afterId: {
          type: "string",
          description:
            "The ID of the sub-issue to be prioritized after (either afterId OR beforeId should be specified).",
        },
        beforeId: {
          type: "string",
          description:
            "The ID of the sub-issue to be prioritized before (either afterId OR beforeId should be specified).",
        },
      },
      required: ["issueId", "subIssueId"],
    },
  },
  {
    name: "get_repository_info",
    description:
      "Get repository ID, label IDs, and milestone info. Useful for gathering IDs needed for other operations.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "Repository owner",
        },
        repo: {
          type: "string",
          description: "Repository name",
        },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_project_info",
    description:
      "Get project ID, field IDs, and iteration IDs. Useful for configuring iterations.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "Project owner (username or org)",
        },
        projectNumber: {
          type: "number",
          description: "Project number",
        },
      },
      required: ["owner", "projectNumber"],
    },
  },
  {
    name: "update_item_status",
    description:
      "Update the status of a project item using human-readable status values. Automatically resolves field and option IDs.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID (e.g., PVT_kwHOAwJiCM4BNC20)",
        },
        itemId: {
          type: "string",
          description: "Project item node ID (e.g., PVTI_lAHOAwJiCM4BNC20...)",
        },
        status: {
          type: "string",
          description:
            "Human-readable status value (e.g., 'Todo', 'In Progress', 'Done')",
        },
      },
      required: ["projectId", "itemId", "status"],
    },
  },
  {
    name: "update_project_settings",
    description:
      "Update project settings like title, description, readme, or visibility.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID (e.g., PVT_kwHOAwJiCM4BNC20)",
        },
        title: {
          type: "string",
          description: "New project title (optional)",
        },
        shortDescription: {
          type: "string",
          description: "New short description (optional)",
        },
        readme: {
          type: "string",
          description: "New README content (optional)",
        },
        public: {
          type: "boolean",
          description: "Set project visibility (optional)",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_project_status_update",
    description: "Create a status update for a project board.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID",
        },
        status: {
          type: "string",
          enum: ["INACTIVE", "ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETE"],
          description: "The status level",
        },
        body: {
          type: "string",
          description: "Status update body (markdown)",
        },
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD)",
        },
        targetDate: {
          type: "string",
          description: "Target date (YYYY-MM-DD)",
        },
      },
      required: ["projectId", "status"],
    },
  },
  {
    name: "get_project_status_updates",
    description: "Get recent status updates for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID",
        },
        limit: {
          type: "number",
          description: "Number of updates to retrieve (default: 5)",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "add_iteration",
    description:
      "Add a new iteration to an existing iteration field on a ProjectsV2. Fetches current iterations and appends the new one.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID (e.g., PVT_kwHOAwJiCM4BNC20)",
        },
        fieldId: {
          type: "string",
          description: "Iteration field ID",
        },
        title: {
          type: "string",
          description: "Iteration title (e.g., 'Sprint 5', 'Phase 4: Production hardening')",
        },
        startDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format",
        },
        duration: {
          type: "number",
          description: "Duration in days (typically 7 or 14)",
        },
      },
      required: ["projectId", "fieldId", "title", "startDate", "duration"],
    },
  },
  {
    name: "update_iteration",
    description:
      "Update an existing iteration's title, start date, or duration on a ProjectsV2 iteration field.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project node ID (e.g., PVT_kwHOAwJiCM4BNC20)",
        },
        fieldId: {
          type: "string",
          description: "Iteration field ID",
        },
        iterationId: {
          type: "string",
          description: "Iteration ID to update",
        },
        title: {
          type: "string",
          description: "New iteration title (optional)",
        },
        startDate: {
          type: "string",
          description: "New start date in YYYY-MM-DD format (optional)",
        },
        duration: {
          type: "number",
          description: "New duration in days (optional)",
        },
      },
      required: ["projectId", "fieldId", "iterationId"],
    },
  },
];

// Server implementation
const server = new Server(
  {
    name: "github-projects-mcp",
    version: "1.5.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  // Log incoming request
  console.error(`📥 ${name}`);
  console.error(`   Args: ${JSON.stringify(args, null, 2).substring(0, 300)}`);

  // Lazily authenticate on first tool call
  await ensureAuthenticated();

  try {
    const result = await (async () => { switch (name) {
      case "create_project": {
        const input = args as unknown as ProjectInput;
        const result = await githubGraphQL<any>(
          `
          mutation($ownerId: ID!, $title: String!) {
            createProjectV2(input: {
              ownerId: $ownerId
              title: $title
            }) {
              projectV2 {
                id
                number
                title
                url
              }
            }
          }
        `,
          {
            ownerId: await getOwnerId(input.owner),
            title: input.title,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.createProjectV2.projectV2, null, 2),
            },
          ],
        };
      }

      case "create_milestone": {
        const input = args as unknown as MilestoneInput;

        // GitHub GraphQL API does not have a createMilestone mutation.
        // Use the REST API instead: POST /repos/{owner}/{repo}/milestones
        const body: Record<string, unknown> = {
          title: input.title,
        };
        if (input.description) {
          body.description = input.description;
        }
        if (input.dueOn) {
          body.due_on = input.dueOn;
        }

        const token = await authProvider.getToken();
        const response = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/milestones`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `GitHub REST API error (${response.status}): ${errorBody}`
          );
        }

        const milestone = (await response.json()) as Record<string, unknown>;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  number: milestone.number,
                  title: milestone.title,
                  id: milestone.node_id,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "create_issue": {
        const input = args as unknown as IssueInput;
        const repoId = await getRepositoryId(input.owner, input.repo);

        // Get milestone ID if milestone number provided
        let milestoneId = null;
        if (input.milestoneNumber) {
          milestoneId = await getMilestoneId(
            input.owner,
            input.repo,
            input.milestoneNumber
          );
        }

        const result = await githubGraphQL<any>(
          `
          mutation($repoId: ID!, $title: String!, $body: String!, $milestoneId: ID, $labelIds: [ID!], $assigneeIds: [ID!]) {
            createIssue(input: {
              repositoryId: $repoId
              title: $title
              body: $body
              milestoneId: $milestoneId
              labelIds: $labelIds
              assigneeIds: $assigneeIds
            }) {
              issue {
                id
                number
                title
                url
              }
            }
          }
        `,
          {
            repoId,
            title: input.title,
            body: input.body,
            milestoneId,
            labelIds: input.labelIds || [],
            assigneeIds: input.assignees
              ? await Promise.all(
                  input.assignees.map((username) => getUserId(username))
                )
              : [],
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.createIssue.issue, null, 2),
            },
          ],
        };
      }

      case "add_issue_to_project": {
        const { projectId, issueId } = args as {
          projectId: string;
          issueId: string;
        };

        const result = await githubGraphQL<any>(
          `
          mutation($projectId: ID!, $contentId: ID!) {
            addProjectV2ItemById(input: {
              projectId: $projectId
              contentId: $contentId
            }) {
              item {
                id
              }
            }
          }
        `,
          { projectId, contentId: issueId }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.addProjectV2ItemById.item, null, 2),
            },
          ],
        };
      }

      case "create_iteration_field": {
        const input = args as unknown as IterationInput;
        const field = await createIterationField(githubGraphQL, input);
        return {
          content: [{ type: "text", text: JSON.stringify(field, null, 2) }],
        };
      }

      case "assign_issue_to_iteration": {
        const input = args as unknown as AssignIterationInput;
        const item = await assignIssueToIteration(githubGraphQL, input);
        return {
          content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
        };
      }

      case "add_iteration": {
        const input = args as unknown as AddIterationInput;
        const field = await addIteration(githubGraphQL, input);
        return {
          content: [{ type: "text", text: JSON.stringify(field, null, 2) }],
        };
      }

      case "update_iteration": {
        const input = args as unknown as UpdateIterationInput;
        const field = await updateIteration(githubGraphQL, input);
        return {
          content: [{ type: "text", text: JSON.stringify(field, null, 2) }],
        };
      }

      case "add_subissue": {
        const input = args as unknown as AddSubIssueInput;
        const result = await githubGraphQL<any>(
          `
          mutation($issueId: ID!, $subIssueId: ID, $subIssueUrl: String, $replaceParent: Boolean) {
            addSubIssue(input: {
              issueId: $issueId
              subIssueId: $subIssueId
              subIssueUrl: $subIssueUrl
              replaceParent: $replaceParent
            }) {
              issue {
                id
                number
                title
              }
              subIssue {
                id
                number
                title
              }
            }
          }
        `,
          {
            issueId: input.issueId,
            subIssueId: input.subIssueId || null,
            subIssueUrl: input.subIssueUrl || null,
            replaceParent: input.replaceParent || false,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.addSubIssue, null, 2),
            },
          ],
        };
      }

      case "remove_subissue": {
        const input = args as unknown as RemoveSubIssueInput;
        const result = await githubGraphQL<any>(
          `
          mutation($issueId: ID!, $subIssueId: ID!) {
            removeSubIssue(input: {
              issueId: $issueId
              subIssueId: $subIssueId
            }) {
              issue {
                id
                number
                title
              }
              subIssue {
                id
                number
                title
              }
            }
          }
        `,
          {
            issueId: input.issueId,
            subIssueId: input.subIssueId,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.removeSubIssue, null, 2),
            },
          ],
        };
      }

      case "reprioritize_subissue": {
        const input = args as unknown as ReprioritizeSubIssueInput;
        const result = await githubGraphQL<any>(
          `
          mutation($issueId: ID!, $subIssueId: ID!, $afterId: ID, $beforeId: ID) {
            reprioritizeSubIssue(input: {
              issueId: $issueId
              subIssueId: $subIssueId
              afterId: $afterId
              beforeId: $beforeId
            }) {
              issue {
                id
                number
                title
              }
            }
          }
        `,
          {
            issueId: input.issueId,
            subIssueId: input.subIssueId,
            afterId: input.afterId || null,
            beforeId: input.beforeId || null,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.reprioritizeSubIssue, null, 2),
            },
          ],
        };
      }

      case "get_repository_info": {
        const { owner, repo } = args as { owner: string; repo: string };

        const result = await githubGraphQL<any>(
          `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              id
              name
              labels(first: 100) {
                nodes {
                  id
                  name
                }
              }
              milestones(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
                nodes {
                  id
                  number
                  title
                }
              }
            }
          }
        `,
          { owner, repo }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.repository, null, 2),
            },
          ],
        };
      }

      case "get_project_info": {
        const { owner, projectNumber } = args as {
          owner: string;
          projectNumber: number;
        };

        const result = await githubGraphQL<any>(
          `
          query($owner: String!, $number: Int!) {
            repositoryOwner(login: $owner) {
              ... on User {
                projectV2(number: $number) {
                  id
                  title
                  number
                  fields(first: 100) {
                    nodes {
                      ... on ProjectV2Field {
                        id
                        name
                        dataType
                      }
                      ... on ProjectV2IterationField {
                        id
                        name
                        dataType
                        configuration {
                          iterations {
                            id
                            title
                            startDate
                            duration
                          }
                        }
                      }
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                        dataType
                        options {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
              ... on Organization {
                projectV2(number: $number) {
                  id
                  title
                  number
                  fields(first: 100) {
                    nodes {
                      ... on ProjectV2Field {
                        id
                        name
                        dataType
                      }
                      ... on ProjectV2IterationField {
                        id
                        name
                        dataType
                        configuration {
                          iterations {
                            id
                            title
                            startDate
                            duration
                          }
                        }
                      }
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                        dataType
                        options {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
          { owner, number: projectNumber }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.repositoryOwner.projectV2, null, 2),
            },
          ],
        };
      }

      case "update_item_status": {
        const input = args as unknown as UpdateItemStatusInput;
        const result = await updateItemStatus(githubGraphQL, input);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "update_project_settings": {
        const input = args as unknown as UpdateProjectSettingsInput;

        // Build the mutation input dynamically based on provided fields
        const updateInput: any = { projectId: input.projectId };
        if (input.title !== undefined) updateInput.title = input.title;
        if (input.shortDescription !== undefined)
          updateInput.shortDescription = input.shortDescription;
        if (input.readme !== undefined) updateInput.readme = input.readme;
        if (input.public !== undefined) updateInput.public = input.public;

        const result = await githubGraphQL<any>(
          `
          mutation($input: UpdateProjectV2Input!) {
            updateProjectV2(input: $input) {
              projectV2 {
                id
                title
                shortDescription
                readme
                public
                url
              }
            }
          }
        `,
          { input: updateInput }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Project settings updated successfully",
                  project: result.updateProjectV2.projectV2,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "create_project_status_update": {
        const input = args as unknown as ProjectStatusUpdateInput;

        const result = await githubGraphQL<any>(
          `
          mutation($projectId: ID!, $status: ProjectV2StatusUpdateStatus!, $body: String, $startDate: Date, $targetDate: Date) {
            createProjectV2StatusUpdate(input: {
              projectId: $projectId
              status: $status
              body: $body
              startDate: $startDate
              targetDate: $targetDate
            }) {
              statusUpdate {
                id
                status
                body
                startDate
                targetDate
              }
            }
          }
        `,
          {
            projectId: input.projectId,
            status: input.status,
            body: input.body || "",
            startDate: input.startDate || null,
            targetDate: input.targetDate || null,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.createProjectV2StatusUpdate.statusUpdate, null, 2),
            },
          ],
        };
      }

      case "get_project_status_updates": {
        const { projectId, limit } = args as { projectId: string; limit?: number };

        const result = await githubGraphQL<any>(
          `
          query($projectId: ID!, $limit: Int!) {
            node(id: $projectId) {
              ... on ProjectV2 {
                statusUpdates(first: $limit) {
                  nodes {
                    id
                    status
                    body
                    startDate
                    targetDate
                    createdAt
                    updatedAt
                    creator {
                      login
                    }
                  }
                }
              }
            }
          }
        `,
          { projectId, limit: limit || 5 }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.node.statusUpdates.nodes, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    })();

    const elapsed = Date.now() - startTime;
    const preview = result.content?.[0]?.text?.substring(0, 200) ?? "";
    console.error(`✅ ${name} (${elapsed}ms)`);
    console.error(`   Result: ${preview}${preview.length >= 200 ? "..." : ""}`);
    return result;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    // Provide actionable auth error messages
    if (error instanceof AuthenticationError || error?.status === 401) {
      const recovery =
        authProvider.type === "pat"
          ? "Please set a new GITHUB_TOKEN and restart the server."
          : "Please restart the MCP server to re-authenticate.";
      console.error(`❌ ${name} failed (${elapsed}ms): ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Authentication error: ${error.message}. ${recovery}`,
          },
        ],
        isError: true,
      };
    }
    console.error(`❌ ${name} failed (${elapsed}ms): ${error.message}`);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});


// Helper functions
async function getOwnerId(owner: string): Promise<string> {
  const result = await githubGraphQL<any>(
    `
    query($login: String!) {
      repositoryOwner(login: $login) {
        id
      }
    }
  `,
    { login: owner }
  );
  return result.repositoryOwner.id;
}

async function getRepositoryId(owner: string, repo: string): Promise<string> {
  const result = await githubGraphQL<any>(
    `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
      }
    }
  `,
    { owner, repo }
  );
  return result.repository.id;
}

async function getMilestoneId(
  owner: string,
  repo: string,
  number: number
): Promise<string> {
  const result = await githubGraphQL<any>(
    `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        milestone(number: $number) {
          id
        }
      }
    }
  `,
    { owner, repo, number }
  );
  return result.repository.milestone.id;
}

async function getUserId(username: string): Promise<string> {
  const result = await githubGraphQL<any>(
    `
    query($login: String!) {
      user(login: $login) {
        id
      }
    }
  `,
    { login: username }
  );
  return result.user.id;
}

// Validate token at startup with a lightweight query
async function validateToken(gql: typeof graphql): Promise<string | null> {
  try {
    const result = await gql<{ viewer: { login: string } }>(
      `query { viewer { login } }`,
    );
    return result.viewer.login;
  } catch {
    return null;
  }
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();

  // Connect immediately — auth is deferred to first tool call
  // This prevents the server from blocking on device flow polling,
  // which would time out in Claude Code's ~2 min bash timeout.
  console.error("GitHub Projects MCP Server v1.5.0 starting...");
  console.error("Auth will be resolved on first tool call.");

  await server.connect(transport);

  console.error("Connected to MCP client, listening for tool requests.");
}

main().catch((error) => {
  console.error("");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("❌ Fatal Error:");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error(error);
  console.error("");
  process.exit(1);
});
