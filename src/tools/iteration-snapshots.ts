import fs from "fs";
import os from "os";
import path from "path";
import type { IterationAssignment } from "./iterations.js";

/**
 * Where iteration snapshots land. Mirrors the credential store's location
 * (`src/auth/token-store.ts`) so the server keeps all its local state in one place.
 *
 * Resolved on call rather than at import: a module-level `os.homedir()` is fixed
 * for the life of the process and unreachable from a test that mocks `os`.
 */
export function snapshotDir(): string {
  return path.join(
    os.homedir(),
    ".config",
    "github-projects-mcp",
    "iteration-snapshots",
  );
}

/** Bumped only if the on-disk shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

export type IterationOperation = "add_iteration" | "update_iteration";

export interface IterationSnapshot {
  version: number;
  createdAt: string;
  operation: IterationOperation;
  projectId: string;
  fieldId: string;
  fieldName: string;
  /** Iterations as they were *before* the mutation, ids included. */
  iterationsBefore: Array<{
    id: string;
    title: string;
    startDate: string;
    duration: number;
  }>;
  /**
   * Assignments to restore, keyed by iteration title. Already remapped for a
   * rename, so this is directly replayable — no knowledge of the original call needed.
   */
  assignments: IterationAssignment[];
}

/** ISO 8601 minus the characters that are awkward in a filename. */
function fileTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Persist a snapshot before the destructive mutation runs, and return its path.
 *
 * This is the recovery net for #32: `updateProjectV2Field` detaches every item's
 * iteration value, and the restore that follows is one mutation per item. If the
 * process dies inside that window the assignments are unrecoverable from the API —
 * the old values are gone and the mutation already succeeded, so there is nothing
 * to retry against. Writing them down first is the only thing that makes the window
 * survivable.
 *
 * Failure to write is fatal on purpose. Proceeding without the file would enter
 * exactly the unrecoverable window this exists to close, and the caller cannot tell
 * the difference after the fact.
 */
export function writeIterationSnapshot(
  snapshot: Omit<IterationSnapshot, "version" | "createdAt">,
  now: Date = new Date(),
): string {
  const payload: IterationSnapshot = {
    version: SNAPSHOT_VERSION,
    createdAt: now.toISOString(),
    ...snapshot,
  };

  // projectId is a base64-ish node id (`PVT_kwHOAwJiCM4BNC20`); anything outside
  // this class would be a surprise, so replace rather than trust it.
  const safeProject = snapshot.projectId.replace(/[^A-Za-z0-9_-]/g, "_");
  const dir = snapshotDir();
  const file = path.join(dir, `${safeProject}-${fileTimestamp(now)}.json`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Refusing to mutate the iteration field: could not write the recovery ` +
        `snapshot to ${dir} (${reason}). The mutation detaches every ` +
        `item's iteration value, so without this file a mid-restore failure ` +
        `would lose them permanently.`,
    );
  }

  return file;
}

/** Read a snapshot back for replay. Validates enough to fail clearly, not exhaustively. */
export function readIterationSnapshot(file: string): IterationSnapshot {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read iteration snapshot ${file}: ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Iteration snapshot ${file} is not valid JSON`);
  }

  const snapshot = parsed as IterationSnapshot;
  if (snapshot?.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Iteration snapshot ${file} has version ${snapshot?.version}, expected ${SNAPSHOT_VERSION}`,
    );
  }
  if (!Array.isArray(snapshot.assignments)) {
    throw new Error(`Iteration snapshot ${file} has no assignments array`);
  }
  if (!snapshot.projectId || !snapshot.fieldId) {
    throw new Error(
      `Iteration snapshot ${file} is missing projectId or fieldId — cannot target a restore`,
    );
  }

  return snapshot;
}
