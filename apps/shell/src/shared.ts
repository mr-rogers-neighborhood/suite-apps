/**
 * The words the shell, the chrome bridge and the pack bridge agree on.
 *
 * The preloads cannot import this module (a sandboxed preload is CommonJS), so
 * `channels.test.ts` reads them and fails if a channel name drifts. Types are
 * duplicated nowhere: both sides of IPC use these shapes.
 */
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
  uninstallPack: "suite:shell:uninstall-pack",
} as const;

/** Pushed, not invoked: the chrome redraws from the last state it received. */
export const CHROME_STATE = "suite:shell:state-changed";

export const PACK_IPC = {
  info: "suite:pack:info",
  launch: "suite:pack:launch",
  listDocuments: "suite:documents:list",
  createDocument: "suite:documents:create",
  openDocument: "suite:documents:open",
  saveDocument: "suite:documents:save",
  removeDocument: "suite:documents:remove",
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
  setTitle: "suite:pack:set-title",
  openExternal: "suite:pack:open-external",
} as const;

export type {
  FileEntry,
  FileFilter,
  FileHandle,
  FileHandleInfo,
  FileLock,
  FileReadOptions,
  FileWriteOptions,
  PackLaunchContext,
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

/** What the chrome needs to render a pack tile. No path and no code. */
export interface PackSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly entry: string;
  readonly capabilities: readonly PackCapability[];
  readonly source: PackSource;
}

/**
 * A pack on disk that the catalogue found.
 *
 * `trusted` is the host's verification result, not the archive's claim. A refused
 * archive still lists, with a sentence a person can read; it can never install.
 * The absolute path stays in the main process.
 */
export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly entry: string;
  readonly trusted: boolean;
  readonly refusal: string | null;
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

export interface ThemeView {
  readonly mode: "light" | "dark";
  readonly values: Readonly<Record<string, string>>;
}

export interface ShellState {
  readonly tabs: readonly ShellTab[];
  readonly activeTabId: string | null;
  readonly packs: readonly PackSummary[];
  readonly catalogue: readonly CatalogueEntry[];
  readonly installedVersions: readonly InstalledVersionView[];
  readonly theme: ThemeView;
  readonly notice: string | null;
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
