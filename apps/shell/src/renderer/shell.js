/*
 * The chrome page.
 *
 * It draws the tab strip and the launcher. It never draws pack content: a pack
 * lives in its own WebContentsView over the area below the tab bar. The page
 * names packs and tabs; the main process owns windows, views and documents.
 */

const api = globalThis.suiteShell;

const elements = {
  tabs: document.querySelector("#tabs"),
  packs: document.querySelector("#packs"),
  packCount: document.querySelector("#pack-count"),
  catalogue: document.querySelector("#catalogue"),
  catalogueCount: document.querySelector("#catalogue-count"),
  search: document.querySelector("#search"),
  notice: document.querySelector("#notice"),
  newTab: document.querySelector("#new-tab"),
  home: document.querySelector("#home"),
  installPack: document.querySelector("#install-pack"),
};

let state = {
  tabs: [],
  activeTabId: null,
  packs: [],
  catalogue: [],
  installedVersions: [],
  theme: { mode: "dark", values: {} },
  notice: null,
};
let query = "";
let shouldFocusSearch = true;

function showNotice(message) {
  elements.notice.hidden = false;
  elements.notice.textContent = message;
}

function run(promise) {
  promise.catch((error) => {
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

function renderTabs() {
  const fragment = document.createDocumentFragment();

  for (const tab of state.tabs) {
    const selected = tab.id === state.activeTabId;
    const node = element("div", "tab");
    node.setAttribute("role", "tab");
    node.setAttribute("aria-selected", String(selected));
    node.tabIndex = selected ? 0 : -1;
    node.dataset.tabId = tab.id;
    node.title = tab.title;

    const dot = element("span", "tab-dot");
    dot.style.background = colorFor(tab.kind === "pack" ? tab.packId : tab.id);
    dot.setAttribute("aria-hidden", "true");

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

  const meta = element("div", "card-meta");
  for (const capability of pack.capabilities) {
    meta.append(element("span", "pill", capability));
  }
  if (pack.capabilities.length === 0) meta.append(element("span", "pill", "no capabilities"));

  card.append(top, description, meta);
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
  const matches = state.packs.filter((pack) => matchesQuery(pack.name, pack.id, pack.description));

  elements.packCount.textContent = countLabel(state.packs.length, "pack");

  if (matches.length === 0) {
    const message = element(
      "p",
      "empty",
      state.packs.length === 0
        ? "No packs are installed. Add a signed pack or install one from the catalogue below."
        : `No pack matches “${query.trim()}”.`,
    );
    elements.packs.replaceChildren(message);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const pack of matches) fragment.append(installedCard(pack));
  elements.packs.replaceChildren(fragment);
}

function renderCatalogue() {
  const matches = state.catalogue.filter((entry) =>
    matchesQuery(entry.name, entry.id, entry.description),
  );
  elements.catalogueCount.textContent = countLabel(state.catalogue.length, "archive");

  if (state.catalogue.length === 0) {
    elements.catalogue.replaceChildren(
      element(
        "p",
        "empty",
        "No archives are in the catalogue. Put signed .suitepack files in the catalogue folder, or use Add pack….",
      ),
    );
    return;
  }
  if (matches.length === 0) {
    elements.catalogue.replaceChildren(
      element("p", "empty", `No catalogue archive matches “${query.trim()}”.`),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of matches) fragment.append(catalogueCard(entry));
  elements.catalogue.replaceChildren(fragment);
}

function paint() {
  applyTheme();
  renderTabs();
  renderPacks();
  renderCatalogue();

  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  document.body.dataset.active = String(state.activeTabId !== null);
  document.title = active ? `${active.title} — Suite` : "Suite";

  elements.notice.hidden = state.notice === null;
  elements.notice.textContent = state.notice ?? "";

  if (state.activeTabId === null && shouldFocusSearch) {
    shouldFocusSearch = false;
    elements.search.focus();
  }
}

function bindChrome() {
  elements.newTab.addEventListener("click", () => {
    shouldFocusSearch = true;
    run(api.newTab());
  });
  elements.home.addEventListener("click", () => {
    shouldFocusSearch = true;
    run(api.newTab());
  });

  elements.search.addEventListener("input", () => {
    query = elements.search.value;
    renderPacks();
    renderCatalogue();
  });

  elements.installPack.addEventListener("click", () => {
    elements.installPack.disabled = true;
    Promise.resolve(api.installPack())
      .catch((error) => {
        showNotice(error instanceof Error ? error.message : "The host refused that action.");
      })
      .finally(() => {
        elements.installPack.disabled = false;
      });
  });

  document.addEventListener("keydown", (event) => {
    const command = event.ctrlKey || event.metaKey;
    if (!command) {
      if (event.key === "Escape" && document.activeElement === elements.search) {
        elements.search.value = "";
        query = "";
        renderPacks();
        renderCatalogue();
      }
      return;
    }

    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      shouldFocusSearch = true;
      run(api.newTab());
    } else if (event.key.toLowerCase() === "w" && state.activeTabId !== null) {
      event.preventDefault();
      run(api.closeTab(state.activeTabId));
    } else if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      shouldFocusSearch = true;
      elements.search.focus();
      elements.search.select();
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
    if (next.activeTabId === null && state.activeTabId !== null) shouldFocusSearch = true;
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
