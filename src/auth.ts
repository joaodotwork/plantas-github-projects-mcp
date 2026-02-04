import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "github-projects-mcp");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export async function getGitHubToken(): Promise<string> {
  // 1. Check environment variable
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // 2. Check stored token
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      if (config.token) {
        return config.token;
      }
    } catch (e) {
      // Ignore error, proceed to auth
    }
  }

  // 3. Initiate Device Flow
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Missing configuration. Please set GITHUB_TOKEN or GITHUB_CLIENT_ID environment variable."
    );
  }

  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("🔐 GitHub Authentication Required");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("No GITHUB_TOKEN found. Initiating Device Flow...");

  const auth = createOAuthDeviceAuth({
    clientType: "oauth-app",
    clientId: clientId,
    scopes: ["repo", "read:org", "project"],
    onVerification(verification) {
      console.error("");
      console.error(`1. Open: ${verification.verification_uri}`);
      console.error(`2. Enter code: ${verification.user_code}`);
      console.error("");
      console.error("Waiting for authentication...");
    },
  });

  const tokenAuthentication = await auth({
    type: "oauth",
  });

  // Save token
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ token: tokenAuthentication.token }, null, 2)
  );
  console.error("✅ Authentication successful! Token saved.");

  return tokenAuthentication.token;
}
