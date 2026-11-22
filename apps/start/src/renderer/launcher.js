/*
 * The hub, as a page.
 *
 * Plain DOM and no framework: everything installed here would be a dependency
 * the hub carries into the apps it is meant to stay out of.
 *
 * It renders what the main process reports and nothing else.
 */
import { renderApps } from "./apps.js";
import { renderFiles } from "./files.js";
import { renderHome } from "./home.js";
import { installRail } from "./rail.js";
import { renderScreens } from "./screens.js";
import { renderSettings } from "./settings.js";
import { SUITE_MARK_PATH, SUITE_MARK_VIEW_BOX } from "./suiteMark.js";
import { renderSync } from "./sync.js";

const bridge = globalThis.suiteStart;

const actions = {
  async launch(id) {
    await bridge.launch(id);
    await refresh();
  },
  /**
   * Install or update one app.
   *
   * The call resolves when the app is on disk, but the card is redrawn from what arrives
   * while it runs — the bar is the answer, not the await.
   */
  async install(id) {
    await bridge.installApp(id);
    await refresh();
  },
  async remove(id) {
    await bridge.removeApp(id);
    await refresh();
  },
  /**
   * The Home Screen's edits.
   *
   * Each one names an id and a choice; main owns the document and answers with the new
   * Screens state, so the page redraws from the result rather than from a guess.
   */
  async moveWidget(id, direction) {
    applyScreens(await bridge.moveWidget(id, direction));
  },
  async resizeWidget(id, size) {
    applyScreens(await bridge.setWidgetSize(id, size));
  },
  async addWidget(id) {
    applyScreens(await bridge.addWidget(id));
  },
  async removeWidget(id) {
    applyScreens(await bridge.removeWidget(id));
  },
  async setWidgetSetting(id, field, value) {
    applyScreens(await bridge.setWidgetSetting(id, field, value));
  },
  /** The manager's edits: Start owns the set, and each answers with the new state. */
  async createScreen(name) {
    applyScreens(await bridge.createScreen(name));
  },
  async renameScreen(id, name) {
    applyScreens(await bridge.renameScreen(id, name));
  },
  async duplicateScreen(id) {
    applyScreens(await bridge.duplicateScreen(id));
  },
  async deleteScreen(id, replacementId) {
    applyScreens(await bridge.deleteScreen(id, replacementId));
  },
  async setHomeScreen(id) {
    applyScreens(await bridge.setHomeScreen(id));
  },
  async openScreen(id) {
    applyScreens(await bridge.openScreen(id));
  },
  /** Repaint from the last state, for a local mode switch such as Edit layout. */
  rerender() {
    if (lastState !== null) render(lastState);
  },
  async uninstall(id) {
    await bridge.uninstallApp(id);
    await refresh();
  },
  /**
   * Which palette to draw.
   *
   * The next state arrives carrying the answer, so the select keeps whatever was chosen
   * rather than snapping back to a value the page guessed.
   */
  async setTheme(preset, mode) {
    await bridge.setTheme({ preset, mode });
    await refresh();
  },
  async reveal(id) {
    await bridge.revealApp(id);
  },
  async openRecent(recent) {
    await bridge.launch(recent.appId);
    await refresh();
  },
  async openFile(path) {
    await bridge.openFile(path);
    await refresh();
  },
  /**
   * Put a document's link on the clipboard.
   *
   * The clipboard belongs to the page rather than to the hub: it is one async
   * call, the page is a secure origin, and a channel that writes the system
   * clipboard in main would be a capability for nothing.
   */
  /**
   * Install Suite Sync, or open it.
   *
   * The tray app keeps the relay, so the pane's whole job is the deployment: ask
   * Flatpak for it when it is absent, and start it when it is there.
   */
  async installSync() {
    await bridge.installSync();
    await refresh();
  },
  async openSync() {
    await bridge.openSync();
    await refresh();
  },
  async copyLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      return false;
    }
  },
};

/** The last thing main said, so a progress event can redraw the cards alone. */
let lastState = null;

/**
 * Take the Screens state an action returned and redraw.
 *
 * The action's answer is the authority for the surface it changed. Everything else in
 * `lastState` is still true, so it is kept rather than re-listing every app on each edit.
 */
function applyScreens(screens) {
  if (screens === null || screens === undefined || lastState === null) {
    void refresh();
    return;
  }
  render({ ...lastState, screens });
}

/** The Apps filter, so a list of nine still behaves like a list of three. */
let appFilter = "";

function visibleApps(state) {
  if (appFilter.trim().length === 0) return state;
  const wanted = appFilter.trim().toLowerCase();
  return {
    ...state,
    apps: state.apps.filter((app) => app.name.toLowerCase().includes(wanted)),
  };
}

/**
 * Paint a resolved theme onto the document.
 *
 * Every role is a custom property, so this is the whole integration: the stylesheet says
 * `var(--ink)` and never asks which preset is on. `data-theme` and `data-theme-mode` are set
 * too, because a preset with a different feel may want a different shadow or border
 * treatment, and that is a rule rather than a colour.
 */
function applyTheme(theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.values)) root.style.setProperty(name, value);
  root.dataset.theme = theme.choice.preset;
  root.dataset.themeMode = theme.mode;
  root.style.colorScheme = theme.mode;
}

function render(state) {
  lastState = state;
  // The Home Screen first: the app grid is a widget, and `renderApps` fills the lists the
  // widget shell creates.
  renderHome(state, actions);
  renderApps(visibleApps(state), actions);
  renderScreens(state, actions);
  renderFiles(state, actions);
  renderSettings(state, actions);
  renderSync(state, actions);
  document.getElementById("version").textContent = `Suite ${state.version}`;

  // The theme, already resolved by main: this page has no bundler and cannot import
  // `@suite/theme`, so the variables arrive as data and are painted onto the root. Set from
  // state rather than from the control, so a choice made in one window is right in the next.
  applyTheme(state.settings.theme);

  // The rail carries the one number worth acting on, and hides it at zero so a
  // healthy hub is quiet.
  const attention = state.apps.filter((app) => !app.health.ok).length;
  const badge = document.getElementById("count-apps");
  badge.hidden = attention === 0;
  badge.textContent = String(attention);
  badge.setAttribute("aria-label", `${attention} needing attention`);
}

async function refresh() {
  render(await bridge.listApps());
}

if (typeof bridge !== "object" || bridge === null) {
  document.querySelector(".content").textContent =
    "Start's shell did not load, so this window cannot list anything. Restart Suite.";
} else {
  const rail = installRail();
  bridge.onChanged?.(render);

  // Cmd/Ctrl+1..4 reach the pane with the same number a person sees in the rail.
  const tabs = ["apps", "files", "sync", "settings"];
  globalThis.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const index = Number.parseInt(event.key, 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
    event.preventDefault();
    rail.select(index);
  });

  // A bar moves far more often than anything else in this window changes, so it arrives
  // on its own channel and redraws only the cards.
  bridge.onInstallProgress?.((installing) => {
    if (lastState === null) return;
    lastState = { ...lastState, installing };
    renderApps(visibleApps(lastState), actions);
  });

  document.getElementById("add").addEventListener("click", async () => {
    await bridge.addApp();
    await refresh();
  });

  // Adding a widget is a picker and one button rather than a second Home surface.
  document.getElementById("widget-add")?.addEventListener("click", async () => {
    const picker = document.getElementById("widget-picker");
    if (!picker || picker.value.length === 0) return;
    await actions.addWidget(picker.value);
  });

  // On demand: one request per app that names a feed, and nothing on a timer.
  // The answer arrives as a broadcast, so the page re-reads rather than guessing.
  const check = document.getElementById("check-updates");
  check.addEventListener("click", async () => {
    check.disabled = true;
    check.textContent = "Checking…";
    try {
      await bridge.checkUpdates();
    } finally {
      check.disabled = false;
      check.textContent = "Check for updates";
    }
  });

  // The host's rooms change without Start knowing, so the pane re-reads when it is
  // opened rather than showing a snapshot from whenever the window last drew.
  document.getElementById("tab-sync").addEventListener("click", () => void refresh());

  const search = document.getElementById("app-search");
  search?.addEventListener("input", () => {
    appFilter = search.value;
    if (lastState !== null) render(lastState);
  });

  // A launch Start initiated changes what is recent, so the window re-reads
  // rather than trusting what it already drew.
  globalThis.addEventListener("focus", () => void refresh());

  renderSuiteMark();
  void refresh();
}

/**
 * Put the suite's own mark in the rail.
 *
 * Drawn as `currentColor`, so it is whatever ink the theme says — the alternative was the black
 * and white file pair the apps used to swap, which only knew about two of six modes.
 */
function renderSuiteMark() {
  const slot = document.getElementById("rail-mark");
  if (!slot) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", SUITE_MARK_VIEW_BOX);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SUITE_MARK_PATH);
  svg.append(path);
  slot.replaceChildren(svg);
}
