/**
 * The services a pack sees.
 *
 * These are the pack-side types. They describe the host a pack is written
 * against and the target shape of `window.suite`; the v1 desktop host implements
 * a subset (documents, files and the small info surface) and refuses the rest at
 * discovery. Neither side imports Electron or Node from this package.
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
  readonly launch: PackLaunchContext;
  readonly files: FilesService;
  readonly documents: DocumentsService;
  readonly storage: KeyValueStore;
  readonly relay: RelayService;
  readonly commands: CommandsService;
  readonly notifications: NotificationsService;
  readonly theme: ThemeTokens;
  readonly lifecycle: Lifecycle;
}
