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
  editToggle: document.querySelector("#edit-toggle"),
  editBar: document.querySelector("#edit-bar"),
  widgetChoice: document.querySelector("#widget-choice"),
  addWidget: document.querySelector("#add-widget"),
  empty: document.querySelector("#empty"),
  newTab: document.querySelector("#new-tab"),
  home: document.querySelector("#home"),
  openHome: document.querySelector("#open-home"),
};

const SIZES = ["1x1", "2x1", "full"];

let state = {
  tabs: [],
  activeTabId: null,
  surface: "launcher",
  screens: [],
  packs: [],
  catalogue: [],
  installedVersions: [],
  theme: { mode: "dark", values: {} },
  notice: null,
};
let query = "";
let editing = false;
let shouldFocusSearch = true;
let appsView = {
  packs: null,
  packCount: null,
  catalogue: null,
  catalogueCount: null,
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
  for (const [name, value] of Object.entries(state.theme.values)) {
    root.style.setProperty(name, value);
  }
}

function sizeLabel(size) {
  if (size === "full") return "Full row";
  if (size === "2x1") return "2 × 1";
  return "1 × 1";
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

function countLabel(total, noun) {
  return total === 0 ? "" : `${total} ${noun}${total === 1 ? "" : "s"}`;
}

function installedCard(pack) {
  const tile = element("div", "tile");
  const card = element("button", "card");
  card.type = "button";
  card.title = `Open ${pack.name}`;

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
  card.addEventListener("click", () => run(api.openPack(pack.id)));
  tile.append(card);

  const actions = element("div", "tile-actions");
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

function catalogueCard(entry) {
  const tile = element("div", "tile");
  const card = element("div", "card card-static");
  const name = entry.name.length > 0 ? entry.name : entry.id;

  const top = element("div", "card-top");
  const dot = element("span", "card-dot");
  dot.style.background = colorFor(entry.id);
  dot.setAttribute("aria-hidden", "true");
  top.append(dot, element("span", "card-name", name));
  top.append(
    element(
      "span",
      entry.trusted ? "pill pill-available" : "pill pill-refused",
      entry.trusted ? "available" : "refused",
    ),
  );
  if (entry.version.length > 0) {
    top.append(element("span", "card-version", `v${entry.version}`));
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
  }

  tile.append(card);
  const actions = element("div", "tile-actions");
  if (!entry.trusted) {
    const refused = actionButton("Cannot install", () => {});
    refused.disabled = true;
    actions.append(refused);
  } else {
    const installed = state.installedVersions.some(
      (version) => version.id === entry.id && version.version === entry.version,
    );
    const button = actionButton(
      installed ? "Installed" : `Install v${entry.version}`,
      () => {
        button.disabled = true;
        Promise.resolve(api.installCataloguePack(entry.id, entry.version))
          .catch((error) => {
            showNotice(error instanceof Error ? error.message : "The host refused that action.");
          })
          .finally(() => {
            button.disabled = installed;
          });
      },
      "action-primary",
    );
    button.disabled = installed;
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
  const matches = state.catalogue.filter((entry) =>
    matchesQuery(entry.name, entry.id, entry.description),
  );
  appsView.catalogueCount.textContent = countLabel(state.catalogue.length, "archive");

  if (state.catalogue.length === 0) {
    appsView.catalogue.replaceChildren(
      element(
        "p",
        "empty",
        "No archives are in the catalogue. Put signed .suitepack files in the catalogue folder, or use Add pack….",
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
 * The `shell.apps` host widget: the installed pack grid and the local catalogue.
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
    "Packs arrive as signed .suitepack files in the catalogue folder. Installing adds one to this device. A new app opens right away; restart Suite to run a new version of an app that is already open. An update keeps the old version until you remove it.",
  );
  const catalogue = element("div", "grid");
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
  available.append(availableHead, muted, catalogue, install);

  body.append(installed, available);
  appsView = { packs, packCount, catalogue, catalogueCount, search: input };
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

function widgetTile(widget, index, total) {
  const tile = element("section", `widget widget-${widget.size} widget-${widget.source}`);
  tile.dataset.registryId = widget.registryId;
  tile.setAttribute("role", "group");
  tile.setAttribute("aria-label", `${widget.title}, ${sizeLabel(widget.size)}`);
  if (editing) tile.tabIndex = 0;

  const head = element("div", "widget-head");
  const title = element("h2", "widget-title", widget.title);
  head.append(title);
  if (widget.source === "host") head.append(element("span", "pill pill-host", "Suite Shell"));
  if (widget.source === "app" && widget.appName !== null) {
    head.append(element("span", "pill", widget.appName));
  }
  if (widget.source === "unknown") head.append(element("span", "pill pill-refused", "unknown"));
  head.append(element("span", "widget-size", sizeLabel(widget.size)));
  tile.append(head);

  const body = element("div", "widget-body");
  if (widget.source === "host" && widget.registryId === "shell.apps") {
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

  if (editing) {
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

function renderWidgets(view) {
  const fragment = document.createDocumentFragment();
  view.widgets.forEach((widget, index) => {
    fragment.append(widgetTile(widget, index, view.widgets.length));
  });
  if (view.widgets.length === 0) {
    fragment.append(element("p", "empty", "This Screen has no widgets. Choose Edit to add one."));
  }
  elements.widgets.replaceChildren(fragment);
}

function renderChoices(view) {
  const placed = new Set(view.widgets.map((widget) => widget.registryId));
  const choices = view.choices.filter((choice) => !placed.has(choice.registryId));
  elements.widgetChoice.replaceChildren();
  for (const choice of choices) {
    const option = element("option", "", `${choice.title} — ${choice.appName}`);
    option.value = choice.registryId;
    elements.widgetChoice.append(option);
  }
  elements.addWidget.disabled = choices.length === 0;
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
    appsView = {
      packs: null,
      packCount: null,
      catalogue: null,
      catalogueCount: null,
      search: null,
    };
    return;
  }

  elements.notice.hidden = state.notice === null;
  elements.notice.textContent = state.notice ?? "";
  elements.screenName.textContent = view ? view.name : screenTab.title;
  elements.screenEyebrow.textContent = view ? "Screen" : "Unavailable screen";

  if (view === undefined || !view.available) {
    editing = false;
    elements.editToggle.hidden = true;
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
  elements.editToggle.textContent = editing ? "Done" : "Edit";
  elements.editToggle.setAttribute("aria-pressed", String(editing));
  elements.editBar.hidden = !editing;
  renderChoices(view);
  renderWidgets(view);
  updateFocus();
}

function paint() {
  applyTheme();
  renderTabs();
  renderScreen();

  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  document.body.dataset.surface = state.surface;
  document.title = active ? `${active.title} — Suite Shell` : "Suite Shell";
}

function bindChrome() {
  const openHome = () => {
    shouldFocusSearch = true;
    run(api.newTab());
  };

  elements.newTab.addEventListener("click", openHome);
  elements.home.addEventListener("click", openHome);
  elements.openHome.addEventListener("click", openHome);

  elements.editToggle.addEventListener("click", () => {
    editing = !editing;
    paint();
  });

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
