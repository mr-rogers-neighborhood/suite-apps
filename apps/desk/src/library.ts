import { watch as fsWatch } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DocumentStore } from "./documents.js";
import { isSafeDocumentId } from "./documents.js";
import { isSafePackId } from "./packs.js";
import type { DocumentSummary } from "./shared.js";

/**
 * The host's side of a pack's library: where a document lives, and when it
 * changed.
 *
 * A pack cannot open a file manager and cannot watch a directory, so the host
 * does both. Neither answer carries a path: reveal spends an absolute path
 * inside the main process, and a change is a list of document ids. Nothing is
 * delivered while the pack is closed; the host keeps a fingerprint of each
 * document it last saw, so `pendingChanges` is what a pack reads when it starts.
 * The pack never polls.
 */

/** A pack's own document scope. Derived by the host, never supplied by the pack. */
export interface LibraryScope {
  readonly containerId: string;
  readonly publisherId: string;
  readonly packId: string;
}

/**
 * Show one document in the host's file manager.
 *
 * The pack names a document it already owns; the host resolves the device copy
 * and calls `reveal` with the absolute path. The callback lives in the main
 * process, so the path is spent there and the pack receives only the summary.
 */
export async function revealDocument(
  store: DocumentStore,
  scope: { readonly containerId: string; readonly packId: string },
  id: string,
  reveal: (path: string) => void,
): Promise<DocumentSummary | null> {
  const located = await store.locate(scope.containerId, scope.packId, id);
  if (located === null) return null;
  reveal(located.path);
  return located.summary;
}

/** Start a directory watcher. Returns the function that stops it. */
export type DirectoryWatch = (directory: string, onChange: () => void) => () => void;

/**
 * `node:fs` is the binding; tests inject their own so a change is deterministic.
 *
 * A watcher reports that *something* happened in the directory. The host never
 * trusts the event's name: it re-reads its own list and compares fingerprints,
 * so a coalesced event or a temp file cannot be mistaken for a document.
 */
export const watchDirectory: DirectoryWatch = (directory, onChange) => {
  const watcher = fsWatch(directory, { persistent: false }, () => onChange());
  watcher.on("error", () => {
    // A directory can vanish while watched. The next scan is the truth, and a
    // closed watcher is not a reason to fail the pack.
  });
  return () => watcher.close();
};

/** What the host last saw of one document. */
interface Fingerprint {
  readonly updatedAt: number;
  readonly size: number;
}

interface LibraryData {
  readonly version: 1;
  /** Keyed by scope; a document id maps to the last fingerprint the host saw. */
  readonly packs: Readonly<Record<string, Readonly<Record<string, Fingerprint>>>>;
}

export const LIBRARY_VERSION = 1;
const MAX_DOCUMENTS_PER_PACK = 10_000;

function emptyData(): LibraryData {
  return { version: LIBRARY_VERSION, packs: {} };
}

function isFingerprint(value: unknown): value is Fingerprint {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    record.updatedAt >= 0 &&
    typeof record.size === "number" &&
    Number.isInteger(record.size) &&
    record.size >= 0
  );
}

function parseData(value: unknown): LibraryData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the library record is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== LIBRARY_VERSION) {
    throw new Error(`the library record is at version ${String(record.version)}`);
  }
  if (typeof record.packs !== "object" || record.packs === null) {
    throw new Error("the library record has no packs");
  }

  const packs: Record<string, Record<string, Fingerprint>> = {};
  for (const [key, raw] of Object.entries(record.packs)) {
    if (typeof raw !== "object" || raw === null) continue;
    const documents: Record<string, Fingerprint> = {};
    let count = 0;
    for (const [id, value] of Object.entries(raw)) {
      if (count >= MAX_DOCUMENTS_PER_PACK) break;
      if (!isSafeDocumentId(id) || !isFingerprint(value)) continue;
      documents[id] = { updatedAt: value.updatedAt, size: value.size };
      count += 1;
    }
    packs[key] = documents;
  }
  return { version: LIBRARY_VERSION, packs };
}

function scopeKey(scope: LibraryScope): string {
  if (!isSafePackId(scope.packId) || scope.publisherId.length === 0) {
    throw new Error("invalid library scope");
  }
  return `${scope.containerId}:${scope.publisherId}:${scope.packId}`;
}

function fingerprints(summaries: readonly DocumentSummary[]): Record<string, Fingerprint> {
  const state: Record<string, Fingerprint> = {};
  for (const summary of summaries.slice(0, MAX_DOCUMENTS_PER_PACK)) {
    state[summary.id] = { updatedAt: summary.updatedAt, size: summary.size };
  }
  return state;
}

interface Subscription {
  readonly notify: (documentIds: readonly string[]) => void;
}

interface WatchEntry {
  readonly scope: LibraryScope;
  readonly store: DocumentStore;
  readonly close: () => void;
  readonly tabs: Map<string, Subscription>;
}

/**
 * The seen fingerprints and the live watchers.
 *
 * The fingerprint file outlives the host: a change made while the host was off
 * is still a change when the pack next starts. The watchers do not: they exist
 * only while a tab of that pack is open, so nothing is delivered to a closed
 * pack.
 */
export class LibraryWatch {
  readonly #file: string;
  readonly #watch: DirectoryWatch;
  #data: LibraryData;
  #watchers = new Map<string, WatchEntry>();
  #queue: Promise<unknown> = Promise.resolve();
  #writing: Promise<void> = Promise.resolve();

  private constructor(file: string, data: LibraryData, watch: DirectoryWatch) {
    this.#file = file;
    this.#data = data;
    this.#watch = watch;
  }

  static async open(
    file: string,
    options: { readonly watch?: DirectoryWatch } = {},
  ): Promise<LibraryWatch> {
    let parsed: LibraryData | null = null;
    try {
      parsed = parseData(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
        console.warn("[desk] the library record could not be read; starting empty", error);
      }
    }
    return new LibraryWatch(file, parsed ?? emptyData(), options.watch ?? watchDirectory);
  }

  /** The pack's documents that changed since the host last saw them. */
  async pending(store: DocumentStore, scope: LibraryScope): Promise<readonly string[]> {
    return this.#serialise(() => this.#diff(store, scope));
  }

  /**
   * Record what the pack has just seen.
   *
   * Called after an open, create or save through the host. A save by the pack is
   * not an external change, so marking it seen keeps the next `pendingChanges`
   * honest. The first write for a pack also records the documents already on
   * disk as the baseline, so an old document is never reported as "changed" the
   * first time a pack opens only one of them.
   */
  async markSeen(
    store: DocumentStore,
    scope: LibraryScope,
    summaries: readonly Pick<DocumentSummary, "id" | "size" | "updatedAt">[],
  ): Promise<void> {
    await this.#serialise(async () => {
      const key = scopeKey(scope);
      const existing = this.#data.packs[key];
      const documents =
        existing === undefined
          ? fingerprints(await store.list(scope.containerId, scope.packId))
          : { ...existing };
      for (const summary of summaries) {
        if (!isSafeDocumentId(summary.id)) continue;
        documents[summary.id] = { updatedAt: summary.updatedAt, size: summary.size };
      }
      this.#data = {
        ...this.#data,
        packs: { ...this.#data.packs, [key]: documents },
      };
      await this.#persist();
    });
  }

  /** A removed document is not a pending change later. */
  async forget(scope: LibraryScope, documentId: string): Promise<void> {
    await this.#serialise(async () => {
      const key = scopeKey(scope);
      const existing = this.#data.packs[key];
      if (existing === undefined || existing[documentId] === undefined) return;
      const documents = { ...existing };
      delete documents[documentId];
      this.#data = { ...this.#data, packs: { ...this.#data.packs, [key]: documents } };
      await this.#persist();
    });
  }

  /** Watch this pack while one of its tabs is open. Two tabs share one watcher. */
  async subscribe(
    store: DocumentStore,
    scope: LibraryScope,
    tabId: string,
    notify: (documentIds: readonly string[]) => void,
  ): Promise<void> {
    const key = scopeKey(scope);
    let entry = this.#watchers.get(key);
    if (entry === undefined) {
      const directory = store.directoryFor(scope.containerId, scope.packId);
      await mkdir(directory, { recursive: true });
      const tabs = new Map<string, Subscription>();
      const close = this.#watch(directory, () => {
        void this.check(store, scope).catch((error: unknown) => {
          console.warn("[desk] a document change could not be checked", error);
        });
      });
      entry = { scope, store, close, tabs };
      this.#watchers.set(key, entry);
    }
    entry.tabs.set(tabId, { notify });
  }

  /** Called when a view is destroyed. The watcher closes with the last tab. */
  unsubscribe(tabId: string): void {
    for (const [key, entry] of this.#watchers) {
      if (!entry.tabs.delete(tabId)) continue;
      if (entry.tabs.size === 0) {
        entry.close();
        this.#watchers.delete(key);
      }
    }
  }

  /**
   * Re-read the directory, record what changed as seen and notify the open tabs.
   *
   * Public so a test can drive the same path a filesystem event drives. Returns
   * the changed ids, which is also what the tabs received.
   */
  async check(store: DocumentStore, scope: LibraryScope): Promise<readonly string[]> {
    return this.#serialise(async () => {
      const changed = await this.#diff(store, scope);
      if (changed.length === 0) return [];
      const current = await store.list(scope.containerId, scope.packId);
      this.#data = {
        ...this.#data,
        packs: { ...this.#data.packs, [scopeKey(scope)]: fingerprints(current) },
      };
      await this.#persist();
      const entry = this.#watchers.get(scopeKey(scope));
      if (entry !== undefined) {
        for (const subscription of entry.tabs.values()) subscription.notify(changed);
      }
      return changed;
    });
  }

  /** Await every queued scan. Tests use it; the host does not need it. */
  async settle(): Promise<void> {
    await this.#queue.catch(() => undefined);
    await this.#writing.catch(() => undefined);
  }

  async #diff(store: DocumentStore, scope: LibraryScope): Promise<readonly string[]> {
    const key = scopeKey(scope);
    const seen = this.#data.packs[key];
    const current = await store.list(scope.containerId, scope.packId);

    // The first look at a pack is the baseline. The pack never had a view of
    // these documents, so none of them is a change.
    if (seen === undefined) {
      this.#data = {
        ...this.#data,
        packs: { ...this.#data.packs, [key]: fingerprints(current) },
      };
      await this.#persist();
      return [];
    }

    const changed: string[] = [];
    const present = new Set<string>();
    for (const summary of current) {
      present.add(summary.id);
      const previous = seen[summary.id];
      if (
        previous === undefined ||
        previous.updatedAt !== summary.updatedAt ||
        previous.size !== summary.size
      ) {
        changed.push(summary.id);
      }
    }
    for (const id of Object.keys(seen)) {
      if (!present.has(id)) changed.push(id);
    }
    return changed.sort((left, right) => left.localeCompare(right));
  }

  #serialise<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #persist(): Promise<void> {
    const contents = `${JSON.stringify(this.#data, null, 2)}\n`;
    const write = this.#writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#file), { recursive: true });
        const temporary = `${this.#file}.tmp-${process.pid}`;
        await writeFile(temporary, contents, "utf8");
        await rename(temporary, this.#file);
      });
    this.#writing = write.catch(() => undefined);
    return write;
  }
}
