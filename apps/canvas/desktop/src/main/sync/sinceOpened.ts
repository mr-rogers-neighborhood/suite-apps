import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SyncSinceOpened } from "../../shared/ipc.js";

/**
 * What sync did while this workspace was closed.
 *
 * The relay keeps ciphertext and the app keeps its document, so the only honest answer to
 * "what changed since I last opened this?" is a count of what arrived, when the last sync
 * finished, and the roster the host already reports — never a list of cards. The count is
 * written here rather than held in a variable because the question is about the *previous*
 * run: a number that starts at zero every launch cannot answer it.
 *
 * It is a session record, not a document version: it never travels in a frame, never names a
 * document, and the renderer only ever receives the three facts the dialog draws.
 */

/** A small, atomic record beside the cursor and the group. One per workspace. */
interface StoredSession {
  readonly version: 1;
  readonly workspaceId: string;
  /** ISO-8601: when Canvas opened this workspace in the run this record describes. */
  readonly openedAt: string;
  /**
   * ISO-8601 of the last time sync was confirmed with the host, or null when this device has
   * never synced. Carried forward on open, so the dialog can answer before connecting.
   */
  readonly lastSyncedAt: string | null;
  /** Document updates handed to the window during this run. Counts, never content. */
  readonly updates: number;
}

export interface SinceOpenedOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  /** Test seam: the clock a record is stamped with. */
  readonly now?: () => Date;
}

export interface SinceOpenedStore {
  /** The three facts the renderer draws: when, how many, and how long ago. */
  summary(): SyncSinceOpened;
  /** One document update from the host was handed to the page. */
  noteUpdate(): void;
  /** The host answered, so the last successful sync is now. */
  noteSynced(): void;
  /** Write anything still only in memory. Called on stop, and before a workspace switch. */
  flush(): Promise<void>;
}

/** A burst of frames is one write, not one per frame. */
const WRITE_DELAY_MS = 500;

export async function createSinceOpened(options: SinceOpenedOptions): Promise<SinceOpenedStore> {
  const directory = join(options.dataDir, "sync", "sessions");
  const target = join(directory, `${options.workspaceId}.json`);
  const now = options.now ?? (() => new Date());
  const openedAt = now().toISOString();

  /**
   * The previous run's last sync, which is what the dialog says before this one connects.
   *
   * A missing or unreadable record is not an error: it is a workspace that has not synced
   * here before, and "no sync yet" is a true answer.
   */
  let lastSyncedAt: string | null = null;
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as Partial<StoredSession>;
    if (
      parsed.version === 1 &&
      parsed.workspaceId === options.workspaceId &&
      typeof parsed.lastSyncedAt === "string"
    ) {
      lastSyncedAt = parsed.lastSyncedAt;
    }
  } catch {
    // Nothing applied here yet, or the file was lost with the rest of the data directory.
  }

  let updates = 0;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function write(): Promise<void> {
    const record: StoredSession = {
      version: 1,
      workspaceId: options.workspaceId,
      openedAt,
      lastSyncedAt,
      updates,
    };
    await mkdir(directory, { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }

  function schedule(): void {
    dirty = true;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      // A record that cannot be written must not take the sync service down with it: the
      // worst case is a dialog that says "no sync yet" after a crash.
      void write().catch(() => undefined);
    }, WRITE_DELAY_MS);
  }

  return {
    summary: () => ({ openedAt, updates, lastSyncedAt }),

    noteUpdate() {
      updates += 1;
      lastSyncedAt = now().toISOString();
      schedule();
    },

    noteSynced() {
      lastSyncedAt = now().toISOString();
      schedule();
    },

    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!dirty) return;
      dirty = false;
      await write().catch(() => undefined);
    },
  };
}
