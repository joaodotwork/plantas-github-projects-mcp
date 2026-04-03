import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { StoredCredentials } from "./types.js";

// We need to mock fs before importing the module
vi.mock("fs");
vi.mock("os");

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

// Stable mocks for key derivation
mockOs.hostname.mockReturnValue("test-host");
mockOs.userInfo.mockReturnValue({ username: "test-user" } as any);
mockOs.homedir.mockReturnValue("/home/test");

describe("token-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.hostname.mockReturnValue("test-host");
    mockOs.userInfo.mockReturnValue({ username: "test-user" } as any);
    mockOs.homedir.mockReturnValue("/home/test");
  });

  // We test via the actual crypto round-trip by using real fs operations
  // through a buffer capture approach
  describe("saveCredentials + loadCredentials round-trip", () => {
    it("encrypts and decrypts credentials correctly", async () => {
      let savedBuffer: Buffer | null = null;

      mockFs.existsSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.includes("credentials.enc")) {
          return savedBuffer !== null;
        }
        if (filePath.includes("config.json")) return false;
        // CONFIG_DIR
        return true;
      });

      mockFs.writeFileSync.mockImplementation((_path: any, data: any) => {
        savedBuffer = data as Buffer;
      });

      mockFs.readFileSync.mockImplementation(((p: any) => {
        if (savedBuffer) return savedBuffer;
        throw new Error("File not found");
      }) as any);

      mockFs.mkdirSync.mockReturnValue(undefined as any);

      // Import fresh to get the functions with mocked deps
      const { saveCredentials, loadCredentials } = await import(
        "./token-store.js"
      );

      const credentials: StoredCredentials = {
        token: "ghu_test_token_123",
        refreshToken: "ghr_refresh_456",
        expiresAt: "2026-04-04T00:00:00Z",
        refreshTokenExpiresAt: "2026-07-03T00:00:00Z",
        clientId: "Iv1.abc123",
      };

      saveCredentials(credentials);
      expect(savedBuffer).not.toBeNull();

      const loaded = loadCredentials();
      expect(loaded).toEqual(credentials);
    });

    it("returns null when no credentials file exists", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const { loadCredentials } = await import("./token-store.js");
      const result = loadCredentials();
      expect(result).toBeNull();
    });

    it("returns null on corrupted data", async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        return String(p).includes("credentials.enc");
      });
      mockFs.readFileSync.mockReturnValue(Buffer.from("corrupted-data"));

      const { loadCredentials } = await import("./token-store.js");
      const result = loadCredentials();
      expect(result).toBeNull();
    });
  });

  describe("legacy migration", () => {
    it("migrates plaintext config.json to encrypted storage", async () => {
      let savedBuffer: Buffer | null = null;
      let deletedFiles: string[] = [];

      mockFs.existsSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.includes("credentials.enc")) return false;
        if (filePath.includes("config.json")) return true;
        return true; // CONFIG_DIR
      });

      mockFs.readFileSync.mockImplementation(((p: any) => {
        const filePath = String(p);
        if (filePath.includes("config.json")) {
          return JSON.stringify({ token: "ghp_legacy_token" });
        }
        if (savedBuffer) return savedBuffer;
        throw new Error("not found");
      }) as any);

      mockFs.writeFileSync.mockImplementation((_path: any, data: any) => {
        savedBuffer = data as Buffer;
      });

      mockFs.unlinkSync.mockImplementation((p: any) => {
        deletedFiles.push(String(p));
      });

      mockFs.mkdirSync.mockReturnValue(undefined as any);

      const { loadCredentials } = await import("./token-store.js");
      const result = loadCredentials();

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_legacy_token");
      expect(result!.refreshToken).toBe("");
      expect(deletedFiles.some((f) => f.includes("config.json"))).toBe(true);
    });
  });
});
