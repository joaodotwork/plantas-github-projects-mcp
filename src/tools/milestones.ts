import { graphql } from "@octokit/graphql";

export type GraphQLFn = typeof graphql;

export interface SetIssueMilestoneInput {
  owner: string;
  repo: string;
  /** Issue or pull request number. */
  issueNumber: number;
  /** Milestone number to assign, or `null` to clear the milestone. */
  milestoneNumber: number | null;
}

export interface SetIssueMilestoneResult {
  type: "Issue" | "PullRequest";
  number: number;
  url: string;
  milestone: { number: number; title: string } | null;
}

/** Resolve a milestone number to its node ID. */
export async function getMilestoneId(
  gql: GraphQLFn,
  owner: string,
  repo: string,
  number: number
): Promise<string> {
  const result = await gql<any>(
    `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        milestone(number: $number) {
          id
          title
        }
      }
    }
  `,
    { owner, repo, number }
  );

  const milestone = result.repository?.milestone;
  if (!milestone) {
    throw new Error(`Milestone #${number} not found in ${owner}/${repo}`);
  }
  return milestone.id;
}

/**
 * Set (or clear) the milestone on an issue or pull request that already exists.
 *
 * `create_issue` can attach a milestone at creation time, but there was no way to change one
 * afterwards — the gap in #23, which forced a fall back to `gh issue edit --milestone`. Board
 * fields (`update_item_status`, `assign_issue_to_iteration`) have always been mutable; this
 * brings milestones in line.
 *
 * Pull requests carry milestones too, so the number is resolved through the
 * `issueOrPullRequest` union and dispatched to the matching mutation.
 */
export async function setIssueMilestone(
  gql: GraphQLFn,
  input: SetIssueMilestoneInput
): Promise<SetIssueMilestoneResult> {
  if (input.milestoneNumber === undefined) {
    throw new Error(
      "Missing required parameter: 'milestoneNumber'. Pass a milestone number to assign, or null to clear the milestone."
    );
  }

  const lookup = await gql<any>(
    `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issueOrPullRequest(number: $number) {
          __typename
          ... on Issue {
            id
            number
            milestone { number title }
          }
          ... on PullRequest {
            id
            number
            milestone { number title }
          }
        }
      }
    }
  `,
    { owner: input.owner, repo: input.repo, number: input.issueNumber }
  );

  const content = lookup.repository?.issueOrPullRequest;
  if (!content) {
    throw new Error(
      `No issue or pull request #${input.issueNumber} in ${input.owner}/${input.repo}`
    );
  }

  const milestoneId =
    input.milestoneNumber === null
      ? null
      : await getMilestoneId(gql, input.owner, input.repo, input.milestoneNumber);

  const isPullRequest = content.__typename === "PullRequest";

  // `updateIssue`/`updatePullRequest` treat an explicit null milestoneId as "clear it".
  const result = await gql<any>(
    isPullRequest
      ? `
      mutation($id: ID!, $milestoneId: ID) {
        updatePullRequest(input: { pullRequestId: $id, milestoneId: $milestoneId }) {
          pullRequest {
            number
            url
            milestone { number title }
          }
        }
      }
    `
      : `
      mutation($id: ID!, $milestoneId: ID) {
        updateIssue(input: { id: $id, milestoneId: $milestoneId }) {
          issue {
            number
            url
            milestone { number title }
          }
        }
      }
    `,
    { id: content.id, milestoneId }
  );

  const updated = isPullRequest
    ? result.updatePullRequest.pullRequest
    : result.updateIssue.issue;

  return {
    type: isPullRequest ? "PullRequest" : "Issue",
    number: updated.number,
    url: updated.url,
    milestone: updated.milestone ?? null,
  };
}
