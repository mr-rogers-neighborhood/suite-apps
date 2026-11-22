import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderApps } from "./renderer/apps.js";
import { renderDashboard } from "./renderer/dashboard.js";

/**
 * The dashboard pane.
 *
 * The page is plain DOM, so this is the smallest document it needs: elements with
 * children, an id, a dataset and the handful of properties the renderers set. Two
 * questions are worth testing here and nowhere else: that every widget in the resolved
 * layout is drawn with its controls wired, and that the app grid inside its widget still
 * carries every card the catalogue produced.
 */

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = [];
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.selected = false;
    this.id = "";
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    this.listeners.push([type, listener]);
  }

  /** Fire the one listener a test cares about, the way a click or a change would. */
  fire(type) {
    for (const [name, listener] of this.listeners) {
      if (name === type) listener({ type, target: this });
    }
  }
}

const STATIC_IDS = [
  "dashboard",
  "dashboard-note",
  "dashboard-status",
  "dashboard-add",
  "widget-picker",
];

let nodes;
let root;

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function findAll(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
}

beforeEach(() => {
  nodes = new Map(STATIC_IDS.map((id) => [id, new FakeNode(id)]));
  root = nodes.get("dashboard");
  nodes.get("widget-picker").value = "";
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    getElementById: (id) => nodes.get(id) ?? findById(root, id),
  };
});

function widget(overrides = {}) {
  return {
    id: "start.apps",
    title: "Apps",
    description: "Every app the suite offers, installed or not.",
    kind: "apps",
    size: "full",
    sizes: ["2x1", "full"],
    ...overrides,
  };
}

function recentsWidget(overrides = {}) {
  return widget({
    id: "start.recents",
    title: "Recently opened",
    description: "The last documents Start opened for you.",
    kind: "recents",
    size: "2x1",
    sizes: ["1x1", "2x1", "full"],
    ...overrides,
  });
}

function card(overrides = {}) {
  return {
    id: "canvas",
    name: "Suite Canvas",
    source: "folder",
    icon: null,
    state: "current",
    version: "0.1.0",
    reason: null,
    running: false,
    channel: "alpha",
    tier: "stable",
    switchTier: null,
    executable: "/opt/suite/canvas",
    fileExtensions: ["canvas"],
    lastOpenedAt: null,
    fileCount: 0,
    health: { ok: true },
    ...overrides,
  };
}

const actions = {
  launch: vi.fn(),
  install: vi.fn(),
  remove: vi.fn(),
  uninstall: vi.fn(),
  reveal: vi.fn(),
  moveWidget: vi.fn(),
  resizeWidget: vi.fn(),
  addWidget: vi.fn(),
  removeWidget: vi.fn(),
  openRecent: vi.fn(),
};

function render(state) {
  renderDashboard(state, actions);
  renderApps(state, actions);
}

function shells() {
  return findAll(root, (node) => node.dataset?.widgetId !== undefined);
}

describe("the dashboard", () => {
  it("draws one widget per layout entry, in the file's order and size", () => {
    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: {
        widgets: [recentsWidget(), widget()],
        available: [],
        note: null,
      },
    });

    expect(shells().map((node) => [node.dataset.widgetId, node.dataset.size])).toEqual([
      ["start.recents", "2x1"],
      ["start.apps", "full"],
    ]);
  });

  it("still renders every card inside the app grid widget", () => {
    const apps = [
      card(),
      card({ id: "planner", name: "Suite Planner", state: "not-installed", version: null }),
      card({ id: "budget", name: "Suite Budget", source: "flatpak", state: "update-available" }),
      card({ id: "slop-canvas", name: "Suite Canvas (pre-release)", tier: "canary" }),
    ];

    render({
      apps,
      self: card({ id: "start", name: "Suite Start" }),
      recents: [],
      dashboard: { widgets: [widget()], available: [], note: null },
    });

    const grid = document.getElementById("apps");
    expect(grid.children.map((node) => node.dataset.appId)).toEqual([
      "canvas",
      "planner",
      "budget",
      "start",
    ]);
    const preRelease = document.getElementById("apps-pre-release-list");
    expect(preRelease.children.map((node) => node.dataset.appId)).toEqual(["slop-canvas"]);
    expect(document.getElementById("apps-pre-release").hidden).toBe(false);
  });

  it("shows the repair note when the layout was not honoured, and hides it otherwise", () => {
    const note = nodes.get("dashboard-note");

    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: {
        widgets: [widget()],
        available: [],
        note: "Not shown because nothing on this machine provides planner.quick-task.",
      },
    });
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("planner.quick-task");

    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [widget()], available: [], note: null },
    });
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe("");
  });

  it("offers move controls that name the widget and its position, disabled at the ends", () => {
    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [widget(), recentsWidget()], available: [], note: null },
    });

    const [first, second] = shells();
    const earlier = (shell) =>
      findAll(shell, (node) => node.dataset?.widgetAction === "earlier")[0];
    const later = (shell) => findAll(shell, (node) => node.dataset?.widgetAction === "later")[0];

    expect(earlier(first).disabled).toBe(true);
    expect(later(first).disabled).toBe(false);
    expect(later(first).attributes["aria-label"]).toBe("Move later: Apps, position 1 of 2");
    expect(earlier(second).disabled).toBe(false);
    expect(later(second).disabled).toBe(true);
  });

  it("moves a widget when its control is used", () => {
    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [widget(), recentsWidget()], available: [], note: null },
    });

    const later = findAll(shells()[0], (node) => node.dataset?.widgetAction === "later")[0];
    later.fire("click");

    expect(actions.moveWidget).toHaveBeenCalledWith("start.apps", "later");
  });

  it("offers only the size classes the widget declares", () => {
    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [recentsWidget()], available: [], note: null },
    });

    const select = findAll(shells()[0], (node) => node.tagName === "select")[0];
    expect(select.children.map((option) => option.value)).toEqual(["1x1", "2x1", "full"]);
    expect(select.children.find((option) => option.selected)?.value).toBe("2x1");
    expect(select.attributes["aria-label"]).toBe("Size of Recently opened");

    select.value = "full";
    select.fire("change");
    expect(actions.resizeWidget).toHaveBeenCalledWith("start.recents", "full");
  });

  it("does not let the last widget be removed", () => {
    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [widget()], available: [], note: null },
    });

    const remove = findAll(shells()[0], (node) => node.dataset?.widgetAction === "remove")[0];
    expect(remove.disabled).toBe(true);
  });

  it("lists the widgets that are not on the dashboard yet, and hides the picker when none", () => {
    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [widget()], available: [recentsWidget()], note: null },
    });

    const picker = nodes.get("widget-picker");
    expect(nodes.get("dashboard-add").hidden).toBe(false);
    expect(picker.children.map((option) => [option.value, option.textContent])).toEqual([
      ["start.recents", "Recently opened"],
    ]);

    render({
      apps: [],
      self: null,
      recents: [],
      dashboard: { widgets: [widget(), recentsWidget()], available: [], note: null },
    });
    expect(nodes.get("dashboard-add").hidden).toBe(true);
  });

  it("renders the recents widget's own rows and opens one", () => {
    const recents = [
      {
        path: "/home/person/Documents/Suite/Planner/plan.planner",
        name: "plan.planner",
        appId: "planner",
        appName: "Suite Planner",
        openedAt: Date.now(),
      },
    ];

    render({
      apps: [],
      self: null,
      recents,
      dashboard: { widgets: [recentsWidget()], available: [], note: null },
    });

    const row = findAll(shells()[0], (node) => node.className === "row-open")[0];
    expect(row.children.map((node) => node.textContent)).toEqual([
      "plan.planner",
      "Suite Planner · just now",
    ]);
    row.fire("click");
    expect(actions.openRecent).toHaveBeenCalledWith(recents[0]);
  });
});
