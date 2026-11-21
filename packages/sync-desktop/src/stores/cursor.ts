import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SyncStorePaths } from "./relayConfig.js";

/**
 * How far this device has caught up, as the relay numbered it.
 *
 * A relay assigns each stored frame a position and hands frames out in that order. The
 * position is the only thing a catch-up request can mean: a count of frames held in this
 * process starts at zero on every launch, drifts when a frame is replayed, and says nothing
 * after the relay has dropped what came before it.
 *
 * So the last applied position is written here, beside the group state, and a reconnect asks
 * for the frames after it. This is a cursor, not a document version: it names an offset in the
 * relay's log and never travels inside a frame.
 *
 * A workspace that has never applied a frame has no cursor, which is distinct from a cursor of
 * `0`: the first means "ask from the start", the second means "frame 0 is already applied".
 * A missing file is not an error.
 */
interface StoredCursor {
  readonly version: 1;
  /** The index of the last frame applied, as the relay numbered it. */
  readonly index: number;
}

export interface CursorStore {
  load(): Promise<number | null>;
  save(index: number): Promise<void>;
  /** Drop a cursor, for a workspace this device is no longer part of. */
  clear(): Promise<void>;
}

export function createCursorStore({ dataDir, workspaceId }: SyncStorePaths): CursorStore {
  const directory = join(dataDir, "sync", "cursors");
  const target = join(directory, `${workspaceId}.json`);

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(target, "utf8")) as StoredCursor;
        if (
          typeof parsed.index !== "number" ||
          !Number.isInteger(parsed.index) ||
          parsed.index < 0
        ) {
          return null;
        }
        return parsed.index;
      } catch {
        return null;
      }
    },

    async save(index) {
      if (!Number.isInteger(index) || index < 0) return;
      await mkdir(directory, { recursive: true });
      const temporary = `${target}.tmp`;
      // A cursor is small and its loss only costs a replayed frame, so a rename after every
      // applied frame is cheap enough to keep it exact.
      await writeFile(
        temporary,
        `${JSON.stringify({ version: 1, index } satisfies StoredCursor)}\n`,
        { mode: 0o600 },
      );
      await rename(temporary, target);
    },

    async clear() {
      await rm(target, { force: true });
    },
  };
}
