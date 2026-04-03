import type { AuthProvider } from "./types.js";
import { AuthenticationError } from "./types.js";

export class PatProvider implements AuthProvider {
  readonly type = "pat" as const;
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async getToken(): Promise<string> {
    return this.token;
  }

  async refreshToken(): Promise<string> {
    throw new AuthenticationError(
      "Personal access tokens cannot be refreshed. " +
        "Please set a new GITHUB_TOKEN environment variable.",
      401,
      false,
    );
  }
}
