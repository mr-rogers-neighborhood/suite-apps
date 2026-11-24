/**
 * The words the shell, the chrome bridge and the pack bridge agree on.
 *
 * The preloads cannot import this module (a sandboxed preload is CommonJS), so
 * `channels.test.ts` reads them and fails if a channel name drifts. Types are
 * duplicated nowhere: both sides of IPC use these shapes.
 */
import type { SuiteWidgetFieldType, SuiteWidgetSize } from "@suite/contracts";
import { PACK_CAPABILITIES, type PackCapability } from "@suite/pack/capabilities";
import type { FileHandleInfo } from "@suite/pack-runtime";

export const CHROME_SCHEME = "suite-shell";
export const CHROME_HOST = "app";
export const CHROME_ORIGIN = `${CHROME_SCHEME}://${CHROME_HOST}`;

export const PACK_SCHEME = "suite-pack";

export const CHROME_IPC = {
  state: "suite:shell:state",
  openPack: "suite:shell:open-pack",
  activateTab: "suite:shell:activate-tab",
  closeTab: "suite:shell:close-tab",
  newTab: "suite:shell:new-tab",
  reloadTab: "suite:shell:reload-tab",
  openExternal: "suite:shell:open-external",
  installPack: "suite:shell:install-pack",
  installCataloguePack: "suite:shell:install-catalogue-pack",
  importRevocation: "suite:shell:import-revocation",
  rotatePublisher: "suite:shell:rotate-publisher",
  uninstallPack: "suite:shell:uninstall-pack",
  addWidget: "suite:shell:add-widget",
  removeWidget: "suite:shell:remove-widget",
  moveWidget: "suite:shell:move-widget",
  resizeWidget: "suite:shell:resize-widget",
} as const;

/** Pushed, not invoked: the chrome redraws from the last state it received. */
export const CHROME_STATE = "suite:shell:state-changed";

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

/** Main-process pushes a pack may listen for. */
export const PACK_EVENT = {
  deepLink: "suite:pack:deep-link",
  documentsChanged: "suite:documents:changed",
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
 * One app session. The shell owns the tab; a pack owns everything inside it.
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
  readonly widgets: readonly ScreenWidgetView[];
  readonly choices: readonly ScreenChoiceView[];
}

export interface ThemeView {
  readonly mode: "light" | "dark";
  readonly values: Readonly<Record<string, string>>;
}

export interface ShellState {
  readonly tabs: readonly ShellTab[];
  readonly activeTabId: string | null;
  readonly surface: ShellSurface;
  readonly screens: readonly ScreenView[];
  readonly packs: readonly PackSummary[];
  readonly catalogue: readonly CatalogueEntry[];
  /** Which source the catalogue is showing, in a sentence the chrome can print. */
  readonly catalogueSource: string;
  readonly installedVersions: readonly InstalledVersionView[];
  readonly theme: ThemeView;
  readonly notice: string | null;
  /** A host sentence about reminders, such as a denied permission. Null is the quiet state. */
  readonly reminderStatus: string | null;
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
