import type { SuiteReleaseChannel, SuiteWidgetSize } from "@suite/contracts";

/**
 * What the hub window asks the main process for.
 *
 * Same discipline as the Canvas bridge: no method takes a path it wants written,
 * and every one is a capability the main process chooses to grant. `addApp` runs
 * a file picker in main, so the renderer never learns a directory it could point
 * somewhere else.
 */

export const START_IPC = {
  listApps: "suite:start:list",
  launch: "suite:start:launch",
  addApp: "suite:start:add",
  removeApp: "suite:start:remove",
  installApp: "suite:start:install",
  uninstallApp: "suite:start:uninstall",
  setTheme: "suite:start:theme",
  revealApp: "suite:start:reveal",
  recents: "suite:start:recents",
  forgetRecent: "suite:start:forget",
  openFile: "suite:start:open-file",
  checkUpdates: "suite:start:check-updates",
  installSync: "suite:start:sync-install",
  openSync: "suite:start:sync-open",
  info: "suite:start:info",
  // The Home Screen: an id and a choice cross the bridge, never a path.
  moveWidget: "suite:start:screen-move",
  sizeWidget: "suite:start:screen-size",
  addWidget: "suite:start:screen-add",
  removeWidget: "suite:start:screen-remove",
  setWidgetSetting: "suite:start:screen-setting",
  // The host-owned manager. Each answers with the new Screens state.
  createScreen: "suite:start:screen-create",
  renameScreen: "suite:start:screen-rename",
  duplicateScreen: "suite:start:screen-duplicate",
  deleteScreen: "suite:start:screen-delete",
  setHomeScreen: "suite:start:screen-home",
  openScreen: "suite:start:screen-open",
} as const;

/** Pushed rather than invoked: the window redraws from what arrives here. */
export const START_CHANGED = "suite:start:changed";

/**
 * Pushed while an install runs, and only then.
 *
 * A whole `LauncherState` carries an index of every document on this machine, which is
 * far too much to send per downloaded chunk; this is the one thing that changes while a
 * bar moves.
 */
export const START_INSTALL_PROGRESS = "suite:start:install-progress";

export type StartChannel = (typeof START_IPC)[keyof typeof START_IPC];

/**
 * Which mode the window draws.
 *
 * Declared here rather than in `theme.ts` because the page imports this module and that one
 * reads the filesystem. `theme.ts` owns the rules; this owns the vocabulary.
 *
 * `system` is a *choice*, not a mode: by the time a value reaches the page it has been
 * resolved against the desktop, so a stylesheet never sees it.
 */
export type ThemeSource = "system" | "light" | "dark";

/** What a person chose: a preset, and how bright to draw it. */
export interface ThemeChoice {
  /** The preset's id, from `@suite/theme`. */
  readonly preset: string;
  readonly mode: ThemeSource;
}

/** One entry in the picker. The colours are not here: `themeValues` carries the chosen one. */
export interface ThemeOption {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * The chosen theme, already resolved.
 *
 * The page cannot import `@suite/theme` — it is plain ES modules served over `start://` with
 * no bundler — so main does the resolving and sends the answer. That keeps the renderer
 * dependency-free and puts the one place that knows how a preset becomes CSS in the process
 * that already imports the package.
 */
export interface ResolvedTheme {
  readonly choice: ThemeChoice;
  /** The preset list, for the picker. */
  readonly options: readonly ThemeOption[];
  /** The resolved mode, never `system`. */
  readonly mode: "light" | "dark";
  /** Every role as a custom property, ready for `style.setProperty`. */
  readonly values: Readonly<Record<string, string>>;
}

/** Whether an install can be launched, and why not when it cannot. */
export type AppHealth = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * What a card is offering, in the four honest states and the two corners around them.
 *
 * `local` is the app a person built themselves: D44 makes it first-class, so it is not
 * a lesser card — it simply is not in the suite's catalogue, and this hub has no feed to
 * offer it versions from. `refused` is an install that cannot be launched.
 */
export type AppCardState =
  | "not-installed"
  | "no-release"
  | "update-available"
  | "current"
  | "local"
  | "refused";

/** How one store operation is going, for the line that replaces its button. */
export interface InstallProgress {
  readonly id: string;
  readonly phase: "installing" | "failed";
  /** What went wrong, in the same words the card will show. */
  readonly reason: string | null;
}

/**
 * Who put this install on the machine.
 *
 * It decides what the card may offer. `flatpak` owns the deployment, so Start
 * opens, updates and removes it. `folder` is a copy a person placed: Start opens,
 * reveals and forgets it, and never downloads or replaces it.
 */
export type AppSource = "folder" | "flatpak";

/** One app card, installed, offered, or refused. */
export interface AppCard {
  /** Null for a refused install with no record, because there is nothing to act on. */
  readonly id: string | null;
  readonly name: string;
  /** How this copy got here. Decides which buttons the card can honestly offer. */
  readonly source: AppSource;
  /** The app's own mark, as a data URI, when the hub knows one. */
  readonly icon: string | null;
  readonly state: AppCardState;
  /** The version installed here, or null when this machine does not have it. */
  readonly version: string | null;
  /** Why no version is offered, when none is. */
  readonly reason: string | null;
  /**
   * Whether the process Start started is still alive.
   *
   * Only ever true for an app Start launched this session: a window opened from the menu
   * is not this process's child, and guessing otherwise would be a claim nobody made.
   */
  readonly running: boolean;
  readonly channel: SuiteReleaseChannel;
  /**
   * The tier this card names: `stable`, or the pre-release branch (`slop`,
   * `canary`, `beta`). Text, never a colour alone.
   */
  readonly tier: "stable" | "slop" | "canary" | "beta";
  /**
   * The other pre-release branch this card can switch to, when one is published.
   *
   * A switch keeps the single pre-release install and changes its data folder. It
   * is never a second install of `run.suite.slop.<app>`.
   */
  readonly switchTier: "slop" | "canary" | "beta" | null;
  readonly executable: string | null;
  readonly fileExtensions: readonly string[];
  readonly lastOpenedAt: number | null;
  /** How many documents the index found in this app's folder. */
  readonly fileCount: number;
  readonly health: AppHealth;
}

/** One file the index found, with the app that claims it. */
export interface FileCard {
  readonly path: string;
  readonly name: string;
  readonly appId: string;
  readonly appName: string;
  readonly folder: string;
  readonly modifiedAt: number;
  readonly installed: boolean;
  /** The link that opens this document in its app, when its name survives one. */
  readonly link: string | null;
}

/** One recent file. */
export interface RecentCard {
  readonly path: string;
  readonly name: string;
  readonly appId: string;
  readonly appName: string;
  readonly openedAt: number;
}

/** A refused install, shown so a broken app is visible rather than absent. */
export interface RefusedInstall {
  readonly path: string;
  readonly reason: string;
}

/** What Start knows about itself, for the Settings pane. */
/**
 * One installed app, and every place it keeps something.
 *
 * The point of the list is that a person can leave: knowing where the binary, the
 * machine-local state and the documents are is what makes "uninstall this" a decision
 * rather than a leap. Nothing here is new — these are the same paths `@suite/contracts`
 * defines and the app itself resolves — and that is the point of showing them.
 */
export interface AppLocation {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** The binary Start launches, as the install record names it. */
  readonly executable: string;
  /** `~/Documents/Suite/<App>`, where this app's files are. */
  readonly documents: string;
  /** The per-user directory for machine-local state. Never beside a document. */
  readonly data: string;
}

export interface StartSettings {
  readonly dataDirectory: string;
  readonly documentsRoot: string;
  readonly installRoots: readonly string[];
  /** Where each app Start can see keeps its things. Empty before anything is installed. */
  readonly locations: readonly AppLocation[];
  /** Which palette the window draws, and how bright. */
  readonly theme: ResolvedTheme;
}

/** Which way a move control takes one placement. */
export type ScreenMoveDirection = "earlier" | "later";

/**
 * What a placement draws.
 *
 * `apps` and `recents` come from Start's own table. `app` is a descriptor an installed app
 * declared in `suite.app.json`. `unknown` is a registry id this build cannot resolve: it
 * stays in the document and is drawn as a named placeholder, never dropped.
 */
export type ScreenWidgetKind = "apps" | "recents" | "app" | "unknown";

/** One field a resolved app widget asks the host to draw for a capture. */
export interface ScreenWidgetFieldView {
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "day" | "number";
  readonly required: boolean;
  readonly maxLength: number | null;
}

/** One instance setting, with the value the Screen currently resolves to. */
export interface ScreenWidgetSettingView {
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "day" | "number";
  readonly value: string;
  readonly required: boolean;
  readonly maxLength: number | null;
}

/**
 * One placement, already resolved against the widget registry.
 *
 * Main does the joining: the Screen names registry ids, sizes and settings; the registry
 * supplies the title, the size classes and the capture fields. The page never sees an
 * unresolved entry without a name: an unknown id arrives as an `unknown` placement whose
 * title is the id itself.
 */
export interface ScreenWidgetView {
  /** The registry id, `<app id>.<widget id>`. */
  readonly registryId: string;
  readonly title: string;
  readonly description: string | null;
  readonly kind: ScreenWidgetKind;
  readonly size: SuiteWidgetSize;
  /** Every class this placement can take, in the order the picker shows them. */
  readonly sizes: readonly SuiteWidgetSize[];
  /** The app descriptor's submit label, or null when it declares no capture. */
  readonly submitLabel: string | null;
  readonly fields: readonly ScreenWidgetFieldView[];
  /** Declared settings with defaults applied, plus unknown ones kept on the Screen. */
  readonly settings: readonly ScreenWidgetSettingView[];
  /** Saved settings the descriptor does not declare. They stay on the Screen. */
  readonly unknownSettings: readonly string[];
  /** A sentence about an unknown widget, an issue, or settings this build cannot use. */
  readonly note: string | null;
}

/** A widget the person can still add to the open Screen. */
export interface AvailableScreenWidget {
  readonly registryId: string;
  readonly title: string;
  readonly description: string | null;
  readonly defaultSize: SuiteWidgetSize;
}

/** One Screen, as the manager lists it. */
export interface ScreenSummary {
  readonly id: string;
  readonly name: string;
  readonly home: boolean;
  readonly open: boolean;
  /** False when the file exists but this build cannot read it. */
  readonly readable: boolean;
}

/** The open Screen: its name and its resolved, ordered placements. */
export interface ScreenView {
  readonly id: string;
  readonly name: string;
  readonly home: boolean;
  readonly widgets: readonly ScreenWidgetView[];
}

/** The replacement question asked before Home is deleted. */
export interface ScreenReplacement {
  /** The Screen whose deletion is waiting for an answer. */
  readonly forId: string;
  readonly choices: readonly { readonly id: string; readonly name: string }[];
}

/** Everything the Home Screen pane and the host-owned manager draw. */
export interface ScreensState {
  readonly homeId: string;
  readonly openId: string;
  readonly screens: readonly ScreenSummary[];
  readonly screen: ScreenView;
  /** Widgets the registry knows but the open Screen does not show yet. */
  readonly available: readonly AvailableScreenWidget[];
  /**
   * Why the Screen document was not honoured, when it was not: a corrupt or newer file,
   * or a refused migration. `null` on an ordinary launch.
   */
  readonly note: string | null;
  /** The answer to the last manager action, when it has one. */
  readonly managerNote: string | null;
  /** Set when Home cannot be deleted until another Screen is chosen as Home. */
  readonly replacement: ScreenReplacement | null;
}

export interface LauncherState {
  readonly apps: readonly AppCard[];
  readonly recents: readonly RecentCard[];
  readonly files: readonly FileCard[];
  readonly settings: StartSettings;
  readonly version: string;
  /** The Home Screen: the open composition and the Screens a person manages. */
  readonly screens: ScreensState;
  /** The relay this machine runs, and what it is holding. */
  readonly sync: SyncState;
  /** Installs running right now, so a window that opens mid-install still sees the bar. */
  readonly installing: readonly InstallProgress[];
  /**
   * Launches that did not work, by app id, since this window opened.
   *
   * A card with a sentence here is telling the person why the window they expected never
   * appeared, which is the one thing a launcher can say that a file manager cannot.
   */
  readonly launchErrors: Readonly<Record<string, string>>;
  /** The hub's own row, which it can show but cannot act on. */
  readonly self: AppCard | null;
}

/**
 * What the Sync pane shows.
 *
 * Suite Sync is a Flatpak like the other apps: Start installs it from the store and
 * opens it with `flatpak run`. The relay lives inside that app, which shows its own
 * address, relay code and fingerprint, so the pane describes a deployment rather
 * than a process Start supervises.
 */
export interface SyncState {
  /**
   * `not-installed` offers Install, `installed` offers Open, and `problem` says why
   * neither is possible. A problem is never drawn as a dead button.
   */
  readonly state: "not-installed" | "installed" | "problem";
  /** The version Flatpak reports, when there is a deployment. */
  readonly version: string | null;
  /** The deployed commit, when Flatpak resolved one. */
  readonly commit: string | null;
  /** Why the deployment cannot be read, installed or opened. Null when all is well. */
  readonly problem: string | null;
}
