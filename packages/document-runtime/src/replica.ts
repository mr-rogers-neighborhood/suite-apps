/**
 * The renderer's replica of one document.
 *
 * Planner and Budget both keep a Loro document in main and a live copy in the renderer. The copy
 * merges edits locally, forwards each CRDT delta to main, and exposes a rebuilt snapshot for
 * `useSyncExternalStore`. This class owns that single `observe` call site; the app supplies the
 * document, the factory that rebuilds it after a replacement, and the bridge call.
 *
 * The peer-id-on-load rule stays with the document factory: `WorkspaceDocument.fromSnapshot` and
 * `BudgetDocument.fromSnapshot` each set a fresh peer id, and moving that here would make a
 * document's own identity depend on the replica that happens to load it.
 */

/** The part of a document the replica reads, observed and snapshotted. */
export interface ObservableDocument<Snapshot> {
  getSnapshot(): Snapshot;
  observe(listener: (update: Uint8Array) => void): () => void;
}

export interface DocumentReplicaOptions<Doc extends ObservableDocument<Snapshot>, Snapshot> {
  readonly doc: Doc;
  /**
   * Rebuilds a document from the bytes main sends after an import or a sync frame. The app passes
   * its own factory so the schema, validation and peer-id rule stay with that app's document.
   */
  readonly load: (snapshot: Uint8Array) => Doc;
  /** Forwards one local CRDT update to the authority. */
  readonly commit: (update: Uint8Array) => Promise<void>;
  /** The sentence prefix a failed commit logs, e.g. `"Suite Planner"`. */
  readonly errorLabel?: string;
}

export class DocumentReplica<Doc extends ObservableDocument<Snapshot>, Snapshot> {
  #doc: Doc;
  readonly #load: (snapshot: Uint8Array) => Doc;
  readonly #commit: (update: Uint8Array) => Promise<void>;
  readonly #errorLabel: string;
  #snapshot: Snapshot;
  #listeners = new Set<() => void>();
  #detach: () => void;

  constructor(options: DocumentReplicaOptions<Doc, Snapshot>) {
    this.#doc = options.doc;
    this.#load = options.load;
    this.#commit = options.commit;
    this.#errorLabel = options.errorLabel ?? "Suite document";
    this.#snapshot = options.doc.getSnapshot();
    this.#detach = this.watch();
  }

  get document(): Doc {
    return this.#doc;
  }

  getSnapshot = (): Snapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  refresh(): void {
    this.#snapshot = this.#doc.getSnapshot();
    for (const listener of this.#listeners) listener();
  }

  replace(snapshot: Uint8Array): void {
    this.#detach();
    this.#doc = this.#load(snapshot);
    this.#detach = this.watch();
    this.refresh();
  }

  dispose(): void {
    this.#detach();
    this.#listeners.clear();
  }

  private watch(): () => void {
    return this.#doc.observe((update) => {
      void this.#commit(update).catch((error: unknown) =>
        console.error(`${this.#errorLabel}: could not commit an update`, error),
      );
      this.refresh();
    });
  }
}
