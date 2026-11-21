import type { SuiteAppManifest } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import { appCards } from "./cards.js";
import { ALL_CATALOGUE_APPS, type CatalogueApp } from "./catalogue.js";
import { isPreReleaseId } from "./channels.js";
import type { StoreChannel } from "./packageBackend.js";
import type { DiscoveredApp } from "./registry.js";

/**
 * Cards from fake listings.
 *
 * These are the shapes the package backend reports after discovery, so the tests
 * exercise the card rules rather than a live Flatpak: two ids, one pre-release
 * branch, and the copy a removal would show.
 */

const APPS_ROOT = "/home/me/Applications/Suite";
const COMMIT_A = "a".repeat(64);
const COMMIT_B = "b".repeat(64);

function discovered(
  id: string,
  options: {
    readonly version?: string;
    readonly flatpak?: { readonly branch: string; readonly commit?: string } | undefined;
  } = {},
): DiscoveredApp {
  const version = options.version ?? "0.1.0";
  const flatpak = options.flatpak;
  return {
    manifest: {
      format: "suite.app",
      id,
      name: isPreReleaseId(id) ? "Suite Canvas (pre-release)" : "Suite Canvas",
      version,
      contractVersion: "1.0.0",
      deepLinkPrefix: `suite://${id}/`,
      fileExtensions: ["canvas"],
      protocols: [],
      capabilities: ["document.file"],
    } satisfies SuiteAppManifest,
    manifestPath: "",
    executable:
      flatpak === undefined ? `${APPS_ROOT}/${id}/${version}/suite-canvas` : "/usr/bin/flatpak",
    installedAt: null,
    ...(flatpak === undefined
      ? {}
      : {
          flatpak: {
            application: `run.suite.${id}`,
            installation: "user",
            branch: flatpak.branch,
            ...(flatpak.commit === undefined ? {} : { commit: flatpak.commit }),
          },
        }),
  };
}

function catalogue(installed: ReadonlyMap<string, string>): readonly CatalogueApp[] {
  return ALL_CATALOGUE_APPS.map((entry) => {
    const preRelease = entry.preRelease === true;
    return {
      ...entry,
      available: preRelease ? null : "0.1.0",
      reason: preRelease ? "a pre-release updates through its Flatpak branch" : null,
      installed: installed.get(entry.id) ?? null,
      newer: false,
      artifact: null,
    } satisfies CatalogueApp;
  });
}

function cards(
  apps: readonly DiscoveredApp[],
  channels: ReadonlyMap<string, readonly StoreChannel[]> = new Map(),
) {
  return appCards({
    apps,
    rejected: [],
    files: [],
    recents: [],
    updates: new Map(),
    catalogue: catalogue(new Map(apps.map((entry) => [entry.manifest.id, entry.manifest.version]))),
    versions: new Map(),
    running: new Set(),
    appsRoot: APPS_ROOT,
    storeChannels: channels,
  });
}

describe("channel-aware cards", () => {
  it("shows the stable card when a machine has neither id", () => {
    const cardsFor = cards([]);
    expect(cardsFor.map((card) => card.id)).toEqual(["canvas", "planner", "budget"]);
    expect(cardsFor.find((card) => card.id === "slop.canvas")).toBeUndefined();
    expect(cardsFor[0]?.tier).toBe("stable");
    expect(cardsFor[0]?.channelNotice).toBeNull();
  });

  it("shows stable and one pre-release side by side, each named", () => {
    const cardsFor = cards(
      [
        discovered("canvas"),
        discovered("slop.canvas", { flatpak: { branch: "canary", commit: COMMIT_A } }),
      ],
      new Map([["slop.canvas", [{ tier: "canary", branch: "canary", commit: COMMIT_A }]]]),
    );

    const stable = cardsFor.find((card) => card.id === "canvas");
    const preRelease = cardsFor.find((card) => card.id === "slop.canvas");
    expect(stable).toMatchObject({ tier: "stable", channelNotice: null, source: "managed" });
    expect(preRelease).toMatchObject({
      id: "slop.canvas",
      name: "Suite Canvas (pre-release)",
      tier: "canary",
      source: "flatpak",
      state: "current",
      installChannel: "flatpak",
      switchTier: null,
    });
    expect(preRelease?.channelNotice).toContain("Canary");
    expect(preRelease?.channelNotice).toContain("uninstalling asks before deleting it");
  });

  it("offers a switch, not a second install, when two pre-release branches exist", () => {
    const cardsFor = cards(
      [discovered("slop.canvas", { flatpak: { branch: "slop", commit: COMMIT_A } })],
      new Map([
        [
          "slop.canvas",
          [
            { tier: "slop", branch: "slop", commit: COMMIT_A },
            { tier: "canary", branch: "canary", commit: COMMIT_B },
          ],
        ],
      ]),
    );

    const preRelease = cardsFor.filter((card) => card.id === "slop.canvas");
    // One id, one card: the other branch is a switch on it, never a second package.
    expect(preRelease).toHaveLength(1);
    expect(preRelease[0]).toMatchObject({
      state: "current",
      switchTier: "canary",
    });
    expect(preRelease[0]?.channelNotice).toContain("Switching to canary keeps this install");
    expect(preRelease[0]?.channelNotice).toContain("changes its data folder");
    expect(
      cardsFor.some((card) => card.id === "slop.canvas" && card.state === "not-installed"),
    ).toBe(false);
  });

  it("updates inside the installed tier without offering another branch", () => {
    const cardsFor = cards(
      [discovered("slop.canvas", { flatpak: { branch: "beta", commit: COMMIT_A } })],
      new Map([["slop.canvas", [{ tier: "beta", branch: "beta", commit: COMMIT_B }]]]),
    );

    const preRelease = cardsFor.find((card) => card.id === "slop.canvas");
    expect(preRelease).toMatchObject({
      tier: "beta",
      state: "update-available",
      switchTier: null,
    });
  });
});
