import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import {
  snapshotDir,
  SNAPSHOT_VERSION,
  writeIterationSnapshot,
  readIterationSnapshot,
} from "./iteration-snapshots.js";

vi.mock("fs");
vi.mock("os");

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

const PAYLOAD = {
  operation: "update_iteration" as const,
  projectId: "PVT_kwHOAwJiCM4BNC20",
  fieldId: "PVTIF_lADO",
  fieldName: "Sprint",
  iterationsBefore: [
    { id: "iter-1", title: "Sprint 1", startDate: "2026-01-01", duration: 7 },
  ],
  assignments: [
    { itemId: "item-1", label: "Issue #42", iterationTitle: "Sprint 1" },
  ],
};

const NOW = new Date("2026-08-28T12:34:56.789Z");

beforeEach(() => {
  // reset, not clear: clearAllMocks keeps implementations, so a mock set to
  // throw in one test leaks into every test after it.
  vi.resetAllMocks();
  mockOs.homedir.mockReturnValue("/home/test");
});

describe("writeIterationSnapshot", () => {
  it("writes under the same config dir as the credential store", () => {
    writeIterationSnapshot(PAYLOAD, NOW);
    const [file] = mockFs.writeFileSync.mock.calls[0];
    expect(String(file)).toContain("github-projects-mcp");
    expect(String(file)).toContain("iteration-snapshots");
  });

  it("creates the directory recursively before writing", () => {
    writeIterationSnapshot(PAYLOAD, NOW);
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(snapshotDir(), {
      recursive: true,
    });
    // Order matters: a write into a missing directory throws.
    expect(mockFs.mkdirSync.mock.invocationCallOrder[0]).toBeLessThan(
      mockFs.writeFileSync.mock.invocationCallOrder[0],
    );
  });

  it("names the file by project and timestamp, with no filename-hostile characters", () => {
    const file = writeIterationSnapshot(PAYLOAD, NOW);
    const base = file.split("/").pop()!;
    expect(base).toBe("PVT_kwHOAwJiCM4BNC20-2026-08-28T12-34-56-789Z.json");
    // Colons and dots break paths on some platforms and confuse shells everywhere.
    expect(base.slice(0, -".json".length)).not.toMatch(/[:.]/);
  });

  it("sanitises a project id that is not a plain node id", () => {
    const file = writeIterationSnapshot(
      { ...PAYLOAD, projectId: "../../etc/passwd" },
      NOW,
    );
    const base = file.split("/").pop()!;
    expect(base).not.toContain("/");
    expect(base).not.toContain("..");
    expect(base.startsWith("______etc_passwd-")).toBe(true);
  });

  it("returns the path it wrote", () => {
    const returned = writeIterationSnapshot(PAYLOAD, NOW);
    expect(returned).toBe(String(mockFs.writeFileSync.mock.calls[0][0]));
  });

  it("stamps version and createdAt onto the payload", () => {
    writeIterationSnapshot(PAYLOAD, NOW);
    const written = JSON.parse(
      String(mockFs.writeFileSync.mock.calls[0][1]),
    );
    expect(written.version).toBe(SNAPSHOT_VERSION);
    expect(written.createdAt).toBe("2026-08-28T12:34:56.789Z");
  });

  it("round-trips the assignments and the pre-mutation iterations", () => {
    writeIterationSnapshot(PAYLOAD, NOW);
    const written = JSON.parse(
      String(mockFs.writeFileSync.mock.calls[0][1]),
    );
    expect(written.assignments).toEqual(PAYLOAD.assignments);
    expect(written.iterationsBefore).toEqual(PAYLOAD.iterationsBefore);
    expect(written.fieldId).toBe(PAYLOAD.fieldId);
    expect(written.operation).toBe("update_iteration");
  });

  it("throws an error naming the directory when the write fails", () => {
    mockFs.writeFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(() => writeIterationSnapshot(PAYLOAD, NOW)).toThrow(
      /EACCES: permission denied/,
    );
    expect(() => writeIterationSnapshot(PAYLOAD, NOW)).toThrow(snapshotDir());
  });

  it("explains why the failure blocks the mutation", () => {
    mockFs.mkdirSync.mockImplementation(() => {
      throw new Error("EROFS");
    });
    expect(() => writeIterationSnapshot(PAYLOAD, NOW)).toThrow(
      /Refusing to mutate/i,
    );
  });
});

describe("readIterationSnapshot", () => {
  function onDisk(contents: unknown) {
    mockFs.readFileSync.mockReturnValue(
      typeof contents === "string" ? contents : JSON.stringify(contents),
    );
  }

  const VALID = {
    version: SNAPSHOT_VERSION,
    createdAt: NOW.toISOString(),
    ...PAYLOAD,
  };

  it("parses a snapshot written by writeIterationSnapshot", () => {
    writeIterationSnapshot(PAYLOAD, NOW);
    onDisk(String(mockFs.writeFileSync.mock.calls[0][1]));

    const snapshot = readIterationSnapshot("/snap/s.json");
    expect(snapshot.assignments).toEqual(PAYLOAD.assignments);
    expect(snapshot.projectId).toBe(PAYLOAD.projectId);
  });

  it("names the file when it cannot be read", () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });
    expect(() => readIterationSnapshot("/snap/gone.json")).toThrow(
      /\/snap\/gone\.json/,
    );
    expect(() => readIterationSnapshot("/snap/gone.json")).toThrow(/ENOENT/);
  });

  it("rejects malformed JSON rather than returning a partial snapshot", () => {
    onDisk("{ not json");
    expect(() => readIterationSnapshot("/snap/s.json")).toThrow(
      /not valid JSON/,
    );
  });

  it("rejects an unknown snapshot version", () => {
    onDisk({ ...VALID, version: 99 });
    expect(() => readIterationSnapshot("/snap/s.json")).toThrow(
      /version 99, expected 1/,
    );
  });

  it("rejects a snapshot with no assignments array", () => {
    onDisk({ ...VALID, assignments: undefined });
    expect(() => readIterationSnapshot("/snap/s.json")).toThrow(
      /no assignments array/,
    );
  });

  it("rejects a snapshot that cannot target a restore", () => {
    onDisk({ ...VALID, fieldId: "" });
    expect(() => readIterationSnapshot("/snap/s.json")).toThrow(
      /missing projectId or fieldId/,
    );
  });

  it("accepts an empty assignment list — a board with nothing assigned is valid", () => {
    onDisk({ ...VALID, assignments: [] });
    expect(readIterationSnapshot("/snap/s.json").assignments).toEqual([]);
  });
});
