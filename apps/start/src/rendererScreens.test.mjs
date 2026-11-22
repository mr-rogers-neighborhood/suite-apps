import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderScreens } from "./renderer/screens.js";
import { findAll, findById, installDocument } from "./rendererTestDom.mjs";

/**
 * The host-owned Screens manager.
 *
 * Start owns this surface, so the test is about the controls a person uses: the list names
 * every Screen, Home and Open are disabled where they would do nothing, and deleting Home
 * turns into a question about its replacement rather than a dead button.
 */

const STATIC_IDS = ["screens-manager-body"];

let root;

beforeEach(() => {
  ({ root } = installDocument(STATIC_IDS));
});

const actions = {
  createScreen: vi.fn(),
  renameScreen: vi.fn(),
  duplicateScreen: vi.fn(),
  deleteScreen: vi.fn(),
  setHomeScreen: vi.fn(),
  openScreen: vi.fn(),
};

function screen(overrides = {}) {
  return { id: "start-home", name: "Home", home: false, open: false, readable: true, ...overrides };
}

function screensState(overrides = {}) {
  return {
    homeId: "start-home",
    openId: "start-home",
    screens: [screen({ home: true, open: true }), screen({ id: "work", name: "Work" })],
    screen: { id: "start-home", name: "Home", home: true, widgets: [] },
    available: [],
    note: null,
    managerNote: null,
    replacement: null,
    ...overrides,
  };
}

function paint(state) {
  renderScreens({ screens: state }, actions);
}

function rows() {
  return findAll(root, (node) => node.dataset?.screenId !== undefined);
}

function rowFor(id) {
  return rows().find((row) => row.dataset.screenId === id);
}

function button(row, action) {
  return findAll(row, (node) => node.dataset?.screenAction === action)[0];
}

describe("the Screens manager", () => {
  it("lists every Screen with its Home and Open roles", () => {
    paint(screensState());

    expect(rows().map((row) => row.dataset.screenId)).toEqual(["start-home", "work"]);
    const home = rowFor("start-home");
    expect(findAll(home, (node) => node.className === "screen-row-name")[0].textContent).toBe(
      "Home",
    );
    expect(
      findAll(home, (node) => node.className === "screen-badge").map((node) => node.textContent),
    ).toEqual(["Home", "Open"]);
  });

  it("opens a Screen and makes one Home, with each control named", () => {
    paint(screensState());

    const work = rowFor("work");
    const open = button(work, "open");
    expect(open.disabled).toBe(false);
    expect(open.attributes["aria-label"]).toBe("Open Work");
    open.fire("click");
    expect(actions.openScreen).toHaveBeenCalledWith("work");

    const home = button(work, "home");
    expect(home.attributes["aria-label"]).toBe("Make Work the Home Screen");
    home.fire("click");
    expect(actions.setHomeScreen).toHaveBeenCalledWith("work");

    // The current Home is already Home, and the open Screen is already open.
    expect(button(rowFor("start-home"), "open").disabled).toBe(true);
    expect(button(rowFor("start-home"), "home").disabled).toBe(true);
  });

  it("renames, duplicates and deletes by id", () => {
    paint(screensState());

    const work = rowFor("work");
    const input = findAll(work, (node) => node.className === "field screen-rename-input")[0];
    expect(input.value).toBe("Work");
    input.value = "Deep work";
    button(work, "rename").fire("click");
    expect(actions.renameScreen).toHaveBeenCalledWith("work", "Deep work");

    button(work, "duplicate").fire("click");
    expect(actions.duplicateScreen).toHaveBeenCalledWith("work");

    button(work, "delete").fire("click");
    expect(actions.deleteScreen).toHaveBeenCalledWith("work", null);
  });

  it("does not let the last Screen be deleted", () => {
    const state = screensState({
      screens: [screen({ home: true, open: true })],
    });
    paint(state);

    expect(button(rowFor("start-home"), "delete").disabled).toBe(true);
  });

  it("marks an unreadable Screen and refuses to open or duplicate it", () => {
    paint(
      screensState({ screens: [screen({ home: true, readable: false }), screen({ id: "work" })] }),
    );

    const broken = rowFor("start-home");
    expect(
      findAll(broken, (node) => node.className.includes("screen-badge-warning"))[0].textContent,
    ).toBe("Unreadable");
    expect(button(broken, "open").disabled).toBe(true);
    expect(button(broken, "duplicate").disabled).toBe(true);
  });

  it("creates a Screen from the name field", () => {
    paint(screensState());

    const input = findById(root, "screen-new-name");
    input.value = "Reading";
    findById(root, "screen-create").fire("click");
    expect(actions.createScreen).toHaveBeenCalledWith("Reading");
  });

  it("asks which Screen becomes Home before deleting Home", () => {
    paint(
      screensState({
        managerNote: "Home can only be deleted once another Screen becomes Home.",
        replacement: { forId: "start-home", choices: [{ id: "work", name: "Work" }] },
      }),
    );

    expect(findAll(root, (node) => node.className === "screens-note")[0].textContent).toContain(
      "another Screen becomes Home",
    );
    const select = findAll(rowFor("start-home"), (node) => node.tagName === "select")[0];
    expect(select.children.map((option) => [option.value, option.textContent])).toEqual([
      ["work", "Work"],
    ]);

    select.value = "work";
    button(rowFor("start-home"), "delete-home").fire("click");
    expect(actions.deleteScreen).toHaveBeenCalledWith("start-home", "work");
  });
});
