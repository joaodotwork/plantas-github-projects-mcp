import { describe, it, expect, vi } from "vitest";
import {
  createIterationField,
  assignIssueToIteration,
  type GraphQLFn,
} from "./iterations.js";

// Helpers to capture what was sent to the GraphQL client
function captureCall(mock: ReturnType<typeof vi.fn>, callIndex: number) {
  const call = mock.mock.calls[callIndex];
  return { query: call[0] as string, variables: call[1] as Record<string, unknown> };
}

describe("createIterationField", () => {
  it("step 2 mutation does not declare or pass projectId", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        createProjectV2Field: { projectV2Field: { id: "field-abc" } },
      })
      .mockResolvedValueOnce({
        updateProjectV2Field: {
          projectV2Field: {
            id: "field-abc",
            name: "Sprint",
            configuration: { iterations: [] },
          },
        },
      }) as unknown as GraphQLFn;

    await createIterationField(gql, {
      projectId: "proj-xyz",
      fieldName: "Sprint",
      duration: 7,
      startDate: "2026-03-02",
      iterations: [{ title: "Sprint 1", startDate: "2026-03-02", duration: 7 }],
    });

    const { query, variables } = captureCall(vi.mocked(gql), 1);

    expect(query).not.toContain("$projectId");
    expect(query).not.toContain("projectId:");
    expect(variables).not.toHaveProperty("projectId");
  });

  it("step 2 mutation uses ProjectV2IterationFieldConfigurationIterationInput", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        createProjectV2Field: { projectV2Field: { id: "field-abc" } },
      })
      .mockResolvedValueOnce({
        updateProjectV2Field: {
          projectV2Field: {
            id: "field-abc",
            name: "Sprint",
            configuration: { iterations: [] },
          },
        },
      }) as unknown as GraphQLFn;

    await createIterationField(gql, {
      projectId: "proj-xyz",
      fieldName: "Sprint",
      duration: 7,
      startDate: "2026-03-02",
      iterations: [{ title: "Sprint 1", startDate: "2026-03-02", duration: 7 }],
    });

    const { query } = captureCall(vi.mocked(gql), 1);

    expect(query).toContain("ProjectV2IterationFieldConfigurationIterationInput");
    expect(query).not.toContain("ProjectV2IterationFieldIterationInput");
  });

  it("step 2 mutation passes fieldId, duration, startDate, and iterations", async () => {
    const iterations = [{ title: "Sprint 1", startDate: "2026-03-02", duration: 7 }];
    const gql = vi.fn()
      .mockResolvedValueOnce({
        createProjectV2Field: { projectV2Field: { id: "field-created" } },
      })
      .mockResolvedValueOnce({
        updateProjectV2Field: {
          projectV2Field: {
            id: "field-created",
            name: "Sprint",
            configuration: { iterations },
          },
        },
      }) as unknown as GraphQLFn;

    await createIterationField(gql, {
      projectId: "proj-xyz",
      fieldName: "Sprint",
      duration: 7,
      startDate: "2026-03-02",
      iterations,
    });

    const { variables } = captureCall(vi.mocked(gql), 1);

    expect(variables).toEqual({
      fieldId: "field-created",
      duration: 7,
      startDate: "2026-03-02",
      iterations,
    });
  });

  it("step 1 creates the field with projectId and name", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        createProjectV2Field: { projectV2Field: { id: "field-new" } },
      })
      .mockResolvedValueOnce({
        updateProjectV2Field: {
          projectV2Field: { id: "field-new", name: "Sprint", configuration: { iterations: [] } },
        },
      }) as unknown as GraphQLFn;

    await createIterationField(gql, {
      projectId: "proj-xyz",
      fieldName: "Sprint",
      duration: 7,
      startDate: "2026-03-02",
      iterations: [],
    });

    const { variables } = captureCall(vi.mocked(gql), 0);
    expect(variables).toEqual({ projectId: "proj-xyz", name: "Sprint" });
  });
});

describe("assignIssueToIteration", () => {
  it("resolves itemId and projectId before calling the mutation", async () => {
    const gql = vi.fn()
      // getProjectItemId query
      .mockResolvedValueOnce({
        repository: {
          issue: {
            projectItems: {
              nodes: [{ id: "item-789", project: { number: 5 } }],
            },
          },
        },
      })
      // getProjectId query
      .mockResolvedValueOnce({ user: { projectV2: { id: "proj-456" } } })
      // updateProjectV2ItemFieldValue mutation
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-789" } },
      }) as unknown as GraphQLFn;

    await assignIssueToIteration(gql, {
      owner: "octocat",
      repo: "hello-world",
      projectNumber: 5,
      issueNumber: 42,
      fieldId: "field-123",
      iterationId: "iter-456",
    });

    const { query, variables } = captureCall(vi.mocked(gql), 2);

    // Mutation must NOT pass owner/repo/issueNumber directly
    expect(query).not.toContain("$owner");
    expect(query).not.toContain("$repo");
    expect(query).not.toContain("$issueNumber");

    // Mutation must use the resolved IDs
    expect(variables).toEqual({
      projectId: "proj-456",
      itemId: "item-789",
      fieldId: "field-123",
      iterationId: "iter-456",
    });
  });

  it("looks up itemId using the correct issue query variables", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        repository: {
          issue: {
            projectItems: { nodes: [{ id: "item-1", project: { number: 3 } }] },
          },
        },
      })
      .mockResolvedValueOnce({ user: { projectV2: { id: "proj-1" } } })
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-1" } },
      }) as unknown as GraphQLFn;

    await assignIssueToIteration(gql, {
      owner: "myorg",
      repo: "myrepo",
      projectNumber: 3,
      issueNumber: 10,
      fieldId: "f-1",
      iterationId: "i-1",
    });

    const { variables: lookupVars } = captureCall(vi.mocked(gql), 0);
    expect(lookupVars).toMatchObject({ owner: "myorg", repo: "myrepo", issueNumber: 10 });
  });

  it("throws if the issue is not found in the project", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repository: {
        issue: {
          projectItems: { nodes: [{ id: "item-other", project: { number: 99 } }] },
        },
      },
    }) as unknown as GraphQLFn;

    await expect(
      assignIssueToIteration(gql, {
        owner: "octocat",
        repo: "hello-world",
        projectNumber: 5,
        issueNumber: 42,
        fieldId: "f-1",
        iterationId: "i-1",
      })
    ).rejects.toThrow("Issue #42 not found in project #5");
  });
});
