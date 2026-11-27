import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { RelayView, ShellTab } from "../../shared.js";
import { colorFor, syncPresentation, toHostPack, toHostTabs } from "./state.js";

const tabs: readonly ShellTab[] = [
  { kind: "pack", id: "tab-1", packId: "canvas", title: "Canvas", entry: "index.html" },
  { kind: "screen", id: "tab-2", screenId: "home", title: "Home" },
];

function relay(overrides: Partial<RelayView> = {}): RelayView {
  return {
    state: "off",
    on: false,
    address: null,
    fingerprint: null,
    code: null,
    consoleUrl: null,
    restartCount: 0,
    lastError: null,
    ...overrides,
  };
}

describe("the host bar's state mapping", () => {
  it("maps pack and screen tabs and keeps their identity colour", () => {
    const mapped = toHostTabs(tabs);
    expect(mapped.map(({ id, title, kind }) => ({ id, title, kind }))).toEqual([
      { id: "tab-1", title: "Canvas", kind: "pack" },
      { id: "tab-2", title: "Home", kind: "screen" },
    ]);

    const packIcon = mapped[0]?.icon as ReactElement<{ style: { background: string } }>;
    const screenIcon = mapped[1]?.icon as ReactElement<{ style: { background: string } }>;
    expect(packIcon.props.style.background).toBe(colorFor("canvas"));
    expect(screenIcon.props.style.background).toBe(colorFor("home"));
    expect(packIcon.props.style.background).not.toBe(screenIcon.props.style.background);
  });

  it("names the relay lifecycle as the shared pill does", () => {
    expect(syncPresentation(relay()).situation).toBe("local");
    expect(syncPresentation(relay({ state: "starting" })).situation).toBe("connecting");
    expect(
      syncPresentation(relay({ state: "on", on: true, address: "wss://127.0.0.1:1/sync" })),
    ).toEqual({
      situation: "synced",
      label: "Sync on",
      tooltip: "wss://127.0.0.1:1/sync",
    });
    expect(syncPresentation(relay({ state: "failed", lastError: "no bus" }))).toEqual({
      situation: "refused",
      label: "Sync failed",
      tooltip: "no bus",
    });
    expect(syncPresentation(relay({ state: "crashed", lastError: "no bus" })).label).toBe(
      "Sync failed",
    );
  });

  it("gives the pack a row whenever it published anything, including only a title", () => {
    // A pack with a document name and no controls used to be treated as nothing, so its
    // title vanished. Every published zone counts as material.
    expect(toHostPack({ navigation: null })).toBeUndefined();
    expect(toHostPack({ navigation: null, context: "Autumn plan" })).toEqual({
      context: "Autumn plan",
      navigation: null,
    });
    expect(toHostPack({ navigation: null, actions: "Export" })).toEqual({
      navigation: null,
      actions: "Export",
    });
    expect(toHostPack({ navigation: "View", context: "Autumn plan", actions: "Export" })).toEqual({
      context: "Autumn plan",
      navigation: "View",
      actions: "Export",
    });
  });
});
