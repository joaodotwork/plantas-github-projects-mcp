import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeviceFlowProvider } from "./device-flow-provider.js";
import type { StoredCredentials } from "./types.js";
import { AuthenticationError } from "./types.js";

vi.mock("@octokit/oauth-methods", () => ({
  refreshToken: vi.fn(),
}));

vi.mock("./token-store.js", () => ({
  saveCredentials: vi.fn(),
  clearCredentials: vi.fn(),
}));

import { refreshToken as mockRefreshToken } from "@octokit/oauth-methods";
import { saveCredentials, clearCredentials } from "./token-store.js";

function makeCredentials(overrides?: Partial<StoredCredentials>): StoredCredentials {
  return {
    token: "ghu_original_token",
    refreshToken: "ghr_refresh_token",
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8h from now
    refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    clientId: "Iv1.test",
    ...overrides,
  };
}

describe("DeviceFlowProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getToken", () => {
    it("returns current token when not expired", async () => {
      const provider = new DeviceFlowProvider(
        makeCredentials(),
        "Iv1.test",
        "secret",
      );
      const token = await provider.getToken();
      expect(token).toBe("ghu_original_token");
    });

    it("refreshes token when expired", async () => {
      const expired = makeCredentials({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      vi.mocked(mockRefreshToken).mockResolvedValueOnce({
        authentication: {
          token: "ghu_new_token",
          refreshToken: "ghr_new_refresh",
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
      } as any);

      const provider = new DeviceFlowProvider(expired, "Iv1.test", "secret");
      const token = await provider.getToken();

      expect(token).toBe("ghu_new_token");
      expect(saveCredentials).toHaveBeenCalledOnce();
    });
  });

  describe("refreshToken", () => {
    it("calls octokit refreshToken with correct params", async () => {
      vi.mocked(mockRefreshToken).mockResolvedValueOnce({
        authentication: {
          token: "ghu_refreshed",
          refreshToken: "ghr_refreshed",
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
      } as any);

      const provider = new DeviceFlowProvider(
        makeCredentials(),
        "Iv1.test",
        "my-secret",
      );
      const token = await provider.refreshToken();

      expect(token).toBe("ghu_refreshed");
      expect(mockRefreshToken).toHaveBeenCalledWith({
        clientType: "oauth-app",
        clientId: "Iv1.test",
        clientSecret: "my-secret",
        refreshToken: "ghr_refresh_token",
      });
      expect(saveCredentials).toHaveBeenCalledOnce();
    });

    it("throws AuthenticationError on refresh failure", async () => {
      vi.mocked(mockRefreshToken).mockRejectedValueOnce(
        new Error("invalid_grant"),
      );

      const provider = new DeviceFlowProvider(
        makeCredentials(),
        "Iv1.test",
        "secret",
      );

      await expect(provider.refreshToken()).rejects.toThrow(AuthenticationError);
      expect(clearCredentials).toHaveBeenCalledOnce();
    });

    it("throws AuthenticationError when no refresh token available", async () => {
      const noRefresh = makeCredentials({ refreshToken: "" });
      const provider = new DeviceFlowProvider(noRefresh, "Iv1.test", "secret");

      await expect(provider.refreshToken()).rejects.toThrow(
        "No refresh token available",
      );
    });

    it("deduplicates concurrent refresh calls (mutex)", async () => {
      let resolveRefresh: (value: any) => void;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      vi.mocked(mockRefreshToken).mockImplementation(
        () => refreshPromise as any,
      );

      const provider = new DeviceFlowProvider(
        makeCredentials(),
        "Iv1.test",
        "secret",
      );

      // Fire two concurrent refreshes
      const p1 = provider.refreshToken();
      const p2 = provider.refreshToken();

      // Resolve the single underlying refresh
      resolveRefresh!({
        authentication: {
          token: "ghu_once",
          refreshToken: "ghr_once",
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const [t1, t2] = await Promise.all([p1, p2]);
      expect(t1).toBe("ghu_once");
      expect(t2).toBe("ghu_once");
      // Only one actual refresh call
      expect(mockRefreshToken).toHaveBeenCalledOnce();
    });
  });
});
