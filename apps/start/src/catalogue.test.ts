import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeedFetch } from "@suite/desktop";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_APPS,
  catalogueMatchesContracts,
  FLATPAK_CATALOGUE_APPS,
  feedFor,
  isNewer,
  readCatalogue,
  SELF_ENTRY,
  SELF_ID,
} from "./catalogue.js";

const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

function feedBody(version: string): string {
  return [
    `version: ${version}`,
    "files:",
    `  - url: Suite-${version}.AppImage`,
    "    sha512: ABC",
    "    size: 12",
    "",
  ].join("\n");
}

/** A feed host that serves what this test signs, and 404s everything else. */
function feedHost(entries: Record<string, string>): FeedFetch {
  return async (url) => {
    const body = entries[url.endsWith(".sig") ? url.slice(0, -4) : url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    if (url.endsWith(".sig")) {
      const signature = sign(null, new TextEncoder().encode(body), pair.privateKey);
      return { ok: true, status: 200, text: async () => signature.toString("base64") };
    }
    return { ok: true, status: 200, text: async () => body };
  };
}

/** A feed that publishes a manifest and no signature. */
function unsignedHost(body: string): FeedFetch {
  return async (url) =>
    url.endsWith(".sig")
      ? { ok: false, status: 404, text: async () => "" }
      : { ok: true, status: 200, text: async () => body };
}

const base = "https://local.test/feed";
const FEED_HOST = "https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where each app's own manifest and builder config live in this checkout. */
const APP_SOURCES = {
  canvas: {
    manifest: join(REPO_ROOT, "apps/canvas/desktop/suite.app.json"),
    builder: join(REPO_ROOT, "apps/canvas/desktop/electron-builder.yml"),
  },
  planner: {
    manifest: join(REPO_ROOT, "apps/planner/suite.app.json"),
    builder: join(REPO_ROOT, "apps/planner/electron-builder.yml"),
  },
  budget: {
    manifest: join(REPO_ROOT, "apps/budget/suite.app.json"),
    builder: join(REPO_ROOT, "apps/budget/electron-builder.yml"),
  },
} as const;

/** The `publish.url` a builder config hands to the app's own updater. */
function publishUrl(builderText: string): string | null {
  const block = /^publish:\s*\n((?:[ \t]+.*(?:\n|$))*)/mu.exec(builderText)?.[1] ?? "";
  return /^\s+url:\s*(\S+)\s*$/mu.exec(block)?.[1] ?? null;
}

describe("feedFor", () => {
  it("uses the app's declared URL when nothing replaces it", () => {
    expect(feedFor(CATALOGUE_APPS[1])).toBe(`${FEED_HOST}/feeds/planner`);
  });

  it("puts a local release folder in place of the whole URL, one folder per app", () => {
    expect(feedFor(CATALOGUE_APPS[1], `${base}/`)).toBe(`${base}/planner`);
  });

  it("is null for the hub when the build named no feed", () => {
    expect(feedFor(SELF_ENTRY)).toBeNull();
  });
});

describe("feed declarations", () => {
  it("gives every app the Pages feed its manifest and builder config name", () => {
    // The URL has three homes on purpose: the hub's catalogue, the app's suite.app.json
    // and its electron-builder config. This is the test that keeps them one fact.
    for (const entry of CATALOGUE_APPS) {
      const source = APP_SOURCES[entry.id as keyof typeof APP_SOURCES];
      const expected = `${FEED_HOST}/feeds/${entry.id}`;

      expect(entry.feed, `${entry.id} catalogue`).toBe(expected);

      const manifest = JSON.parse(readFileSync(source.manifest, "utf8")) as {
        update?: { feed?: string };
      };
      expect(manifest.update?.feed, `${entry.id} suite.app.json`).toBe(expected);

      expect(publishUrl(readFileSync(source.builder, "utf8")), `${entry.id} builder`).toBe(
        expected,
      );
    }
  });

  it("gives the hub the same feed its builder config names", () => {
    expect(
      publishUrl(readFileSync(join(REPO_ROOT, "apps/start/electron-builder.yml"), "utf8")),
    ).toBe(`${FEED_HOST}/feeds/start`);
  });

  it("keeps every feed off a releases/latest redirect", () => {
    for (const entry of [...CATALOGUE_APPS, SELF_ENTRY]) {
      expect(entry.feed).not.toContain("/releases/latest");
    }
  });
});

describe("feedFor Help", () => {
  it("never invents an AppImage feed, even from a local release folder", () => {
    const help = FLATPAK_CATALOGUE_APPS[0];
    expect(feedFor(help)).toBeNull();
    expect(feedFor(help, base)).toBeNull();
    expect(CATALOGUE_APPS.map((entry) => entry.id)).not.toContain("help");
  });
});

describe("catalogueMatchesContracts", () => {
  it("says the same thing about each app that SUITE_APPS does", () => {
    // The table repeats what each app's own manifest declares; this is the half of
    // that repetition a test can hold.
    expect(catalogueMatchesContracts()).toEqual([]);
  });
});

describe("isNewer", () => {
  it("is true only when the feed is ahead", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });

  it("orders a release above its prerelease", () => {
    expect(isNewer("0.1.0", "0.1.0-alpha.3")).toBe(true);
    expect(isNewer("0.1.0-alpha.3", "0.1.0")).toBe(false);
  });

  it("is false when a version is missing or unreadable, rather than guessing", () => {
    expect(isNewer(null, "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", null)).toBe(false);
    expect(isNewer("next", "0.1.0")).toBe(false);
  });
});

describe("readCatalogue", () => {
  it("offers every app, installed or not, and the hub's row last", async () => {
    const catalogue = await readCatalogue({
      installed: new Map(),
      feedBase: base,
      selfFeed: `${base}/start`,
      fetch: feedHost({
        [`${base}/canvas/latest-linux.yml`]: feedBody("0.3.0"),
        [`${base}/planner/latest-linux.yml`]: feedBody("0.2.0"),
        [`${base}/budget/latest-linux.yml`]: feedBody("0.1.0"),
        [`${base}/start/latest-linux.yml`]: feedBody("0.3.0"),
      }),
      publicKey,
      platform: "linux",
    });

    expect(catalogue.map((entry) => entry.id)).toEqual([
      "canvas",
      "planner",
      "budget",
      "slop-canvas",
      "slop-planner",
      "slop-budget",
      "help",
      SELF_ID,
    ]);
    // Stable document apps read a feed; the pre-release entries have none by design.
    const stable = catalogue.filter((entry) => entry.preRelease !== true && entry.id !== "help");
    expect(stable.every((entry) => entry.available !== null)).toBe(true);
    expect(stable.every((entry) => entry.installed === null)).toBe(true);
    expect(stable.every((entry) => entry.newer === false)).toBe(true);
    const preRelease = catalogue.filter((entry) => entry.preRelease === true);
    expect(preRelease.every((entry) => entry.feed === "")).toBe(true);
    expect(preRelease.every((entry) => entry.available === null)).toBe(true);
    // Help is Flatpak-only, so there is no feed to read even when one is offered locally.
    const help = catalogue.find((entry) => entry.id === "help");
    expect(help).toMatchObject({
      feed: "",
      available: null,
      reason: "Flatpak owns updates",
      flatpakOnly: true,
    });
  });

  it("says which installed app the feed is ahead of", async () => {
    const catalogue = await readCatalogue({
      installed: new Map([
        ["canvas", "0.3.0"],
        ["planner", "0.1.0"],
      ]),
      feedBase: base,
      fetch: feedHost({
        [`${base}/canvas/latest-linux.yml`]: feedBody("0.3.0"),
        [`${base}/planner/latest-linux.yml`]: feedBody("0.2.0"),
      }),
      publicKey,
      platform: "linux",
    });

    const canvas = catalogue.find((entry) => entry.id === "canvas");
    const planner = catalogue.find((entry) => entry.id === "planner");
    expect(canvas?.newer).toBe(false);
    expect(planner?.newer).toBe(true);
    expect(planner?.installed).toBe("0.1.0");
    expect(planner?.available).toBe("0.2.0");
  });

  it("offers nothing from a feed that does not verify, and says why", async () => {
    const catalogue = await readCatalogue({
      installed: new Map(),
      feedBase: base,
      fetch: unsignedHost(feedBody("0.2.0")),
      publicKey,
      platform: "linux",
      now: () => new Date("2026-11-07T12:00:00.000Z"),
    });

    const planner = catalogue.find((entry) => entry.id === "planner");
    expect(planner?.available).toBeNull();
    expect(planner?.newer).toBe(false);
    expect(planner?.reason).toContain("signature");
  });

  it("says a feed it could not reach is unreachable, not out of date", async () => {
    const catalogue = await readCatalogue({
      installed: new Map(),
      feedBase: base,
      fetch: feedHost({}),
      publicKey,
      platform: "linux",
    });

    const canvas = catalogue.find((entry) => entry.id === "canvas");
    expect(canvas?.available).toBeNull();
    expect(canvas?.reason).toBe("the feed answered 404");
  });

  it("tells the truth about the hub's own row when the build has no feed", async () => {
    const catalogue = await readCatalogue({
      installed: new Map(),
      fetch: feedHost({}),
      publicKey,
      platform: "linux",
    });

    const self = catalogue.find((entry) => entry.id === SELF_ID);
    expect(self?.feed).toBe("");
    expect(self?.reason).toBe("this build was packaged without a feed");
  });
});
