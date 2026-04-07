import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { refreshToken as octokitRefreshToken } from "@octokit/oauth-methods";
import type { AuthProvider, StoredCredentials } from "./types.js";
import { AuthenticationError } from "./types.js";
import { saveCredentials, clearCredentials } from "./token-store.js";

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
        clientType: "oauth-app",
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
   * Run the GitHub Device Flow to get a new token.
   */
  static async authenticate(
    clientId: string,
    clientSecret: string,
  ): Promise<DeviceFlowProvider> {
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("🔐 GitHub Authentication Required");
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("No valid token found. Initiating Device Flow...");

    const auth = createOAuthDeviceAuth({
      clientType: "oauth-app",
      clientId,
      scopes: ["read:project", "project", "repo"],
      onVerification(verification) {
        console.error("");
        console.error(`1. Open: ${verification.verification_uri}`);
        console.error(`2. Enter code: ${verification.user_code}`);
        console.error("");
        console.error("Waiting for authentication...");
      },
    });

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
  }
}
