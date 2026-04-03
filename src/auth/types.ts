export interface AuthProvider {
  /** Get the current valid token */
  getToken(): Promise<string>;
  /** Attempt to refresh the token; returns new token or throws */
  refreshToken(): Promise<string>;
  /** Provider type for logging/error messages */
  readonly type: "pat" | "oauth-device";
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface StoredCredentials {
  token: string;
  refreshToken: string;
  expiresAt: string;
  refreshTokenExpiresAt: string;
  clientId: string;
}
