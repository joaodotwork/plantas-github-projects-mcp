import type { AuthProvider } from "./types.js";
import { PatProvider } from "./pat-provider.js";
import { DeviceFlowProvider } from "./device-flow-provider.js";
import { loadCredentials } from "./token-store.js";

export type { AuthProvider } from "./types.js";
export { AuthenticationError } from "./types.js";

/**
 * Resolve an AuthProvider using the fallback chain:
 * 1. GITHUB_TOKEN env var → PatProvider
 * 2. Stored encrypted credentials → DeviceFlowProvider
 * 3. Device Flow authentication → DeviceFlowProvider
 */
export async function resolveAuthProvider(): Promise<AuthProvider> {
  // 1. PAT from environment variable (highest priority)
  if (process.env.GITHUB_TOKEN) {
    return new PatProvider(process.env.GITHUB_TOKEN);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || "";

  // 2. Stored credentials
  const stored = loadCredentials();
  if (stored && stored.token) {
    // If stored credentials have refresh info, use DeviceFlowProvider
    if (stored.refreshToken) {
      return new DeviceFlowProvider(
        stored,
        stored.clientId || clientId || "",
        clientSecret,
      );
    }
    // Legacy stored token without refresh — treat as PAT
    return new PatProvider(stored.token);
  }

  // 3. Device Flow authentication
  if (!clientId) {
    throw new Error(
      "Missing configuration. Please set GITHUB_TOKEN or GITHUB_CLIENT_ID environment variable.\n" +
        "  - GITHUB_TOKEN: Personal access token (simplest)\n" +
        "  - GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET: GitHub App OAuth (recommended)",
    );
  }

  return DeviceFlowProvider.authenticate(clientId, clientSecret);
}
