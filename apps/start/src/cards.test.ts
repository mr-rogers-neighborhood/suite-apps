import type { SuiteAppManifest } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import { appCards, attentionCount, fileCards, selfCard } from "./cards.js";
import type { CatalogueApp } from "./catalogue.js";
import type { IndexedFile } from "./fileIndex.js";
import type { DiscoveredApp } from "./registry.js";

function discovered(overrides: Partial<SuiteAppManifest> = {}): DiscoveredApp {
  return {
    manifest: {
      format: "suite.app",
      id: "canvas",
      name: "Suite Canvas",
      version: "0.1.0",
      contractVersion: "1.0.0",
      deepLinkPrefix: "suite://canvas/",
      fileExtensions: ["canvas"],
      protocols: [],
      capabilities: ["document.file"],
      widgets: [],
      ...overrides,
    },
    manifestPath: "/installs/canvas/suite.app.json",
    executable: "/opt/suite/canvas",
    installedAt: null,
  };
}

function offered(overrides: Partial<CatalogueApp> = {}): CatalogueApp {
  return {
    id: "canvas",
    name: "Suite Canvas",
    folder: "Canvas",
    extensions: ["canvas"],
    capabilities: ["document.file"],
    channel: "alpha",
    installed: null,
    ...overrides,
  };
}

function indexed(overrides: Partial<IndexedFile> = {}): IndexedFile {
  return {
    path: "/home/me/Documents/Suite/Canvas/Research.canvas",
    name: "Research.canvas",
    appId: "canvas",
    appName: "Canvas",
    folder: "Canvas",
    modifiedAt: 1_000,
    installed: true,
    ...overrides,
  };
}

const NO_RUNNING: ReadonlySet<string> = new Set();

function flatpak(commit = "a".repeat(64)): DiscoveredApp {
  return {
    ...discovered(),
    executable: "/usr/bin/flatpak",
    flatpak: { application: "run.suite.canvas", installation: "user", branch: "master", commit },
  };
}

describe("appCards", () => {
  it("offers an install for an app the store carries", () => {
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [offered()],
      running: NO_RUNNING,
      store: new Map([["canvas", "a".repeat(64)]]),
    });
    expect(card).toMatchObject({
      id: "canvas",
      name: "Suite Canvas",
      state: "not-installed",
      version: null,
      executable: null,
    });
  });

  it("says no release when the store does not offer the app", () => {
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [offered()],
      running: NO_RUNNING,
    });
    expect(card?.state).toBe("no-release");
    expect(card?.reason).toBe("the store does not offer this app");
  });

  it("leaves a copy in a folder to its owner", () => {
    const [card] = appCards({
      apps: [{ ...discovered(), executable: "/home/me/Downloads/suite-canvas.AppImage" }],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [offered()],
      running: NO_RUNNING,
      store: new Map([["canvas", "a".repeat(64)]]),
    });
    expect(card).toMatchObject({
      source: "folder",
      state: "local",
      version: "0.1.0",
      reason: null,
    });
  });

  it("labels a Flatpak and compares it with its origin's commit", () => {
    const [card] = appCards({
      apps: [flatpak()],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [offered({ installed: "0.1.0" })],
      running: NO_RUNNING,
      store: new Map([["canvas", "a".repeat(64)]]),
    });
    expect(card).toMatchObject({
      source: "flatpak",
      state: "current",
      version: "0.1.0",
      reason: null,
    });
  });

  it("offers an update when the origin publishes another commit", () => {
    const [card] = appCards({
      apps: [flatpak()],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [offered({ installed: "0.1.0" })],
      running: NO_RUNNING,
      store: new Map([["canvas", "b".repeat(64)]]),
    });
    expect(card).toMatchObject({ source: "flatpak", state: "update-available" });
  });

  it("keeps an installed app the catalogue does not name", () => {
    // D44: a copy built by hand is a first-class app, not a lesser one.
    const [card] = appCards({
      apps: [discovered({ id: "scratch", name: "Scratch", deepLinkPrefix: "suite://scratch/" })],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [],
      running: NO_RUNNING,
    });
    expect(card).toMatchObject({
      id: "scratch",
      state: "local",
      source: "folder",
      version: "0.1.0",
      executable: "/opt/suite/canvas",
    });
  });

  it("counts the files the index found for the app", () => {
    const [card] = appCards({
      apps: [discovered()],
      rejected: [],
      files: [indexed(), indexed({ name: "B.canvas" }), indexed({ appId: "budget" })],
      recents: [],
      catalogue: [offered({ installed: "0.1.0" })],
      running: NO_RUNNING,
    });
    expect(card?.fileCount).toBe(2);
    expect(card?.health).toEqual({ ok: true });
  });

  it("takes the channel from the manifest", () => {
    const [card] = appCards({
      apps: [discovered({ update: { feed: "https://example.test/feed", channel: "beta" } })],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [offered({ installed: "0.1.0" })],
      running: NO_RUNNING,
    });
    expect(card?.channel).toBe("beta");
  });

  it("carries the last-open time from Start's own history", () => {
    const [card] = appCards({
      apps: [discovered()],
      rejected: [],
      files: [],
      recents: [{ path: "/a.canvas", appId: "canvas", openedAt: 1_700_000_000_000 }],
      catalogue: [offered({ installed: "0.1.0" })],
      running: NO_RUNNING,
    });
    expect(card?.lastOpenedAt).toBe(1_700_000_000_000);
  });

  it("turns a refused install into a card that says why, before the others", () => {
    const cards = appCards({
      apps: [discovered()],
      rejected: [
        { path: "/installs/budget/suite.app.json", reason: "the manifest is not JSON" },
        { path: "/opt/canvas/suite.app.json", reason: "gone", id: "canvas" },
      ],
      files: [],
      recents: [],
      catalogue: [offered({ installed: "0.1.0" })],
      running: NO_RUNNING,
    });

    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({
      id: null,
      name: "budget",
      state: "refused",
      executable: null,
      health: { ok: false, reason: "the manifest is not JSON" },
    });
    // A refused install with a record keeps its id, so it can still be removed.
    expect(cards[1]).toMatchObject({ id: "canvas", name: "canvas", state: "refused" });
  });

  it("offers Help through the store", () => {
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      catalogue: [
        offered({
          id: "help",
          name: "Suite Help",
          folder: "Help",
          extensions: [],
          capabilities: [],
        }),
      ],
      running: NO_RUNNING,
      store: new Map([["help", "c".repeat(64)]]),
    });
    expect(card).toMatchObject({
      id: "help",
      name: "Suite Help",
      state: "not-installed",
      version: null,
    });
    // The card keeps the app's own mark, so Help is recognisable before it is installed.
    expect(card?.icon).toMatch(/^data:image\/png;base64,/u);
  });

  it("counts only the cards that need attention", () => {
    const cards = appCards({
      apps: [discovered(), discovered({ id: "planner" })],
      rejected: [{ path: "/installs/budget/suite.app.json", reason: "the manifest is not JSON" }],
      files: [],
      recents: [],
      catalogue: [
        offered({ installed: "0.1.0" }),
        offered({ id: "planner", name: "Suite Planner", installed: "0.1.0" }),
      ],
      running: NO_RUNNING,
    });
    expect(attentionCount(cards)).toBe(1);
    expect(attentionCount([])).toBe(0);
  });
});

describe("selfCard", () => {
  it("offers Update Start only when the origin publishes another commit", () => {
    const card = selfCard(offered({ id: "start", name: "Suite Start" }), "0.3.0", {
      flatpak: true,
      canUpdate: true,
      checked: true,
    });
    expect(card).toMatchObject({
      id: "start",
      source: "flatpak",
      state: "update-available",
      version: "0.3.0",
      reason: "Flatpak reports a newer build is available",
    });
  });

  it("says the installed build is current when the origin offers nothing newer", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", {
      flatpak: true,
      checked: true,
    });
    expect(card).toMatchObject({
      source: "flatpak",
      state: "current",
      reason: "Flatpak reports the newest build is installed",
    });
  });

  it("offers nothing when Flatpak did not deploy this build", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", { flatpak: true });
    expect(card).toMatchObject({
      source: "flatpak",
      state: "current",
      reason: "not checked (Flatpak)",
    });
  });

  it("says the deployed build starts next launch, because the running one keeps its code", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", {
      flatpak: true,
      canUpdate: true,
      checked: true,
      updated: true,
    });
    expect(card.reason).toContain("starts next launch");
    // The update already happened, so the row does not ask for it again.
    expect(card.state).toBe("current");
  });

  it("a failed check never claims an update", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", {
      flatpak: true,
      error: "could not read suite-local for run.suite.start",
    });
    expect(card).toMatchObject({
      state: "current",
      reason: "could not read suite-local for run.suite.start",
    });
  });

  it("a non-Flatpak build cannot replace itself", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0");
    expect(card).toMatchObject({ id: "start", source: "folder", state: "current" });
  });
});

describe("fileCards", () => {
  it("gives every row the link that opens it", () => {
    const rows = fileCards([indexed()]);
    expect(rows[0]).toMatchObject({
      name: "Research.canvas",
      appId: "canvas",
      link: "suite://canvas/workspace/Research.canvas",
    });
  });

  it("leaves a row without a link when its name would not survive one", () => {
    const rows = fileCards([indexed({ name: "a/b.canvas" })]);
    expect(rows[0]?.link).toBeNull();
  });
});
