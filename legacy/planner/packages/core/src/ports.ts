export type ReminderEvent = {
  taskId: string;
  title: string;
  remindAt: string;
};

/**
 * One reminder the renderer wants delivered later, wherever the host can deliver it.
 *
 * The id is the task's, so asking twice replaces rather than stacks. `at` is epoch milliseconds
 * because that is the only form a platform alarm understands; the ISO string stays in the
 * document.
 */
export type ReminderSchedule = {
  id: string;
  title: string;
  at: number;
};

export type AppCommand = "capture" | "today" | "inbox";

export type WorkspaceInfo = {
  path: string;
  schemaVersion: number;
};

export type ExportResult = { canceled: boolean; path?: string };

export type ImportResult = { canceled: boolean };

/**
 * What this device is doing with the workspace's other copies.
 *
 * The words are the ones a person can act on, not the protocol's: a frame, an epoch or a key
 * package never reaches the screen. `count` is the relay's frame count when this device joined,
 * carried to show that something is happening without pretending it is a document version.
 */
export type SyncState =
  | { readonly state: "off" }
  | { readonly state: "connecting" }
  | { readonly state: "syncing"; readonly count: number }
  | { readonly state: "asleep"; readonly reason: string }
  | { readonly state: "refused"; readonly reason: string }
  /** An invitation has been used, and this device is waiting to be let in. */
  | { readonly state: "waiting" }
  /** Somebody who owns this workspace took this device out of it. */
  | { readonly state: "removed" };

export type SyncMemberRole = "owner" | "editor" | "viewer";

/** One device the relay knows, as it last described the room. */
export type SyncMember = {
  readonly deviceId: string;
  readonly name: string;
  readonly role: SyncMemberRole;
};

/**
 * One person this installation chose to know.
 *
 * The renderer sees the contact but never the file it came from. `publicKey` may be absent
 * while a contact is known by code alone; the first signed invitation from that code
 * completes it. Nothing here is sent to a relay or a directory.
 */
export type SyncContact = {
  readonly code: string;
  readonly name: string;
  readonly deviceId?: string;
  readonly publicKey?: string;
  readonly addedAt: string;
  readonly lastSeenAt?: string;
  readonly trusted: boolean;
};

/**
 * Everything the sync dialog needs, in one value.
 *
 * Pushed by main whenever it changes, so the pill and the dialog read one source rather than
 * asking twice and drifting. `workspaceId` is the sync identity of the open workspace: a
 * fingerprint of the id the document already carries, never a secret.
 */
export type SyncInfo = {
  readonly workspaceId: string | null;
  readonly deviceId: string;
  readonly status: SyncState;
  readonly members: readonly SyncMember[];
  /** The code this installation shows another person who wants to add it. */
  readonly friendCode: string;
  /**
   * The same code as a `suite://friend` link, with the install key a scan would carry.
   *
   * Built by main, because the key lives there. A host without an identity omits it; the
   * dialog then shows the code alone.
   */
  readonly friendLink?: string;
  /** The people this installation knows, whichever workspace is open. */
  readonly contacts: readonly SyncContact[];
};

/**
 * The only surface the renderer has on the machine. Main implements it; preload exposes it through
 * contextBridge; tests and Storybook use an in-memory implementation.
 */
export type PlannerBridge = {
  /**
   * The document to open, or `null` when there is not one yet.
   *
   * `null` is not an error and not a shrug: it is the host saying "nothing is here", which is the
   * one answer a container can honestly give. `fromSnapshot` needs a schema-initialised snapshot,
   * and a container that hosts Planner has no way to produce one that stays valid as the schema
   * moves — so inventing the document belongs to the app, not the host.
   *
   * A host that always has bytes (the desktop shell always opens a file) never returns it.
   */
  loadSnapshot(): Promise<Uint8Array | null>;
  /**
   * Take the document the app just made, once, on a first run.
   *
   * A host that answered `null` has no document and cannot make one — manufacturing a
   * schema-initialised snapshot would be the host knowing a domain. So the app hands its first
   * document back, before the person can edit it, and the host keeps it as the file.
   *
   * This is not a convenience. A host that only ever receives `commit(update)` gets the deltas that
   * come *after* creation, and a document rebuilt from those is missing its schema: the emitted
   * update after `WorkspaceDocument.create()` carries no meta at all. Optional, because a host that
   * always had a document from a file has nothing to adopt.
   */
  adopt?(snapshot: Uint8Array): Promise<void>;
  /**
   * Whether this session started with no workspace file, which is when a start screen is due.
   *
   * Optional on purpose. A host that hands a document over, rather than letting the app read or
   * invent one, has no such distinction to report, and it must not be forced to invent an answer
   * to boot the renderer. Absent reads as `false`, which sends the person straight to the
   * document, which is the right outcome for a container.
   */
  wasCreated?(): Promise<boolean>;
  commit(update: Uint8Array): Promise<void>;
  onWorkspaceReplaced(listener: (snapshot: Uint8Array) => void): () => void;
  onReminder(listener: (reminder: ReminderEvent) => void): () => void;
  /**
   * A Suite link the host routes to this tab while it is already open.
   *
   * The first launch arrives through `launch()` before the renderer starts; this
   * subscription is for the reminder click that arrives after it.
   */
  onDeepLink?(listener: (url: string) => void): () => void;
  /**
   * Hand the pending reminders to the host, when the host can deliver them.
   *
   * Absent on the desktop app, whose main process runs the scheduler itself and can notify while
   * the window is hidden. A container-hosted pack implements it by asking the container's
   * notification service, and returns the permission it ended with so the UI can say when
   * reminders are blocked instead of going quiet. `failure` is set when permission was granted
   * but the platform refused a schedule, so the UI can distinguish "blocked" from "could not
   * schedule this one".
   */
  syncReminders?(
    reminders: readonly ReminderSchedule[],
  ): Promise<{ permission: string; failure?: "schedule" }>;
  /**
   * Ask the platform for notification permission, once, when the first reminder needs it.
   *
   * Separate from `syncReminders` because asking is a decision the person makes in a moment, and
   * the app records that it happened: a revoked permission resets the platform to "ask again", and
   * re-opening the prompt on every edit is how an app becomes noise.
   */
  requestNotifications?(): Promise<string>;
  onCommand(listener: (command: AppCommand) => void): () => void;
  exportWorkspace(): Promise<ExportResult>;
  importWorkspace(): Promise<ImportResult>;
  info(): Promise<WorkspaceInfo>;
  platform(): Promise<string>;
  /**
   * Sync is opt-in and lives in main: the renderer never holds a key and never opens a
   * socket. It asks for a state, starts or stops a connection, writes an invitation and
   * hands a pasted one back. Every method is optional so a host without sync can still
   * implement `PlannerBridge`; the desktop shell provides all of them.
   */
  syncStatus?(): Promise<SyncInfo>;
  /** Share this workspace through a relay at `url`, or reconnect to one it already knows. */
  syncEnable?(url: string, fingerprint?: string): Promise<SyncInfo>;
  /** Stop syncing this copy. The workspace keeps its file and its membership. */
  syncDisable?(): Promise<SyncInfo>;
  /** Write a single-use invitation and hand back the link to give someone. */
  syncInvite?(role: "editor" | "viewer", to?: string): Promise<string | null>;
  /** Ask to join from a link somebody shared. Resolves once this device has asked. */
  syncJoin?(link: string, fingerprint?: string): Promise<SyncInfo>;
  /** Add a person by friend code, or complete one whose key arrived with the code. */
  syncAddContact?(input: { code: string; name: string; publicKey?: string }): Promise<SyncInfo>;
  /** Forget a person. Their code can be added again. */
  syncRemoveContact?(code: string): Promise<SyncInfo>;
  /** Main pushes every change of state, so one subscription feeds the pill and the dialog. */
  onSyncChanged?(listener: (info: SyncInfo) => void): () => void;
};
