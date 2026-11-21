import { rename, writeFile } from "node:fs/promises";

/**
 * The authoritative document in the main process.
 *
 * Planner and Budget write one Loro document to one file with the same mechanics: a debounced
 * save, a temp file renamed over the old one, a previous copy kept before the overwrite, and a
 * promise chain that lets a transient failure end without stopping later saves. The app supplies
 * the path, the serializer and its backup policy; the file format, directory and schema stay with
 * the app.
 */
export interface StoredDocument<Snapshot> {
  snapshot(): Uint8Array;
  applyUpdate(update: Uint8Array): void;
  getSnapshot(): Snapshot;
}

export interface MainDocumentStoreOptions<Doc extends StoredDocument<Snapshot>, Snapshot> {
  readonly doc: Doc;
  /** The file the store owns. */
  readonly path: string;
  /** Produces the exact bytes the app's file format defines for this document. */
  readonly serialize: (doc: Doc) => string;
  /** The temp file the rename replaces `path` with. Defaults to `${path}.tmp`. */
  readonly tempPath?: string;
  /** Runs before the temp file is written, for an app that creates the directory each save. */
  readonly prepareDirectory?: (path: string) => Promise<void>;
  /**
   * Keeps the previous copy. Planner copies the file to one rolling backup beside it; Budget keeps
   * its own previous/daily backups. The store calls this before the rename, so the copy is the
   * file that was there, never the one being written.
   */
  readonly backup?: (path: string) => Promise<void>;
  /**
   * Where the backup runs. Planner writes the temp file first and then copies the old file;
   * Budget copies first. Defaults to `"after-temp"`.
   */
  readonly backupOrder?: "before-temp" | "after-temp";
  /** Milliseconds an edit waits before it is written. Defaults to 400. */
  readonly debounceMs?: number;
  /** Logs a failed write. The app names its own document in the sentence. */
  readonly logWriteError?: (error: unknown) => void;
}

export class MainDocumentStore<Doc extends StoredDocument<Snapshot>, Snapshot> {
  readonly #serialize: (doc: Doc) => string;
  readonly #path: string;
  readonly #tempPath: string;
  readonly #prepareDirectory: ((path: string) => Promise<void>) | undefined;
  readonly #backup: ((path: string) => Promise<void>) | undefined;
  readonly #backupOrder: "before-temp" | "after-temp";
  readonly #debounceMs: number;
  readonly #logWriteError: ((error: unknown) => void) | undefined;
  #doc: Doc;
  #saveTimer: NodeJS.Timeout | null = null;
  #flushing: Promise<void> = Promise.resolve();
  #lastError: string | null = null;

  constructor(options: MainDocumentStoreOptions<Doc, Snapshot>) {
    this.#doc = options.doc;
    this.#path = options.path;
    this.#tempPath = options.tempPath ?? `${options.path}.tmp`;
    this.#serialize = options.serialize;
    this.#prepareDirectory = options.prepareDirectory;
    this.#backup = options.backup;
    this.#backupOrder = options.backupOrder ?? "after-temp";
    this.#debounceMs = options.debounceMs ?? 400;
    this.#logWriteError = options.logWriteError;
  }

  get document(): Doc {
    return this.#doc;
  }

  get path(): string {
    return this.#path;
  }

  /** The last write's message, or null after a successful write. */
  get lastError(): string | null {
    return this.#lastError;
  }

  snapshot(): Uint8Array {
    return this.#doc.snapshot();
  }

  getSnapshot(): Snapshot {
    return this.#doc.getSnapshot();
  }

  commit(update: Uint8Array): void {
    this.#doc.applyUpdate(update);
    this.scheduleSave();
  }

  /** Runs a main-process mutation and schedules the write that follows it. */
  mutate<T>(mutation: (doc: Doc) => T): T {
    const result = mutation(this.#doc);
    this.scheduleSave();
    return result;
  }

  scheduleSave(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.flush();
    }, this.#debounceMs);
  }

  flush(): Promise<void> {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    this.#flushing = this.#flushing
      .then(() => this.#writeCurrent())
      .catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error);
        // Keep the chain alive: a transient write failure must not stop every later save.
        this.#logWriteError?.(error);
      });
    return this.#flushing;
  }

  async exportTo(target: string): Promise<void> {
    await writeFile(target, this.#serialize(this.#doc), "utf8");
  }

  /** Flushes the last debounced save. Main calls this before a window or the app quits. */
  async close(): Promise<void> {
    await this.flush();
  }

  /** Swaps the authority after an import; the caller writes it with `flush`. */
  protected replaceDocument(doc: Doc): void {
    this.#doc = doc;
  }

  async #writeCurrent(): Promise<void> {
    const contents = this.#serialize(this.#doc);
    await this.#prepareDirectory?.(this.#path);
    if (this.#backupOrder === "before-temp") await this.#backup?.(this.#path);
    await writeFile(this.#tempPath, contents, "utf8");
    if (this.#backupOrder === "after-temp") await this.#backup?.(this.#path);
    await rename(this.#tempPath, this.#path);
    this.#lastError = null;
  }
}
