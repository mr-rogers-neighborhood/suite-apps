import type { KeyValueStore } from "@suite/go";
import { describe, expect, it } from "vitest";
import {
  closeTab,
  createTabStore,
  EMPTY_TABS,
  focusTab,
  openTab,
  removeTabs,
  retainTabs,
  showHome,
} from "./tabs.js";

/**
 * Open-app tabs (Orca pattern).
 *
 * The rules that matter are pure: one tab per app, an existing app is focused
 * rather than opened twice, closing the active tab falls back instead of leaving
 * a hole, and a removed pack takes its tabs with it.
 */

describe("opening and focusing", () => {
  it("opens one tab per app and focuses an app that is already open", () => {
    let state = openTab(EMPTY_TABS, "planner");
    state = openTab(state, "budget");
    state = openTab(state, "planner");

    expect(state).toEqual({ tabs: ["planner", "budget"], active: "planner" });
  });

  it("does not open a second tab when a capture targets an open app", () => {
    const state = openTab(openTab(EMPTY_TABS, "planner"), "budget");
    expect(openTab(state, "planner").tabs).toEqual(["planner", "budget"]);
  });

  it("ignores focusing an app that has no tab", () => {
    expect(focusTab(EMPTY_TABS, "planner")).toEqual(EMPTY_TABS);
  });
});

describe("closing and leaving", () => {
  it("closes the active tab and falls back to its left neighbour, then right", () => {
    const state = openTab(openTab(openTab(EMPTY_TABS, "a"), "b"), "c");

    expect(closeTab(state, "c")).toEqual({ tabs: ["a", "b"], active: "b" });
    // The first tab has no left neighbour, so the next surviving one wins.
    const first = { tabs: ["a", "b", "c"], active: "a" };
    expect(closeTab(first, "a")).toEqual({ tabs: ["b", "c"], active: "b" });
  });

  it("closes a resting tab without moving the active one", () => {
    const state = openTab(openTab(EMPTY_TABS, "a"), "b");
    expect(closeTab(state, "a")).toEqual({ tabs: ["b"], active: "b" });
  });

  it("leaves a tab for Home without closing it", () => {
    expect(showHome(openTab(EMPTY_TABS, "a"))).toEqual({ tabs: ["a"], active: null });
  });

  it("removes every tab a pack owned and moves off a removed active tab", () => {
    const state = openTab(openTab(EMPTY_TABS, "a"), "b");
    expect(removeTabs(state, ["b"])).toEqual({ tabs: ["a"], active: "a" });
  });

  it("drops a restored tab whose app is no longer available", () => {
    expect(retainTabs({ tabs: ["a", "gone"], active: "gone" }, ["a"])).toEqual({
      tabs: ["a"],
      active: null,
    });
  });
});

describe("persistence", () => {
  function memory(): KeyValueStore & { value: string | null } {
    const store = {
      value: null as string | null,
      async get() {
        return store.value;
      },
      async set(_key: string, value: string) {
        store.value = value;
      },
      async delete() {
        store.value = null;
      },
      async keys() {
        return [];
      },
    };
    return store;
  }

  it("round-trips the strip and active tab, and tolerates a malformed value", async () => {
    const store = memory();
    const tabs = createTabStore(store);

    await tabs.write({ tabs: ["planner", "budget"], active: "budget" });
    expect(await tabs.read()).toEqual({ tabs: ["planner", "budget"], active: "budget" });

    store.value = "{not json";
    expect(await tabs.read()).toEqual(EMPTY_TABS);
  });
});
