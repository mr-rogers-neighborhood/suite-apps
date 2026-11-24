import { describe, expect, it } from "vitest";
import { devPacksEnabled, mergePackSources, shouldOpenAfterInstall } from "./packRegistry.js";
import type { PackInfo } from "./packs.js";
import type { ShellTab } from "./shared.js";

function tab(packId: string): ShellTab {
  return { kind: "pack", id: packId, packId, title: packId, entry: "index.html" };
}

function pack(id: string, name: string, source: PackInfo["source"]): PackInfo {
  return {
    id,
    name,
    version: "1.0.0",
    description: null,
    entry: "index.html",
    capabilities: [],
    publisher: { id: "suite", fingerprint: "AA:BB" },
    root: `/packs/${id}`,
    source,
  };
}

describe("the development pack gate", () => {
  it("opens only for an unpackaged app with the explicit switch", () => {
    expect(devPacksEnabled({ isPackaged: false, env: { SUITE_SHELL_DEV_PACKS: "1" } })).toBe(true);
  });

  it("stays closed without the switch", () => {
    expect(devPacksEnabled({ isPackaged: false, env: {} })).toBe(false);
    expect(devPacksEnabled({ isPackaged: false, env: { SUITE_SHELL_DEV_PACKS: "0" } })).toBe(false);
    expect(devPacksEnabled({ isPackaged: false, env: { SUITE_SHELL_DEV_PACKS: "true" } })).toBe(
      false,
    );
  });

  it("is ignored in a packaged build", () => {
    expect(devPacksEnabled({ isPackaged: true, env: { SUITE_SHELL_DEV_PACKS: "1" } })).toBe(false);
  });
});

describe("merging pack sources", () => {
  it("sorts the combined list by name", () => {
    const merged = mergePackSources({
      installed: [pack("scratch", "Scratch", "installed")],
      development: [pack("welcome", "Welcome", "development")],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["scratch", "welcome"]);
  });

  it("lets a development pack win a collision with an installed pack", () => {
    const merged = mergePackSources({
      installed: [pack("welcome", "Welcome", "installed")],
      development: [pack("welcome", "Welcome", "development")],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("development");
    expect(merged[0]?.root).toBe("/packs/welcome");
  });

  it("keeps installed packs that have no development twin", () => {
    const merged = mergePackSources({
      installed: [pack("welcome", "Welcome", "installed"), pack("scratch", "Scratch", "installed")],
      development: [pack("welcome", "Welcome", "development")],
    });
    expect(merged.map((entry) => [entry.id, entry.source])).toEqual([
      ["scratch", "installed"],
      ["welcome", "development"],
    ]);
  });

  it("returns an empty list when neither source has a pack", () => {
    expect(mergePackSources({ installed: [], development: [] })).toEqual([]);
  });
});

describe("opening a pack after install", () => {
  it("opens a pack that has no tab", () => {
    expect(shouldOpenAfterInstall([], "demo")).toBe(true);
    expect(shouldOpenAfterInstall([tab("welcome")], "demo")).toBe(true);
  });

  it("does not open a duplicate tab for a pack that is already open", () => {
    expect(shouldOpenAfterInstall([tab("demo")], "demo")).toBe(false);
    expect(shouldOpenAfterInstall([tab("welcome"), tab("demo")], "demo")).toBe(false);
  });

  it("matches the pack id exactly", () => {
    expect(shouldOpenAfterInstall([tab("demolition")], "demo")).toBe(true);
  });

  it("ignores a screen tab", () => {
    expect(
      shouldOpenAfterInstall(
        [{ kind: "screen", id: "home", screenId: "home", title: "Home" }],
        "demo",
      ),
    ).toBe(true);
  });
});
