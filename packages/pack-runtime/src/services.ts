/**
 * The services a pack sees.
 *
 * These are the pack-side types. They describe the host a pack is written
 * against and the target shape of `window.suite`; the v1 desktop host implements
 * a subset (documents with reveal and a change watch, files with a bounded
 * folder import, the recent list, launch and the small info surface) and refuses
 * the rest at discovery. Neither side imports Electron or Node from this
 * package.
 */

export type Disposable = () => void;

export interface FileEntry {
  /** Relative, slash-separated path inside the pack's root. */
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly size: number;
  readonly mtimeMs: number;
}

export interface FileReadOptions {
  readonly maxBytes?: number;
}

export interface FileWriteOptions {
  readonly atomic?: boolean;
  /**
   * Refuse the write when the file's mtime is not this value. The host compares
   * before it writes, so a stale writer loses instead of overwriting a newer one.
   */
  readonly expectedMtimeMs?: number;
}

export interface FileLock {
  readonly path: string;
  release(): Promise<void>;
}

/**
 * The pack's files.
 *
 * The first group is scoped to the pack's own root: relative paths only, host
 * owned atomic writes, backups and locks. The second group is the user-consented
 * external file surface: a person picks a file or a destination, and the pack
 * reads or writes through a handle without learning the path.
 */
export interface FilesService {
  list(path?: string): Promise<readonly FileEntry[]>;
  stat(path: string): Promise<FileEntry | null>;
  mkdir(path: string): Promise<void>;
  read(path: string, options?: FileReadOptions): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array, options?: FileWriteOptions): Promise<FileEntry>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  /** Host-managed backup; returns the relative path of the backup file. */
  backup(path: string): Promise<string>;
  lock(path: string): Promise<FileLock>;

  /** A person-consented file from the platform picker. */
  pickOpen(filters?: readonly FileFilter[]): Promise<FileHandle | null>;
  /** A person-chosen destination. The pack writes through the handle. */
  pickSave(suggestedName: string): Promise<FileHandle | null>;
  /** Copy an open external file into the pack's own root. */
  importFile(handle: FileHandle, name?: string): Promise<FileEntry>;
  /**
   * Ask the person for a folder and copy it into the pack's own root.
   *
   * The host owns the picker and the copy rules; the source path never crosses.
   * The result names a relative directory inside the pack's root plus the files
   * it holds. A host without this surface leaves it absent, so a pack can say so
   * rather than pretend a folder import happened.
   */
  importFolder?(destination?: string): Promise<ImportedFolder | null>;
}

/** What a folder import leaves in the pack's own root. The source path is not here. */
export interface ImportedFolder {
  /** Relative, slash-separated directory inside the pack's root. */
  readonly path: string;
  /** Every copied file, with paths relative to the pack root, not to `path`. */
  readonly entries: readonly FileEntry[];
}

export interface FileFilter {
  readonly name: string;
  /** Bare, lower-case, without a dot. */
  readonly extensions: readonly string[];
}

export interface FileHandleInfo {
  readonly name: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface FileHandle {
  readonly info: FileHandleInfo;
  read(): Promise<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface RelayConnectOptions {
  /** `ws://127.0.0.1` for a loopback relay, or `wss://` with a certificate pin. */
  readonly url: string;
  /** SHA-256 of the relay certificate, required for `wss://`. */
  readonly certificateSha256?: string;
}

export interface RelayConnection {
  send(frame: Uint8Array): Promise<void>;
  onFrame(listener: (frame: Uint8Array) => void): Disposable;
  onClose(listener: (reason: string) => void): Disposable;
  close(): Promise<void>;
}

export interface RelayService {
  /** The host opens and pins the socket; frames stay opaque to the host. */
  connect(options: RelayConnectOptions): Promise<RelayConnection>;
}

export interface CommandRegistration {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly keybinding?: string;
  run(): void | Promise<void>;
}

export interface CommandsService {
  register(command: CommandRegistration): Disposable;
  execute(id: string): Promise<void>;
}

/**
 * The pack's own identity (S2.6, S4.7).
 *
 * A host derives this key per `(publisher id, pack id)` from its device key and
 * hands the pack only the public half. The pack never sees the device key or the
 * derived secret. `sign` is the host's signing call for the pack's own data; a
 * relay frame, a relay role record and a membership change are refused there.
 */
export interface PackIdentity {
  readonly publisherId: string;
  readonly packId: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: string;
  /** The key's SHA-256 fingerprint, in the same form a publisher key uses. */
  readonly fingerprint: string;
}

export interface IdentityService {
  /** This pack's derived public identity. */
  pack(): Promise<PackIdentity>;
  /** Sign bytes as this pack's own data. The host refuses relay and role use. */
  sign(bytes: Uint8Array): Promise<string>;
}

export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";

export interface ScheduledNotification {
  readonly id: string;
  readonly title: string;
  readonly at: number;
}

export interface NotificationOutcome {
  readonly ok: boolean;
  readonly permission: NotificationPermission;
  readonly reason?: "denied" | "unsupported" | "failed";
}

export interface NotificationsService {
  permission(): Promise<NotificationPermission>;
  request(): Promise<NotificationPermission>;
  schedule(notification: ScheduledNotification): Promise<NotificationOutcome>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
}

/** The read-only handle a declared projection receives. It names one document and no path. */
export interface ProjectionDocument {
  readonly id: string;
  readonly version: number;
  read(): Promise<Uint8Array>;
}

/** One display row a projection returns. The host adds the pack id and capture time. */
export interface ProjectedReminder {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Epoch milliseconds, not a wall-clock string. */
  readonly at: number;
  /** A `suite://<pack-id>/...` link the host routes on click. */
  readonly deepLink: string;
}

/**
 * The pack-owned half of a declared projection (S6.3).
 *
 * A pack binds the entry its manifest names. The host calls only that entry,
 * with a handle scoped to the document it already resolved. The pack formats
 * the rows; the host schedules and delivers them.
 */
export interface ProjectionsService {
  register(
    entry: string,
    handler: (document: ProjectionDocument) => Promise<readonly ProjectedReminder[]>,
  ): Disposable;
}

export interface DocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly updatedAt: number;
}

export interface DocumentRecord extends DocumentSummary {
  readonly bytes: Uint8Array;
}

export interface DocumentsService {
  list(): Promise<readonly DocumentSummary[]>;
  create(name: string): Promise<DocumentSummary>;
  open(id: string): Promise<DocumentRecord | null>;
  save(id: string, bytes: Uint8Array): Promise<DocumentSummary>;
  remove(id: string): Promise<void>;
  /**
   * Ask the host to show this document where the host keeps it.
   *
   * The pack names a document it already owns; the host opens the file manager
   * at the device copy. The absolute path never crosses, and a host without a
   * file manager leaves the method absent rather than inventing one.
   */
  reveal?(id: string): Promise<DocumentSummary | null>;
  /**
   * Documents that changed since this pack last saw them.
   *
   * The host compares its own record with the files on disk, so a change made
   * while the pack was closed (or while the host was off) is still reported on
   * the next start. Newest first is not guaranteed; ids only.
   */
  pendingChanges?(): Promise<readonly string[]>;
  /**
   * Ask the host to watch this pack's own documents while the pack is open.
   *
   * The host delivers ids, never paths. Nothing is delivered while the pack is
   * closed; `pendingChanges` is what it reads when it starts. A pack must not
   * poll a directory itself.
   */
  onChanged?(listener: (documentIds: readonly string[]) => void): Disposable;
}

/**
 * One row of the host's recent list.
 *
 * `documentId` and `name` are present only for a document this pack owns.
 * Another pack's entry keeps its pack id and time, because no pack may
 * enumerate another pack's documents (S11.1); the host still keeps the
 * cross-pack record for its own launcher.
 */
export interface RecentDocument {
  readonly packId: string;
  readonly documentId: string | null;
  readonly name: string | null;
  /** Epoch milliseconds when the host recorded the open. */
  readonly openedAt: number;
}

/**
 * The host's recent list (S11.3).
 *
 * The host records an open; a pack reads metadata, never content, and "forget"
 * removes the row rather than deleting a document.
 */
export interface RecentsService {
  list(): Promise<readonly RecentDocument[]>;
  /** Remove this pack's row for one document. The document itself stays. */
  forget(documentId: string): Promise<void>;
}

/** Small persisted values, namespaced per pack by the host. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export interface ThemeTokens {
  readonly scheme: "light" | "dark";
  readonly density: string;
  readonly cssVariables: Readonly<Record<string, string>>;
}

export interface Lifecycle {
  /** The host is about to hide or discard this view; write anything pending. */
  onSuspend(listener: () => void | Promise<void>): Disposable;
  onResume(listener: () => void): Disposable;
  /** Called before the host destroys the view. */
  onFlush(listener: () => void | Promise<void>): Disposable;
}

export type PackLaunchContext =
  | { readonly kind: "launcher" }
  | { readonly kind: "deep-link"; readonly url: string }
  | { readonly kind: "file"; readonly file: FileHandle };

/**
 * The object exposed as `window.suite`.
 *
 * A pack may use only what its manifest declares; the host returns an empty or
 * absent service when the capability is missing.
 */
export interface PackHost {
  readonly packId: string;
  readonly containerId: string;
  /** The context this tab was opened with. Async because it crosses the bridge. */
  launch(): Promise<PackLaunchContext>;
  readonly files: FilesService;
  readonly documents: DocumentsService;
  readonly recents: RecentsService;
  readonly storage: KeyValueStore;
  readonly identity: IdentityService;
  readonly relay: RelayService;
  readonly commands: CommandsService;
  readonly notifications: NotificationsService;
  readonly projections: ProjectionsService;
  readonly theme: ThemeTokens;
  readonly lifecycle: Lifecycle;
}
