import { describe, it, expect, vi } from "vitest";
import { updateItemStatus, type GraphQLFn } from "./status.js";

function captureCall(mock: ReturnType<typeof vi.fn>, callIndex: number) {
  const call = mock.mock.calls[callIndex];
  return { query: call[0] as string, variables: call[1] as Record<string, unknown> };
}

const PROJECT_FIELDS_RESPONSE = {
  node: {
    fields: {
      nodes: [
        {
          id: "PVTSSF_status",
          name: "Status",
          dataType: "SINGLE_SELECT",
          options: [
            { id: "opt-todo", name: "Todo" },
            { id: "opt-progress", name: "In Progress" },
            { id: "opt-done", name: "Done" },
          ],
        },
      ],
    },
  },
};

describe("updateItemStatus", () => {
  it("throws when status param is missing", async () => {
    const gql = vi.fn() as unknown as GraphQLFn;

    await expect(
      updateItemStatus(gql, {
        projectId: "PVT_123",
        itemId: "PVTI_456",
        status: undefined as unknown as string,
      })
    ).rejects.toThrow("Missing required parameter: 'status'");

    expect(vi.mocked(gql)).not.toHaveBeenCalled();
  });

  it("throws when status param is empty string", async () => {
    const gql = vi.fn() as unknown as GraphQLFn;

    await expect(
      updateItemStatus(gql, {
        projectId: "PVT_123",
        itemId: "PVTI_456",
        status: "",
      })
    ).rejects.toThrow("Missing required parameter: 'status'");

    expect(vi.mocked(gql)).not.toHaveBeenCalled();
  });

  it("matches status case-insensitively", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce(PROJECT_FIELDS_RESPONSE)
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_456" } },
      }) as unknown as GraphQLFn;

    const result = await updateItemStatus(gql, {
      projectId: "PVT_123",
      itemId: "PVTI_456",
      status: "todo",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Status updated to 'Todo'");
    expect(result.statusOptionId).toBe("opt-todo");
  });

  it("throws when status value does not match any option", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce(PROJECT_FIELDS_RESPONSE) as unknown as GraphQLFn;

    await expect(
      updateItemStatus(gql, {
        projectId: "PVT_123",
        itemId: "PVTI_456",
        status: "Blocked",
      })
    ).rejects.toThrow("Status 'Blocked' not found. Available options: Todo, In Progress, Done");
  });

  it("throws when project has no Status field", async () => {
    const gql = vi.fn().mockResolvedValueOnce({
      node: {
        fields: {
          nodes: [{ id: "f1", name: "Priority", dataType: "TEXT" }],
        },
      },
    }) as unknown as GraphQLFn;

    await expect(
      updateItemStatus(gql, {
        projectId: "PVT_123",
        itemId: "PVTI_456",
        status: "Todo",
      })
    ).rejects.toThrow("No Status field found in project");
  });

  it("sends correct mutation variables", async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce(PROJECT_FIELDS_RESPONSE)
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_456" } },
      }) as unknown as GraphQLFn;

    await updateItemStatus(gql, {
      projectId: "PVT_123",
      itemId: "PVTI_456",
      status: "In Progress",
    });

    const { variables } = captureCall(vi.mocked(gql), 1);

    expect(variables).toEqual({
      projectId: "PVT_123",
      itemId: "PVTI_456",
      fieldId: "PVTSSF_status",
      value: { singleSelectOptionId: "opt-progress" },
    });
  });
});
