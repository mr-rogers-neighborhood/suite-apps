/**
 * Everything the container hands a module, and the reason each thing is shaped the
 * way it is.
 *
 * The governing rule: the host may carry a document but may not read one. Bytes go
 * in and come out; the envelope shape (`.planner`, `.budget`, `.canvas`) belongs to
 * the domain that wrote it, for the same reason `@suite/files` shares the mechanics
 * of an envelope and refuses its shape. If this interface ever grows a `parse`, the
 * container has started becoming the monolith.
 */
import type { SuiteGoModuleId } from "./module.js";

/**
 * A document as the shell lists it.
 *
 * `title` is supplied by the module when it saves, because a base64 Loro snapshot
 * has no human name in it and the host must not learn to read one. A module that
 * doesn't supply a title gets "Untitled" from the shell, not from here.
 */
export interface DocumentSummary {
  readonly id: string;
  readonly moduleId: SuiteGoModuleId;
  /** The file name, with its extension. Carried so a person recognises it in a backup. */
  readonly name: string;
  readonly title: string;
  readonly savedAt: number;
}

/** A document opened for a module: the summary plus bytes it alone can interpret. */
export interface DocumentRecord extends DocumentSummary {
  readonly bytes: Uint8Array;
}

export interface CreateDocumentInput {
  readonly moduleId: SuiteGoModuleId;
  /** File name with extension. The store rejects one it cannot use as a name. */
  readonly name: string;
}

export interface SaveDocumentInput {
  /** What the recents list should show. Omit to keep the previous title. */
  readonly title?: string;
  readonly bytes: Uint8Array;
}

/**
 * The document store the host implements.
 *
 * `list()` with no argument is the recents query: the shell needs one list spanning
 * modules, which is exactly what it can build from summaries without touching a
 * payload.
 */
export interface DocumentStore {
  list(moduleId?: SuiteGoModuleId): Promise<readonly DocumentSummary[]>;
  create(input: CreateDocumentInput): Promise<DocumentRecord>;
  open(id: string): Promise<DocumentRecord | null>;
  save(id: string, input: SaveDocumentInput): Promise<DocumentSummary>;
  remove(id: string): Promise<void>;
}

/**
 * Small persisted values, already namespaced per module by the host.
 *
 * A module asking for `"last-tab"` cannot collide with another module asking for
 * `"last-tab"`. The host owns the namespacing so a module cannot escape it.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

/**
 * The container's chrome, offered rather than taken.
 *
 * Deliberately not a general navigation stack. A module owning the top-level back
 * stack would break the one rule that keeps the container honest — that leaving a
 * module returns to home. So a module may name itself and may ask to be closed,
 * and that is all.
 */
export interface ModuleNavigation {
  setTitle(title: string): void;
  /** Leave the module and return to home. */
  close(): void;
}

/**
 * What a module tells the container about the documents it opens.
 *
 * The container keeps one recents list across domains, and it cannot build that
 * list by reading documents — it has no idea what they contain. So the module says
 * which document it opened and what to call it. `title` is supplied for the same
 * reason it is supplied on save: a base64 snapshot has no human name in it.
 */
export interface ModuleRecents {
  remember(documentId: string, title: string): void;
  forget(documentId: string): void;
}

/**
 * A filter for the platform's file picker.
 *
 * `extensions` are bare, lower-case and without a dot — the same rule the suite uses
 * for a manifest's file extensions. A phone picker wants a MIME type in the end, and
 * the implementation decides how to express the filter; this stays neutral so a full
 * app can describe its own file without the container learning what it means.
 */
export interface FileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

/** A file the person chose, already read into memory. */
export interface PickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export type FileOutcome =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: "cancelled" | "failed"; readonly message?: string };

export interface WriteFileInput {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/**
 * What the platform will allow a reminder to do.
 *
 * `prompt` means nothing has been decided yet, which is the only state worth asking about: the
 * platform remembers a denial and asking again does not bring the prompt back. `unsupported` is
 * the honest answer on a target with no notification channel, not a failure.
 */
export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";

/**
 * One reminder a domain wants delivered later.
 *
 * `id` is the domain's, and stable: scheduling the same id twice replaces the first rather than
 * stacking a second alarm, which is what makes a re-render safe. `title` is the domain's text,
 * carried the way a document title is — the container shows it and never reads it. `at` is epoch
 * milliseconds; the platform chooses the exactness it is allowed.
 */
export interface ScheduledNotification {
  readonly id: string;
  readonly title: string;
  readonly at: number;
}

export interface NotificationOutcome {
  readonly ok: boolean;
  /** The permission after the attempt, so a caller can show a denied state without asking again. */
  readonly permission: NotificationPermission;
  readonly reason?: "denied" | "unsupported" | "failed";
}

/**
 * Local notifications, for work that happens at a time rather than while an app is open.
 *
 * The container is a delivery channel, not a scheduler: it stores nothing, reads nothing and
 * restarts nothing. A pack that wants a reminder asks for it again on the next launch, which is
 * the property that makes a phone's alarm behaviour predictable.
 */
export interface NotificationService {
  permission(): Promise<NotificationPermission>;
  /** Asks the platform, once. A decision already made is returned rather than re-asked. */
  request(): Promise<NotificationPermission>;
  schedule(notification: ScheduledNotification): Promise<NotificationOutcome>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
}

/**
 * Reading and writing files the person can reach.
 *
 * Three verbs, because a phone has three real capabilities and pretending otherwise
 * produces buttons that fail: pick a file from the platform picker, write one into
 * the app's own documents, and hand one to the share sheet so it can leave.
 *
 * There is deliberately no "reveal in file manager". A desktop has one; a phone does
 * not, and the share sheet is the honest replacement.
 */
export interface FileService {
  /** Opens the platform's picker. `null` means the person cancelled. */
  pickOpen(filters: readonly FileFilter[]): Promise<PickedFile | null>;
  /** Writes into the app's own documents directory and reports the URI. */
  write(input: WriteFileInput): Promise<{ readonly ok: true; readonly uri: string }>;
  /** Offers the file to the platform share sheet. */
  share(input: WriteFileInput): Promise<FileOutcome>;
}

export type ThemeDensity = "compact" | "cozy" | "comfortable";
export type ColorScheme = "light" | "dark";

/**
 * Resolved theme values.
 *
 * The contract names no colour and no spacing number: those are the theme system's
 * to own. The shell resolves tokens once at the root, and a module reads variables
 * rather than hard-coding a palette it would then have to keep in sync.
 */
export interface ThemeTokens {
  readonly scheme: ColorScheme;
  readonly density: ThemeDensity;
  readonly cssVariables: Readonly<Record<string, string>>;
}

export interface ModuleHost {
  /** Which module is being hosted. A module can tell itself apart in one shared store. */
  readonly moduleId: SuiteGoModuleId;
  readonly documents: DocumentStore;
  readonly storage: KeyValueStore;
  readonly navigation: ModuleNavigation;
  readonly recents: ModuleRecents;
  readonly files: FileService;
  readonly notifications: NotificationService;
  readonly theme: ThemeTokens;
}
