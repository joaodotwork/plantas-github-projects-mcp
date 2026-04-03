import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthProvider } from "./types.js";
import { AuthenticationError } from "./types.js";

// Mock @octokit/graphql
vi.mock("@octokit/graphql", () => {
  const mockClient = vi.fn();
  const mockDefaults = vi.fn(() => mockClient);
  const graphql = Object.assign(vi.fn(), { defaults: mockDefaults });
  return { graphql };
});

import { graphql } from "@octokit/graphql";

function createMockProvider(overrides?: Partial<AuthProvider>): AuthProvider {
  return {
    type: "oauth-device",
    getToken: vi.fn().mockResolvedValue("token-1"),
    refreshToken: vi.fn().mockResolvedValue("token-2"),
    ...overrides,
  };
}

describe("createResilientGraphQL", () => {
  let mockClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = vi.fn();
    vi.mocked(graphql.defaults).mockReturnValue(mockClient as any);
  });

  it("executes query with current token on success", async () => {
    mockClient.mockResolvedValueOnce({ viewer: { login: "test" } });

    // Import fresh
    const { createResilientGraphQL } = await import("./resilient-client.js");
    const provider = createMockProvider();
    const gql = createResilientGraphQL(provider);

    const result = await gql("query { viewer { login } }");

    expect(result).toEqual({ viewer: { login: "test" } });
    expect(provider.getToken).toHaveBeenCalledOnce();
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  it("retries once on 401 with refreshed token", async () => {
    const error401 = Object.assign(new Error("Bad credentials"), {
      status: 401,
    });
    // First call fails with 401
    mockClient
      .mockRejectedValueOnce(error401)
      .mockResolvedValueOnce({ viewer: { login: "refreshed" } });

    const { createResilientGraphQL } = await import("./resilient-client.js");
    const provider = createMockProvider();
    const gql = createResilientGraphQL(provider);

    const result = await gql("query { viewer { login } }");

    expect(result).toEqual({ viewer: { login: "refreshed" } });
    expect(provider.refreshToken).toHaveBeenCalledOnce();
  });

  it("throws AuthenticationError when retry also fails", async () => {
    const error401 = Object.assign(new Error("Bad credentials"), {
      status: 401,
    });
    mockClient.mockRejectedValue(error401);

    const { createResilientGraphQL } = await import("./resilient-client.js");
    const provider = createMockProvider({
      refreshToken: vi.fn().mockRejectedValue(new Error("refresh failed")),
    });
    const gql = createResilientGraphQL(provider);

    await expect(gql("query { viewer { login } }")).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("does not retry on non-auth errors", async () => {
    const error500 = Object.assign(new Error("Server error"), { status: 500 });
    mockClient.mockRejectedValueOnce(error500);

    const { createResilientGraphQL } = await import("./resilient-client.js");
    const provider = createMockProvider();
    const gql = createResilientGraphQL(provider);

    await expect(gql("query { viewer { login } }")).rejects.toThrow(
      "Server error",
    );
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  it("propagates AuthenticationError from provider.refreshToken", async () => {
    const error401 = Object.assign(new Error("Bad credentials"), {
      status: 401,
    });
    mockClient.mockRejectedValueOnce(error401);

    const authError = new AuthenticationError("PAT cannot be refreshed", 401);

    const { createResilientGraphQL } = await import("./resilient-client.js");
    const provider = createMockProvider({
      refreshToken: vi.fn().mockRejectedValue(authError),
    });
    const gql = createResilientGraphQL(provider);

    await expect(gql("query { viewer { login } }")).rejects.toThrow(
      "PAT cannot be refreshed",
    );
  });
});
