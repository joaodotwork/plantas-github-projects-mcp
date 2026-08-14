import { describe, it, expect, vi } from "vitest";
import { setIssueMilestone, getMilestoneId, type GraphQLFn } from "./milestones.js";

function captureCall(mock: ReturnType<typeof vi.fn>, callIndex: number) {
  const call = mock.mock.calls[callIndex];
  return { query: call[0] as string, variables: call[1] as Record<string, unknown> };
}

describe("getMilestoneId", () => {
  it("resolves a milestone number to its node id", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repository: { milestone: { id: "MI_kwDO", title: "v1.0" } },
    }) as unknown as GraphQLFn;

    const id = await getMilestoneId(gql, "octocat", "hello-world", 4);

    expect(id).toBe("MI_kwDO");
    const { variables } = captureCall(vi.mocked(gql), 0);
    expect(variables).toEqual({ owner: "octocat", repo: "hello-world", number: 4 });
  });

  it("throws a clear error when the milestone does not exist", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repository: { milestone: null },
    }) as unknown as GraphQLFn;

    await expect(getMilestoneId(gql, "octocat", "hello-world", 99)).rejects.toThrow(
      "Milestone #99 not found in octocat/hello-world"
    );
  });
});

describe("setIssueMilestone", () => {
  it("assigns a milestone to an existing issue", async () => {
    const gql = vi.fn()
      // content lookup
      .mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: "Issue",
            id: "I_kwDO",
            number: 12,
            milestone: null,
          },
        },
      })
      // milestone lookup
      .mockResolvedValueOnce({ repository: { milestone: { id: "MI_kwDO", title: "v1.0" } } })
      // updateIssue mutation
      .mockResolvedValueOnce({
        updateIssue: {
          issue: { number: 12, url: "https://github.com/o/r/issues/12", milestone: { number: 4, title: "v1.0" } },
        },
      }) as unknown as GraphQLFn;

    const result = await setIssueMilestone(gql, {
      owner: "o",
      repo: "r",
      issueNumber: 12,
      milestoneNumber: 4,
    });

    expect(result).toMatchObject({
      number: 12,
      milestone: { number: 4, title: "v1.0" },
    });

    const { query, variables } = captureCall(vi.mocked(gql), 2);
    expect(query).toContain("updateIssue");
    expect(variables).toEqual({ id: "I_kwDO", milestoneId: "MI_kwDO" });
  });

  it("clears the milestone when milestoneNumber is null", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: "Issue",
            id: "I_kwDO",
            number: 12,
            milestone: { number: 4, title: "v1.0" },
          },
        },
      })
      .mockResolvedValueOnce({
        updateIssue: { issue: { number: 12, url: "https://github.com/o/r/issues/12", milestone: null } },
      }) as unknown as GraphQLFn;

    const result = await setIssueMilestone(gql, {
      owner: "o",
      repo: "r",
      issueNumber: 12,
      milestoneNumber: null,
    });

    // No milestone lookup — nothing to resolve.
    expect(vi.mocked(gql)).toHaveBeenCalledTimes(2);
    const { variables } = captureCall(vi.mocked(gql), 1);
    expect(variables).toEqual({ id: "I_kwDO", milestoneId: null });
    expect(result.milestone).toBeNull();
  });

  it("uses updatePullRequest for pull request numbers", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: "PullRequest",
            id: "PR_kwDO",
            number: 21,
            milestone: null,
          },
        },
      })
      .mockResolvedValueOnce({ repository: { milestone: { id: "MI_kwDO", title: "v1.0" } } })
      .mockResolvedValueOnce({
        updatePullRequest: {
          pullRequest: { number: 21, url: "https://github.com/o/r/pull/21", milestone: { number: 4, title: "v1.0" } },
        },
      }) as unknown as GraphQLFn;

    const result = await setIssueMilestone(gql, {
      owner: "o",
      repo: "r",
      issueNumber: 21,
      milestoneNumber: 4,
    });

    const { query, variables } = captureCall(vi.mocked(gql), 2);
    expect(query).toContain("updatePullRequest");
    expect(query).not.toContain("updateIssue(");
    expect(variables).toEqual({ id: "PR_kwDO", milestoneId: "MI_kwDO" });
    expect(result).toMatchObject({ number: 21, type: "PullRequest" });
  });

  it("throws when the number matches neither an issue nor a PR", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      repository: { issueOrPullRequest: null },
    }) as unknown as GraphQLFn;

    await expect(
      setIssueMilestone(gql, { owner: "o", repo: "r", issueNumber: 9999, milestoneNumber: 4 })
    ).rejects.toThrow("No issue or pull request #9999 in o/r");
  });

  it("rejects an undefined milestoneNumber rather than silently clearing", async () => {
    const gql = vi.fn() as unknown as GraphQLFn;

    await expect(
      setIssueMilestone(gql, {
        owner: "o",
        repo: "r",
        issueNumber: 12,
      } as any)
    ).rejects.toThrow(/milestoneNumber/);

    expect(vi.mocked(gql)).not.toHaveBeenCalled();
  });
});
