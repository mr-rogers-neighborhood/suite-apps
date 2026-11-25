import { describe, expect, it } from "vitest";
import { packTabsFor, planUninstall } from "./lifecycle.js";
import type { ShellTab } from "./shared.js";

const tabs: readonly ShellTab[] = [
  { kind: "pack", id: "a", packId: "welcome", title: "Welcome", entry: "index.html" },
  { kind: "pack", id: "b", packId: "welcome", title: "Welcome again", entry: "index.html" },
  { kind: "pack", id: "c", packId: "scratch", title: "Scratch", entry: "index.html" },
  { kind: "screen", id: "d", screenId: "home", title: "Home" },
];

describe("uninstall and open tabs", () => {
  it("closes every open tab for the pack being uninstalled", () => {
    expect(planUninstall(tabs, "welcome")).toEqual({
      closeTabs: ["a", "b"],
      closesOpenTabs: true,
    });
  });

  it("ignores screen tabs and other packs", () => {
    expect(packTabsFor(tabs, "welcome").map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(packTabsFor(tabs, "screen-only")).toEqual([]);
  });

  it("removes a version even when no tab is open", () => {
    expect(planUninstall([tabs[3] as ShellTab], "welcome")).toEqual({
      closeTabs: [],
      closesOpenTabs: false,
    });
  });
});
