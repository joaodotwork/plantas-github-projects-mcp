import { graphql } from "@octokit/graphql";

export type GraphQLFn = typeof graphql;

export interface UpdateItemStatusInput {
  projectId: string;
  itemId: string;
  status: string;
}

export interface UpdateItemStatusResult {
  success: boolean;
  message: string;
  itemId: string;
  statusFieldId: string;
  statusOptionId: string;
}

export async function updateItemStatus(
  gql: GraphQLFn,
  input: UpdateItemStatusInput
): Promise<UpdateItemStatusResult> {
  if (!input.status) {
    throw new Error(
      "Missing required parameter: 'status'. Provide a human-readable status value (e.g., 'Todo', 'In Progress', 'Done')."
    );
  }

  // Get project fields to find the Status field and its options
  const projectResult = await gql<any>(
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
  const updateResult = await gql<any>(
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
    success: true,
    message: `Status updated to '${statusOption.name}'`,
    itemId: updateResult.updateProjectV2ItemFieldValue.projectV2Item.id,
    statusFieldId: statusField.id,
    statusOptionId: statusOption.id,
  };
}
