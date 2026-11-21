import { describe, expect, it } from "vitest";
import {
  ALL_CATALOGUE_APPS,
  CATALOGUE_APPS,
  catalogueMatchesContracts,
  FLATPAK_CATALOGUE_APPS,
  readCatalogue,
  SELF_ENTRY,
  SELF_ID,
  withInstalled,
} from "./catalogue.js";

describe("the catalogue", () => {
  it("names every stable app, its pre-release identity, then Help and the hub", () => {
    expect(CATALOGUE_APPS.map((entry) => entry.id)).toEqual(["canvas", "planner", "budget"]);
    expect(ALL_CATALOGUE_APPS.map((entry) => entry.id)).toEqual([
      "canvas",
      "planner",
      "budget",
      "slop-canvas",
      "slop-planner",
      "slop-budget",
      "help",
    ]);
    expect(FLATPAK_CATALOGUE_APPS.map((entry) => entry.id)).toEqual(["help"]);
  });

  it("carries no feed: the Flatpak store is the update channel", () => {
    for (const entry of [...ALL_CATALOGUE_APPS, SELF_ENTRY]) {
      expect(entry).not.toHaveProperty("feed");
      expect(entry).not.toHaveProperty("flatpakOnly");
    }
  });

  it("says the same thing about each app that SUITE_APPS does", () => {
    // The table repeats what each app's own manifest declares; this is the half of
    // that repetition a test can hold.
    expect(catalogueMatchesContracts()).toEqual([]);
  });

  it("reads what is installed and puts the hub's row last", async () => {
    const catalogue = await readCatalogue({
      installed: new Map([
        ["canvas", "0.3.0"],
        ["planner", "0.1.0"],
      ]),
    });

    expect(catalogue.map((entry) => entry.id)).toEqual([
      ...ALL_CATALOGUE_APPS.map((entry) => entry.id),
      SELF_ID,
    ]);
    expect(catalogue.find((entry) => entry.id === "canvas")?.installed).toBe("0.3.0");
    expect(catalogue.find((entry) => entry.id === "budget")?.installed).toBeNull();
    expect(catalogue.at(-1)?.id).toBe(SELF_ID);
  });

  it("updates one entry after a store change and leaves the rest alone", async () => {
    const catalogue = await readCatalogue({ installed: new Map() });
    const next = withInstalled(catalogue, "canvas", "0.3.0");
    expect(next.find((entry) => entry.id === "canvas")?.installed).toBe("0.3.0");
    expect(next.find((entry) => entry.id === "planner")?.installed).toBeNull();
  });
});
