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
    mutation($fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: [ProjectV2IterationFieldConfigurationIterationInput!]!) {
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

async function getIterationFieldConfig(
  graphqlFn: GraphQLFn,
  projectId: string,
  fieldId: string,
): Promise<{ duration: number; startDate: string; iterations: IterationConfig[] }> {
  const result = await graphqlFn<any>(
    `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "") {
            __typename
          }
          fields(first: 100) {
            nodes {
              ... on ProjectV2IterationField {
                id
                configuration {
                  duration
                  startDate
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

  return {
    duration: field.configuration.duration,
    startDate: field.configuration.startDate,
    iterations: [
      ...field.configuration.iterations,
      ...field.configuration.completedIterations,
    ],
  };
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

  const result = await graphqlFn<any>(
    `
    mutation($fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: [ProjectV2IterationFieldConfigurationIterationInput!]!) {
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
      fieldId: input.fieldId,
      duration: config.duration,
      startDate: config.startDate,
      iterations: allIterations,
    },
  );

  return result.updateProjectV2Field.projectV2Field;
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

  const allIterations = config.iterations.map((it) => {
    if (it.id === input.iterationId) {
      return {
        id: it.id,
        title: input.title ?? it.title,
        startDate: input.startDate ?? it.startDate,
        duration: input.duration ?? it.duration,
      };
    }
    return {
      id: it.id,
      title: it.title,
      startDate: it.startDate,
      duration: it.duration,
    };
  });

  const result = await graphqlFn<any>(
    `
    mutation($fieldId: ID!, $duration: Int!, $startDate: Date!, $iterations: [ProjectV2IterationFieldConfigurationIterationInput!]!) {
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
      fieldId: input.fieldId,
      duration: config.duration,
      startDate: config.startDate,
      iterations: allIterations,
    },
  );

  return result.updateProjectV2Field.projectV2Field;
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
