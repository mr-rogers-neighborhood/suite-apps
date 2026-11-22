import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderApps } from "./renderer/apps.js";
import { renderHome, resetEditing } from "./renderer/home.js";
import { findAll, findById, installDocument } from "./rendererTestDom.mjs";

/**
 * The Home Screen pane.
 *
 * Two questions are worth testing here and nowhere else: that every placement the resolved
 * Screen names is drawn in its order with its controls, and that the app grid inside its
 * widget still carries every card the catalogue produced. Unknown placements and settings
 * have their own cases because keeping them visible is the rule.
 */

const STATIC_IDS = ["screen", "screen-note", "screen-status", "screen-add", "widget-picker"];

let nodes;
let root;

beforeEach(() => {
  ({ nodes, root } = installDocument(STATIC_IDS));
  nodes.get("widget-picker").value = "";
  resetEditing();
});

function widget(overrides = {}) {
  return {
    registryId: "start.apps",
    title: "Apps",
    description: "Every app the suite offers, installed or not.",
    kind: "apps",
    size: "full",
    sizes: ["2x1", "full"],
    submitLabel: null,
    fields: [],
    settings: [],
    unknownSettings: [],
    note: null,
    ...overrides,
  };
}

function recentsWidget(overrides = {}) {
  return widget({
    registryId: "start.recents",
    title: "Recently opened",
    description: "The last documents Start opened for you.",
    kind: "recents",
    size: "2x1",
    sizes: ["1x1", "2x1", "full"],
    ...overrides,
  });
}

function appWidget(overrides = {}) {
  return widget({
    registryId: "planner.quick-task",
    title: "Quick task",
    description: null,
    kind: "app",
    size: "2x1",
    sizes: ["1x1", "2x1", "full"],
    submitLabel: "Add task",
    fields: [{ id: "title", label: "Task", type: "text", required: true, maxLength: 120 }],
    settings: [
      {
        id: "project",
        label: "Project",
        type: "text",
        value: "inbox",
        required: false,
        maxLength: null,
      },
    ],
    ...overrides,
  });
}

function unknownWidget(overrides = {}) {
  return widget({
    registryId: "future.unknown-widget",
    title: "future.unknown-widget",
    description: "Nothing on this machine provides future.unknown-widget yet.",
    kind: "unknown",
    size: "1x1",
    sizes: ["1x1", "2x1", "full"],
    note: "This widget and its settings stay in the Screen until an installed app declares it.",
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
  setWidgetSetting: vi.fn(),
  openRecent: vi.fn(),
  rerender: vi.fn(),
};

function screensState(overrides = {}) {
  return {
    homeId: "start-home",
    openId: "start-home",
    screens: [{ id: "start-home", name: "Home", home: true, open: true, readable: true }],
    screen: {
      id: "start-home",
      name: "Home",
      home: true,
      widgets: [widget()],
    },
    available: [],
    note: null,
    managerNote: null,
    replacement: null,
    ...overrides,
  };
}

function launcher(screensOverrides = {}, outer = {}) {
  return {
    apps: [],
    self: null,
    recents: [],
    ...outer,
    screens: screensState(screensOverrides),
  };
}

function render(state) {
  renderHome(state, actions);
  renderApps(state, actions);
}

function shells() {
  return findAll(root, (node) => node.dataset?.widgetId !== undefined);
}

function edit() {
  findById(root, "screen-edit").fire("click");
  // The toggle asks the page to repaint; a test does the same thing directly.
  render(screensStateLast);
}

/** The state most recently painted, so a re-render after the toggle uses it. */
let screensStateLast = null;

function paint(state) {
  screensStateLast = state;
  render(state);
}

describe("the Home Screen", () => {
  it("draws one widget per placement, in the Screen's order and size", () => {
    paint(
      launcher({
        screen: {
          id: "start-home",
          name: "Home",
          home: true,
          widgets: [recentsWidget(), appWidget(), unknownWidget()],
        },
      }),
    );

    expect(
      shells().map((node) => [node.dataset.widgetId, node.dataset.size, node.dataset.kind]),
    ).toEqual([
      ["start.recents", "2x1", "recents"],
      ["planner.quick-task", "2x1", "app"],
      ["future.unknown-widget", "1x1", "unknown"],
    ]);
  });

  it("still renders every card inside the app grid widget", () => {
    const apps = [
      card(),
      card({ id: "planner", name: "Suite Planner", state: "not-installed", version: null }),
      card({ id: "budget", name: "Suite Budget", source: "flatpak", state: "update-available" }),
      card({ id: "slop-canvas", name: "Suite Canvas (pre-release)", tier: "canary" }),
    ];

    paint(
      launcher(
        { screen: { id: "start-home", name: "Home", home: true, widgets: [widget()] } },
        { apps, self: card({ id: "start", name: "Suite Start" }) },
      ),
    );

    const grid = findById(root, "apps");
    expect(grid.children.map((node) => node.dataset.appId)).toEqual([
      "canvas",
      "planner",
      "budget",
      "start",
    ]);
    const preRelease = findById(root, "apps-pre-release-list");
    expect(preRelease.children.map((node) => node.dataset.appId)).toEqual(["slop-canvas"]);
    expect(findById(root, "apps-pre-release").hidden).toBe(false);
  });

  it("shows the document note when the file was not honoured, and hides it otherwise", () => {
    const note = nodes.get("screen-note");

    paint(launcher({ note: "This screen was written by a newer Suite." }));
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("newer Suite");

    paint(launcher());
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe("");
  });

  it("draws an unknown placement as a named placeholder with its note", () => {
    paint(
      launcher({
        screen: { id: "start-home", name: "Home", home: true, widgets: [unknownWidget()] },
      }),
    );

    const [shell] = shells();
    expect(findAll(shell, (node) => node.className === "widget-title")[0].textContent).toBe(
      "future.unknown-widget",
    );
    expect(
      findAll(shell, (node) => node.tagName === "p" && node.className.includes("widget-unknown"))[0]
        .textContent,
    ).toContain("stay in the Screen");
  });

  it("draws an app widget's title, capture fields and settings", () => {
    paint(
      launcher({ screen: { id: "start-home", name: "Home", home: true, widgets: [appWidget()] } }),
    );

    const [shell] = shells();
    expect(findAll(shell, (node) => node.className === "widget-title")[0].textContent).toBe(
      "Quick task",
    );

    const fields = findAll(shell, (node) => node.className === "field");
    expect(fields.map((node) => [node.type, node.name])).toEqual([
      ["text", "title"],
      ["text", ""],
    ]);
    expect(fields[0].required).toBe(true);
    expect(fields[0].maxLength).toBe(120);
    expect(fields[1].value).toBe("inbox");

    const submit = findAll(shell, (node) => node.type === "submit")[0];
    expect(submit.textContent).toBe("Add task");
    expect(submit.disabled).toBe(true);

    fields[1].value = "work";
    fields[1].fire("change");
    expect(actions.setWidgetSetting).toHaveBeenCalledWith("planner.quick-task", "project", "work");
  });

  it("keeps the editing tools out of the ordinary view", () => {
    paint(
      launcher({ screen: { id: "start-home", name: "Home", home: true, widgets: [widget()] } }),
    );

    expect(findAll(root, (node) => node.dataset?.widgetAction !== undefined)).toEqual([]);
    expect(nodes.get("screen-add").hidden).toBe(true);
    expect(findById(root, "screen-edit").textContent).toBe("Edit layout");
  });

  it("shows the named tools in edit mode and offers the widgets that can be added", () => {
    paint(
      launcher({
        screen: { id: "start-home", name: "Home", home: true, widgets: [widget()] },
        available: [
          {
            registryId: "start.recents",
            title: "Recently opened",
            description: null,
            defaultSize: "2x1",
          },
        ],
      }),
    );
    edit();

    const [shell] = shells();
    const moveLater = findAll(shell, (node) => node.dataset?.widgetAction === "later")[0];
    expect(moveLater.attributes["aria-label"]).toBe("Move later: Apps, position 1 of 1");
    expect(moveLater.disabled).toBe(true);
    expect(nodes.get("screen-add").hidden).toBe(false);
    expect(nodes.get("widget-picker").children.map((option) => option.value)).toEqual([
      "start.recents",
    ]);
    expect(findById(root, "screen-edit").textContent).toBe("Done editing");
  });

  it("moves a widget with Alt+Arrow in edit mode and announces the move", () => {
    paint(
      launcher({
        screen: {
          id: "start-home",
          name: "Home",
          home: true,
          widgets: [widget(), recentsWidget()],
        },
      }),
    );
    edit();

    const [first, second] = shells();
    first.fire("keydown", { key: "ArrowRight", altKey: true });
    expect(actions.moveWidget).toHaveBeenCalledWith("start.apps", "later");
    expect(nodes.get("screen-status").textContent).toContain("position 2 of 2");

    second.fire("keydown", { key: "ArrowLeft", altKey: true });
    expect(actions.moveWidget).toHaveBeenCalledWith("start.recents", "earlier");
  });

  it("does not take a plain arrow key as a move", () => {
    paint(
      launcher({
        screen: {
          id: "start-home",
          name: "Home",
          home: true,
          widgets: [widget(), recentsWidget()],
        },
      }),
    );
    edit();
    actions.moveWidget.mockClear();

    shells()[0].fire("keydown", { key: "ArrowRight", altKey: false });
    expect(actions.moveWidget).not.toHaveBeenCalled();
  });

  it("offers only the size classes the placement declares and resizes on change", () => {
    paint(
      launcher({
        screen: { id: "start-home", name: "Home", home: true, widgets: [recentsWidget()] },
      }),
    );
    edit();

    const select = findAll(shells()[0], (node) => node.tagName === "select")[0];
    expect(select.children.map((option) => option.value)).toEqual(["1x1", "2x1", "full"]);
    expect(select.children.find((option) => option.selected)?.value).toBe("2x1");
    expect(select.attributes["aria-label"]).toBe("Size of Recently opened");

    select.value = "full";
    select.fire("change");
    expect(actions.resizeWidget).toHaveBeenCalledWith("start.recents", "full");
  });

  it("does not let the last placement be removed", () => {
    paint(
      launcher({ screen: { id: "start-home", name: "Home", home: true, widgets: [widget()] } }),
    );
    edit();

    const remove = findAll(shells()[0], (node) => node.dataset?.widgetAction === "remove")[0];
    expect(remove.disabled).toBe(true);
  });

  it("removes a placement when another one remains", () => {
    paint(
      launcher({
        screen: {
          id: "start-home",
          name: "Home",
          home: true,
          widgets: [widget(), recentsWidget()],
        },
      }),
    );
    edit();

    const remove = findAll(shells()[0], (node) => node.dataset?.widgetAction === "remove")[0];
    expect(remove.disabled).toBe(false);
    remove.fire("click");
    expect(actions.removeWidget).toHaveBeenCalledWith("start.apps");
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

    paint(
      launcher(
        { screen: { id: "start-home", name: "Home", home: true, widgets: [recentsWidget()] } },
        { recents },
      ),
    );

    const row = findAll(shells()[0], (node) => node.className === "row-open")[0];
    expect(row.children.map((node) => node.textContent)).toEqual([
      "plan.planner",
      "Suite Planner · just now",
    ]);
    row.fire("click");
    expect(actions.openRecent).toHaveBeenCalledWith(recents[0]);
  });
});
