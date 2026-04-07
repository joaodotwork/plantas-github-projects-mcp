import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { refreshToken as octokitRefreshToken } from "@octokit/oauth-methods";
import type { AuthProvider, StoredCredentials } from "./types.js";
import { AuthenticationError } from "./types.js";
import { saveCredentials, clearCredentials } from "./token-store.js";

/**
 * Thrown when device flow auth has been initiated but the user hasn't
 * completed browser authorization yet. Contains the verification URL
 * and user code so the caller can surface them to the user.
 */
export class DeviceFlowPendingError extends Error {
  constructor(
    public readonly verificationUri: string,
    public readonly userCode: string,
  ) {
    super("Device flow authentication pending — waiting for browser authorization.");
    this.name = "DeviceFlowPendingError";
  }
}

export class DeviceFlowProvider implements AuthProvider {
  readonly type = "oauth-device" as const;
  private credentials: StoredCredentials;
  private clientId: string;
  private clientSecret: string;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    credentials: StoredCredentials,
    clientId: string,
    clientSecret: string,
  ) {
    this.credentials = credentials;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getToken(): Promise<string> {
    // If token has expired, proactively refresh
    if (this.credentials.expiresAt && this.isExpired()) {
      return this.refreshToken();
    }
    return this.credentials.token;
  }

  async refreshToken(): Promise<string> {
    // Mutex: if a refresh is already in flight, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<string> {
    if (!this.credentials.refreshToken) {
      throw new AuthenticationError(
        "No refresh token available. Please re-authenticate.",
        401,
        false,
      );
    }

    try {
      const response = await octokitRefreshToken({
        clientType: "github-app",
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        refreshToken: this.credentials.refreshToken,
      });

      const { authentication } = response;

      this.credentials = {
        token: authentication.token,
        refreshToken: authentication.refreshToken,
        expiresAt: authentication.expiresAt,
        refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
        clientId: this.clientId,
      };

      saveCredentials(this.credentials);
      console.error("🔄 Token refreshed successfully.");

      return this.credentials.token;
    } catch (error: any) {
      clearCredentials();
      throw new AuthenticationError(
        `Token refresh failed: ${error.message}. Please re-authenticate.`,
        401,
        false,
      );
    }
  }

  private isExpired(): boolean {
    if (!this.credentials.expiresAt) return false;
    // Refresh 5 minutes before expiry to avoid edge cases
    const expiresAt = new Date(this.credentials.expiresAt).getTime();
    return Date.now() > expiresAt - 5 * 60 * 1000;
  }

  /**
   * Pending device flow promise — shared across calls so multiple tool
   * invocations don't start separate device flows.
   */
  private static pendingAuth: Promise<DeviceFlowProvider> | null = null;

  /**
   * Kick off the GitHub Device Flow and return immediately with a
   * DeviceFlowPendingError containing the verification URL and user code.
   *
   * The polling continues in the background. Subsequent calls to
   * `authenticate()` await the same promise — if the user has completed
   * browser auth, the promise resolves immediately.
   */
  static async authenticate(
    clientId: string,
    clientSecret: string,
  ): Promise<DeviceFlowProvider> {
    // If a device flow is already in flight, check if it has resolved
    if (DeviceFlowProvider.pendingAuth) {
      return DeviceFlowProvider.pendingAuth;
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("🔐 GitHub Authentication Required");
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("No valid token found. Initiating Device Flow...");

    // Use a promise to wait for the onVerification callback, which fires
    // after the initial HTTP request to GitHub returns the device code.
    let resolveVerification: (v: { uri: string; code: string }) => void;
    const verificationReady = new Promise<{ uri: string; code: string }>(
      (resolve) => { resolveVerification = resolve; },
    );

    const auth = createOAuthDeviceAuth({
      clientType: "oauth-app",
      clientId,
      scopes: ["read:project", "project", "repo"],
      onVerification(verification) {
        resolveVerification({
          uri: verification.verification_uri,
          code: verification.user_code,
        });
        console.error("");
        console.error(`1. Open: ${verification.verification_uri}`);
        console.error(`2. Enter code: ${verification.user_code}`);
        console.error("");
        console.error("Waiting for authentication...");
      },
    });

    // Start polling in the background — do NOT await here
    DeviceFlowProvider.pendingAuth = (async () => {
      try {
        const tokenAuth = await auth({ type: "oauth" });

        const credentials: StoredCredentials = {
          token: tokenAuth.token,
          refreshToken: (tokenAuth as any).refreshToken ?? "",
          expiresAt: (tokenAuth as any).expiresAt ?? "",
          refreshTokenExpiresAt: (tokenAuth as any).refreshTokenExpiresAt ?? "",
          clientId,
        };

        saveCredentials(credentials);
        console.error("✅ Authentication successful! Token saved.");

        return new DeviceFlowProvider(credentials, clientId, clientSecret);
      } catch (error) {
        // Reset so the next call can start a fresh flow
        DeviceFlowProvider.pendingAuth = null;
        throw error;
      }
    })();

    // Wait for the onVerification callback to fire with the URL and code
    const verification = await verificationReady;

    // Throw with the URL/code so the tool handler can surface them
    throw new DeviceFlowPendingError(verification.uri, verification.code);
  }

  /**
   * Reset any in-flight device flow (for testing).
   */
  static resetPendingAuth(): void {
    DeviceFlowProvider.pendingAuth = null;
  }
}
