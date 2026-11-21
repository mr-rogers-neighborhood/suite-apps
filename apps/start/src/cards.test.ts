import type { SuiteAppManifest } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import { appCards, attentionCount, fileCards, selfCard } from "./cards.js";
import type { CatalogueApp } from "./catalogue.js";
import type { IndexedFile } from "./fileIndex.js";
import type { DiscoveredApp } from "./registry.js";
import type { ReportedUpdate } from "./reportedUpdate.js";

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
    feed: "https://example.test/canvas",
    channel: "alpha",
    available: null,
    reason: null,
    installed: null,
    newer: false,
    artifact: null,
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

/** The report an app that has never checked gives. */
const UNREPORTED: ReportedUpdate = {
  state: "unknown",
  version: null,
  available: null,
  checkedAt: null,
  source: null,
};

const NO_UPDATES: ReadonlyMap<string, ReportedUpdate> = new Map();
const NO_VERSIONS: ReadonlyMap<string, number> = new Map();
const NO_RUNNING: ReadonlySet<string> = new Set();
const APPS_ROOT = "/home/me/Applications/Suite";

/** A copy Start placed, which is the only kind it may replace. */
function managed(overrides: Partial<SuiteAppManifest> = {}): DiscoveredApp {
  return { ...discovered(overrides), executable: `${APPS_ROOT}/Canvas/0.1.1/suite-canvas` };
}

describe("appCards", () => {
  it("offers a card for an app that is not on this machine at all", () => {
    // The empty window was the thing this replaced, so this is the test that matters.
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.2.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({
      id: "canvas",
      name: "Suite Canvas",
      state: "not-installed",
      version: null,
      available: "0.2.0",
      executable: null,
    });
  });

  it("offers nothing when the feed offered nothing, and says why", () => {
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ reason: "the manifest is not signed by the publisher" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card?.state).toBe("no-release");
    expect(card?.available).toBeNull();
    expect(card?.reason).toBe("the manifest is not signed by the publisher");
  });

  it("asks for an update when the feed is ahead, and keeps the installed version visible", () => {
    const [card] = appCards({
      apps: [managed()],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.2.0", installed: "0.1.0", newer: true })],
      versions: new Map([["canvas", 2]]),
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({
      state: "update-available",
      version: "0.1.0",
      available: "0.2.0",
      executable: `${APPS_ROOT}/Canvas/0.1.1/suite-canvas`,
      versions: 2,
    });
  });

  it("offers the version it replaced, and only when one is on disk", () => {
    const withPrevious = appCards({
      apps: [managed()],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.2.0", installed: "0.2.0" })],
      versions: new Map([["canvas", 2]]),
      previous: new Map([["canvas", "0.1.0"]]),
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(withPrevious[0]?.previousVersion).toBe("0.1.0");

    const withoutOne = appCards({
      apps: [managed()],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.2.0", installed: "0.2.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(withoutOne[0]?.previousVersion).toBeNull();
  });

  it("says up to date when the installed version is the offered one", () => {
    const [card] = appCards({
      apps: [managed()],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.1.0", installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({ state: "current", version: "0.1.0", available: "0.1.0" });
  });

  it("keeps an installed app the catalogue does not name", () => {
    // D44: a copy built by hand is a first-class app, not a lesser one.
    const [card] = appCards({
      apps: [discovered({ id: "scratch", name: "Scratch", deepLinkPrefix: "suite://scratch/" })],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({
      id: "scratch",
      state: "local",
      source: "folder",
      version: "0.1.0",
      available: null,
      executable: "/opt/suite/canvas",
    });
  });

  it("labels a Flatpak install and does not sell it the AppImage feed", () => {
    // The feed is a different channel: offering its version here would install a
    // second copy in another format rather than update the one that is running.
    const [card] = appCards({
      apps: [
        {
          ...discovered(),
          executable: "/usr/bin/flatpak",
          flatpak: { application: "run.suite.canvas", installation: "user" },
        },
      ],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.3.0", installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({
      id: "canvas",
      source: "flatpak",
      state: "current",
      version: "0.1.0",
      available: null,
      reason: null,
      versions: 1,
      previousVersion: null,
    });
  });

  it("offers the store as the install channel when it has the app", () => {
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
      store: new Map([["canvas", "a".repeat(64)]]),
    });
    expect(card).toMatchObject({ state: "not-installed", installChannel: "flatpak" });
  });

  it("is still installable from the store when no AppImage feed answered", () => {
    // The store is the channel, so a silent feed must not hide the Install button.
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: null, reason: "the feed could not be read" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
      store: new Map([["canvas", "a".repeat(64)]]),
    });
    expect(card).toMatchObject({ state: "not-installed", installChannel: "flatpak" });
  });

  it("leaves a copy a person placed under its own updater, whatever the feed says", () => {
    const [card] = appCards({
      apps: [{ ...discovered(), executable: "/home/me/Downloads/suite-canvas.AppImage" }],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ available: "0.9.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({ source: "folder", state: "local", version: "0.1.0" });
  });

  it("says a Flatpak has an update when the store publishes another commit", () => {
    const [card] = appCards({
      apps: [
        {
          ...discovered(),
          executable: "/usr/bin/flatpak",
          flatpak: {
            application: "run.suite.canvas",
            installation: "user",
            commit: "a".repeat(64),
          },
        },
      ],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
      store: new Map([["canvas", "b".repeat(64)]]),
    });
    expect(card).toMatchObject({
      source: "flatpak",
      state: "update-available",
      available: null,
      installChannel: "flatpak",
    });
  });

  it("leaves a Flatpak current when the store has the installed commit", () => {
    const commit = "a".repeat(64);
    const [card] = appCards({
      apps: [
        {
          ...discovered(),
          executable: "/usr/bin/flatpak",
          flatpak: { application: "run.suite.canvas", installation: "user", commit },
        },
      ],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
      store: new Map([["canvas", commit]]),
    });
    expect(card).toMatchObject({ source: "flatpak", state: "current" });
  });

  it("calls an install under Start's own root managed, whoever asked first", () => {
    const [card] = appCards({
      apps: [{ ...discovered(), executable: `${APPS_ROOT}/Canvas/0.1.0/suite-canvas` }],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0", available: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({ source: "managed", state: "current" });
  });

  it("counts the files the index found for the app", () => {
    const [card] = appCards({
      apps: [discovered()],
      rejected: [],
      files: [indexed(), indexed({ name: "B.canvas" }), indexed({ appId: "budget" })],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0", available: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card?.fileCount).toBe(2);
    expect(card?.health).toEqual({ ok: true });
  });

  it("takes the channel from the manifest and the update state from the app", () => {
    const [card] = appCards({
      apps: [discovered({ update: { feed: "https://example.test/feed", channel: "beta" } })],
      rejected: [],
      files: [],
      recents: [],
      updates: new Map([
        [
          "canvas",
          {
            state: "available",
            version: "0.1.0",
            available: "0.2.0",
            checkedAt: "2026-11-06T12:00:00.000Z",
            source: "app",
          },
        ],
      ]),
      catalogue: [offered({ installed: "0.1.0", available: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({ channel: "beta", update: { state: "available" } });
  });

  it("leaves the update state unknown when the app never reported one", () => {
    const [card] = appCards({
      apps: [discovered()],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card?.update).toEqual(UNREPORTED);
  });

  it("carries the last-open time from Start's own history", () => {
    const [card] = appCards({
      apps: [discovered()],
      rejected: [],
      files: [],
      recents: [{ path: "/a.canvas", appId: "canvas", openedAt: 1_700_000_000_000 }],
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
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
      updates: NO_UPDATES,
      catalogue: [offered({ installed: "0.1.0" })],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
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

  it("offers Help through Flatpak with no AppImage feed", () => {
    const [card] = appCards({
      apps: [],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [
        offered({
          id: "help",
          name: "Suite Help",
          folder: "Help",
          extensions: [],
          capabilities: [],
          feed: "",
          flatpakOnly: true,
        }),
      ],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card).toMatchObject({
      id: "help",
      name: "Suite Help",
      state: "not-installed",
      installChannel: "flatpak",
      available: null,
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
      updates: NO_UPDATES,
      catalogue: [
        offered({ installed: "0.1.0" }),
        offered({ id: "planner", name: "Suite Planner", installed: "0.1.0" }),
      ],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(attentionCount(cards)).toBe(1);
    expect(attentionCount([])).toBe(0);
  });
});

describe("selfCard", () => {
  it("asks for nothing itself, and offers the page where a newer build lives", () => {
    const card = selfCard(
      offered({
        id: "start",
        name: "Suite Start",
        available: "0.3.1",
        feed: "https://x",
        releases: "https://github.com/o/r/releases/latest",
      }),
      "0.3.0",
    );
    expect(card).toMatchObject({
      id: "start",
      state: "update-available",
      version: "0.3.0",
      available: "0.3.1",
      releases: "https://github.com/o/r/releases/latest",
      executable: null,
    });
  });

  it("is up to date when the running version is the published one", () => {
    const card = selfCard(offered({ id: "start", available: "0.3.0" }), "0.3.0");
    expect(card.state).toBe("current");
  });

  it("says when the hub's own feed offered nothing", () => {
    const card = selfCard(offered({ id: "start", reason: "no signature" }), "0.3.0");
    expect(card.state).toBe("no-release");
    expect(card.reason).toBe("no signature");
  });

  it("reports a Flatpak deployment as Flatpak's to update, not as a feed answer", () => {
    const card = selfCard(
      offered({
        id: "start",
        name: "Suite Start",
        reason: "this build was packaged without a feed",
      }),
      "0.3.0",
      { flatpak: true, canUpdate: true },
    );
    expect(card).toMatchObject({
      id: "start",
      source: "flatpak",
      installChannel: "flatpak",
      state: "update-available",
      version: "0.3.0",
      available: null,
      releases: null,
      reason: "not checked (Flatpak)",
    });
  });

  it("loses the action, and keeps the fact, when the id is not Start's own", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", { flatpak: true, canUpdate: false });
    expect(card).toMatchObject({
      source: "flatpak",
      state: "no-release",
      releases: null,
      reason: "not checked (Flatpak)",
    });
  });

  it("says the deployed build starts next launch, because the running one keeps its code", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", {
      flatpak: true,
      canUpdate: true,
      updated: true,
    });
    expect(card.reason).toContain("starts next launch");
    expect(card.available).toBeNull();
  });

  it("shows what Flatpak said when the update did not happen", () => {
    const card = selfCard(offered({ id: "start" }), "0.3.0", {
      flatpak: true,
      canUpdate: true,
      error: "error: app run.suite.start not installed",
    });
    expect(card.reason).toBe("error: app run.suite.start not installed");
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

describe("a managed install whose feed has not answered", () => {
  it("is not described as a copy Start did not place", () => {
    // The moment before the feeds answer is the moment a person is most likely to read the
    // card. Saying "from a folder, updates itself" about an app in Start's own root would be
    // the opposite of the truth, and would invite the double-updater it exists to prevent.
    const [card] = appCards({
      apps: [{ ...discovered(), executable: `${APPS_ROOT}/Canvas/0.1.1/suite-canvas.AppImage` }],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card?.state).toBe("no-release");
    expect(card?.reason).toBe("its release feed has not been read yet");
  });

  it("still calls a copy outside that root a folder copy", () => {
    const [card] = appCards({
      apps: [{ ...discovered(), executable: "/home/me/Downloads/elsewhere.AppImage" }],
      rejected: [],
      files: [],
      recents: [],
      updates: NO_UPDATES,
      catalogue: [],
      versions: NO_VERSIONS,
      running: NO_RUNNING,
      appsRoot: APPS_ROOT,
    });
    expect(card?.state).toBe("local");
  });
});
