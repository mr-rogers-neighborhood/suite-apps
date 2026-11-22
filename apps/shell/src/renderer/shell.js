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
    dot.style.background = colorFor(tab.packId);
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

function renderPacks() {
  const needle = query.trim().toLowerCase();
  const matches = state.packs.filter((pack) => {
    if (needle.length === 0) return true;
    return `${pack.name} ${pack.id} ${pack.description ?? ""}`.toLowerCase().includes(needle);
  });

  elements.packCount.textContent =
    state.packs.length === 0
      ? ""
      : `${state.packs.length} pack${state.packs.length === 1 ? "" : "s"}`;

  if (matches.length === 0) {
    const message = element(
      "p",
      "empty",
      state.packs.length === 0
        ? "No packs are installed. Use Install pack… to add a signed pack."
        : `No pack matches “${query.trim()}”.`,
    );
    elements.packs.replaceChildren(message);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const pack of matches) {
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
    fragment.append(card);
  }
  elements.packs.replaceChildren(fragment);
}

function paint() {
  applyTheme();
  renderTabs();
  renderPacks();

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
