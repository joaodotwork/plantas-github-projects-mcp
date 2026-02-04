#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { graphql } from "@octokit/graphql";
import { getGitHubToken } from "./auth.js";

// GitHub GraphQL client
let githubGraphQL: typeof graphql;

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

interface IterationInput {
  projectId: string;
  fieldName: string;
  duration: number;
  startDate: string;
  iterations: Array<{
    title: string;
    startDate: string;
    duration: number;
  }>;
}

interface AssignIterationInput {
  owner: string;
  repo: string;
  projectNumber: number;
  issueNumber: number;
  iterationId: string;
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

interface UpdateItemStatusInput {
  projectId: string;
  itemId: string;
  status: string;
}

interface UpdateProjectSettingsInput {
  projectId: string;
  title?: string;
  shortDescription?: string;
  readme?: string;
  public?: boolean;
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
];

// Server implementation
const server = new Server(
  {
    name: "github-projects-mcp",
    version: "1.3.1",
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

  // Log incoming request
  console.error(`📥 Received request: ${name}`);
  console.error(`   Args: ${JSON.stringify(args, null, 2).substring(0, 200)}...`);

  try {
    switch (name) {
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
        const repoId = await getRepositoryId(input.owner, input.repo);

        const result = await githubGraphQL<any>(
          `
          mutation($repoId: ID!, $title: String!, $description: String, $dueOn: DateTime) {
            createMilestone(input: {
              repositoryId: $repoId
              title: $title
              description: $description
              dueOn: $dueOn
            }) {
              milestone {
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
            description: input.description || "",
            dueOn: input.dueOn || null,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.createMilestone.milestone, null, 2),
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

        // Step 1: Create the iteration field
        const createResult = await githubGraphQL<any>(
          `
          mutation($projectId: ID!, $name: String!) {
            createProjectV2Field(input: {
              projectId: $projectId
              dataType: ITERATION
              name: $name
            }) {
              projectV2Field {
                ... on ProjectV2IterationField {
                  id
                  name
                }
              }
            }
          }
        `,
          {
            projectId: input.projectId,
            name: input.fieldName,
          }
        );

        const fieldId = createResult.createProjectV2Field.projectV2Field.id;

        // Step 2: Update the field with iteration configuration
        const updateResult = await githubGraphQL<any>(
          `
          mutation($projectId: ID!, $fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: [ProjectV2IterationFieldIterationInput!]!) {
            updateProjectV2Field(input: {
              projectId: $projectId
              fieldId: $fieldId
              iterationConfiguration: {
                duration: $duration
                startDate: $startDate
                iterations: $iterations
              }
            }) {
              projectV2Field {
                ... on ProjectV2IterationField {
                  id
                  name
                  configuration {
                    iterations {
                      id
                      title
                      startDate
                      duration
                    }
                  }
                }
              }
            }
          }
        `,
          {
            projectId: input.projectId,
            fieldId: fieldId,
            duration: input.duration,
            startDate: input.startDate,
            iterations: input.iterations,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                updateResult.updateProjectV2Field.projectV2Field,
                null,
                2
              ),
            },
          ],
        };
      }

      case "assign_issue_to_iteration": {
        const input = args as unknown as AssignIterationInput & {
          fieldId: string;
          iterationId: string;
        };

        // Get project item ID for this issue
        const itemId = await getProjectItemId(
          input.owner,
          input.repo,
          input.issueNumber,
          input.projectNumber
        );

        const result = await githubGraphQL<any>(
          `
          mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: {
                iterationId: $iterationId
              }
            }) {
              projectV2Item {
                id
              }
            }
          }
        `,
          {
            projectId: await getProjectId(input.owner, input.projectNumber),
            itemId,
            fieldId: input.fieldId,
            iterationId: input.iterationId,
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                result.updateProjectV2ItemFieldValue.projectV2Item,
                null,
                2
              ),
            },
          ],
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
            user(login: $owner) {
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
        `,
          { owner, number: projectNumber }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.user.projectV2, null, 2),
            },
          ],
        };
      }

      case "update_item_status": {
        const input = args as unknown as UpdateItemStatusInput;

        // First, get project fields to find the Status field and its options
        const projectResult = await githubGraphQL<any>(
          `
          query($projectId: ID!) {
            node(id: $projectId) {
              ... on ProjectV2 {
                fields(first: 100) {
                  nodes {
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
        `,
          { projectId: input.projectId }
        );

        // Find the Status field
        const statusField = projectResult.node.fields.nodes.find(
          (field: any) =>
            field.dataType === "SINGLE_SELECT" &&
            (field.name === "Status" || field.name === "status")
        );

        if (!statusField) {
          throw new Error(
            "No Status field found in project. Available fields: " +
              projectResult.node.fields.nodes
                .map((f: any) => f.name)
                .join(", ")
          );
        }

        // Find the option that matches the requested status (case-insensitive)
        const statusOption = statusField.options.find(
          (opt: any) =>
            opt.name.toLowerCase() === input.status.toLowerCase()
        );

        if (!statusOption) {
          throw new Error(
            `Status '${input.status}' not found. Available options: ${statusField.options
              .map((o: any) => o.name)
              .join(", ")}`
          );
        }

        // Update the project item's status field
        const updateResult = await githubGraphQL<any>(
          `
          mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: $value
            }) {
              projectV2Item {
                id
              }
            }
          }
        `,
          {
            projectId: input.projectId,
            itemId: input.itemId,
            fieldId: statusField.id,
            value: {
              singleSelectOptionId: statusOption.id,
            },
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Status updated to '${statusOption.name}'`,
                  itemId: updateResult.updateProjectV2ItemFieldValue.projectV2Item.id,
                },
                null,
                2
              ),
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
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
      user(login: $login) {
        id
      }
    }
  `,
    { login: owner }
  );
  return result.user.id;
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

async function getProjectId(owner: string, number: number): Promise<string> {
  const result = await githubGraphQL<any>(
    `
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
        }
      }
    }
  `,
    { owner, number }
  );
  return result.user.projectV2.id;
}

async function getProjectItemId(
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number
): Promise<string> {
  const result = await githubGraphQL<any>(
    `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              id
              project {
                number
              }
            }
          }
        }
      }
    }
  `,
    { owner, repo, issueNumber }
  );

  const item = result.repository.issue.projectItems.nodes.find(
    (node: any) => node.project.number === projectNumber
  );

  if (!item) {
    throw new Error(
      `Issue #${issueNumber} not found in project #${projectNumber}`
    );
  }

  return item.id;
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();

  // Get token (checks env var, config file, or prompts Device Flow)
  const token = await getGitHubToken();

  githubGraphQL = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });

  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("🚀 GitHub Projects MCP Server");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("");
  console.error("📋 Server Info:");
  console.error("   Name:      github-projects-mcp");
  console.error("   Version:   1.3.0");
  console.error("   Transport: stdio (stdin/stdout)");
  console.error("   Protocol:  Model Context Protocol (MCP)");
  console.error("");
  console.error("🔧 Configuration:");
  console.error("   GitHub Token: ✅ Set");
  console.error("   Node Version: " + process.version);
  console.error("   Platform:     " + process.platform);
  console.error("");
  console.error(`🛠️  Available Tools (${tools.length}):`);
  tools.forEach((tool, index) => {
    console.error(`   ${index + 1}. ${tool.name}`);
  });
  console.error("");
  console.error("ℹ️  Transport Details:");
  console.error("   • MCP uses stdio (not HTTP/SSE)");
  console.error("   • Communication via stdin/stdout pipes");
  console.error("   • No port binding required");
  console.error("   • Claude Desktop/Code manages the process");
  console.error("");
  console.error("✅ Server ready and waiting for requests...");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("");

  await server.connect(transport);

  // Log when server starts processing
  console.error("🔌 Connected to MCP client");
  console.error("📡 Listening for tool requests on stdio...");
  console.error("");
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
