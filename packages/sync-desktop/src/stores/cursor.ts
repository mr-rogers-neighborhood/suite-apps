import { decodeStoreText, encodeStoreText, SYNC_STORE_ROOT, type SyncStoreFiles } from "./port.js";

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

export function createCursorStore(files: SyncStoreFiles, workspaceId: string): CursorStore {
  const target = `${SYNC_STORE_ROOT}/cursors/${workspaceId}.json`;

  return {
    async load() {
      const bytes = await files.read(target);
      if (bytes === null) return null;
      try {
        const parsed = JSON.parse(decodeStoreText(bytes)) as StoredCursor;
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
      await files.write(
        target,
        encodeStoreText(`${JSON.stringify({ version: 1, index } satisfies StoredCursor)}\n`),
      );
    },

    async clear() {
      await files.remove(target);
    },
  };
}
