import { join } from "node:path";
import { originKey } from "@suite/desktop";
import { SUITE_PUBLISHER_ID } from "@suite/pack";
import { isWidgetRegistryId } from "@suite/screens";
import {
  app,
  BaseWindow,
  Menu,
  type MenuItemConstructorOptions,
  session,
  shell,
  WebContentsView,
} from "electron";
import { clearCommandEntries } from "./commandInvocation.js";
import { DEFAULT_CONTAINER_ID } from "./container.js";
import { LAUNCHER_CONTEXT, parseSuiteLink } from "./deepLink.js";
import { navigationReleasesLocks } from "./files.js";
import {
  isWidgetSize,
  preferredWidgetSize,
  screenView,
  shellSurface,
  shellWidgetRegistry,
} from "./home.js";
import { registerPackProtocol } from "./packProtocol.js";
import {
  externalLinkFor,
  type PackInfo,
  packOrigin,
  packPartition,
  tabViewTarget,
} from "./packs.js";
import { clearProjectionEntries } from "./reminderProjections.js";
import type { ScreenSet } from "./screens.js";
import { clearPackSender, setPackSender } from "./senders.js";
import {
  type CatalogueEntry,
  CHROME_ORIGIN,
  CHROME_PICK,
  CHROME_SETTINGS,
  CHROME_STATE,
  type InstalledVersionView,
  PACK_EVENT,
  type PackLaunchContext,
  type PackShellTab,
  type PickerData,
  type PickerPackView,
  type RelayView,
  type ScreenView,
  type ShellState,
  type ThemeView,
} from "./shared.js";
import type { SpaceState, SpaceStore } from "./spaces.js";
import { paintThemeSurface, themeOptions } from "./theme.js";

/**
 * What a pack calls one of its documents.
 *
 * A pack may declare several formats; the first one that names itself supplies the word, because
 * a list row can only carry one. A pack that names none keeps the neutral "document".
 */
function packNoun(pack: PackInfo): { readonly singular: string; readonly plural: string } | null {
  for (const document of pack.documents ?? []) {
    if (document.name !== undefined) {
      return { singular: document.name.singular, plural: document.name.plural };
    }
  }
  return null;
}

/** The chrome's own height. The chrome page uses the same number in its stylesheet. */
export const TAB_BAR_HEIGHT = 56;

const configuredPartitions = new Set<string>();

/**
 * One OS window: a full-window chrome view with pack views laid over its content
 * area. Closing a tab destroys its view; switching a tab only hides it, so a
 * half-typed note survives a trip through the launcher.
 */
export class ShellWindow {
  readonly window: BaseWindow;
  readonly #chrome: WebContentsView;
  #packs: readonly PackInfo[];
  #catalogue: readonly CatalogueEntry[];
  #catalogueSource: string;
  #installedVersions: readonly InstalledVersionView[];
  readonly #spaces: SpaceStore;
  readonly #screens: ScreenSet;
  #screenManagerNote: string | null = null;
  readonly #containerId: string;
  readonly #onViewClosed: ((tabId: string) => void) | undefined;
  readonly #views = new Map<string, WebContentsView>();
  /**
   * The stylesheet each pack view currently has inserted.
   *
   * `insertCSS` is additive, so a repaint removes the previous sheet after the new one is in
   * place. A view that loaded after the change starts with no key and simply gains the
   * current theme.
   */
  readonly #themeKeys = new Map<string, string>();
  /**
   * What each tab was opened with. It is stored here, keyed by the tab the main
   * process derived from the sender, so a pack never parses a launch out of a URL
   * or names another tab. A deep link updates the entry before the tab activates.
   */
  readonly #launchContexts = new Map<string, PackLaunchContext>();
  /** The document each pack tab was opened on, so the picker leaves it out of Recents. */
  readonly #tabDocuments = new Map<
    string,
    { readonly packId: string; readonly documentId: string }
  >();
  readonly #listDocuments: (
    packId: string,
  ) => Promise<readonly { readonly id: string; readonly name: string }[]>;
  readonly #recentRows: () => readonly {
    readonly packId: string;
    readonly documentId: string;
    readonly openedAt: number;
  }[];
  #theme: ThemeView;
  #firstRun: boolean;
  #notice: string | null = null;
  #reminderStatus: string | null = null;
  #relay: RelayView = {
    state: "off",
    on: false,
    address: null,
    fingerprint: null,
    code: null,
    consoleUrl: null,
    restartCount: 0,
    lastError: null,
  };
  #closed = false;

  constructor(options: {
    readonly packs: readonly PackInfo[];
    readonly catalogue?: readonly CatalogueEntry[];
    readonly catalogueSource?: string;
    readonly installedVersions?: readonly InstalledVersionView[];
    readonly spaces: SpaceStore;
    readonly screens: ScreenSet;
    readonly theme: ThemeView;
    readonly firstRun?: boolean;
    readonly relay?: RelayView;
    readonly containerId?: string;
    /** The pack's documents, read from the store on each picker open. */
    readonly listDocuments?: (
      packId: string,
    ) => Promise<readonly { readonly id: string; readonly name: string }[]>;
    /** The host's own recent rows, so the picker can order documents. */
    readonly recentRows?: () => readonly {
      readonly packId: string;
      readonly documentId: string;
      readonly openedAt: number;
    }[];
    readonly onViewClosed?: (tabId: string) => void;
    readonly onClosed?: () => void;
  }) {
    this.#packs = options.packs;
    this.#catalogue = options.catalogue ?? [];
    this.#catalogueSource = options.catalogueSource ?? "";
    this.#installedVersions = options.installedVersions ?? [];
    this.#spaces = options.spaces;
    this.#screens = options.screens;
    this.#containerId = options.containerId ?? DEFAULT_CONTAINER_ID;
    this.#listDocuments = options.listDocuments ?? (async () => []);
    this.#recentRows = options.recentRows ?? (() => []);
    this.#onViewClosed = options.onViewClosed;
    this.#theme = options.theme;
    this.#firstRun = options.firstRun ?? false;
    this.#relay = options.relay ?? this.#relay;

    this.window = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 760,
      minHeight: 520,
      show: false,
      title: "Suite Desk",
      backgroundColor: "#0b0d12",
    });

    this.#chrome = new WebContentsView({
      webPreferences: {
        preload: join(app.getAppPath(), "dist", "preload", "chrome.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    this.#chrome.setBackgroundColor("#0b0d12");
    this.window.contentView.addChildView(this.#chrome);
    this.window.on("resize", () => this.#layout());
    this.window.on("closed", () => {
      this.#close();
      options.onClosed?.();
    });

    this.#chrome.webContents.setWindowOpenHandler(({ url }) => {
      this.openExternal(url);
      return { action: "deny" };
    });
    this.#chrome.webContents.on("will-navigate", (event, url) => {
      if (originKey(url) !== originKey(CHROME_ORIGIN)) event.preventDefault();
    });
    this.#chrome.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(`[desk] the chrome page failed to load ${url}: ${description} (${code})`);
      // A hidden window with a live process is worse than an empty one: the
      // person can at least close it and see the log.
      this.window.show();
    });

    this.#layout();
    void this.#chrome.webContents.loadURL(`${CHROME_ORIGIN}/index.html`).catch((error: unknown) => {
      console.error("[desk] the chrome page failed to load", error);
    });
    this.#chrome.webContents.once("did-finish-load", () => {
      this.#layout();
      this.window.show();
      // A restored space document can name an active tab. The tab strip draws it, but
      // the pack view only exists after it is activated; do that once the chrome
      // can receive the state it produces.
      const active = this.#spaces.state().activeTabId;
      if (active === null) this.broadcast();
      else {
        void this.activateTab(active).catch((error: unknown) => {
          console.warn("[desk] could not restore the active tab", error);
          this.broadcast();
        });
      }
    });
  }

  state(): ShellState {
    const spaceState = this.#spaces.state();
    return {
      tabs: spaceState.tabs,
      activeTabId: spaceState.activeTabId,
      surface: shellSurface(spaceState),
      firstRun: this.#firstRun,
      screens: this.#screenViews(spaceState),
      screenList: this.#screens.summaries().map((screen) => ({
        id: screen.id,
        name: screen.name,
        home: screen.id === this.#screens.homeId,
        open: spaceState.tabs.some((tab) => tab.kind === "screen" && tab.screenId === screen.id),
        readable: screen.readable,
      })),
      homeScreenId: this.#screens.homeId,
      screenManagerNote: this.#screenManagerNote,
      packs: this.#packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        description: pack.description,
        entry: pack.entry,
        capabilities: pack.capabilities,
        source: pack.source,
        publisher: pack.publisher,
        consent: pack.consent ?? [],
      })),
      catalogue: this.#catalogue,
      catalogueSource: this.#catalogueSource,
      installedVersions: this.#installedVersions,
      theme: this.#theme,
      themeChoices: themeOptions().map((theme) => ({ id: theme.id, name: theme.name })),
      notice: this.#notice,
      reminderStatus: this.#reminderStatus,
      relay: this.#relay,
    };
  }

  /**
   * One view per screen tab the space document names.
   *
   * A tab whose Screen is no longer on this device stays in the strip and draws an
   * unavailable placeholder instead of silently becoming a pack.
   */
  #screenViews(spaceState: SpaceState): readonly ScreenView[] {
    const registry = shellWidgetRegistry(this.#packs);
    const width = this.window.getContentBounds().width;
    const views: ScreenView[] = [];
    const seen = new Set<string>();

    for (const tab of spaceState.tabs) {
      if (tab.kind !== "screen" || seen.has(tab.screenId)) continue;
      seen.add(tab.screenId);
      const screen = this.#screens.screen(tab.screenId);
      if (screen !== null) {
        views.push(screenView(screen, this.#packs, registry, width));
        continue;
      }
      views.push({
        id: tab.screenId,
        name: tab.title,
        available: false,
        widgets: [],
        choices: [],
      });
    }

    return views;
  }

  broadcast(): void {
    if (this.#closed) return;
    const state = this.state();
    this.#chrome.webContents.send(CHROME_STATE, state);
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    this.window.setTitle(active === undefined ? "Suite Desk" : `${active.title} — Suite Desk`);
  }

  async openPack(packId: string, launch: PackLaunchContext = LAUNCHER_CONTEXT): Promise<void> {
    const pack = this.#packs.find((candidate) => candidate.id === packId);
    if (pack === undefined) {
      this.#notice = `No pack named ${packId} is installed.`;
      this.broadcast();
      return;
    }

    await this.#openPackTab(pack, launch, pack.name);
  }

  /**
   * Open one of a pack's documents in its own tab.
   *
   * A document already showing is focused instead of duplicated. The title is the document's own
   * name, because that is what the person chose in the picker.
   */
  async openDocument(packId: string, documentId: string): Promise<void> {
    const pack = this.#packs.find((candidate) => candidate.id === packId);
    if (pack === undefined) {
      this.#notice = `No pack named ${packId} is installed.`;
      this.broadcast();
      return;
    }
    const open = [...this.#tabDocuments.entries()].find(
      ([, document]) => document.packId === packId && document.documentId === documentId,
    );
    if (open !== undefined) {
      await this.activateTab(open[0]);
      return;
    }
    await this.#openPackTab(pack, { kind: "document", documentId }, documentId, {
      packId,
      documentId,
    });
  }

  /** Ask a pack to make a document and open it. The tab is named before the pack answers. */
  async newDocument(packId: string): Promise<void> {
    const pack = this.#packs.find((candidate) => candidate.id === packId);
    if (pack === undefined) {
      this.#notice = `No pack named ${packId} is installed.`;
      this.broadcast();
      return;
    }
    const noun = packNoun(pack)?.singular ?? "document";
    await this.#openPackTab(pack, { kind: "create" }, `New ${noun}`);
  }

  /** The picker's data: packs, their documents, Screens and what already has a tab. */
  async picker(): Promise<PickerData> {
    const recents = new Map<string, number>();
    for (const row of this.#recentRows()) {
      recents.set(`${row.packId}\u0000${row.documentId}`, row.openedAt);
    }

    const packs: PickerPackView[] = [];
    for (const pack of this.#packs) {
      const declared = pack.documents ?? [];
      let documents: PickerData["packs"][number]["documents"] = null;
      if (declared.length > 0) {
        try {
          documents = (await this.#listDocuments(pack.id)).map((document) => ({
            id: document.id,
            name: document.name,
            openedAt: recents.get(`${pack.id}\u0000${document.id}`) ?? null,
          }));
        } catch {
          // An unreadable list is an empty one; the pack can still be opened.
          documents = [];
        }
      }
      packs.push({
        id: pack.id,
        name: pack.name,
        description: pack.description ?? null,
        noun: packNoun(pack),
        documents,
        unavailable: false,
      });
    }

    return {
      packs,
      screens: this.#screens.summaries().map((screen) => ({ id: screen.id, name: screen.name })),
      openDocuments: [...this.#tabDocuments.values()],
    };
  }

  async #openPackTab(
    pack: PackInfo,
    launch: PackLaunchContext,
    title: string,
    document?: { readonly packId: string; readonly documentId: string },
  ): Promise<void> {
    const tab = await this.#spaces.openTab({
      kind: "pack",
      packId: pack.id,
      title,
      entry: pack.entry,
    });
    this.#launchContexts.set(tab.id, launch);
    if (document !== undefined) this.#tabDocuments.set(tab.id, document);
    this.#notice = null;
    await this.activateTab(tab.id);
  }

  /**
   * Route a `suite://` link to its installed pack.
   *
   * The link never installs or updates. An unknown or malformed link returns to
   * the launcher so the refusal sentence is visible. An already-open tab for the
   * pack is focused and receives the new context; otherwise a tab opens with the
   * context stored before its view is created.
   */
  async openDeepLink(link: string): Promise<void> {
    const parsed = parseSuiteLink(link, this.#packs);
    if (!parsed.ok) {
      this.#notice = parsed.message;
      // Home is where a host sentence is visible; the launcher is no longer a second
      // copy of the pack grid.
      await this.openHome().catch(() => undefined);
      this.broadcast();
      return;
    }

    const { pack, launch } = parsed.value;
    const open = this.#spaces
      .state()
      .tabs.find((tab) => tab.kind === "pack" && tab.packId === pack.id);
    if (open !== undefined) {
      this.#launchContexts.set(open.id, launch);
      this.#notice = null;
      await this.activateTab(open.id);
      const view = this.#views.get(open.id);
      if (view !== undefined && !view.webContents.isDestroyed()) {
        view.webContents.send(PACK_EVENT.deepLink, parsed.value.url);
      }
      return;
    }

    const tab = await this.#spaces.openTab({
      kind: "pack",
      packId: pack.id,
      title: pack.name,
      entry: pack.entry,
    });
    this.#launchContexts.set(tab.id, launch);
    this.#notice = null;
    await this.activateTab(tab.id);
  }

  /** The launch context for a tab the main process derived from the sender. */
  launchFor(tabId: string): PackLaunchContext {
    return this.#launchContexts.get(tabId) ?? LAUNCHER_CONTEXT;
  }

  async activateTab(tabId: string | null): Promise<void> {
    await this.#spaces.activateTab(tabId);
    const state = this.#spaces.state();
    const tab = tabId === null ? undefined : state.tabs.find((entry) => entry.id === tabId);
    if (tab === undefined) {
      this.#hideViews();
      this.#chrome.webContents.focus();
      this.broadcast();
      return;
    }

    // A screen tab is host chrome, not a pack view. The chrome page draws the
    // composition in the same content area; hiding every pack view is what makes it
    // visible, because a pack view is layered over that area.
    if (tab.kind === "screen") {
      this.#hideViews();
      this.#chrome.webContents.focus();
      this.broadcast();
      return;
    }

    let view: WebContentsView;
    try {
      view = this.#viewFor(tab);
    } catch (error) {
      this.#notice = error instanceof Error ? error.message : String(error);
      // The tab stays in the strip for the person to close; Home is where the
      // sentence can be read, and it is the host's own surface rather than a second
      // copy of the launcher.
      await this.openHome().catch(() => undefined);
      this.broadcast();
      return;
    }

    for (const [id, candidate] of this.#views) {
      candidate.setVisible(id === tab.id);
    }
    this.#layout();
    view.webContents.focus();
    this.broadcast();
  }

  async closeTab(tabId: string): Promise<void> {
    const next = await this.#spaces.closeTab(tabId);
    this.#launchContexts.delete(tabId);
    this.#tabDocuments.delete(tabId);
    const view = this.#views.get(tabId);
    if (view !== undefined) {
      this.#views.delete(tabId);
      this.window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) {
        clearPackSender(view.webContents.id);
        clearProjectionEntries(view.webContents.id);
        clearCommandEntries(view.webContents.id);
        // A page's `beforeunload` may cancel `window.close`, leaving a token
        // owned by a tab that is no longer open. Closing without waiting
        // destroys the contents, so `destroyed` and the lock release run.
        view.webContents.close({ waitForBeforeUnload: false });
      }
    }
    await this.activateTab(next);
  }

  /** Close several tabs, in the order the caller chose, before an uninstall. */
  async closeTabs(tabIds: readonly string[]): Promise<void> {
    for (const tabId of tabIds) {
      await this.closeTab(tabId);
    }
  }

  async newTab(): Promise<void> {
    this.pick();
  }

  /** Ask the chrome to show the new-tab picker; the picker owns the rest. */
  pick(): void {
    if (this.#closed) return;
    this.#chrome.webContents.send(CHROME_PICK);
  }

  /** Open the Home screen tab, or activate the one already showing it. */
  async openHome(): Promise<void> {
    await this.openScreen(this.#screens.homeId);
  }

  /** Open one Screen tab, or activate the tab already showing it. */
  async openScreen(screenId: string): Promise<void> {
    const screen = this.#screens.screen(screenId);
    if (screen === null) {
      this.#notice = "That Screen is no longer here.";
      this.broadcast();
      return;
    }
    const open = this.#spaces
      .state()
      .tabs.find((tab) => tab.kind === "screen" && tab.screenId === screen.id);
    if (open !== undefined) {
      await this.activateTab(open.id);
      return;
    }

    const tab = await this.#spaces.openTab({
      kind: "screen",
      screenId: screen.id,
      title: screen.name,
    });
    await this.activateTab(tab.id);
  }

  /** The Screen the active tab draws, if the active tab is a Screen. */
  #activeScreenStore() {
    const active = this.#spaces
      .state()
      .tabs.find((tab) => tab.id === this.#spaces.state().activeTabId);
    if (active === undefined || active.kind !== "screen") return null;
    return this.#screens.store(active.screenId);
  }

  /**
   * Add one placement to the active Screen. The registry decides its first size, and
   * a duplicate id is refused by the document, which says so in the notice.
   */
  async addScreenWidget(registryId: string): Promise<void> {
    if (!isWidgetRegistryId(registryId)) return;
    const store = this.#activeScreenStore();
    if (store === null) return;
    const registry = shellWidgetRegistry(this.#packs);
    const added = await store.add({
      registryId,
      size: preferredWidgetSize(registryId, registry),
    });
    this.#notice = added ? null : `${registryId} is already on this Screen.`;
    this.broadcast();
  }

  async removeScreenWidget(registryId: string): Promise<void> {
    if (!isWidgetRegistryId(registryId)) return;
    await this.#activeScreenStore()?.remove(registryId);
    this.#notice = null;
    this.broadcast();
  }

  async moveScreenWidget(registryId: string, direction: string): Promise<void> {
    if (!isWidgetRegistryId(registryId)) return;
    if (direction !== "earlier" && direction !== "later") return;
    await this.#activeScreenStore()?.moveBy(registryId, direction);
    this.broadcast();
  }

  async resizeScreenWidget(registryId: string, size: string): Promise<void> {
    if (!isWidgetRegistryId(registryId)) return;
    if (!isWidgetSize(size)) return;
    await this.#activeScreenStore()?.resize(registryId, size);
    this.broadcast();
  }

  /** Create a Screen, then show it in a tab. */
  async createScreen(name: string): Promise<void> {
    this.#screenManagerNote = null;
    const id = await this.#screens.create(name);
    await this.openScreen(id);
    this.broadcast();
  }

  async renameScreen(screenId: string, name: string): Promise<void> {
    const renamed = await this.#screens.rename(screenId, name);
    this.#screenManagerNote = renamed ? null : "That Screen is no longer here.";
    await this.#retitleScreenTab(screenId);
    this.broadcast();
  }

  async duplicateScreen(screenId: string): Promise<void> {
    this.#screenManagerNote = null;
    const copy = await this.#screens.duplicate(screenId);
    if (copy === null) {
      this.#screenManagerNote = "That Screen is no longer here.";
      this.broadcast();
      return;
    }
    await this.openScreen(copy);
    this.broadcast();
  }

  async deleteScreen(screenId: string, replacementId: string | null): Promise<void> {
    const removal = await this.#screens.remove(screenId, replacementId);
    if (!removal.ok) {
      this.#screenManagerNote = removal.message;
      this.broadcast();
      return;
    }

    this.#screenManagerNote = null;
    for (const tab of this.#spaces.state().tabs) {
      if (tab.kind === "screen" && tab.screenId === screenId) {
        await this.#spaces.closeTab(tab.id);
      }
    }
    await this.openHome();
    this.broadcast();
  }

  async setHomeScreen(screenId: string): Promise<void> {
    const changed = await this.#screens.setHome(screenId);
    this.#screenManagerNote = changed ? null : "That Screen is no longer here.";
    if (changed) {
      const screen = this.#screens.screen(screenId);
      if (screen !== null) await this.#retitleScreenTab(screenId);
    }
    this.broadcast();
  }

  /**
   * The context menu for one tab.
   *
   * A Screen tab can become Home; a pack tab can reload. Both close, and Close is the menu's
   * last item so the destructive choice is not where a hurried click lands first.
   */
  showTabMenu(tabId: string): void {
    const tab = this.#spaces.state().tabs.find((entry) => entry.id === tabId);
    if (tab === undefined) return;
    const items: MenuItemConstructorOptions[] = [];

    if (tab.kind === "screen") {
      const isHome = tab.screenId === this.#screens.homeId;
      items.push({
        label: isHome ? "This is Home" : "Set as Home",
        enabled: !isHome,
        click: () => {
          void this.setHomeScreen(tab.screenId);
        },
      });
    } else {
      items.push({
        label: "Reload Tab",
        click: () => {
          this.reloadTab(tab.id);
        },
      });
    }

    items.push(
      {
        label: "Settings…",
        click: () => {
          this.openSettings(tab.kind === "screen" ? "home" : "appearance");
        },
      },
      { type: "separator" },
      {
        label: "Close Tab",
        accelerator: process.platform === "darwin" ? "Cmd+W" : "Ctrl+W",
        click: () => {
          void this.closeTab(tab.id);
        },
      },
    );

    Menu.buildFromTemplate(items).popup({ window: this.window });
  }

  /** Ask the chrome to draw Settings; the page owns the surface and its section. */
  openSettings(section?: "appearance" | "home" | "packs"): void {
    if (this.#closed) return;
    this.#chrome.webContents.send(CHROME_SETTINGS, section ?? null);
  }

  /** Keep a renamed Screen's tab title in step with its document. */
  async #retitleScreenTab(screenId: string): Promise<void> {
    const screen = this.#screens.screen(screenId);
    if (screen === null) return;
    for (const tab of this.#spaces.state().tabs) {
      if (tab.kind === "screen" && tab.screenId === screenId) {
        await this.#spaces.setTitle(tab.id, screen.name);
      }
    }
  }

  reloadTab(tabId: string): void {
    this.#views.get(tabId)?.webContents.reload();
  }

  async setTabTitle(tabId: string, title: string): Promise<void> {
    await this.#spaces.setTitle(tabId, title);
    this.broadcast();
  }

  setTheme(theme: ThemeView): void {
    this.#theme = theme;
    this.broadcast();
    // A theme is host state, so every open pack moves with it instead of waiting for a
    // reload. The chrome is repainted by the broadcast above.
    for (const [tabId, view] of this.#views) this.#paintPackTheme(tabId, view);
  }

  setFirstRun(firstRun: boolean): void {
    if (this.#firstRun === firstRun) return;
    this.#firstRun = firstRun;
    this.broadcast();
  }

  /**
   * Paint the host's resolved tokens onto one pack view.
   *
   * Two halves: the stylesheet carries the values and `color-scheme`, and a constant script
   * carries the attributes a stylesheet may key off. Neither reads anything from the pack,
   * and both are replaced rather than appended on the next change.
   */
  #paintPackTheme(tabId: string, view: WebContentsView): void {
    if (view.webContents.isDestroyed()) return;
    void paintThemeSurface(view.webContents, this.#theme, this.#themeKeys.get(tabId))
      .then((key) => this.#themeKeys.set(tabId, key))
      .catch(() => undefined);
  }

  /** Replace the launcher's data without rebuilding the window. */
  setPackData(
    packs: readonly PackInfo[],
    catalogue: readonly CatalogueEntry[] = this.#catalogue,
    installedVersions: readonly InstalledVersionView[] = this.#installedVersions,
    catalogueSource: string = this.#catalogueSource,
  ): void {
    this.#packs = packs;
    this.#catalogue = catalogue;
    this.#installedVersions = installedVersions;
    this.#catalogueSource = catalogueSource;
    this.broadcast();
  }

  /** Show a host-owned message, such as the result of an install. */
  setNotice(message: string | null): void {
    this.#notice = message;
    this.broadcast();
  }

  /** Show the reminder permission state, or clear it on Home. */
  setReminderStatus(message: string | null): void {
    if (this.#reminderStatus === message) return;
    this.#reminderStatus = message;
    this.broadcast();
  }

  /** Replace the relay state the chrome draws. */
  setRelayStatus(relay: RelayView): void {
    this.#relay = relay;
    this.broadcast();
  }

  openExternal(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      void shell.openExternal(parsed.toString()).catch(() => undefined);
    } catch {
      // A malformed URL is not something to hand to the OS.
    }
  }

  /**
   * Show a file the host owns in the platform file manager.
   *
   * The path is resolved by the document store in the main process; no pack ever
   * sees it. The window is host chrome, so the action is the host's.
   */
  revealFile(path: string): void {
    shell.showItemInFolder(path);
  }

  focus(): void {
    if (this.#closed) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  #viewFor(tab: PackShellTab): WebContentsView {
    const existing = this.#views.get(tab.id);
    if (existing !== undefined) return existing;

    const target = tabViewTarget(this.#packs, tab, this.#containerId);
    if (target === null) throw new Error(`pack ${tab.packId} is no longer installed`);
    const { pack } = target;

    configurePackSession(pack, this.#containerId);
    const view = new WebContentsView({
      webPreferences: {
        preload: join(app.getAppPath(), "dist", "preload", "pack.cjs"),
        session: session.fromPartition(
          packPartition(pack.id, this.#containerId, pack.publisher?.id ?? SUITE_PUBLISHER_ID),
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true,
      },
    });
    const webContentsId = view.webContents.id;
    view.setBackgroundColor("#0b0d12");
    this.window.contentView.addChildView(view);
    this.#views.set(tab.id, view);
    setPackSender(webContentsId, {
      containerId: this.#containerId,
      packId: pack.id,
      tabId: tab.id,
      pack,
      webContentsId,
      webContents: view.webContents,
    });

    view.webContents.setWindowOpenHandler(({ url }) => {
      const link = externalLinkFor(pack, url);
      if (link !== null) this.openExternal(link);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      if (originKey(url) !== originKey(packOrigin(pack.id, this.#containerId))) {
        event.preventDefault();
      }
    });
    view.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    view.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.#notice = `${pack.name} failed to load ${url}: ${description} (${code}).`;
      this.broadcast();
    });
    view.webContents.on("did-finish-load", () => {
      // Theme tokens are host-provided. A pack may style itself from them, but it does not
      // ship a copy of the palette and it cannot choose a different one.
      this.#paintPackTheme(tab.id, view);
      if (this.#notice?.startsWith(pack.name) === true) {
        this.#notice = null;
        this.broadcast();
      }
    });
    view.webContents.on("did-start-navigation", (details) => {
      // A reload or a same-origin navigation replaces the document that held
      // the tab's locks. Same-document navigation keeps that page alive.
      if (!navigationReleasesLocks(details.isMainFrame, details.isSameDocument)) return;
      this.#onViewClosed?.(tab.id);
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      // The page that held the tokens is gone even though the view may reload.
      this.#onViewClosed?.(tab.id);
      this.#notice = `${pack.name} stopped: ${details.reason}.`;
      this.broadcast();
    });
    view.webContents.once("destroyed", () => {
      clearPackSender(webContentsId);
      clearProjectionEntries(webContentsId);
      clearCommandEntries(webContentsId);
      this.#themeKeys.delete(tab.id);
      // Locks are owned by the tab id. A destroyed view cannot release its own
      // writer, so the host does it here.
      this.#onViewClosed?.(tab.id);
    });

    void view.webContents.loadURL(target.url).catch((error: unknown) => {
      this.#notice = `${pack.name} failed to load: ${error instanceof Error ? error.message : String(error)}`;
      this.broadcast();
    });
    return view;
  }

  #layout(): void {
    if (this.#closed) return;
    const { width, height } = this.window.getContentBounds();
    this.#chrome.setBounds({ x: 0, y: 0, width, height });
    const contentHeight = Math.max(0, height - TAB_BAR_HEIGHT);
    for (const view of this.#views.values()) {
      view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width, height: contentHeight });
    }
  }

  #hideViews(): void {
    for (const view of this.#views.values()) view.setVisible(false);
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const view of this.#views.values()) {
      if (!view.webContents.isDestroyed()) {
        clearPackSender(view.webContents.id);
        clearProjectionEntries(view.webContents.id);
        clearCommandEntries(view.webContents.id);
        view.webContents.close({ waitForBeforeUnload: false });
      }
    }
    this.#views.clear();
    if (!this.#chrome.webContents.isDestroyed()) {
      this.#chrome.webContents.close({ waitForBeforeUnload: false });
    }
  }
}

/**
 * A pack's session is its storage boundary and its network policy.
 *
 * Permissions are denied wholesale. A pack without `network` may reach only its
 * own `suite-pack://` origin; a pack with the capability may also reach HTTPS and
 * WSS. The CSP set by the protocol handler is the second line.
 */
function configurePackSession(pack: PackInfo, containerId: string): void {
  const partition = packPartition(pack.id, containerId, pack.publisher?.id ?? SUITE_PUBLISHER_ID);
  if (configuredPartitions.has(partition)) return;
  configuredPartitions.add(partition);

  const packSession = session.fromPartition(partition);
  registerPackProtocol(packSession, pack, containerId);
  packSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  packSession.setPermissionCheckHandler(() => false);
  // A download writes outside the pack's document root and has no size cap. A
  // pack that needs to export a file must use the host's file service (later).
  packSession.on("will-download", (event) => event.preventDefault());

  const network = pack.capabilities.includes("network");
  const ownOrigin = packOrigin(pack.id, containerId);
  packSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const local =
      url.startsWith(`${ownOrigin}/`) ||
      url.startsWith("devtools:") ||
      url.startsWith("blob:") ||
      url.startsWith("data:");
    if (local) {
      callback({});
      return;
    }
    if (network && (url.startsWith("https:") || url.startsWith("wss:"))) {
      callback({});
      return;
    }
    callback({ cancel: true });
  });
}
