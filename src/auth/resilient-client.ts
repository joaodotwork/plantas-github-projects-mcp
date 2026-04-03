import { graphql } from "@octokit/graphql";
import type { AuthProvider } from "./types.js";
import { AuthenticationError } from "./types.js";

type GraphQLFn = typeof graphql;

function isAuthError(error: any): boolean {
  // Octokit GraphQL errors include status on HttpError
  if (error?.status === 401) return true;
  // Check message patterns
  const msg = error?.message?.toLowerCase() ?? "";
  return msg.includes("bad credentials") || msg.includes("unauthorized");
}

/**
 * Creates a GraphQL client that automatically retries on 401 by refreshing the token.
 * Conforms to the GraphQLFn type used by tool modules.
 */
export function createResilientGraphQL(provider: AuthProvider): GraphQLFn {
  const execute = async (query: string, parameters?: Record<string, any>) => {
    const token = await provider.getToken();
    const client = graphql.defaults({
      headers: { authorization: `token ${token}` },
    });

    try {
      return await client(query, parameters);
    } catch (error: any) {
      if (!isAuthError(error)) throw error;

      // Attempt refresh and retry once
      try {
        const newToken = await provider.refreshToken();
        const refreshedClient = graphql.defaults({
          headers: { authorization: `token ${newToken}` },
        });
        return await refreshedClient(query, parameters);
      } catch (refreshError: any) {
        if (refreshError instanceof AuthenticationError) throw refreshError;
        throw new AuthenticationError(
          `Authentication failed after token refresh. ${getRecoveryMessage(provider)}`,
          401,
        );
      }
    }
  };

  // GraphQLFn is a callable with .defaults() etc. We only need the callable part
  // since tool modules call it as gql(query, vars).
  return execute as unknown as GraphQLFn;
}

/**
 * Get the current token for REST API calls, with retry-on-failure support.
 * For the single REST call site (create_milestone), this is simpler than wrapping fetch.
 */
export async function getTokenWithRefresh(provider: AuthProvider): Promise<string> {
  return provider.getToken();
}

function getRecoveryMessage(provider: AuthProvider): string {
  if (provider.type === "pat") {
    return "Please set a new GITHUB_TOKEN environment variable and restart the server.";
  }
  return "Please restart the MCP server to re-authenticate.";
}
