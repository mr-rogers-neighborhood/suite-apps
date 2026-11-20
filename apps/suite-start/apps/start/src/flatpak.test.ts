import { parseAppManifest } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "./catalogue.js";
import {
  FLATPAK_APP_PREFIX,
  flatpakIdFor,
  flatpakManifest,
  flatpakRunArgs,
  flatpakScopeArgs,
  parseFlatpakList,
  suiteFlatpakFor,
  withFlatpakInstalls,
} from "./flatpak.js";
import type { DiscoveredApp, DiscoveryResult } from "./registry.js";

/** The rows `flatpak list --app --json` writes, trimmed to two apps. */
const LIST = JSON.stringify([
  {
    name: "Suite Canvas",
    application_id: "run.suite.canvas",
    version: "0.1.0",
    branch: "master",
    arch: "x86_64",
    origin: "suite-local",
    installation: "user",
  },
  {
    name: "Flatseal",
    application_id: "com.github.tchx84.Flatseal",
    version: "2.4.1",
    branch: "stable",
    arch: "x86_64",
    origin: "flathub",
    installation: "system",
  },
]);

const CANVAS: CatalogueEntry = {
  id: "canvas",
  name: "Suite Canvas",
  folder: "Canvas",
  extensions: ["canvas"],
  capabilities: ["document.file", "sync"],
  feed: "https://example.test/canvas",
  channel: "alpha",
};

function discovered(): DiscoveredApp {
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
    },
    manifestPath: "/home/me/Applications/Suite/Canvas/0.1.0/suite.app.json",
    executable: "/home/me/Applications/Suite/Canvas/0.1.0/suite-canvas",
    installedAt: null,
  };
}

const empty: DiscoveryResult = { apps: [], rejected: [] };

describe("flatpakIdFor", () => {
  it("names the application under the suite namespace", () => {
    expect(flatpakIdFor("canvas")).toBe(`${FLATPAK_APP_PREFIX}canvas`);
    expect(flatpakIdFor("canvas")).toBe("run.suite.canvas");
  });
});

describe("parseFlatpakList", () => {
  it("reads the fields the CLI writes", () => {
    const apps = parseFlatpakList(LIST);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toEqual({
      applicationId: "run.suite.canvas",
      name: "Suite Canvas",
      version: "0.1.0",
      branch: "master",
      origin: "suite-local",
      installation: "user",
    });
  });

  it("drops a row with no application id instead of guessing one", () => {
    const apps = parseFlatpakList(JSON.stringify([{ name: "Nameless", version: "1.0.0" }]));
    expect(apps).toEqual([]);
  });

  it("answers nothing for output that is not a list", () => {
    expect(parseFlatpakList("not json")).toEqual([]);
    expect(parseFlatpakList("{}")).toEqual([]);
    expect(parseFlatpakList("[]")).toEqual([]);
  });
});

describe("suiteFlatpakFor", () => {
  it("finds the suite app and ignores every other Flatpak", () => {
    const apps = parseFlatpakList(LIST);
    expect(suiteFlatpakFor({ id: "canvas" }, apps)?.applicationId).toBe("run.suite.canvas");
    expect(suiteFlatpakFor({ id: "planner" }, apps)).toBeNull();
  });

  it("does not accept a longer id that merely starts with the suite prefix", () => {
    const apps = parseFlatpakList(
      JSON.stringify([{ application_id: "run.suite.canvas.helper", version: "1.0.0" }]),
    );
    expect(suiteFlatpakFor({ id: "canvas" }, apps)).toBeNull();
  });
});

describe("flatpakManifest", () => {
  it("describes the app the catalogue already describes", () => {
    const manifest = flatpakManifest(CANVAS, "0.1.0");
    const parsed = parseAppManifest(manifest);
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(parsed.value).toMatchObject({
      id: "canvas",
      name: "Suite Canvas",
      version: "0.1.0",
      deepLinkPrefix: "suite://canvas/",
      fileExtensions: ["canvas"],
      capabilities: ["document.file", "sync"],
    });
  });

  it("names no update feed: Flatpak's remote is the update channel", () => {
    expect(flatpakManifest(CANVAS, "0.1.0").update).toBeUndefined();
  });
});

describe("withFlatpakInstalls", () => {
  it("adds a Flatpak the install records cannot see", () => {
    const merged = withFlatpakInstalls(empty, parseFlatpakList(LIST), [CANVAS], "/usr/bin/flatpak");
    expect(merged.apps).toHaveLength(1);
    expect(merged.apps[0]).toMatchObject({
      executable: "/usr/bin/flatpak",
      installedAt: null,
      flatpak: { application: "run.suite.canvas", installation: "user" },
    });
    expect(merged.apps[0]?.manifest.version).toBe("0.1.0");
  });

  it("keeps the copy Start or a person already installed", () => {
    const existing = discovered();
    const merged = withFlatpakInstalls(
      { apps: [existing], rejected: [] },
      parseFlatpakList(LIST),
      [CANVAS],
      "/usr/bin/flatpak",
    );
    expect(merged.apps).toEqual([existing]);
  });

  it("skips a deployment that cannot say what version it is", () => {
    const apps = parseFlatpakList(
      JSON.stringify([{ application_id: "run.suite.canvas", version: "" }]),
    );
    expect(withFlatpakInstalls(empty, apps, [CANVAS], "/usr/bin/flatpak").apps).toEqual([]);
  });

  it("leaves refusals where discovery put them", () => {
    const rejected = [{ path: "/installs/budget/suite.app.json", reason: "no manifest" }];
    const merged = withFlatpakInstalls({ apps: [], rejected }, [], [CANVAS], "/usr/bin/flatpak");
    expect(merged.rejected).toEqual(rejected);
  });
});

describe("flatpakRunArgs", () => {
  it("puts the application between run and the app's own argument", () => {
    expect(flatpakRunArgs("run.suite.canvas", ["suite://canvas/card/1"])).toEqual([
      "run",
      "run.suite.canvas",
      "suite://canvas/card/1",
    ]);
  });
});

describe("flatpakScopeArgs", () => {
  it("names the installation the discovery saw", () => {
    expect(flatpakScopeArgs("user")).toEqual(["--user"]);
    expect(flatpakScopeArgs("system")).toEqual(["--system"]);
    expect(flatpakScopeArgs("")).toEqual([]);
  });
});
