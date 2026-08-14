import { graphql } from "@octokit/graphql";

export type GraphQLFn = typeof graphql;

export interface IterationInput {
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

/**
 * Identifies the target item either by number (`owner`/`repo`/`issueNumber`) or directly by
 * project item ID, and the project either by number (`owner`/`projectNumber`) or by ID.
 * `update_item_status` has always taken IDs directly; this mirrors it.
 */
export interface AssignIterationInput {
  owner?: string;
  repo?: string;
  projectNumber?: number;
  issueNumber?: number;
  /** Project item ID (`PVTI_…`). When given, no number lookup happens. */
  itemId?: string;
  /** Project node ID (`PVT_…`). When given, no project lookup happens. */
  projectId?: string;
  fieldId: string;
  iterationId: string;
}

export async function getProjectId(
  graphqlFn: GraphQLFn,
  owner: string,
  number: number
): Promise<string> {
  const result = await graphqlFn<any>(
    `
    query($owner: String!, $number: Int!) {
      repositoryOwner(login: $owner) {
        ... on User {
          projectV2(number: $number) {
            id
          }
        }
        ... on Organization {
          projectV2(number: $number) {
            id
          }
        }
      }
    }
  `,
    { owner, number }
  );
  return result.repositoryOwner.projectV2.id;
}

/**
 * Resolve a project item ID from an issue *or* pull request number.
 *
 * ProjectsV2 boards hold both, so this queries the `issueOrPullRequest` union. The previous
 * `repository.issue(number:)` form failed outright on PR items with "Could not resolve to an
 * Issue with the number of N" (#20, #25).
 */
export async function getProjectItemId(
  graphqlFn: GraphQLFn,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number
): Promise<string> {
  const result = await graphqlFn<any>(
    `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issueOrPullRequest(number: $issueNumber) {
          __typename
          ... on Issue {
            projectItems(first: 20) {
              nodes { id project { number } }
            }
          }
          ... on PullRequest {
            projectItems(first: 20) {
              nodes { id project { number } }
            }
          }
        }
      }
    }
  `,
    { owner, repo, issueNumber }
  );

  const content = result.repository?.issueOrPullRequest;
  if (!content) {
    throw new Error(
      `No issue or pull request #${issueNumber} in ${owner}/${repo}`
    );
  }

  const item = content.projectItems.nodes.find(
    (node: any) => node.project.number === projectNumber
  );

  if (!item) {
    const kind = content.__typename === "PullRequest" ? "Pull request" : "Issue";
    throw new Error(
      `${kind} #${issueNumber} not found in project #${projectNumber}`
    );
  }

  return item.id;
}

/** Field shape returned by both branches of `createIterationField`. */
const ITERATION_FIELD_SELECTION = `
    ... on ProjectV2IterationField {
      id
      name
      configuration {
        duration
        startDay
        iterations {
          id
          title
          startDate
          duration
        }
      }
    }`;

function isDuplicateNameError(error: unknown): boolean {
  return /name has already been taken/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Locate an iteration field by name, for recovering from a stranded create.
 * Returns null when no field of that name exists.
 *
 * Unpaginated on purpose: a project can hold at most 50 fields in total (system fields count
 * toward that), so `first: 100` cannot truncate.
 */
async function findIterationFieldByName(
  graphqlFn: GraphQLFn,
  projectId: string,
  fieldName: string,
): Promise<{ id: string; iterationCount: number } | null> {
  const result = await graphqlFn<any>(
    `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 100) {
            nodes {
              ... on ProjectV2IterationField {
                id
                name
                configuration {
                  iterations { id }
                  completedIterations { id }
                }
              }
            }
          }
        }
      }
    }
  `,
    { projectId },
  );

  const field = result.node?.fields?.nodes?.find(
    (n: any) => n?.name === fieldName,
  );
  if (!field) return null;

  return {
    id: field.id,
    iterationCount:
      (field.configuration?.iterations?.length ?? 0) +
      (field.configuration?.completedIterations?.length ?? 0),
  };
}

/**
 * Create an iteration field with its iterations in a single mutation.
 *
 * Previously this was create-then-configure. When the second call failed — which it always
 * did, while the payload named a nonexistent input type — the field survived empty and the
 * retry dead-ended on "Name has already been taken" (#21, #22). `CreateProjectV2FieldInput`
 * accepts `iterationConfiguration` (confirmed by live introspection), so the field and its
 * iterations are now created atomically: either both, or neither.
 *
 * For projects still holding a field stranded by the old code path, a duplicate-name failure
 * falls back to adopting that field — but only while it has no iterations, since configuring
 * a populated field would regenerate its iteration IDs and detach every assignment.
 */
export async function createIterationField(
  graphqlFn: GraphQLFn,
  input: IterationInput
) {
  try {
    const result = await graphqlFn<any>(
      `
      mutation($projectId: ID!, $name: String!, $duration: Int!, $startDate: Date!, $iterations: ${ITERATIONS_ARG_TYPE}) {
        createProjectV2Field(input: {
          projectId: $projectId
          dataType: ITERATION
          name: $name
          iterationConfiguration: {
            duration: $duration
            startDate: $startDate
            iterations: $iterations
          }
        }) {
          projectV2Field {${ITERATION_FIELD_SELECTION}
          }
        }
      }
    `,
      {
        projectId: input.projectId,
        name: input.fieldName,
        duration: input.duration,
        startDate: input.startDate,
        iterations: input.iterations,
      }
    );

    return result.createProjectV2Field.projectV2Field;
  } catch (error) {
    if (!isDuplicateNameError(error)) throw error;

    const existing = await findIterationFieldByName(
      graphqlFn,
      input.projectId,
      input.fieldName,
    );
    if (!existing) throw error;

    if (existing.iterationCount > 0) {
      throw new Error(
        `Iteration field '${input.fieldName}' already exists with iterations. ` +
          `Configuring it would regenerate every iteration ID and detach all item ` +
          `assignments — use add_iteration or update_iteration instead.`,
      );
    }

    const configured = await graphqlFn<any>(
      `
      mutation($fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: ${ITERATIONS_ARG_TYPE}) {
        updateProjectV2Field(input: {
          fieldId: $fieldId
          iterationConfiguration: {
            duration: $duration
            startDate: $startDate
            iterations: $iterations
          }
        }) {
          projectV2Field {${ITERATION_FIELD_SELECTION}
          }
        }
      }
    `,
      {
        fieldId: existing.id,
        duration: input.duration,
        startDate: input.startDate,
        iterations: input.iterations,
      },
    );

    // Flagged so callers can tell an adopted field from a freshly created one.
    return { ...configured.updateProjectV2Field.projectV2Field, adopted: true };
  }
}

export interface AddIterationInput {
  projectId: string;
  fieldId: string;
  title: string;
  startDate: string;
  duration: number;
}

export interface UpdateIterationInput {
  projectId: string;
  fieldId: string;
  iterationId: string;
  title?: string;
  startDate?: string;
  duration?: number;
}

interface IterationConfig {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

/**
 * GraphQL type of the `iterations` argument on ProjectV2IterationFieldConfigurationInput.
 *
 * Per GitHub's published schema (docs.github.com/public/fpt/schema.docs.graphql):
 *   input ProjectV2IterationFieldConfigurationInput {
 *     duration: Int!
 *     iterations: [ProjectV2Iteration!]!
 *     startDate: Date!
 *   }
 *
 * Note `ProjectV2Iteration` has exactly three fields — duration, startDate, title —
 * and NO `id`. Sending an `id` is a query error.
 */
const ITERATIONS_ARG_TYPE = "[ProjectV2Iteration!]!";

/** A single item's iteration assignment, captured before a destructive field update. */
export interface IterationAssignment {
  itemId: string;
  /** Human-readable label for diagnostics only. */
  label: string;
  iterationTitle: string;
}

async function getIterationFieldConfig(
  graphqlFn: GraphQLFn,
  projectId: string,
  fieldId: string,
): Promise<{
  name: string;
  duration: number;
  startDate: string;
  iterations: IterationConfig[];
}> {
  const result = await graphqlFn<any>(
    `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 100) {
            nodes {
              ... on ProjectV2IterationField {
                id
                name
                configuration {
                  duration
                  startDay
                  iterations {
                    id
                    title
                    startDate
                    duration
                  }
                  completedIterations {
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
      }
    }
  `,
    { projectId },
  );

  const field = result.node.fields.nodes.find(
    (n: any) => n.id === fieldId,
  );
  if (!field) {
    throw new Error(`Iteration field ${fieldId} not found in project`);
  }

  // `completedIterations` comes back newest-first; the mutation expects chronological
  // order, and completed iterations precede active ones.
  const completed = [...field.configuration.completedIterations].reverse();
  const iterations = [...completed, ...field.configuration.iterations];

  return {
    name: field.name,
    duration: field.configuration.duration,
    // The input requires `startDate` ("the start date for the first iteration"), but the
    // output type exposes `startDay` (a day-of-week integer) and no equivalent date. Derive
    // it from the earliest iteration instead.
    startDate: iterations[0]?.startDate ?? "",
    iterations,
  };
}

/**
 * Capture every item's iteration assignment before a field update.
 *
 * Required because `updateProjectV2Field` regenerates the ID of every iteration — even
 * ones resubmitted byte-identically — which detaches all item values. Assignments are
 * keyed by iteration *title*, the only stable identifier across the mutation.
 */
export async function snapshotIterationAssignments(
  graphqlFn: GraphQLFn,
  projectId: string,
  fieldName: string,
): Promise<IterationAssignment[]> {
  const out: IterationAssignment[] = [];
  let cursor: string | null = null;

  for (;;) {
    const result: any = await graphqlFn<any>(
      `
      query($projectId: ID!, $cursor: String, $fieldName: String!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content {
                  __typename
                  ... on Issue { number }
                  ... on PullRequest { number }
                  ... on DraftIssue { title }
                }
                fieldValueByName(name: $fieldName) {
                  ... on ProjectV2ItemFieldIterationValue { title }
                }
              }
            }
          }
        }
      }
    `,
      { projectId, cursor, fieldName },
    );

    const page = result.node.items;
    for (const node of page.nodes) {
      if (!node.fieldValueByName?.title) continue;
      const content = node.content ?? {};
      out.push({
        itemId: node.id,
        label:
          content.number != null
            ? `${content.__typename} #${content.number}`
            : (content.title ?? node.id),
        iterationTitle: node.fieldValueByName.title,
      });
    }

    if (!page.pageInfo.hasNextPage) return out;
    cursor = page.pageInfo.endCursor;
  }
}

/** Re-apply a snapshot after the field update, mapping old titles to freshly-minted IDs. */
export async function restoreIterationAssignments(
  graphqlFn: GraphQLFn,
  projectId: string,
  fieldId: string,
  snapshot: IterationAssignment[],
  freshIterations: Array<{ id: string; title: string }>,
): Promise<{ restored: number; failed: IterationAssignment[] }> {
  const idByTitle = new Map(freshIterations.map((i) => [i.title, i.id]));
  const failed: IterationAssignment[] = [];
  let restored = 0;

  for (const entry of snapshot) {
    const iterationId = idByTitle.get(entry.iterationTitle);
    if (!iterationId) {
      failed.push(entry);
      continue;
    }
    try {
      await graphqlFn<any>(
        `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { iterationId: $iterationId }
          }) { projectV2Item { id } }
        }
      `,
        { projectId, itemId: entry.itemId, fieldId, iterationId },
      );
      restored++;
    } catch {
      failed.push(entry);
    }
  }

  return { restored, failed };
}

export async function addIteration(
  graphqlFn: GraphQLFn,
  input: AddIterationInput,
) {
  // Fetch current iterations so we can append the new one
  const config = await getIterationFieldConfig(
    graphqlFn,
    input.projectId,
    input.fieldId,
  );

  const allIterations = [
    ...config.iterations.map((it) => ({
      title: it.title,
      startDate: it.startDate,
      duration: it.duration,
    })),
    {
      title: input.title,
      startDate: input.startDate,
      duration: input.duration,
    },
  ];

  // Capture assignments first — the mutation below detaches every one of them.
  const snapshot = await snapshotIterationAssignments(
    graphqlFn,
    input.projectId,
    config.name,
  );

  const result = await graphqlFn<any>(
    `
    mutation($fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: ${ITERATIONS_ARG_TYPE}) {
      updateProjectV2Field(input: {
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
              completedIterations {
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
      fieldId: input.fieldId,
      duration: config.duration,
      startDate: config.startDate || input.startDate,
      iterations: allIterations,
    },
  );

  const field = result.updateProjectV2Field.projectV2Field;
  const restoreReport = await restoreIterationAssignments(
    graphqlFn,
    input.projectId,
    input.fieldId,
    snapshot,
    [
      ...(field.configuration.completedIterations ?? []),
      ...(field.configuration.iterations ?? []),
    ],
  );

  return { ...field, assignmentsRestored: restoreReport };
}

export async function updateIteration(
  graphqlFn: GraphQLFn,
  input: UpdateIterationInput,
) {
  // Fetch current iterations so we can modify the target one
  const config = await getIterationFieldConfig(
    graphqlFn,
    input.projectId,
    input.fieldId,
  );

  const target = config.iterations.find((it) => it.id === input.iterationId);
  if (!target) {
    throw new Error(`Iteration ${input.iterationId} not found in field`);
  }

  // `ProjectV2Iteration` accepts only title/startDate/duration — never `id`.
  const allIterations = config.iterations.map((it) => {
    if (it.id === input.iterationId) {
      return {
        title: input.title ?? it.title,
        startDate: input.startDate ?? it.startDate,
        duration: input.duration ?? it.duration,
      };
    }
    return {
      title: it.title,
      startDate: it.startDate,
      duration: it.duration,
    };
  });

  // Renaming an iteration breaks title-based restore, so remap the snapshot entries
  // that pointed at the old title before restoring.
  const snapshot = await snapshotIterationAssignments(
    graphqlFn,
    input.projectId,
    config.name,
  );
  const renamedTo = input.title && input.title !== target.title ? input.title : null;
  const adjustedSnapshot = renamedTo
    ? snapshot.map((entry) =>
        entry.iterationTitle === target.title
          ? { ...entry, iterationTitle: renamedTo }
          : entry,
      )
    : snapshot;

  const result = await graphqlFn<any>(
    `
    mutation($fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: ${ITERATIONS_ARG_TYPE}) {
      updateProjectV2Field(input: {
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
              completedIterations {
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
      fieldId: input.fieldId,
      duration: config.duration,
      startDate: config.startDate,
      iterations: allIterations,
    },
  );

  const field = result.updateProjectV2Field.projectV2Field;
  const restoreReport = await restoreIterationAssignments(
    graphqlFn,
    input.projectId,
    input.fieldId,
    adjustedSnapshot,
    [
      ...(field.configuration.completedIterations ?? []),
      ...(field.configuration.iterations ?? []),
    ],
  );

  return { ...field, assignmentsRestored: restoreReport };
}

export async function assignIssueToIteration(
  graphqlFn: GraphQLFn,
  input: AssignIterationInput
) {
  const canLookUpItem =
    input.owner != null &&
    input.repo != null &&
    input.issueNumber != null &&
    input.projectNumber != null;

  if (!input.itemId && !canLookUpItem) {
    throw new Error(
      "Cannot identify the item: pass either itemId, or owner + repo + issueNumber + projectNumber."
    );
  }

  const canLookUpProject = input.owner != null && input.projectNumber != null;
  if (!input.projectId && !canLookUpProject) {
    throw new Error(
      "Cannot identify the project: pass either projectId, or owner + projectNumber."
    );
  }

  const itemId =
    input.itemId ??
    (await getProjectItemId(
      graphqlFn,
      input.owner!,
      input.repo!,
      input.issueNumber!,
      input.projectNumber!
    ));

  const projectId =
    input.projectId ??
    (await getProjectId(graphqlFn, input.owner!, input.projectNumber!));

  const result = await graphqlFn<any>(
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
      projectId,
      itemId,
      fieldId: input.fieldId,
      iterationId: input.iterationId,
    }
  );

  return result.updateProjectV2ItemFieldValue.projectV2Item;
}
