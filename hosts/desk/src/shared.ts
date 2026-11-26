/**
 * The words the host, the chrome bridge and the pack bridge agree on.
 *
 * The preloads cannot import this module (a sandboxed preload is CommonJS), so
 * `channels.test.ts` reads them and fails if a channel name drifts. Types are
 * duplicated nowhere: both sides of IPC use these shapes.
 */
import type { SuiteWidgetFieldType, SuiteWidgetSize } from "@suite/contracts";
import { PACK_CAPABILITIES, type PackCapability } from "@suite/pack/capabilities";
import type { FileHandleInfo } from "@suite/pack-runtime";
import type { Density } from "@suite/theme";

export const CHROME_SCHEME = "suite-desk";
export const CHROME_HOST = "app";
export const CHROME_ORIGIN = `${CHROME_SCHEME}://${CHROME_HOST}`;

export const PACK_SCHEME = "suite-pack";

export const CHROME_IPC = {
  state: "suite:shell:state",
  openPack: "suite:shell:open-pack",
  activateTab: "suite:shell:activate-tab",
  closeTab: "suite:shell:close-tab",
  tabMenu: "suite:shell:tab-menu",
  newTab: "suite:shell:new-tab",
  home: "suite:shell:home",
  picker: "suite:shell:picker",
  openDocument: "suite:shell:open-document",
  newDocument: "suite:shell:new-document",
  reloadTab: "suite:shell:reload-tab",
  openExternal: "suite:shell:open-external",
  installPack: "suite:shell:install-pack",
  installCataloguePack: "suite:shell:install-catalogue-pack",
  installFirstRunPack: "suite:shell:install-first-run-pack",
  completeFirstRun: "suite:shell:complete-first-run",
  setTheme: "suite:shell:set-theme",
  reaskConsent: "suite:shell:reask-consent",
  importRevocation: "suite:shell:import-revocation",
  rotatePublisher: "suite:shell:rotate-publisher",
  uninstallPack: "suite:shell:uninstall-pack",
  addWidget: "suite:shell:add-widget",
  removeWidget: "suite:shell:remove-widget",
  moveWidget: "suite:shell:move-widget",
  resizeWidget: "suite:shell:resize-widget",
  createScreen: "suite:shell:create-screen",
  renameScreen: "suite:shell:rename-screen",
  duplicateScreen: "suite:shell:duplicate-screen",
  deleteScreen: "suite:shell:delete-screen",
  setHomeScreen: "suite:shell:set-home-screen",
  openScreen: "suite:shell:open-screen",
  exportScreen: "suite:shell:export-screen",
  importScreen: "suite:shell:import-screen",
  relayStart: "suite:shell:relay-start",
  relayStop: "suite:shell:relay-stop",
  commandList: "suite:shell:command-list",
  commandInvoke: "suite:shell:command-invoke",
  commandScopes: "suite:shell:command-scopes",
  commandItems: "suite:shell:command-items",
  commandCapture: "suite:shell:command-capture",
  commandOpen: "suite:shell:command-open",
  commandSearch: "suite:shell:command-search",
  commandOpenLink: "suite:shell:command-open-link",
  commandClearRecents: "suite:shell:command-clear-recents",
} as const;

/** Pushed, not invoked: the chrome redraws from the last state it received. */
export const CHROME_STATE = "suite:shell:state-changed";
/** Main asks the chrome to open Settings; the section is optional. */
export const CHROME_SETTINGS = "suite:shell:open-settings";

/** Pushed, not invoked: the host asks the chrome to show the new-tab picker. */
export const CHROME_PICK = "suite:shell:pick";

/** One of a pack's documents, as the new-tab picker shows it. */
export interface PickerDocumentView {
  readonly id: string;
  readonly name: string;
  /** Epoch milliseconds the host recorded, or null when it has no record. */
  readonly openedAt: number | null;
}

/** A pack in the picker. `documents` is null when the pack declares none. */
export interface PickerPackView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly noun: { readonly singular: string; readonly plural: string } | null;
  readonly documents: readonly PickerDocumentView[] | null;
  readonly unavailable: boolean;
}

export interface PickerScreenView {
  readonly id: string;
  readonly name: string;
}

export interface PickerData {
  readonly packs: readonly PickerPackView[];
  readonly screens: readonly PickerScreenView[];
  readonly openDocuments: readonly { readonly packId: string; readonly documentId: string }[];
}

export const PACK_IPC = {
  info: "suite:pack:info",
  launch: "suite:pack:launch",
  identityPack: "suite:identity:pack",
  signPackData: "suite:identity:sign",
  listDocuments: "suite:documents:list",
  createDocument: "suite:documents:create",
  openDocument: "suite:documents:open",
  saveDocument: "suite:documents:save",
  removeDocument: "suite:documents:remove",
  revealDocument: "suite:documents:reveal",
  pendingDocumentChanges: "suite:documents:pending-changes",
  watchDocuments: "suite:documents:watch",
  listRecents: "suite:recents:list",
  forgetRecent: "suite:recents:forget",
  listFiles: "suite:files:list",
  statFile: "suite:files:stat",
  makeFileDirectory: "suite:files:mkdir",
  readFile: "suite:files:read",
  writeFile: "suite:files:write",
  renameFile: "suite:files:rename",
  removeFile: "suite:files:remove",
  backupFile: "suite:files:backup",
  lockFile: "suite:files:lock",
  unlockFile: "suite:files:unlock",
  pickExternalFile: "suite:files:pick-open",
  pickExternalSave: "suite:files:pick-save",
  readExternalFile: "suite:files:read-external",
  writeExternalFile: "suite:files:write-external",
  closeExternalFile: "suite:files:close-external",
  importExternalFile: "suite:files:import-external",
  importExternalFolder: "suite:files:import-folder",
  relayConnect: "suite:relay:connect",
  relaySend: "suite:relay:send",
  relayClose: "suite:relay:close",
  setTitle: "suite:pack:set-title",
  openExternal: "suite:pack:open-external",
} as const;

/**
 * The declared-entry channels (S6.3).
 *
 * The host invokes a manifest's projection entry in the pack's own renderer,
 * scoped to one document. `read` is the host's answer to the handle the pack
 * receives; `done` and `failed` end the call. `register` tells the host the
 * pack has bound an entry, so a save does not wait for a handler that will
 * never answer.
 */
export const PACK_PROJECTION = {
  invoke: "suite:projection:invoke",
  register: "suite:projection:register",
  unregister: "suite:projection:unregister",
  read: "suite:projection:read",
  done: "suite:projection:done",
  failed: "suite:projection:failed",
} as const;

/**
 * The scoped command channel (#226).
 *
 * It is separate from the document and file bridge: a request names a command
 * or a scopes call and carries a record of strings, and a reply carries display
 * metadata plus a `suite://` link. No document bytes, path or handle cross it.
 * `register` tells the host the pack bound a declared provider entry.
 */
export const PACK_COMMAND = {
  invoke: "suite:command:invoke",
  register: "suite:command:register",
  unregister: "suite:command:unregister",
  done: "suite:command:done",
  failed: "suite:command:failed",
} as const;

/** Main-process pushes a pack may listen for. */
export const PACK_EVENT = {
  deepLink: "suite:pack:deep-link",
  documentsChanged: "suite:documents:changed",
  relayFrame: "suite:relay:frame",
  relayClosed: "suite:relay:closed",
} as const;

export type {
  FileEntry,
  FileFilter,
  FileHandle,
  FileHandleInfo,
  FileLock,
  FileReadOptions,
  FileWriteOptions,
  ImportedFolder,
  PackLaunchContext,
  ProjectedReminder,
  ProjectionDocument,
  ProjectionsService,
  RecentDocument,
  RecentsService,
} from "@suite/pack-runtime";
export { PACK_CAPABILITIES, type PackCapability };

/**
 * What the main process returns for a picked handle.
 *
 * The token is the only name for the file across IPC; the absolute path stays in
 * the main process. `info` is a name and a snapshot of the size and mtime, never
 * a path. The preload wraps this into the `FileHandle` the pack sees, with the
 * token closed over rather than exposed as a property.
 */
export interface IssuedFileHandle {
  readonly token: string;
  readonly info: FileHandleInfo;
}

/** The options `files.remove` accepts. The store owns recursion and path checks. */
export interface FileRemoveOptions {
  readonly recursive?: boolean;
}

/** Where a pack was found. `development` is an unsigned directory behind a switch. */
export type PackSource = "development" | "installed";

/** Who signed a pack, as the chrome shows it. The fingerprint is the key's SHA-256. */
export interface PackPublisherView {
  readonly id: string;
  readonly fingerprint: string;
}

/**
 * The four strengths a capability can be asked at (S4.2). One vocabulary for
 * the record, the dialog and the pack card.
 */
export type ConsentTier = "install" | "first-use" | "every-use" | "token";

/** One recorded answer, as the pack's card shows it. */
export interface PackConsentView {
  readonly capability: PackCapability;
  readonly tier: ConsentTier;
  readonly answer: "granted" | "denied" | "expired";
  readonly reason: string;
  readonly answeredAt: number;
}

/** What the chrome needs to render a pack tile. No path and no code. */
export interface PackSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly entry: string;
  readonly capabilities: readonly PackCapability[];
  readonly source: PackSource;
  /** Null only for an unsigned development directory. */
  readonly publisher: PackPublisherView | null;
  /** Answers for this installed version (S4.3); a denial is shown, not swallowed. */
  readonly consent?: readonly PackConsentView[];
}

/** How this host fits a pack's `platforms` declaration, as the chrome shows it. */
export type CataloguePlatformState = "available" | "unavailable" | "unknown";

export interface CataloguePlatform {
  /** `unknown` means the manifest predates `platforms`; it is never "supported". */
  readonly state: CataloguePlatformState;
  /** The refusal sentence, or the unknown explanation; null when available. */
  readonly reason: string | null;
}

/**
 * A pack on disk that the catalogue found.
 *
 * `trusted` is the host's verification result, not the archive's claim. A refused
 * archive still lists, with a sentence a person can read; it can never install.
 * The absolute path stays in the main process. The publisher fingerprint and the
 * capability list are here because S2.5 requires both before an install.
 */
export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly entry: string;
  readonly trusted: boolean;
  readonly refusal: string | null;
  readonly publisher: PackPublisherView | null;
  readonly capabilities: readonly PackCapability[];
  /** The pack's `platforms` intersected with what this host serves. */
  readonly platform: CataloguePlatform;
  /** Archive size, so the chrome can show it before an install. */
  readonly sizeBytes: number;
  /** True when this version is newer than the highest valid installed version. */
  readonly updateAvailable: boolean;
}

/** One version directory present under the install root. */
export interface InstalledVersionView {
  readonly id: string;
  readonly version: string;
  /** True for the version the loader selects, which is what a tab runs. */
  readonly current: boolean;
}

/**
 * One app session. The host owns the tab; a pack owns everything inside it.
 *
 * A tab is either a pack tab (a renderer on its own origin) or a screen tab
 * (host-owned chrome, reserved for the next slice). Version-1 space documents
 * carry no `kind` and read as pack tabs.
 */
export interface PackShellTab {
  readonly kind: "pack";
  readonly id: string;
  readonly packId: string;
  readonly title: string;
  readonly entry: string;
}

export interface ScreenShellTab {
  readonly kind: "screen";
  readonly id: string;
  readonly screenId: string;
  readonly title: string;
}

export type ShellTab = PackShellTab | ScreenShellTab;

/**
 * What the chrome paints below the tab strip.
 *
 * A pack tab is covered by its own view, so the chrome content is hidden. A screen
 * tab is host chrome, so its composition fills that same area. With no active tab
 * the chrome shows its empty state rather than a second copy of Home.
 */
export type ShellSurface = "launcher" | "pack" | "screen";

/** Where a placement's descriptor came from. `unknown` is kept, never dropped. */
export type ScreenWidgetSource = "host" | "app" | "unknown";

/** One field a widget declares. The host draws it; the app never supplies DOM. */
export interface ScreenWidgetFieldView {
  readonly id: string;
  readonly label: string;
  readonly type: SuiteWidgetFieldType;
  readonly required: boolean;
}

/** One instance setting with its saved (or default) value resolved by the registry. */
export interface ScreenWidgetSettingView {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface ScreenWidgetView {
  readonly kind: "widget";
  readonly registryId: string;
  readonly size: SuiteWidgetSize;
  readonly source: ScreenWidgetSource;
  readonly title: string;
  readonly appId: string | null;
  readonly appName: string | null;
  /** A sentence for an unknown widget or a write path this host cannot serve yet. */
  readonly note: string | null;
  readonly fields: readonly ScreenWidgetFieldView[];
  readonly settings: readonly ScreenWidgetSettingView[];
  /** Instance settings the declared descriptor does not know. Kept on the Screen. */
  readonly unknownSettings: readonly string[];
  /** Settings that do not fit their declared field. */
  readonly issues: readonly string[];
}

/** One row child: a widget view plus the share of the row it asks for. */
export interface ScreenRowItemView {
  readonly weight: number;
  readonly widget: ScreenWidgetView;
}

/** A row or carousel the document placed. The host draws its children in order. */
export interface ScreenRowView {
  readonly kind: "row";
  readonly size: SuiteWidgetSize;
  readonly layout: "row" | "carousel";
  readonly mode: "wrap" | "scroll";
  readonly items: readonly ScreenRowItemView[];
}

/** One placement in a Screen: a widget, or a row of widgets one level deep. */
export type ScreenEntryView = ScreenWidgetView | ScreenRowView;

/** One widget the edit surface offers to add. */
export interface ScreenChoiceView {
  readonly registryId: string;
  readonly title: string;
  readonly source: "host" | "app";
  readonly appId: string;
  readonly appName: string;
  readonly size: SuiteWidgetSize;
}

/** A Screen as the chrome draws it. `available` is false for a restored unknown screen. */
export interface ScreenView {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly widgets: readonly ScreenEntryView[];
  readonly choices: readonly ScreenChoiceView[];
}

/** One Screen in the manager's list. `open` means a tab currently shows it. */
export interface ScreenSummaryView {
  readonly id: string;
  readonly name: string;
  readonly home: boolean;
  readonly open: boolean;
  readonly readable: boolean;
}

export interface ThemeView {
  /** The resolved preset id, after any stored-id rename. */
  readonly preset: string;
  /** The brightness the page draws. */
  readonly mode: "light" | "dark";
  /** The stored choice: `mode` when it is fixed, or follow-the-system. */
  readonly source: "system" | "light" | "dark";
  readonly density: Density;
  readonly values: Readonly<Record<string, string>>;
  /** The type, density, radius, elevation and motion record for this choice. */
  readonly scale: Readonly<Record<string, string>>;
}

/** What a first-run install reports back to the wizard. */
export interface FirstRunInstallResult {
  readonly ok: boolean;
  readonly detail: string;
}

/** What the relay is doing, in the words the tray used to show. */
export type RelayLifecycle = "off" | "starting" | "on" | "stopping" | "crashed" | "failed";

/**
 * The relay's state as the host chrome draws it.
 *
 * The host supervises the child and owns this surface: on/off, the address a
 * device is given, the certificate pin, the shareable code and the last crash.
 * A pack never sees this view; its own service is the opaque connection only.
 */
export interface RelayView {
  readonly state: RelayLifecycle;
  readonly on: boolean;
  readonly address: string | null;
  readonly fingerprint: string | null;
  readonly code: string | null;
  readonly consoleUrl: string | null;
  readonly restartCount: number;
  /** A crash sentence, kept after a successful restart so a crash is not silent. */
  readonly lastError: string | null;
}

export interface ShellState {
  readonly tabs: readonly ShellTab[];
  readonly activeTabId: string | null;
  readonly surface: ShellSurface;
  /** The first-run wizard replaces the chrome until the host records completion. */
  readonly firstRun: boolean;
  readonly screens: readonly ScreenView[];
  /** Every Screen on this device, for the manager. */
  readonly screenList: readonly ScreenSummaryView[];
  readonly homeScreenId: string;
  /** A manager refusal or note, such as deleting the last Screen. */
  readonly screenManagerNote: string | null;
  readonly packs: readonly PackSummary[];
  readonly catalogue: readonly CatalogueEntry[];
  /** Which source the catalogue is showing, in a sentence the chrome can print. */
  readonly catalogueSource: string;
  readonly installedVersions: readonly InstalledVersionView[];
  readonly theme: ThemeView;
  /** The palettes the host offers, resolved from `@suite/theme` so labels cannot drift. */
  readonly themeChoices: readonly { readonly id: string; readonly name: string }[];
  readonly notice: string | null;
  /** A host sentence about reminders, such as a denied permission. Null is the quiet state. */
  readonly reminderStatus: string | null;
  readonly relay: RelayView;
}

/** A document as the host lists it. `id` is a file name inside the pack's root. */
export interface DocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly updatedAt: number;
}

/** A document opened for a pack: the summary plus bytes only that pack understands. */
export interface DocumentRecord extends DocumentSummary {
  readonly bytes: Uint8Array;
}

export interface PackInfoView {
  readonly id: string;
  readonly name: string;
  readonly containerId: string;
  readonly capabilities: readonly PackCapability[];
}
