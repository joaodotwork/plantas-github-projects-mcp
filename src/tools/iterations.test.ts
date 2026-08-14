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
  const INPUT = {
    projectId: "proj-xyz",
    fieldName: "Sprint",
    duration: 7,
    startDate: "2026-03-02",
    iterations: [{ title: "Sprint 1", startDate: "2026-03-02", duration: 7 }],
  };

  function createdField(iterations: unknown[] = []) {
    return {
      createProjectV2Field: {
        projectV2Field: { id: "field-abc", name: "Sprint", configuration: { iterations } },
      },
    };
  }

  // Regression for #21/#22: this used to be create-then-configure. When step 2 failed the
  // field survived empty, and the retry died with "Name has already been taken". The live
  // schema accepts `iterationConfiguration` on CreateProjectV2FieldInput, so one call does it.
  it("creates the field and its iterations in a single mutation", async () => {
    const gql = vi.fn().mockResolvedValueOnce(createdField(INPUT.iterations)) as unknown as GraphQLFn;

    await createIterationField(gql, INPUT);

    expect(vi.mocked(gql)).toHaveBeenCalledTimes(1);
    const { query } = captureCall(vi.mocked(gql), 0);
    expect(query).toContain("createProjectV2Field");
    expect(query).not.toContain("updateProjectV2Field");
  });

  it("passes projectId, name, dataType and the iteration configuration together", async () => {
    const gql = vi.fn().mockResolvedValueOnce(createdField(INPUT.iterations)) as unknown as GraphQLFn;

    await createIterationField(gql, INPUT);

    const { query, variables } = captureCall(vi.mocked(gql), 0);
    expect(query).toContain("dataType: ITERATION");
    expect(variables).toEqual({
      projectId: "proj-xyz",
      name: "Sprint",
      duration: 7,
      startDate: "2026-03-02",
      iterations: INPUT.iterations,
    });
  });

  // Regression: the mutation previously declared
  // `[ProjectV2IterationFieldConfigurationIterationInput!]!`, a type that does not exist in
  // GitHub's schema. The real type, confirmed by live introspection, is `[ProjectV2Iteration!]!`.
  it("declares the real ProjectV2Iteration input type", async () => {
    const gql = vi.fn().mockResolvedValueOnce(createdField()) as unknown as GraphQLFn;

    await createIterationField(gql, INPUT);

    const { query } = captureCall(vi.mocked(gql), 0);
    expect(query).toContain("[ProjectV2Iteration!]!");
    expect(query).not.toContain("ProjectV2IterationFieldConfigurationIterationInput");
  });

  it("returns the created field with its populated configuration", async () => {
    const gql = vi.fn().mockResolvedValueOnce(createdField(INPUT.iterations)) as unknown as GraphQLFn;

    const field = await createIterationField(gql, INPUT);

    expect(field).toMatchObject({
      id: "field-abc",
      name: "Sprint",
      configuration: { iterations: INPUT.iterations },
    });
  });

  // The partial-state hazard from #21/#22: an earlier run left an empty field behind, so the
  // retry must be able to adopt it rather than dead-ending on the duplicate name.
  it("adopts an existing field of the same name instead of failing on the duplicate", async () => {
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error("Name has already been taken"))
      // field lookup
      .mockResolvedValueOnce({
        node: {
          fields: {
            nodes: [
              { id: "field-stranded", name: "Sprint", configuration: { duration: 7, startDay: 1, iterations: [], completedIterations: [] } },
            ],
          },
        },
      })
      // configure the adopted field
      .mockResolvedValueOnce({
        updateProjectV2Field: {
          projectV2Field: {
            id: "field-stranded",
            name: "Sprint",
            configuration: { iterations: INPUT.iterations },
          },
        },
      }) as unknown as GraphQLFn;

    const field = await createIterationField(gql, INPUT);

    expect(field).toMatchObject({ id: "field-stranded", adopted: true });
    const { query, variables } = captureCall(vi.mocked(gql), 2);
    expect(query).toContain("updateProjectV2Field");
    expect(variables).toMatchObject({ fieldId: "field-stranded", iterations: INPUT.iterations });
  });

  // Adoption must never overwrite a field that already holds iterations — that would wipe
  // every assignment on it. Populated fields belong to add_iteration/update_iteration.
  it("refuses to adopt a field that already has iterations", async () => {
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error("Name has already been taken"))
      .mockResolvedValueOnce({
        node: {
          fields: {
            nodes: [
              {
                id: "field-populated",
                name: "Sprint",
                configuration: {
                  duration: 7,
                  startDay: 1,
                  iterations: [{ id: "i1", title: "Sprint 1", startDate: "2026-03-02", duration: 7 }],
                  completedIterations: [],
                },
              },
            ],
          },
        },
      }) as unknown as GraphQLFn;

    await expect(createIterationField(gql, INPUT)).rejects.toThrow(
      /already exists with iterations/
    );
    // Lookup only — no mutation against the populated field.
    expect(vi.mocked(gql)).toHaveBeenCalledTimes(2);
  });

  it("refuses to adopt a field whose iterations are all completed", async () => {
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error("Name has already been taken"))
      .mockResolvedValueOnce({
        node: {
          fields: {
            nodes: [
              {
                id: "field-historic",
                name: "Sprint",
                configuration: {
                  duration: 7,
                  startDay: 1,
                  iterations: [],
                  completedIterations: [
                    { id: "i0", title: "Sprint 0", startDate: "2026-02-23", duration: 7 },
                  ],
                },
              },
            ],
          },
        },
      }) as unknown as GraphQLFn;

    await expect(createIterationField(gql, INPUT)).rejects.toThrow(
      /already exists with iterations/
    );
    expect(vi.mocked(gql)).toHaveBeenCalledTimes(2);
  });

  it("rethrows a duplicate-name error when no matching field can be found", async () => {
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error("Name has already been taken"))
      .mockResolvedValueOnce({ node: { fields: { nodes: [] } } }) as unknown as GraphQLFn;

    await expect(createIterationField(gql, INPUT)).rejects.toThrow(
      "Name has already been taken"
    );
  });

  it("does not swallow unrelated failures", async () => {
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error("Resource not accessible by integration")) as unknown as GraphQLFn;

    await expect(createIterationField(gql, INPUT)).rejects.toThrow(
      "Resource not accessible by integration"
    );
    expect(vi.mocked(gql)).toHaveBeenCalledTimes(1);
  });
});

describe("assignIssueToIteration", () => {
  it("resolves itemId and projectId before calling the mutation", async () => {
    const gql = vi.fn()
      // getProjectItemId query
      .mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: "Issue",
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
          issueOrPullRequest: {
            __typename: "Issue",
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
        issueOrPullRequest: {
          __typename: "Issue",
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

  // Regression for #20/#25: the lookup used `repository.issue(number:)`, so any PR on the
  // board failed with "Could not resolve to an Issue with the number of N".
  it("resolves pull request items, not just issues", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: "PullRequest",
            projectItems: { nodes: [{ id: "item-pr", project: { number: 8 } }] },
          },
        },
      })
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "proj-8" } } })
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-pr" } },
      }) as unknown as GraphQLFn;

    const result = await assignIssueToIteration(gql, {
      owner: "netliferesearch",
      repo: "the-vanguard",
      projectNumber: 8,
      issueNumber: 21,
      fieldId: "f-1",
      iterationId: "i-1",
    });

    expect(result).toEqual({ id: "item-pr" });
    const { variables } = captureCall(vi.mocked(gql), 2);
    expect(variables).toMatchObject({ itemId: "item-pr", projectId: "proj-8" });
  });

  it("queries issueOrPullRequest with fragments for both content types", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: "PullRequest",
            projectItems: { nodes: [{ id: "item-pr", project: { number: 8 } }] },
          },
        },
      })
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "proj-8" } } })
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-pr" } },
      }) as unknown as GraphQLFn;

    await assignIssueToIteration(gql, {
      owner: "o",
      repo: "r",
      projectNumber: 8,
      issueNumber: 21,
      fieldId: "f-1",
      iterationId: "i-1",
    });

    const { query } = captureCall(vi.mocked(gql), 0);
    expect(query).toContain("issueOrPullRequest");
    expect(query).toContain("... on Issue");
    expect(query).toContain("... on PullRequest");
    // `issue(number:)` was the bug — it must be gone.
    expect(query).not.toMatch(/\bissue\(number:/);
  });

  it("names the content type in the not-on-board error", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repository: {
        issueOrPullRequest: {
          __typename: "PullRequest",
          projectItems: { nodes: [] },
        },
      },
    }) as unknown as GraphQLFn;

    await expect(
      assignIssueToIteration(gql, {
        owner: "o",
        repo: "r",
        projectNumber: 8,
        issueNumber: 21,
        fieldId: "f-1",
        iterationId: "i-1",
      })
    ).rejects.toThrow("Pull request #21 not found in project #8");
  });

  it("throws a clear error when the number matches neither an issue nor a PR", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repository: { issueOrPullRequest: null },
    }) as unknown as GraphQLFn;

    await expect(
      assignIssueToIteration(gql, {
        owner: "o",
        repo: "r",
        projectNumber: 8,
        issueNumber: 9999,
        fieldId: "f-1",
        iterationId: "i-1",
      })
    ).rejects.toThrow("No issue or pull request #9999 in o/r");
  });

  it("skips the lookup when an itemId is supplied directly", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "proj-8" } } })
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_direct" } },
      }) as unknown as GraphQLFn;

    await assignIssueToIteration(gql, {
      owner: "o",
      projectNumber: 8,
      itemId: "PVTI_direct",
      fieldId: "f-1",
      iterationId: "i-1",
    });

    expect(vi.mocked(gql)).toHaveBeenCalledTimes(2);
    const { variables } = captureCall(vi.mocked(gql), 1);
    expect(variables).toMatchObject({ itemId: "PVTI_direct", projectId: "proj-8" });
  });

  it("skips project resolution when a projectId is supplied", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_direct" } },
    }) as unknown as GraphQLFn;

    await assignIssueToIteration(gql, {
      projectId: "PVT_given",
      itemId: "PVTI_direct",
      fieldId: "f-1",
      iterationId: "i-1",
    });

    expect(vi.mocked(gql)).toHaveBeenCalledTimes(1);
    const { variables } = captureCall(vi.mocked(gql), 0);
    expect(variables).toMatchObject({ projectId: "PVT_given", itemId: "PVTI_direct" });
  });

  it("rejects input that identifies neither an item nor an issue number", async () => {
    const gql = vi.fn() as unknown as GraphQLFn;

    await expect(
      assignIssueToIteration(gql, {
        projectId: "PVT_given",
        fieldId: "f-1",
        iterationId: "i-1",
      })
    ).rejects.toThrow(/itemId/);

    expect(vi.mocked(gql)).not.toHaveBeenCalled();
  });

  it("rejects input with no way to resolve the project", async () => {
    const gql = vi.fn() as unknown as GraphQLFn;

    await expect(
      assignIssueToIteration(gql, {
        itemId: "PVTI_direct",
        fieldId: "f-1",
        iterationId: "i-1",
      })
    ).rejects.toThrow(/projectId/);

    expect(vi.mocked(gql)).not.toHaveBeenCalled();
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

type Iter = { id: string; title: string; startDate: string; duration: number };

/**
 * Mock the three-call sequence every field update now performs:
 *   1. getIterationFieldConfig query
 *   2. snapshotIterationAssignments query
 *   3. updateProjectV2Field mutation
 * followed by one restore mutation per snapshotted assignment.
 *
 * The config shape mirrors GitHub's real schema: `ProjectV2IterationFieldConfiguration`
 * exposes `duration`, `startDay`, `iterations`, `completedIterations` — and notably
 * NO `startDate`. Querying `startDate` there is what made these tools fail in production.
 */
function mockWithFieldConfig(
  existingIterations: Iter[],
  mutationResult: any,
  opts: {
    completedIterations?: Iter[];
    assignments?: Array<{ itemId: string; number: number; title: string }>;
  } = {},
) {
  const assignments = opts.assignments ?? [];
  const mock = vi.fn()
    // 1. getIterationFieldConfig
    .mockResolvedValueOnce({
      node: {
        fields: {
          nodes: [
            {
              id: "field-abc",
              name: "Sprint",
              configuration: {
                duration: 7,
                startDay: 1,
                iterations: existingIterations,
                completedIterations: opts.completedIterations ?? [],
              },
            },
          ],
        },
      },
    })
    // 2. snapshotIterationAssignments
    .mockResolvedValueOnce({
      node: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: assignments.map((a) => ({
            id: a.itemId,
            content: { __typename: "Issue", number: a.number },
            fieldValueByName: { title: a.title },
          })),
        },
      },
    })
    // 3. updateProjectV2Field
    .mockResolvedValueOnce(mutationResult);

  // 4..n restore mutations
  for (const _ of assignments) {
    mock.mockResolvedValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: "item" } },
    });
  }

  return mock as unknown as GraphQLFn;
}

/** Index of the updateProjectV2Field call within the mocked sequence. */
const MUTATION_CALL = 2;

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

    const { variables } = captureCall(vi.mocked(gql), MUTATION_CALL);
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

  // Regression: the config query used to request `configuration { startDate }`, which does
  // not exist on ProjectV2IterationFieldConfiguration and made every call fail with
  // "Field 'startDate' doesn't exist on type 'ProjectV2IterationFieldConfiguration'".
  it("queries startDay, never startDate, on the field configuration", async () => {
    const gql = mockWithFieldConfig([], {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: [], completedIterations: [] },
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

    const { query } = captureCall(vi.mocked(gql), 0);
    // Inspect only the direct children of `configuration`, i.e. everything before the
    // nested `iterations { ... }` selection (where startDate is legitimate).
    const configBlock = query.slice(
      query.indexOf("configuration {"),
      query.indexOf("iterations {"),
    );
    expect(configBlock).toContain("startDay");
    expect(configBlock).not.toContain("startDate");
  });

  // Regression: mocks accept any query string, so an undeclared GraphQL variable sails
  // through unit tests and only fails against the real API. Assert every $var used in a
  // query is also declared in its signature.
  it("declares every GraphQL variable it references", async () => {
    const gql = mockWithFieldConfig([], {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: [], completedIterations: [] },
        },
      },
    });

    await addIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      title: "Sprint 1",
      startDate: "2026-03-01",
      duration: 7,
    });

    for (const call of vi.mocked(gql).mock.calls) {
      const query = call[0] as string;
      const signature = query.slice(0, query.indexOf("{"));
      const declared = new Set(
        [...signature.matchAll(/\$(\w+)\s*:/g)].map((m) => m[1]),
      );
      const used = new Set([...query.matchAll(/\$(\w+)/g)].map((m) => m[1]));
      for (const name of used) {
        expect(
          declared.has(name),
          `$${name} is used but not declared in: ${signature.trim()}`,
        ).toBe(true);
      }
    }
  });

  it("carries completed iterations through so history is not dropped", async () => {
    const completed = [
      { id: "old-1", title: "Sprint 0", startDate: "2025-12-25", duration: 7 },
    ];
    const active = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
    ];
    const gql = mockWithFieldConfig(active, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: active, completedIterations: completed },
        },
      },
    }, { completedIterations: completed });

    await addIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      title: "Sprint 2",
      startDate: "2026-01-08",
      duration: 7,
    });

    const { variables } = captureCall(vi.mocked(gql), MUTATION_CALL);
    const titles = (variables.iterations as any[]).map((i) => i.title);
    // Chronological: completed first, then active, then the new one.
    expect(titles).toEqual(["Sprint 0", "Sprint 1", "Sprint 2"]);
    // startDate is "the start date for the first iteration".
    expect(variables.startDate).toBe("2025-12-25");
    expect(variables.duration).toBe(7);
  });

  // Regression: updateProjectV2Field regenerates every iteration ID, detaching all item
  // values. Without a snapshot/restore pass, adding a sprint silently wipes the board.
  it("snapshots assignments and restores them against the new iteration ids", async () => {
    const active = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
    ];
    const gql = mockWithFieldConfig(active, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: {
            // Note the regenerated id — this is what GitHub actually does.
            iterations: [
              { id: "REGENERATED", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
              { id: "iter-new", title: "Sprint 2", startDate: "2026-01-08", duration: 7 },
            ],
            completedIterations: [],
          },
        },
      },
    }, { assignments: [{ itemId: "item-1", number: 42, title: "Sprint 1" }] });

    const result: any = await addIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      title: "Sprint 2",
      startDate: "2026-01-08",
      duration: 7,
    });

    expect(result.assignmentsRestored).toEqual({ restored: 1, failed: [] });

    // The restore mutation runs after the field update and targets the NEW id.
    const { query, variables } = captureCall(vi.mocked(gql), MUTATION_CALL + 1);
    expect(query).toContain("updateProjectV2ItemFieldValue");
    expect(variables.itemId).toBe("item-1");
    expect(variables.iterationId).toBe("REGENERATED");
  });

  it("reports assignments it could not restore instead of failing silently", async () => {
    const active = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
    ];
    const gql = mockWithFieldConfig(active, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          // "Sprint 1" is gone, so its assignment cannot be remapped.
          configuration: {
            iterations: [
              { id: "iter-new", title: "Sprint 2", startDate: "2026-01-08", duration: 7 },
            ],
            completedIterations: [],
          },
        },
      },
    }, { assignments: [{ itemId: "item-1", number: 42, title: "Sprint 1" }] });

    const result: any = await addIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      title: "Sprint 2",
      startDate: "2026-01-08",
      duration: 7,
    });

    expect(result.assignmentsRestored.restored).toBe(0);
    expect(result.assignmentsRestored.failed).toHaveLength(1);
    expect(result.assignmentsRestored.failed[0].label).toBe("Issue #42");
  });

  it("throws when field is not found", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      node: {
        fields: {
          nodes: [
            {
              id: "other-field",
              name: "Sprint",
              configuration: {
                duration: 7,
                startDay: 1,
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

    const { variables } = captureCall(vi.mocked(gql), MUTATION_CALL);
    expect((variables.iterations as any[])).toHaveLength(2);
    // First iteration unchanged
    expect((variables.iterations as any[])[0]).toEqual({
      title: "Sprint 1",
      startDate: "2026-01-01",
      duration: 7,
    });
    // Second iteration updated
    expect((variables.iterations as any[])[1]).toEqual({
      title: "Sprint 2 (extended)",
      startDate: "2026-01-08",
      duration: 14,
    });
  });

  // Regression: `ProjectV2Iteration` has no `id` field, so including one is a query error.
  it("never sends an id inside the iterations payload", async () => {
    const existing = [
      { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
      { id: "iter-2", title: "Sprint 2", startDate: "2026-01-08", duration: 7 },
    ];
    const gql = mockWithFieldConfig(existing, {
      updateProjectV2Field: {
        projectV2Field: {
          id: "field-abc",
          name: "Sprint",
          configuration: { iterations: existing, completedIterations: [] },
        },
      },
    });

    await updateIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      iterationId: "iter-2",
      duration: 14,
    });

    const { variables } = captureCall(vi.mocked(gql), MUTATION_CALL);
    for (const iteration of variables.iterations as any[]) {
      expect(iteration).not.toHaveProperty("id");
      expect(Object.keys(iteration).sort()).toEqual(["duration", "startDate", "title"]);
    }
  });

  it("remaps assignments when the target iteration is renamed", async () => {
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
              { id: "NEW-ID", title: "Renamed", startDate: "2026-01-01", duration: 7 },
            ],
            completedIterations: [],
          },
        },
      },
    }, { assignments: [{ itemId: "item-1", number: 7, title: "Sprint 1" }] });

    const result: any = await updateIteration(gql, {
      projectId: "proj-xyz",
      fieldId: "field-abc",
      iterationId: "iter-1",
      title: "Renamed",
    });

    // Snapshot said "Sprint 1"; the iteration is now "Renamed". Restore must follow it.
    expect(result.assignmentsRestored).toEqual({ restored: 1, failed: [] });
    const { variables } = captureCall(vi.mocked(gql), MUTATION_CALL + 1);
    expect(variables.iterationId).toBe("NEW-ID");
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
          configuration: { iterations: existing, completedIterations: [] },
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

    const { variables } = captureCall(vi.mocked(gql), MUTATION_CALL);
    expect((variables.iterations as any[])[0]).toEqual({
      title: "Sprint 1 renamed",
      startDate: "2026-01-01",
      duration: 7,
    });
  });
});
