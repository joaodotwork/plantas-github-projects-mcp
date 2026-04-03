import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { StoredCredentials } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "github-projects-mcp");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.enc");
const LEGACY_CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SALT = "plantas-github-projects-mcp-v2";
const ALGORITHM = "aes-256-gcm";

function deriveKey(): Buffer {
  const material = `${os.hostname()}:${os.userInfo().username}`;
  return crypto.scryptSync(material, SALT, 32);
}

export function saveCredentials(credentials: StoredCredentials): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  fs.writeFileSync(CREDENTIALS_FILE, combined);
}

export function loadCredentials(): StoredCredentials | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return migrateLegacyConfig();
  }

  try {
    const data = fs.readFileSync(CREDENTIALS_FILE);
    const key = deriveKey();

    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf-8")) as StoredCredentials;
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Migrate from the old plaintext config.json format.
 * Returns null (no refresh token available in legacy format).
 */
function migrateLegacyConfig(): StoredCredentials | null {
  if (!fs.existsSync(LEGACY_CONFIG_FILE)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(LEGACY_CONFIG_FILE, "utf-8"));
    if (!config.token) return null;

    // Legacy tokens are PATs or OAuth tokens without refresh info.
    // We can't create full credentials, but we store what we have.
    // The caller should treat missing refreshToken as a PAT-like token.
    const credentials: StoredCredentials = {
      token: config.token,
      refreshToken: "",
      expiresAt: "",
      refreshTokenExpiresAt: "",
      clientId: "",
    };

    // Save encrypted and remove legacy file
    saveCredentials(credentials);
    fs.unlinkSync(LEGACY_CONFIG_FILE);
    console.error("✅ Migrated legacy token to encrypted storage.");

    return credentials;
  } catch {
    return null;
  }
}
