import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "./catalogue.js";
import { shelfAction, shelfFrom, shelfSummary } from "./shelf.js";

function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id: "planner",
    name: "Planner",
    order: 0,
    description: "Days, tasks and notes",
    version: "1.0.0",
    capabilities: ["documents"],
    platform: { state: "available", reason: "" },
    sizeBytes: 1200,
    sha256: "a".repeat(64),
    url: "https://flatpak.suite.run/packs/planner.suitepack",
    publisher: "suite",
    installedVersion: null,
    action: "install",
    ...overrides,
  };
}

describe("Home's shelf routing", () => {
  it("keeps the index's order for shadows and moves installed apps to their own section", () => {
    const shelf = shelfFrom([
      entry({ id: "canvas", name: "Canvas", order: 0 }),
      entry({
        id: "planner",
        name: "Planner",
        order: 1,
        installedVersion: "1.0.0",
        action: "current",
      }),
      entry({ id: "budget", name: "Budget", order: 2 }),
      entry({ id: "help", name: "Help", order: 3 }),
    ]);

    expect(shelf.shadows.map((row) => row.id)).toEqual(["canvas", "budget", "help"]);
    expect(shelf.installed.map((row) => row.id)).toEqual(["planner"]);
  });

  it("does not branch on a domain id: any row is a shadow or installed by its version alone", () => {
    const shelf = shelfFrom([
      entry({ id: "alpha", order: 0 }),
      entry({ id: "beta", order: 1, installedVersion: "2.0.0", action: "current" }),
    ]);
    expect(shelf.shadows.map((row) => row.id)).toEqual(["alpha"]);
    expect(shelf.installed.map((row) => row.id)).toEqual(["beta"]);
  });

  it("keeps a platform refusal ahead of the install verbs", () => {
    expect(shelfAction(entry({ platform: { state: "unavailable", reason: "not on Go" } }))).toBe(
      "unavailable",
    );
    expect(shelfAction(entry({ action: "update", installedVersion: "0.9.0" }))).toBe("update");
    expect(shelfAction(entry({ action: "current", installedVersion: "1.0.0" }))).toBe("installed");
  });

  it("uses the description for one line, and says when a pack asks for nothing", () => {
    expect(shelfSummary(entry())).toBe("Days, tasks and notes");
    expect(shelfSummary(entry({ description: null, capabilities: [] }))).toBe("Asks for nothing.");
    expect(shelfSummary(entry({ description: null, capabilities: ["documents", "files"] }))).toBe(
      "Uses documents, files.",
    );
  });
});
