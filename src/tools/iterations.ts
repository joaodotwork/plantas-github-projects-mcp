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

export interface AssignIterationInput {
  owner: string;
  repo: string;
  projectNumber: number;
  issueNumber: number;
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

export async function createIterationField(
  graphqlFn: GraphQLFn,
  input: IterationInput
) {
  // Step 1: Create the iteration field
  const createResult = await graphqlFn<any>(
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
  const updateResult = await graphqlFn<any>(
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
            }
          }
        }
      }
    }
  `,
    {
      fieldId,
      duration: input.duration,
      startDate: input.startDate,
      iterations: input.iterations,
    }
  );

  return updateResult.updateProjectV2Field.projectV2Field;
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
  const itemId = await getProjectItemId(
    graphqlFn,
    input.owner,
    input.repo,
    input.issueNumber,
    input.projectNumber
  );

  const projectId = await getProjectId(graphqlFn, input.owner, input.projectNumber);

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
