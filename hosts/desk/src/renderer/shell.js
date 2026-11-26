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

const api = globalThis.suiteShell;

const elements = {
  tabs: document.querySelector("#tabs"),
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
  newTab: document.querySelector("#new-tab"),
  home: document.querySelector("#home"),
  openHome: document.querySelector("#open-home"),
  syncToggle: document.querySelector("#sync-toggle"),
  syncPanel: document.querySelector("#sync-panel"),
  syncState: document.querySelector("#sync-state"),
  syncAddress: document.querySelector("#sync-address"),
  syncFingerprint: document.querySelector("#sync-fingerprint"),
  syncCode: document.querySelector("#sync-code"),
  syncError: document.querySelector("#sync-error"),
  syncStart: document.querySelector("#sync-start"),
  syncStop: document.querySelector("#sync-stop"),
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
  screens: [],
  screenList: [],
  homeScreenId: "",
  screenManagerNote: null,
  packs: [],
  catalogue: [],
  catalogueSource: "",
  installedVersions: [],
  theme: { preset: "suite", mode: "dark", values: {} },
  notice: null,
  reminderStatus: null,
  relay: { ...EMPTY_RELAY },
};
let query = "";
let editing = false;
let managingScreens = false;
let syncOpen = false;
let shouldFocusSearch = true;
let appsView = {
  packs: null,
  packCount: null,
  catalogue: null,
  catalogueCount: null,
  catalogueSource: null,
  search: null,
};

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

function colorFor(id) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return `hsl(${hash} 68% 62%)`;
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
  root.classList.toggle("dark", state.theme.mode === "dark");
  for (const [name, value] of Object.entries(state.theme.values)) {
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

function renderTabs() {
  const fragment = document.createDocumentFragment();

  for (const tab of state.tabs) {
    const selected = tab.id === state.activeTabId;
    const node = element("div", "tab");
    node.setAttribute("role", "tab");
    node.setAttribute("aria-selected", String(selected));
    node.tabIndex = selected ? 0 : -1;
    node.dataset.tabId = tab.id;
    node.dataset.kind = tab.kind;
    node.title = tab.title;

    const dot = element("span", "tab-dot");
    dot.style.background = colorFor(tab.kind === "pack" ? tab.packId : tab.screenId);
    dot.setAttribute("aria-hidden", "true");
    if (tab.kind === "screen") dot.classList.add("tab-dot-screen");

    const title = element("span", "tab-title", tab.title);
    const close = element("button", "tab-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", `Close ${tab.title}`);
    close.title = `Close ${tab.title}`;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      run(api.closeTab(tab.id));
    });

    node.append(dot, title, close);
    node.addEventListener("click", () => run(api.activateTab(tab.id)));
    node.addEventListener("keydown", (event) => {
      if (event.target !== node) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        run(api.activateTab(tab.id));
      }
    });
    fragment.append(node);
  }

  elements.tabs.replaceChildren(fragment);
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
    fragment.append(element("p", "empty", "This Screen has no widgets. Choose Edit to add one."));
  }
  elements.widgets.replaceChildren(fragment);
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
  elements.syncToggle.setAttribute("aria-expanded", String(syncOpen));
  elements.syncToggle.dataset.state = relay.state;
  elements.syncToggle.textContent =
    relay.state === "on"
      ? "Sync · on"
      : relay.state === "crashed" || relay.state === "failed"
        ? "Sync · !"
        : "Sync";
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
  renderTabs();
  renderSync();
  renderScreen();

  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  document.body.dataset.surface = state.surface;
  document.title = active ? `${active.title} — Suite Desk` : "Suite Desk";
}

function bindChrome() {
  const openHome = () => {
    shouldFocusSearch = true;
    run(api.newTab());
  };

  elements.newTab.addEventListener("click", openHome);
  elements.home.addEventListener("click", openHome);
  elements.openHome.addEventListener("click", openHome);

  elements.syncToggle.addEventListener("click", () => {
    syncOpen = !syncOpen;
    paint();
  });
  elements.syncStart.addEventListener("click", () => runRelayAction(api.relayStart()));
  elements.syncStop.addEventListener("click", () => runRelayAction(api.relayStop()));

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
    const command = event.ctrlKey || event.metaKey;
    if (!command) return;

    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      openHome();
    } else if (event.key.toLowerCase() === "w" && state.activeTabId !== null) {
      event.preventDefault();
      run(api.closeTab(state.activeTabId));
    } else if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      shouldFocusSearch = true;
      updateFocus();
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
