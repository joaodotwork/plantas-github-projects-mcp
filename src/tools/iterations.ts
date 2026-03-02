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
