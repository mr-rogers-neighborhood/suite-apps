/*
 * The chrome page.
 *
 * It draws the tab strip, and the Screen the active tab names. A pack tab is covered by
 * its own WebContentsView, so this page draws only the tab strip and the empty state
 * while a pack is active. A Screen tab is host chrome: the composition fills the same
 * area the launcher used to.
 *
 * The page is a read-only view of the state the main process pushes. It never reads a
 * file, keeps no document state, and calls host actions that answer with the new state.
 */

import { colorFor, mountFirstRun, mountTabBar } from "./tab-bar.js";

const api = globalThis.suiteShell;

const elements = {
  hostBar: document.querySelector("#host-bar"),
  firstRun: document.querySelector("#first-run"),
  content: document.querySelector(".content"),
  settings: document.querySelector("#settings-surface"),
  settingsClose: document.querySelector("#settings-close"),
  settingsNav: document.querySelectorAll("#settings-nav button"),
  settingsAppearance: document.querySelector("#settings-appearance"),
  settingsHome: document.querySelector("#settings-home"),
  settingsPacks: document.querySelector("#settings-packs"),
  settingsPresets: document.querySelector("#settings-presets"),
  settingsModes: document.querySelector("#settings-modes"),
  settingsDensities: document.querySelector("#settings-densities"),
  settingsScreens: document.querySelector("#settings-screens"),
  settingsApps: document.querySelector("#settings-apps"),
  screen: document.querySelector("#screen"),
  screenName: document.querySelector("#screen-name"),
  screenEyebrow: document.querySelector(".screen-title .eyebrow"),
  widgets: document.querySelector("#widgets"),
  notice: document.querySelector("#notice"),
  reminderStatus: document.querySelector("#reminder-status"),
  editToggle: document.querySelector("#edit-toggle"),
  screensToggle: document.querySelector("#screens-toggle"),
  screensPanel: document.querySelector("#screens-panel"),
  screensList: document.querySelector("#screens-list"),
  screensNote: document.querySelector("#screens-note"),
  screenNewName: document.querySelector("#screen-new-name"),
  createScreen: document.querySelector("#create-screen"),
  importScreen: document.querySelector("#import-screen"),
  editBar: document.querySelector("#edit-bar"),
  widgetChoice: document.querySelector("#widget-choice"),
  addWidget: document.querySelector("#add-widget"),
  empty: document.querySelector("#empty"),
  openHome: document.querySelector("#open-home"),
  syncPanel: document.querySelector("#sync-panel"),
  syncState: document.querySelector("#sync-state"),
  syncAddress: document.querySelector("#sync-address"),
  syncFingerprint: document.querySelector("#sync-fingerprint"),
  syncCode: document.querySelector("#sync-code"),
  syncError: document.querySelector("#sync-error"),
  syncStart: document.querySelector("#sync-start"),
  syncStop: document.querySelector("#sync-stop"),
  commandSurface: document.querySelector("#command-surface"),
  commandClose: document.querySelector("#command-close"),
  commandApp: document.querySelector("#command-app"),
  commandScope: document.querySelector("#command-scope"),
  commandQuery: document.querySelector("#command-query"),
  commandNote: document.querySelector("#command-note"),
  commandResults: document.querySelector("#command-results"),
  commandScopePanel: document.querySelector("#command-scope-panel"),
  commandScopeTitle: document.querySelector("#command-scope-title"),
  commandScopeAge: document.querySelector("#command-scope-age"),
  commandItems: document.querySelector("#command-items"),
  commandClearRecents: document.querySelector("#command-clear-recents"),
  commandHint: document.querySelector("#command-hint"),
  commandModes: [...document.querySelectorAll(".command-mode")],
};

const SIZES = ["1x1", "2x1", "full"];

const RELAY_LABELS = {
  off: "Off",
  starting: "Starting…",
  on: "On",
  stopping: "Stopping…",
  crashed: "Restarting after a crash",
  failed: "Stopped after repeated crashes",
};

const EMPTY_RELAY = {
  state: "off",
  on: false,
  address: null,
  fingerprint: null,
  code: null,
  consoleUrl: null,
  restartCount: 0,
  lastError: null,
};

let state = {
  tabs: [],
  activeTabId: null,
  surface: "launcher",
  firstRun: false,
  screens: [],
  screenList: [],
  homeScreenId: "",
  screenManagerNote: null,
  packs: [],
  catalogue: [],
  catalogueSource: "",
  installedVersions: [],
  theme: {
    preset: "suite",
    mode: "dark",
    source: "system",
    density: "cozy",
    values: {},
    scale: {},
  },
  themeChoices: [],
  notice: null,
  reminderStatus: null,
  relay: { ...EMPTY_RELAY },
};
let query = "";
let editing = false;
let managingScreens = false;
let syncOpen = false;
let tabBar = null;
let firstRunWizard = null;
/** The host Settings surface is chrome state, like the Screens manager. */
let settingsOpen = false;
let settingsSection = "appearance";
let shouldFocusSearch = true;
let appsView = {
  packs: null,
  packCount: null,
  catalogue: null,
  catalogueCount: null,
  catalogueSource: null,
  search: null,
};

/**
 * Command Surface state (#225).
 *
 * The page owns only what a person typed and which row is highlighted. The host
 * owns discovery, consent, ranking and every provider call, so no pack code and
 * no document state live here.
 */
let commandOpen = false;
let commandMode = "command";
let commandAppId = "*";
let commandScopeId = "global";
let commandListing = { commands: [], apps: [], recent: [], notice: null };
let commandItemsView = null;
let commandSearchView = null;
let commandChosen = 0;
let commandBusy = false;
let commandMessage = null;

function commandApp() {
  return (
    commandListing.apps.find((app) => (app.id ?? "") === commandAppId) ??
    commandListing.apps[0] ??
    null
  );
}

function commandAppValue(app) {
  return app.id ?? "";
}

function commandScopeChoices() {
  const app = commandApp();
  if (app === null || app.scopes.length === 0) return ["global"];
  return app.scopes;
}

function commandMatchesApp(command) {
  if (commandAppId === "*") return true;
  if (commandAppId === "") return command.source === "host";
  return command.packId === commandAppId;
}

function visibleCommands() {
  return commandListing.commands.filter(commandMatchesApp);
}

function visibleHits() {
  return commandSearchView?.hits ?? [];
}

function selectedCount() {
  if (commandMode === "search") return visibleHits().length;
  if (commandMode === "command") return visibleCommands().length;
  return 0;
}

function showCommandMessage(message) {
  commandMessage = message;
  elements.commandNote.hidden = message === null || message === undefined || message === "";
  elements.commandNote.textContent = message ?? "";
}

function renderCommandApps() {
  const fragment = document.createDocumentFragment();
  const all = element("option", "", "All apps");
  all.value = "*";
  fragment.append(all);
  for (const app of commandListing.apps) {
    const option = element("option", "", app.name);
    option.value = commandAppValue(app);
    fragment.append(option);
  }
  elements.commandApp.replaceChildren(fragment);
  elements.commandApp.value = commandAppId;

  const scopes = commandScopeChoices();
  if (!scopes.includes(commandScopeId)) commandScopeId = scopes[0] ?? "global";
  const scopeFragment = document.createDocumentFragment();
  for (const scope of scopes) {
    const option = element("option", "", scope);
    option.value = scope;
    scopeFragment.append(option);
  }
  elements.commandScope.replaceChildren(scopeFragment);
  elements.commandScope.value = commandScopeId;
  elements.commandScope.disabled = commandAppId === "*" || commandAppId === "";
}

function renderCommandResults() {
  elements.commandResults.replaceChildren();
  commandChosen = Math.min(commandChosen, Math.max(0, selectedCount() - 1));

  if (commandMode === "search") {
    const hits = visibleHits();
    if (hits.length === 0) {
      elements.commandResults.append(
        element("p", "empty", "No search results yet. Keep typing, or open the app to search it."),
      );
      return;
    }
    hits.forEach((hit, index) => {
      const row = element("button", "command-result");
      row.type = "button";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === commandChosen));
      row.append(
        element("span", "", hit.title),
        element("span", "command-result-subtitle", hit.subtitle ?? ""),
        element("span", "command-result-source", hit.packName),
      );
      row.addEventListener("click", () => {
        commandChosen = index;
        void invokeSelectedCommand();
      });
      elements.commandResults.append(row);
    });
    return;
  }

  if (commandMode === "capture") {
    elements.commandResults.append(
      element(
        "p",
        "empty",
        commandAppId === "*" || commandAppId === ""
          ? "Choose an app and a scope, then type what to capture."
          : "Type what to capture, then press Enter.",
      ),
    );
    return;
  }

  const commands = visibleCommands();
  if (commands.length === 0) {
    elements.commandResults.append(
      element("p", "empty", `No command matches “${elements.commandQuery.value.trim()}”.`),
    );
    return;
  }
  commands.forEach((command, index) => {
    const row = element("button", "command-result");
    row.type = "button";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === commandChosen));
    row.append(
      element("span", "", command.title),
      element("span", "command-result-subtitle", command.subtitle ?? ""),
      element("span", "command-result-source", command.packName),
    );
    row.addEventListener("click", () => {
      commandChosen = index;
      void invokeSelectedCommand();
    });
    elements.commandResults.append(row);
  });
}

function renderCommandScopePanel() {
  const visible = commandMode === "capture" && commandAppId !== "*" && commandAppId !== "";
  elements.commandScopePanel.hidden = !visible;
  if (!visible) return;

  const app = commandApp();
  elements.commandScopeTitle.textContent = `${app?.name ?? commandAppId} · ${commandScopeId}`;
  elements.commandItems.replaceChildren();
  const view = commandItemsView;
  if (view === null) {
    elements.commandScopeAge.textContent = "Not loaded";
    elements.commandItems.append(
      element("li", "empty", "Choose the app's scope to load its rows."),
    );
    return;
  }

  if (view.ageMs === null) {
    elements.commandScopeAge.textContent = view.placeholder ? "Placeholder" : "Live";
  } else if (view.stale) {
    elements.commandScopeAge.textContent = `${Math.max(0, Math.round(view.ageMs / 1000))}s old`;
  } else {
    elements.commandScopeAge.textContent = "Live";
  }

  if (view.message !== null && view.message !== undefined) {
    elements.commandItems.append(
      element("li", view.stale ? "card-warning" : "widget-muted", view.message),
    );
  }
  for (const item of view.items ?? []) {
    const row = element("li");
    const button = element(
      "button",
      item.done ? "command-item command-item-done" : "command-item",
      item.title,
    );
    button.type = "button";
    button.addEventListener("click", () => {
      void runCommandAction(async () => {
        const outcome = await api.commandOpen(commandAppId, commandScopeId, item.id);
        showCommandMessage(outcome?.message ?? "The host did not answer.");
        await refreshCommandSurface();
      });
    });
    if (item.detail) button.append(element("span", "command-item-detail", item.detail));
    row.append(button);
    elements.commandItems.append(row);
  }
}

function renderCommandSurface() {
  elements.commandSurface.hidden = !commandOpen;
  if (!commandOpen) return;

  for (const button of elements.commandModes) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === commandMode));
  }
  elements.commandQuery.placeholder =
    commandMode === "capture"
      ? "What do you want to capture?"
      : commandMode === "search"
        ? "Search installed apps…"
        : "Type a command name…";
  elements.commandHint.textContent =
    commandMode === "capture"
      ? "Enter to capture · ↑↓ to choose a scope · Esc to close"
      : commandMode === "search"
        ? "Enter to open a result · Esc to close"
        : "↑↓ to choose · Enter to run · Esc to close";
  elements.commandClearRecents.disabled = commandListing.recent.length === 0;

  renderCommandApps();
  renderCommandResults();
  renderCommandScopePanel();
  showCommandMessage(commandMessage ?? commandListing.notice);
}

async function runCommandAction(action) {
  if (commandBusy) return;
  commandBusy = true;
  try {
    await action();
  } catch (error) {
    showCommandMessage(error instanceof Error ? error.message : "The host refused that action.");
  } finally {
    commandBusy = false;
  }
}

async function refreshCommandSurface() {
  if (!commandOpen) return;
  await runCommandAction(async () => {
    const listing = await api.commandList(
      elements.commandQuery.value,
      commandMode,
      commandAppId === "*" ? null : commandAppId,
      commandScopeId,
    );
    if (listing) commandListing = listing;

    const values = commandListing.apps.map(commandAppValue);
    if (!values.includes(commandAppId)) commandAppId = "*";
    const scopes = commandScopeChoices();
    if (!scopes.includes(commandScopeId)) commandScopeId = scopes[0] ?? "global";

    if (commandMode === "search") {
      commandSearchView = await api.commandSearch(elements.commandQuery.value, commandScopeId);
    } else {
      commandSearchView = null;
    }
    if (commandMode === "capture" && commandAppId !== "*" && commandAppId !== "") {
      commandItemsView = await api.commandItems(commandAppId, commandScopeId, 20);
    } else {
      commandItemsView = null;
    }
    commandChosen = 0;
    paint();
  });
}

async function invokeSelectedCommand() {
  if (commandMode === "search") {
    const hit = visibleHits()[commandChosen];
    if (hit === undefined) return;
    await runCommandAction(async () => {
      await api.commandOpenLink(hit.open);
      showCommandMessage(`Opened ${hit.title}.`);
    });
    return;
  }

  if (commandMode === "capture") {
    if (commandAppId === "*" || commandAppId === "") {
      showCommandMessage("Choose an app and a scope first.");
      return;
    }
    const text = elements.commandQuery.value.trim();
    if (text.length === 0) {
      showCommandMessage("Type what to capture first.");
      return;
    }
    await runCommandAction(async () => {
      const outcome = await api.commandCapture(commandAppId, commandScopeId, { title: text });
      showCommandMessage(outcome?.message ?? "The host did not answer.");
      if (outcome?.ok) elements.commandQuery.value = "";
      await refreshCommandSurface();
    });
    return;
  }

  const command = visibleCommands()[commandChosen];
  if (command === undefined) return;
  const text = elements.commandQuery.value.trim();
  const args = command.id === "planner.quick-task" && text.length > 0 ? { title: text } : {};
  await runCommandAction(async () => {
    const outcome = await api.commandInvoke(command.id, command.scope || "global", args);
    showCommandMessage(outcome?.message ?? "The host did not answer.");
    if (outcome?.ok && command.id === "planner.quick-task") elements.commandQuery.value = "";
    await refreshCommandSurface();
  });
}

function openCommandSurface() {
  commandOpen = true;
  commandMessage = null;
  commandMode = "command";
  commandChosen = 0;
  elements.commandQuery.value = "";
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  commandAppId = active !== undefined && active.kind === "pack" ? active.packId : "*";
  commandScopeId = "global";
  paint();
  void refreshCommandSurface();
  elements.commandQuery.focus();
}

function closeCommandSurface() {
  commandOpen = false;
  commandMessage = null;
  paint();
}

function showNotice(message) {
  elements.notice.hidden = false;
  elements.notice.textContent = message;
}

function run(promise) {
  Promise.resolve(promise).catch((error) => {
    showNotice(error instanceof Error ? error.message : "The host refused that action.");
  });
}

/** A widget action answers with the new state; draw it without waiting for the push. */
function runAction(promise) {
  Promise.resolve(promise)
    .then((next) => {
      if (next && Array.isArray(next.tabs)) {
        state = next;
        paint();
      }
    })
    .catch((error) => {
      showNotice(error instanceof Error ? error.message : "The host refused that action.");
    });
}

/** A relay action answers with the relay view only; the rest of the state is unchanged. */
function runRelayAction(promise) {
  Promise.resolve(promise)
    .then((next) => {
      if (next && typeof next.state === "string") {
        state.relay = next;
        paint();
      }
    })
    .catch((error) => {
      showNotice(error instanceof Error ? error.message : "The host refused that action.");
    });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function applyTheme() {
  const root = document.documentElement;
  root.style.colorScheme = state.theme.mode;
  root.dataset.theme = state.theme.preset;
  root.dataset.themeMode = state.theme.mode;
  root.dataset.density = state.theme.density;
  root.classList.toggle("dark", state.theme.mode === "dark");
  for (const [name, value] of Object.entries({
    ...state.theme.values,
    ...state.theme.scale,
  })) {
    root.style.setProperty(name, value);
  }
}

function sizeLabel(size) {
  if (size === "full") return "Full row";
  if (size === "2x1") return "2 × 1";
  return "1 × 1";
}

/** Every registry id one placement draws, including the children of a row. */
function entryRegistryIds(entry) {
  if (entry.kind !== "row") return [entry.registryId];
  return entry.items.map((item) => item.widget.registryId);
}

function nextSize(size) {
  const index = SIZES.indexOf(size);
  return SIZES[(index + 1) % SIZES.length];
}

function openHomeTab() {
  shouldFocusSearch = true;
  run(api.home());
}

/** The picker's New screen: show the Screens manager with the name field ready. */
function composeScreen() {
  managingScreens = true;
  paint();
  elements.screenNewName?.focus();
}

/** Mount the React strip once, then hand it the host's snapshot on every paint. */
function updateHostBar() {
  if (elements.hostBar === null) return;
  if (tabBar === null) {
    tabBar = mountTabBar(elements.hostBar, {
      activate: (id) => run(api.activateTab(id)),
      close: (id) => run(api.closeTab(id)),
      tabMenu: (id) => {
        void api.tabMenu(id);
      },
      newTab: () => run(api.newTab()),
      home: openHomeTab,
      picker: {
        load: () => api.picker(),
        openPack: (id) => run(api.openPack(id)),
        openDocument: (packId, documentId) => run(api.openDocument(packId, documentId)),
        newDocument: (packId) => run(api.newDocument(packId)),
        openScreen: (id) => run(api.openScreen(id)),
        newScreen: composeScreen,
      },
      settings: (section) => openSettings(section),
      openCommands: () => {
        if (commandOpen) closeCommandSurface();
        else openCommandSurface();
      },
      toggleSync: () => {
        syncOpen = !syncOpen;
        paint();
      },
      // The pack's own control was used. The id is the pack's word for it, so the host
      // forwards it unchanged and never decides what it means.
      packMenuAction: (action) => api.packMenuAction(action),
    });
  }
  tabBar.update({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    syncOpen,
    commandOpen,
    relay: { ...EMPTY_RELAY, ...(state.relay ?? {}) },
    packMenu: state.packMenu ?? null,
  });
}

/** Compare dotted versions for the chooser; an unreadable segment sorts low. */
function compareVersions(left, right) {
  const a = String(left).split(/[.+-]/u);
  const b = String(right).split(/[.+-]/u);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const one = Number.parseInt(a[index] ?? "0", 10);
    const two = Number.parseInt(b[index] ?? "0", 10);
    const first = Number.isFinite(one) ? one : 0;
    const second = Number.isFinite(two) ? two : 0;
    if (first !== second) return first < second ? -1 : 1;
  }
  return 0;
}

/**
 * The catalogue as the wizard sees it.
 *
 * One row per app id: a catalogue that still lists two versions offers the highest one, so the
 * person never sees duplicate rows or starts two installs for one id. Status comes from the
 * active install, which also keeps a resumed wizard from calling an installed app "available".
 */
function firstRunPacks() {
  const current = new Map(
    (state.installedVersions ?? [])
      .filter((version) => version.current)
      .map((version) => [version.id, version.version]),
  );
  const entries = new Map();
  for (const entry of state.catalogue ?? []) {
    if (!entry.trusted || entry.publisher === null) continue;
    const existing = entries.get(entry.id);
    if (existing === undefined || compareVersions(entry.version, existing.version) > 0) {
      entries.set(entry.id, entry);
    }
  }

  return [...entries.values()].map((entry) => {
    const installed = current.get(entry.id);
    const status =
      installed === undefined
        ? "available"
        : compareVersions(entry.version, installed) > 0
          ? "update"
          : "installed";
    return {
      id: entry.id,
      name: entry.name,
      ...(entry.description === null ? {} : { description: entry.description }),
      version: entry.version,
      status,
      ...(entry.publisher === null
        ? {}
        : { publisher: `${entry.publisher.id} · key ${entry.publisher.fingerprint}` }),
      capabilities: entry.capabilities ?? [],
    };
  });
}

function firstRunTheme() {
  const theme = state.theme ?? {};
  return {
    preset: theme.preset ?? "suite",
    // Keep "follow the system" as a choice; the resolved light/dark is only what is painted now.
    mode: theme.source ?? (theme.mode === "dark" ? "dark" : "light"),
    density: theme.density ?? "cozy",
  };
}

/**
 * The first-run wizard replaces the chrome until the host records completion.
 *
 * It owns the pack selection and the install rows; the host owns the catalogue, the theme and
 * the installer. The wizard is mounted once and updated with the host's current snapshot.
 */
function updateFirstRun() {
  const firstRun = state.firstRun === true;
  if (firstRun) settingsOpen = false;
  if (elements.firstRun !== null) elements.firstRun.hidden = !firstRun;
  if (elements.content !== null) elements.content.hidden = firstRun;
  if (elements.hostBar !== null) elements.hostBar.hidden = firstRun;
  if (elements.screen !== null) elements.screen.hidden = firstRun;
  if (elements.empty !== null) elements.empty.hidden = firstRun || state.surface !== "launcher";
  if (elements.syncPanel !== null) elements.syncPanel.hidden = firstRun || !syncOpen;
  if (elements.commandSurface !== null) {
    elements.commandSurface.hidden = firstRun || !commandOpen;
  }
  if (!firstRun) {
    if (firstRunWizard !== null) {
      firstRunWizard.unmount();
      firstRunWizard = null;
    }
    return;
  }
  if (elements.firstRun === null) return;
  if (firstRunWizard === null) {
    firstRunWizard = mountFirstRun(elements.firstRun, {
      packs: firstRunPacks(),
      theme: firstRunTheme(),
      onThemeChange: (theme) => run(api.setTheme(theme)),
      onInstall: async (id) => {
        const result = await api.installFirstRunPack(id);
        return {
          id,
          ok: result?.ok === true,
          detail: typeof result?.detail === "string" ? result.detail : "The install was refused.",
        };
      },
      onComplete: () => api.completeFirstRun(),
    });
  }
  firstRunWizard.update(firstRunPacks(), firstRunTheme());
}

const SETTINGS_SECTIONS = ["appearance", "home", "packs"];

/** Apply one Settings choice: merge it with the resolved theme the host already draws. */
function chooseTheme(patch) {
  const theme = state.theme ?? {};
  run(
    api.setTheme({
      preset: theme.preset ?? "suite",
      mode: theme.source ?? "system",
      density: theme.density ?? "cozy",
      ...patch,
    }),
  );
}

function settingsChoice(label, selected, onClick) {
  const button = actionButton(
    label,
    onClick,
    selected ? "settings-choice is-selected" : "settings-choice",
  );
  button.setAttribute("aria-pressed", String(selected));
  return button;
}

function renderSettingsAppearance() {
  const theme = state.theme ?? {};
  const presets = state.themeChoices ?? [];
  const mode = theme.source ?? theme.mode ?? "system";
  const density = theme.density ?? "cozy";

  elements.settingsPresets.replaceChildren(
    ...presets.map((preset) =>
      settingsChoice(preset.name, theme.preset === preset.id, () =>
        chooseTheme({ preset: preset.id }),
      ),
    ),
  );
  elements.settingsModes.replaceChildren(
    ...[
      ["light", "Light"],
      ["dark", "Dark"],
      ["system", "Follow the system"],
    ].map(([value, label]) =>
      settingsChoice(label, mode === value, () => chooseTheme({ mode: value })),
    ),
  );
  elements.settingsDensities.replaceChildren(
    ...[
      ["compact", "Compact"],
      ["cozy", "Cozy"],
      ["comfortable", "Comfortable"],
    ].map(([value, label]) =>
      settingsChoice(label, density === value, () => chooseTheme({ density: value })),
    ),
  );
}

function renderSettingsHome() {
  const screens = state.screenList ?? [];
  if (screens.length === 0) {
    elements.settingsScreens.replaceChildren(element("p", "empty", "No Screens on this device."));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const screen of screens) {
    const row = element("li", "settings-screen");
    const name = element("div", "settings-screen-name");
    name.append(element("span", "", screen.name));
    if (screen.home) name.append(element("span", "screen-badge", "Home"));
    if (screen.open) name.append(element("span", "screen-badge", "Open"));
    if (screen.readable === false) name.append(element("span", "screen-badge", "Unavailable"));
    row.append(name);

    const tools = element("div", "settings-screen-tools");
    const open = actionButton("Open", () => run(api.openScreen(screen.id)));
    open.setAttribute("aria-label", `Open ${screen.name}`);
    const home = actionButton(screen.home ? "This is Home" : "Set as Home", () =>
      run(api.setHomeScreen(screen.id)),
    );
    home.disabled = screen.home || screen.readable === false;
    home.setAttribute("aria-label", `Make ${screen.name} the Home Screen`);
    tools.append(open, home);
    row.append(tools);
    fragment.append(row);
  }
  elements.settingsScreens.replaceChildren(fragment);
}

function renderSettingsPacks() {
  elements.settingsApps.replaceChildren();
  renderAppsWidget(elements.settingsApps);
}

/**
 * The host Settings surface.
 *
 * Appearance is host state, Home is a role over the Screen set, and Packs is the same
 * catalogue widget a Screen can hold. The page reads `state` and calls host actions; it
 * never keeps a preference or a document here.
 */
function renderSettings() {
  const surface = elements.settings;
  if (surface === null) return;
  const visible = settingsOpen && state.firstRun !== true;
  surface.hidden = !visible;
  if (!visible) return;

  for (const button of elements.settingsNav) {
    button.setAttribute("aria-pressed", String(button.dataset.section === settingsSection));
  }
  elements.settingsAppearance.hidden = settingsSection !== "appearance";
  elements.settingsHome.hidden = settingsSection !== "home";
  elements.settingsPacks.hidden = settingsSection !== "packs";

  if (settingsSection === "appearance") renderSettingsAppearance();
  else if (settingsSection === "home") renderSettingsHome();
  else renderSettingsPacks();
}

function openSettings(section) {
  settingsOpen = true;
  if (typeof section === "string" && SETTINGS_SECTIONS.includes(section)) {
    settingsSection = section;
  }
  paint();
  const active = [...elements.settingsNav].find(
    (button) => button.dataset.section === settingsSection,
  );
  active?.focus();
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  paint();
}

function matchesQuery(name, id, description) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${name} ${id} ${description ?? ""}`.toLowerCase().includes(needle);
}
function actionButton(label, onClick, className) {
  const button = element("button", className ? `action ${className}` : "action", label);
  button.type = "button";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick(button);
  });
  return button;
}

function trustAction(action, label) {
  const button = element("button", "install", label);
  button.type = "button";
  button.addEventListener("click", () => {
    button.disabled = true;
    Promise.resolve(action())
      .catch((error) => {
        showNotice(error instanceof Error ? error.message : "The host refused that action.");
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
}

function countLabel(total, noun) {
  return total === 0 ? "" : `${total} ${noun}${total === 1 ? "" : "s"}`;
}

const CONSENT_LABELS = {
  recents: "recent files",
  notifications: "reminders",
};

function consentLabel(capability) {
  return CONSENT_LABELS[capability] ?? capability;
}

function installedCard(pack) {
  const tile = element("div", "tile");
  const card = element("button", "card");
  card.type = "button";
  card.title = `Open ${pack.name}`;
  const denials = Array.isArray(pack.consent)
    ? pack.consent.filter((entry) => entry.answer === "denied")
    : [];

  const top = element("div", "card-top");
  const dot = element("span", "card-dot");
  dot.style.background = colorFor(pack.id);
  dot.setAttribute("aria-hidden", "true");
  top.append(dot, element("span", "card-name", pack.name));
  if (pack.source === "development") {
    const dev = element("span", "pill pill-dev", "dev");
    dev.title = "Loaded from an unsigned development directory";
    top.append(dev);
  }
  top.append(element("span", "card-version", `v${pack.version}`));

  const description = element(
    "p",
    "card-description",
    pack.description ?? "A sandboxed Suite pack.",
  );

  const publisher = pack.publisher
    ? element(
        "p",
        "card-publisher",
        `Publisher ${pack.publisher.id} · key ${pack.publisher.fingerprint}`,
      )
    : null;

  const meta = element("div", "card-meta");
  for (const capability of pack.capabilities) {
    meta.append(element("span", "pill", capability));
  }
  if (pack.capabilities.length === 0) meta.append(element("span", "pill", "no capabilities"));

  card.append(top, description, ...(publisher === null ? [] : [publisher]), meta);
  for (const consent of denials) {
    card.append(
      element(
        "p",
        "card-warning",
        `You denied ${consentLabel(consent.capability)}. The host keeps that answer until you ask again.`,
      ),
    );
  }
  card.addEventListener("click", () => run(api.openPack(pack.id)));
  tile.append(card);

  const actions = element("div", "tile-actions");
  for (const consent of denials) {
    actions.append(
      actionButton(`Ask again about ${consentLabel(consent.capability)}`, () =>
        run(api.reaskConsent(pack.id, consent.capability)),
      ),
    );
  }
  const older = state.installedVersions.filter(
    (version) => version.id === pack.id && !version.current,
  );
  for (const version of older) {
    actions.append(
      actionButton(`Remove v${version.version}`, () =>
        run(api.uninstallPack(pack.id, version.version)),
      ),
    );
  }
  if (pack.source === "installed") {
    actions.append(
      actionButton(
        "Uninstall",
        () => run(api.uninstallPack(pack.id, pack.version)),
        "action-danger",
      ),
    );
  }
  if (actions.childElementCount > 0) tile.append(actions);
  return tile;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function catalogueCard(entry) {
  const tile = element("div", "tile");
  const card = element("div", "card card-static");
  const name = entry.name.length > 0 ? entry.name : entry.id;

  const active = state.installedVersions.find(
    (version) => version.id === entry.id && version.current,
  );
  const exactInstalled = state.installedVersions.some(
    (version) => version.id === entry.id && version.version === entry.version,
  );
  const installedCurrent =
    exactInstalled && active !== undefined && active.version === entry.version;
  const updateAvailable = entry.updateAvailable === true;
  const labelled = !entry.trusted
    ? { className: "pill pill-refused", text: "refused" }
    : entry.platform.state === "unavailable"
      ? { className: "pill pill-refused", text: "unavailable" }
      : installedCurrent
        ? { className: "pill pill-installed", text: "installed" }
        : updateAvailable
          ? { className: "pill pill-update", text: "update" }
          : { className: "pill pill-available", text: "available" };

  const top = element("div", "card-top");
  const dot = element("span", "card-dot");
  dot.style.background = colorFor(entry.id);
  dot.setAttribute("aria-hidden", "true");
  top.append(dot, element("span", "card-name", name));
  top.append(element("span", labelled.className, labelled.text));
  if (entry.version.length > 0) {
    top.append(element("span", "card-version", `v${entry.version}`));
  }
  const size = formatBytes(entry.sizeBytes);
  if (size.length > 0) {
    top.append(element("span", "card-version", size));
  }

  const description = element(
    "p",
    "card-description",
    entry.description ??
      (entry.trusted ? "A signed pack in the catalogue." : "This archive cannot be installed."),
  );
  card.append(top, description);

  if (entry.publisher) {
    card.append(
      element(
        "p",
        "card-publisher",
        `Publisher ${entry.publisher.id} · key ${entry.publisher.fingerprint}`,
      ),
    );
  }
  if (Array.isArray(entry.capabilities) && entry.capabilities.length > 0) {
    const meta = element("div", "card-meta");
    for (const capability of entry.capabilities) {
      meta.append(element("span", "pill", capability));
    }
    card.append(meta);
  }

  if (!entry.trusted) {
    card.append(
      element("p", "card-warning", entry.refusal ?? "This archive could not be verified."),
    );
  } else if (entry.platform.state === "unavailable") {
    card.append(
      element(
        "p",
        "card-warning",
        entry.platform.reason ?? "This pack is not available on this host.",
      ),
    );
  } else if (entry.platform.state === "unknown" && entry.platform.reason) {
    card.append(element("p", "card-warning", entry.platform.reason));
  }

  tile.append(card);
  const actions = element("div", "tile-actions");
  if (!entry.trusted) {
    const refused = actionButton("Cannot install", () => {});
    refused.disabled = true;
    actions.append(refused);
  } else if (entry.platform.state === "unavailable") {
    const unavailable = actionButton("Not available here", () => {});
    unavailable.disabled = true;
    actions.append(unavailable);
  } else {
    const label = installedCurrent
      ? `Reinstall v${entry.version}`
      : updateAvailable
        ? `Update to v${entry.version}`
        : exactInstalled
          ? `Installed v${entry.version}`
          : `Install v${entry.version}`;
    const inert = exactInstalled && !installedCurrent;
    const button = actionButton(
      label,
      () => {
        button.disabled = true;
        Promise.resolve(api.installCataloguePack(entry.id, entry.version))
          .catch((error) => {
            showNotice(error instanceof Error ? error.message : "The host refused that action.");
          })
          .finally(() => {
            button.disabled = inert;
          });
      },
      "action-primary",
    );
    button.disabled = inert;
    actions.append(button);
  }
  tile.append(actions);
  return tile;
}

function renderPacks() {
  if (appsView.packs === null) return;
  const matches = state.packs.filter((pack) => matchesQuery(pack.name, pack.id, pack.description));
  appsView.packCount.textContent = countLabel(state.packs.length, "pack");

  if (matches.length === 0) {
    appsView.packs.replaceChildren(
      element(
        "p",
        "empty",
        state.packs.length === 0
          ? "No packs are installed. Add a signed pack or install one from the catalogue below."
          : `No pack matches “${query.trim()}”.`,
      ),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const pack of matches) fragment.append(installedCard(pack));
  appsView.packs.replaceChildren(fragment);
}

function renderCatalogue() {
  if (appsView.catalogue === null) return;
  if (appsView.catalogueSource !== null) {
    appsView.catalogueSource.textContent = state.catalogueSource;
  }
  const matches = state.catalogue.filter((entry) =>
    matchesQuery(entry.name, entry.id, entry.description),
  );
  appsView.catalogueCount.textContent = countLabel(state.catalogue.length, "archive");

  if (state.catalogue.length === 0) {
    appsView.catalogue.replaceChildren(
      element(
        "p",
        "empty",
        "No packs are available from the catalogue. Use Add pack… to install a signed .suitepack file.",
      ),
    );
    return;
  }
  if (matches.length === 0) {
    appsView.catalogue.replaceChildren(
      element("p", "empty", `No catalogue archive matches “${query.trim()}”.`),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of matches) fragment.append(catalogueCard(entry));
  appsView.catalogue.replaceChildren(fragment);
}

function refreshApps() {
  renderPacks();
  renderCatalogue();
}

/**
 * The `desk.apps` host widget: the installed pack grid and the local catalogue.
 *
 * It is the launcher's content, drawn inside the Screen rather than beside it, so Home
 * replaces the bare launcher instead of duplicating it.
 */
function renderAppsWidget(body) {
  body.classList.add("apps-widget");

  const search = element("label", "search");
  const hidden = element("span", "visually-hidden", "Search packs");
  const input = element("input", "");
  input.type = "search";
  input.placeholder = "Search packs…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = query;
  input.addEventListener("input", () => {
    query = input.value;
    refreshApps();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    input.value = "";
    query = "";
    refreshApps();
  });
  search.append(hidden, input);
  body.append(search);

  const installed = element("section");
  const installedHead = element("div", "section-head");
  const packCount = element("span", "count");
  installedHead.append(element("h2", "", "Installed"), packCount);
  const packs = element("div", "grid");
  installed.append(installedHead, packs);

  const available = element("section", "available");
  const availableHead = element("div", "section-head");
  const catalogueCount = element("span", "count");
  availableHead.append(element("h2", "", "Available"), catalogueCount);
  const muted = element(
    "p",
    "muted",
    "Packs arrive from the signed catalogue or as a .suitepack file. Installing adds one to this device, updating keeps the old version until you remove it, and reinstalling replaces the install while keeping its documents. A new app opens right away; restart Suite to run a new version of an app that is already open.",
  );
  const catalogue = element("div", "grid");
  const catalogueSource = element("p", "muted catalogue-source");
  const install = element("button", "install", "Add pack…");
  install.type = "button";
  install.addEventListener("click", () => {
    install.disabled = true;
    Promise.resolve(api.installPack())
      .catch((error) => {
        showNotice(error instanceof Error ? error.message : "The host refused that action.");
      })
      .finally(() => {
        install.disabled = false;
      });
  });

  // A rotation statement and a revocation advisory are signed files the person
  // chooses, the same way a pack is. Neither one closes a running pack.
  const rotate = trustAction(api.rotatePublisher, "Rotate a key…");
  const revoke = trustAction(api.importRevocation, "Add revocation…");
  const actions = element("div", "trust-actions");
  actions.append(install, rotate, revoke);
  available.append(availableHead, muted, catalogueSource, catalogue, actions);

  body.append(installed, available);
  appsView = { packs, packCount, catalogue, catalogueCount, catalogueSource, search: input };
  refreshApps();
}

function appWidgetBody(widget) {
  const fragment = document.createDocumentFragment();
  fragment.append(element("p", "widget-meta", `From ${widget.appName}`));

  if (widget.fields.length === 0) {
    fragment.append(element("p", "widget-muted", "This widget declares no fields."));
  } else {
    const fields = element("div", "fields");
    for (const field of widget.fields) {
      const row = element("div", "field");
      const label = element("span", "field-label", field.label);
      row.append(label, element("span", "pill", field.type));
      if (field.required) row.append(element("span", "pill pill-required", "required"));
      fields.append(row);
    }
    fragment.append(fields);
  }

  if (widget.settings.length > 0) {
    const settings = element("div", "widget-settings");
    for (const setting of widget.settings) {
      settings.append(
        element("p", "widget-muted", `${setting.label}: ${setting.value || "not set"}`),
      );
    }
    fragment.append(settings);
  }
  if (widget.unknownSettings.length > 0) {
    fragment.append(
      element(
        "p",
        "widget-muted",
        `Saved settings this widget does not declare: ${widget.unknownSettings.join(", ")}.`,
      ),
    );
  }
  if (widget.issues.length > 0) {
    fragment.append(
      element("p", "card-warning", `Check this widget's settings: ${widget.issues.join("; ")}.`),
    );
  }
  if (widget.note !== null) fragment.append(element("p", "widget-note", widget.note));
  return fragment;
}

function editControls(widget, index, total) {
  const controls = element("div", "widget-edit");

  const earlier = actionButton("Move earlier", () =>
    runAction(api.moveWidget(widget.registryId, "earlier")),
  );
  earlier.disabled = index === 0;

  const later = actionButton("Move later", () =>
    runAction(api.moveWidget(widget.registryId, "later")),
  );
  later.disabled = index === total - 1;

  const size = actionButton(`Size: ${sizeLabel(widget.size)}`, () =>
    runAction(api.resizeWidget(widget.registryId, nextSize(widget.size))),
  );

  const remove = actionButton(
    "Remove",
    () => runAction(api.removeWidget(widget.registryId)),
    "action-danger",
  );

  controls.append(earlier, later, size, remove);
  return controls;
}

function widgetTile(widget, index, total, embedded = false) {
  const tile = element("section", `widget widget-${widget.size} widget-${widget.source}`);
  tile.dataset.registryId = widget.registryId;
  tile.setAttribute("role", "group");
  tile.setAttribute(
    "aria-label",
    embedded ? `${widget.title}, in a row` : `${widget.title}, ${sizeLabel(widget.size)}`,
  );
  if (editing && !embedded) tile.tabIndex = 0;

  const head = element("div", "widget-head");
  const title = element("h2", "widget-title", widget.title);
  head.append(title);
  if (widget.source === "host") head.append(element("span", "pill pill-host", "Suite Desk"));
  if (widget.source === "app" && widget.appName !== null) {
    head.append(element("span", "pill", widget.appName));
  }
  if (widget.source === "unknown") head.append(element("span", "pill pill-refused", "unknown"));
  head.append(element("span", "widget-size", sizeLabel(widget.size)));
  tile.append(head);

  const body = element("div", "widget-body");
  if (widget.source === "host" && widget.registryId === "desk.apps") {
    renderAppsWidget(body);
  } else if (widget.source === "host") {
    if (widget.note !== null) body.append(element("p", "widget-note", widget.note));
  } else if (widget.source === "app") {
    body.append(appWidgetBody(widget));
  } else {
    if (widget.note !== null) body.append(element("p", "widget-note", widget.note));
    if (widget.unknownSettings.length > 0) {
      body.append(
        element(
          "p",
          "widget-muted",
          `Saved settings kept with it: ${widget.unknownSettings.join(", ")}.`,
        ),
      );
    }
  }
  tile.append(body);

  if (editing && !embedded) {
    tile.append(editControls(widget, index, total));
    tile.addEventListener("keydown", (event) => {
      if (event.target !== tile) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        runAction(api.moveWidget(widget.registryId, "earlier"));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        runAction(api.moveWidget(widget.registryId, "later"));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const current = SIZES.indexOf(widget.size);
        const previous = SIZES[(current - 1 + SIZES.length) % SIZES.length];
        runAction(api.resizeWidget(widget.registryId, previous));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        runAction(api.resizeWidget(widget.registryId, nextSize(widget.size)));
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        runAction(api.removeWidget(widget.registryId));
      }
    });
  }

  return tile;
}

/**
 * Draw one row or carousel.
 *
 * The children are ordinary widget tiles in document order, so keyboard and screen
 * reader order are the visual order and no child traps focus. The CSS turns the track
 * into one snapping line at phone width, which is the responsive half the shared
 * layout model promises.
 */
function rowTile(row) {
  const section = element("section", `widget-row widget-${row.size}`);
  section.dataset.layout = row.layout;
  section.dataset.mode = row.mode;
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", `Row of ${row.items.length} widgets`);

  const track = element("div", "widget-row-track");
  for (const item of row.items) {
    const tile = widgetTile(item.widget, 0, 0, true);
    tile.classList.add("widget-row-item");
    tile.style.setProperty("--row-weight", String(item.weight));
    track.append(tile);
  }
  section.append(track);
  return section;
}

function renderWidgets(view) {
  const fragment = document.createDocumentFragment();
  view.widgets.forEach((entry, index) => {
    fragment.append(
      entry.kind === "row" ? rowTile(entry) : widgetTile(entry, index, view.widgets.length),
    );
  });
  if (view.widgets.length === 0) {
    if (view.id === state.homeScreenId) {
      const empty = element("section", "home-empty");
      empty.setAttribute("aria-label", "Empty Home");
      empty.append(element("p", "eyebrow", "Home"));
      empty.append(element("h2", "", "A clean start."));
      const packs = state.packs ?? [];
      const first = packs.find((pack) => pack.id === "canvas") ?? packs[0] ?? null;
      empty.append(
        element(
          "p",
          "lede",
          first === null
            ? "No apps are installed yet. Add one, then make a document or add a widget."
            : "Your apps are installed. Open one to make a document, or add a new widget.",
        ),
      );
      const actions = element("div", "home-empty-actions");
      if (first === null) {
        actions.append(
          actionButton("Install from a file…", () => run(api.installPack()), "action-primary"),
        );
        actions.append(actionButton("Choose an app", () => run(api.newTab())));
      } else {
        actions.append(
          actionButton(`Open ${first.name}`, () => run(api.openPack(first.id)), "action-primary"),
        );
        actions.append(actionButton("Create a document", () => run(api.newDocument(first.id))));
        actions.append(actionButton("Choose an app", () => run(api.newTab())));
      }
      empty.append(actions);
      fragment.append(empty);
    } else {
      fragment.append(element("p", "empty", "This Screen has no widgets. Choose Edit to add one."));
    }
  }
  /*
   * Keep the person's place across the rebuild.
   *
   * Every edit used to destroy the whole widget tree, so the focused tile vanished and the
   * next keypress went to the body: keyboard editing was unusable after one action. The
   * tile that was focused is recorded by registry id and given focus back below, so a run
   * of ↑ ↑ → Delete works without reaching for the mouse.
   */
  const focused = document.activeElement;
  const focusedRegistryId =
    focused instanceof HTMLElement && elements.widgets.contains(focused)
      ? (focused.closest(".widget")?.dataset.registryId ?? null)
      : null;

  elements.widgets.replaceChildren(fragment);

  if (focusedRegistryId !== null && editing) {
    const restored = [...elements.widgets.querySelectorAll(".widget")].find(
      (tile) => tile.dataset.registryId === focusedRegistryId,
    );
    restored?.focus();
  }
}

function renderChoices(view) {
  const placed = new Set(view.widgets.flatMap(entryRegistryIds));
  const choices = view.choices.filter((choice) => !placed.has(choice.registryId));
  elements.widgetChoice.replaceChildren();
  for (const choice of choices) {
    const option = element("option", "", `${choice.title} — ${choice.appName}`);
    option.value = choice.registryId;
    elements.widgetChoice.append(option);
  }
  elements.addWidget.disabled = choices.length === 0;
}

/**
 * The Screens manager.
 *
 * Home is a role, not a file name: Set Home changes which Screen the next launch opens.
 * The last Screen is kept, and deleting Home asks which Screen replaces it before the
 * button can run. The page draws only the list the host sends.
 */
function renderScreensPanel() {
  elements.screensToggle.textContent = managingScreens ? "Done" : "Screens";
  elements.screensToggle.setAttribute("aria-expanded", String(managingScreens));
  elements.screensPanel.hidden = !managingScreens;
  if (!managingScreens) return;

  elements.screensNote.hidden = state.screenManagerNote === null;
  elements.screensNote.textContent = state.screenManagerNote ?? "";
  elements.screensList.replaceChildren();

  const screens = state.screenList;
  for (const screen of screens) {
    const row = element("li", "screen-row");
    row.dataset.screenId = screen.id;

    const heading = element("div", "screen-row-heading");
    const badges = element("span", "screen-badges");
    if (screen.home) badges.append(element("span", "screen-badge", "Home"));
    if (screen.open) badges.append(element("span", "screen-badge", "Open"));
    heading.append(element("span", "screen-row-name", screen.name), badges);
    row.append(heading);

    const tools = element("div", "screen-row-tools");
    const open = actionButton("Open", () => runAction(api.openScreen(screen.id)));
    open.disabled = screen.open;
    open.setAttribute("aria-label", `Open ${screen.name}`);

    const home = actionButton("Set Home", () => runAction(api.setHomeScreen(screen.id)));
    home.disabled = screen.home;
    home.setAttribute("aria-label", `Make ${screen.name} the Home Screen`);

    const duplicate = actionButton("Duplicate", () => runAction(api.duplicateScreen(screen.id)));
    duplicate.setAttribute("aria-label", `Duplicate ${screen.name}`);

    const exportScreen = actionButton("Export", () => runAction(api.exportScreen(screen.id)));
    exportScreen.setAttribute("aria-label", `Export ${screen.name} as a .screen file`);

    const remove = actionButton(
      "Delete",
      () => runAction(api.deleteScreen(screen.id, null)),
      "action-danger",
    );
    const last = screens.length <= 1;
    remove.disabled = last;
    remove.setAttribute(
      "aria-label",
      last ? `Delete ${screen.name} (the last Screen cannot be deleted)` : `Delete ${screen.name}`,
    );

    tools.append(open, home, duplicate, exportScreen, remove);
    row.append(tools);

    const rename = element("div", "screen-rename");
    const input = element("input", "field screen-rename-input");
    input.value = screen.name;
    input.maxLength = 120;
    input.setAttribute("aria-label", `New name for ${screen.name}`);
    const renameButton = actionButton("Rename", () =>
      runAction(api.renameScreen(screen.id, input.value)),
    );
    renameButton.setAttribute("aria-label", `Rename ${screen.name}`);
    rename.append(input, renameButton);
    row.append(rename);

    if (screen.home && !last) {
      const replacement = element("div", "screen-replacement");
      replacement.append(
        element(
          "p",
          "screens-note",
          "Choose which Screen becomes Home before this one is deleted.",
        ),
      );
      const select = element("select", "screen-replacement-select");
      select.setAttribute("aria-label", `New Home in place of ${screen.name}`);
      for (const choice of screens) {
        if (choice.id === screen.id) continue;
        const option = element("option", null, choice.name);
        option.value = choice.id;
        select.append(option);
      }
      const confirm = actionButton(
        "Delete Home and use the chosen Screen",
        () => runAction(api.deleteScreen(screen.id, select.value)),
        "action-danger",
      );
      replacement.append(select, confirm);
      row.append(replacement);
    }

    elements.screensList.append(row);
  }

  if (screens.length <= 1) {
    elements.screensList.append(
      element(
        "li",
        "screens-note",
        "This is the last Screen. The host keeps it so there is always a surface to add another on.",
      ),
    );
  }
  elements.createScreen.disabled = false;
}

/**
 * The relay state the tray app used to own.
 *
 * This is host chrome and a read-only view: the page asks main to start or
 * stop and draws the answer. The address, pin and code are the values a person
 * copies; a crash is a sentence here rather than a silent exit.
 */
function renderSync() {
  const relay = { ...EMPTY_RELAY, ...(state.relay ?? {}) };
  elements.syncPanel.hidden = !syncOpen;
  elements.syncState.textContent = RELAY_LABELS[relay.state] ?? relay.state;
  elements.syncState.dataset.state = relay.state;
  elements.syncAddress.textContent = relay.address ?? "Not running";
  elements.syncFingerprint.textContent = relay.fingerprint ?? "Not running";
  elements.syncCode.textContent = relay.code ?? "Not running";

  const restarts =
    relay.restartCount > 0
      ? ` Restarted ${relay.restartCount} time${relay.restartCount === 1 ? "" : "s"}.`
      : "";
  const error = relay.lastError === null ? "" : `${relay.lastError}${restarts}`;
  elements.syncError.hidden = error.length === 0;
  elements.syncError.textContent = error;

  const busy = relay.state === "starting" || relay.state === "stopping";
  elements.syncStart.disabled = busy || relay.state === "on" || relay.state === "crashed";
  elements.syncStop.disabled = relay.state === "off" || relay.state === "failed" || busy;
}

function updateFocus() {
  if (!shouldFocusSearch) return;
  if (state.surface !== "screen" || appsView.search === null) return;
  shouldFocusSearch = false;
  appsView.search.focus();
}

function renderScreen() {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const screenTab = active !== undefined && active.kind === "screen" ? active : null;
  const view =
    screenTab === null ? undefined : state.screens.find((s) => s.id === screenTab.screenId);
  const visible = state.surface === "screen" && screenTab !== null;

  elements.screen.hidden = !visible;
  elements.empty.hidden = state.surface !== "launcher";

  if (!visible) {
    editing = false;
    managingScreens = false;
    appsView = {
      packs: null,
      packCount: null,
      catalogue: null,
      catalogueCount: null,
      catalogueSource: null,
      search: null,
    };
    return;
  }

  elements.notice.hidden = state.notice === null;
  elements.notice.textContent = state.notice ?? "";
  elements.reminderStatus.hidden = state.reminderStatus === null;
  elements.reminderStatus.textContent = state.reminderStatus ?? "";
  elements.screenName.textContent = view ? view.name : screenTab.title;
  elements.screenEyebrow.textContent = view ? "Screen" : "Unavailable screen";

  if (view === undefined || !view.available) {
    editing = false;
    managingScreens = false;
    elements.editToggle.hidden = true;
    elements.screensToggle.hidden = true;
    elements.screensPanel.hidden = true;
    elements.editBar.hidden = true;
    elements.widgets.replaceChildren(
      element(
        "p",
        "empty",
        `${screenTab.title} is not a screen this build has. The tab is kept so you can close it.`,
      ),
    );
    return;
  }

  elements.editToggle.hidden = false;
  elements.screensToggle.hidden = false;
  if (managingScreens) editing = false;
  elements.editToggle.textContent = editing ? "Done" : "Edit";
  elements.editToggle.setAttribute("aria-pressed", String(editing));
  elements.editBar.hidden = !editing;
  renderScreensPanel();
  renderChoices(view);
  renderWidgets(view);
  updateFocus();
}

function paint() {
  applyTheme();
  updateHostBar();
  renderSync();
  renderScreen();
  renderCommandSurface();
  renderSettings();
  updateFirstRun();

  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  document.body.dataset.surface = state.surface;
  document.title = active ? `${active.title} — Suite Desk` : "Suite Desk";
}

function bindChrome() {
  elements.openHome.addEventListener("click", openHomeTab);

  elements.syncStart.addEventListener("click", () => runRelayAction(api.relayStart()));
  elements.syncStop.addEventListener("click", () => runRelayAction(api.relayStop()));

  elements.commandClose.addEventListener("click", closeCommandSurface);
  elements.commandSurface.addEventListener("click", (event) => {
    if (event.target === elements.commandSurface) closeCommandSurface();
  });

  elements.settingsClose?.addEventListener("click", closeSettings);
  elements.settings?.addEventListener("click", (event) => {
    if (event.target === elements.settings) closeSettings();
  });
  for (const button of elements.settingsNav) {
    button.addEventListener("click", () => {
      const section = button.dataset.section;
      if (section === undefined || section === settingsSection) return;
      settingsSection = section;
      paint();
    });
  }
  for (const button of elements.commandModes) {
    button.addEventListener("click", () => {
      if (commandMode === button.dataset.mode) return;
      commandMode = button.dataset.mode;
      commandChosen = 0;
      commandMessage = null;
      paint();
      void refreshCommandSurface();
    });
  }
  elements.commandApp.addEventListener("change", () => {
    commandAppId = elements.commandApp.value;
    commandScopeId = commandScopeChoices()[0] ?? "global";
    commandChosen = 0;
    paint();
    void refreshCommandSurface();
  });
  elements.commandScope.addEventListener("change", () => {
    commandScopeId = elements.commandScope.value;
    commandChosen = 0;
    paint();
    void refreshCommandSurface();
  });
  elements.commandQuery.addEventListener("input", () => {
    void refreshCommandSurface();
  });
  elements.commandQuery.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = selectedCount();
      if (count === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      commandChosen = (commandChosen + step + count) % count;
      renderCommandResults();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void invokeSelectedCommand();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeCommandSurface();
    }
  });
  elements.commandClearRecents.addEventListener("click", () => {
    void runCommandAction(async () => {
      const listing = await api.commandClearRecents();
      if (listing) commandListing = listing;
      commandChosen = 0;
      paint();
    });
  });

  elements.editToggle.addEventListener("click", () => {
    editing = !editing;
    managingScreens = false;
    paint();
  });

  elements.screensToggle.addEventListener("click", () => {
    managingScreens = !managingScreens;
    editing = false;
    paint();
  });

  elements.createScreen.addEventListener("click", () => {
    const name = elements.screenNewName.value.trim();
    if (name.length === 0) return;
    runAction(api.createScreen(name));
    elements.screenNewName.value = "";
  });

  elements.importScreen.addEventListener("click", () => runAction(api.importScreen()));

  elements.addWidget.addEventListener("click", () => {
    const registryId = elements.widgetChoice.value;
    if (registryId.length === 0) return;
    runAction(api.addWidget(registryId));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && settingsOpen) {
      event.preventDefault();
      closeSettings();
      return;
    }
    if (event.key === "Escape" && commandOpen) {
      event.preventDefault();
      closeCommandSurface();
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (!command) return;

    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      openHomeTab();
    } else if (event.key.toLowerCase() === "w" && state.activeTabId !== null) {
      event.preventDefault();
      run(api.closeTab(state.activeTabId));
    } else if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (commandOpen) closeCommandSurface();
      else openCommandSurface();
    }
  });
}

async function start() {
  if (!api) {
    document.body.replaceChildren(
      element("p", "notice", "The Suite bridge is unavailable. The preload did not load."),
    );
    return;
  }

  bindChrome();
  let received = false;
  api.onPick?.(() => tabBar?.showPicker());
  api.onOpenSettings?.((section) => openSettings(section));
  api.onState((next) => {
    if (!next) return;
    received = true;
    state = next;
    paint();
  });

  try {
    const initial = await api.state();
    if (!received && initial) state = initial;
    paint();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "The host did not answer.");
  }
}

start().catch((error) => {
  showNotice(error instanceof Error ? error.message : "The shell could not start.");
});
