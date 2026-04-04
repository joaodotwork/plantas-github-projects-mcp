import { describe, it, expect, vi } from "vitest";
import {
  createIterationField,
  assignIssueToIteration,
  addIteration,
  updateIteration,
  getProjectId,
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
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "proj-456" } } })
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
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "proj-1" } } })
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

describe("getProjectId (org support)", () => {
  it("uses repositoryOwner instead of user in the query", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repositoryOwner: { projectV2: { id: "proj-org-1" } },
    }) as unknown as GraphQLFn;

    await getProjectId(gql, "netliferesearch", 3);

    const { query } = captureCall(vi.mocked(gql), 0);
    expect(query).toContain("repositoryOwner(login: $owner)");
    expect(query).not.toContain("user(login: $owner)");
  });

  it("includes inline fragments for both User and Organization", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repositoryOwner: { projectV2: { id: "proj-org-2" } },
    }) as unknown as GraphQLFn;

    await getProjectId(gql, "netliferesearch", 3);

    const { query } = captureCall(vi.mocked(gql), 0);
    expect(query).toContain("... on User");
    expect(query).toContain("... on Organization");
  });

  it("resolves project ID for an org owner", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repositoryOwner: { projectV2: { id: "proj-org-abc" } },
    }) as unknown as GraphQLFn;

    const id = await getProjectId(gql, "netliferesearch", 3);

    expect(id).toBe("proj-org-abc");
  });

  it("resolves project ID for a user owner", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repositoryOwner: { projectV2: { id: "proj-user-xyz" } },
    }) as unknown as GraphQLFn;

    const id = await getProjectId(gql, "octocat", 7);

    expect(id).toBe("proj-user-xyz");
  });
});

// Helper to create a mock that returns field config then mutation result
function mockWithFieldConfig(
  existingIterations: Array<{ id: string; title: string; startDate: string; duration: number }>,
  mutationResult: any,
) {
  return vi.fn()
    // getIterationFieldConfig query
    .mockResolvedValueOnce({
      node: {
        fields: {
          nodes: [
            {
              id: "field-abc",
              configuration: {
                duration: 7,
                startDate: "2026-01-01",
                iterations: existingIterations,
                completedIterations: [],
              },
            },
          ],
        },
      },
    })
    // updateProjectV2Field mutation
    .mockResolvedValueOnce(mutationResult) as unknown as GraphQLFn;
}

describe("addIteration", () => {
  it("fetches existing iterations and appends the new one", async () => {
    const existing = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
    ];
    const gql = mockWithFieldConfig(existing, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: {
            iterations: [
              ...existing,
              { id: "iter-2", title: "Sprint 2", startDate: "2026-01-08", duration: 7 },
            ],
          },
        },
      },
    });

    await addIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      title: "Sprint 2",
      startDate: "2026-01-08",
      duration: 7,
    });

    const { variables } = captureCall(vi.mocked(gql), 1);
    expect((variables.iterations as any[])).toHaveLength(2);
    expect((variables.iterations as any[])[0]).toEqual({
      title: "Sprint 1",
      startDate: "2026-01-01",
      duration: 7,
    });
    expect((variables.iterations as any[])[1]).toEqual({
      title: "Sprint 2",
      startDate: "2026-01-08",
      duration: 7,
    });
  });

  it("preserves field-level duration and startDate from config", async () => {
    const gql = mockWithFieldConfig([], {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: [] },
        },
      },
    });

    await addIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      title: "Sprint 1",
      startDate: "2026-03-01",
      duration: 14,
    });

    const { variables } = captureCall(vi.mocked(gql), 1);
    expect(variables.duration).toBe(7);
    expect(variables.startDate).toBe("2026-01-01");
  });

  it("throws when field is not found", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      node: {
        fields: {
          nodes: [
            {
              id: "other-field",
              configuration: {
                duration: 7,
                startDate: "2026-01-01",
                iterations: [],
                completedIterations: [],
              },
            },
          ],
        },
      },
    }) as unknown as GraphQLFn;

    await expect(
      addIteration(gql, {
        projectId: "proj-xyz",
        fieldId: "field-missing",
        title: "Sprint 1",
        startDate: "2026-01-01",
        duration: 7,
      }),
    ).rejects.toThrow("Iteration field field-missing not found in project");
  });
});

describe("updateIteration", () => {
  it("updates only the specified fields on the target iteration", async () => {
    const existing = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
      { id: "iter-2", title: "Sprint 2", startDate: "2026-01-08", duration: 7 },
    ];
    const gql = mockWithFieldConfig(existing, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: existing },
        },
      },
    });

    await updateIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      iterationId: "iter-2",
      title: "Sprint 2 (extended)",
      duration: 14,
    });

    const { variables } = captureCall(vi.mocked(gql), 1);
    expect((variables.iterations as any[])).toHaveLength(2);
    // First iteration unchanged
    expect((variables.iterations as any[])[0]).toEqual({
      id: "iter-1",
      title: "Sprint 1",
      startDate: "2026-01-01",
      duration: 7,
    });
    // Second iteration updated
    expect((variables.iterations as any[])[1]).toEqual({
      id: "iter-2",
      title: "Sprint 2 (extended)",
      startDate: "2026-01-08",
      duration: 14,
    });
  });

  it("throws when iteration is not found", async () => {
    const gql = mockWithFieldConfig(
      [{ id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 }],
      {},
    );

    await expect(
      updateIteration(gql, {
        projectId: "proj-xyz",
        fieldId: "field-abc",
        iterationId: "iter-missing",
        title: "Nope",
      }),
    ).rejects.toThrow("Iteration iter-missing not found in field");
  });

  it("keeps original values when optional fields are omitted", async () => {
    const existing = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
    ];
    const gql = mockWithFieldConfig(existing, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: existing },
        },
      },
    });

    await updateIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      iterationId: "iter-1",
      title: "Sprint 1 renamed",
      // startDate and duration omitted
    });

    const { variables } = captureCall(vi.mocked(gql), 1);
    expect((variables.iterations as any[])[0]).toEqual({
      id: "iter-1",
      title: "Sprint 1 renamed",
      startDate: "2026-01-01",
      duration: 7,
    });
  });
});
