import { parseAppManifest } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "./catalogue.js";
import {
  appIdFromFlatpakId,
  commitsMatch,
  FLATPAK_APP_PREFIX,
  findFlatpak,
  flatpakIdFor,
  flatpakManifest,
  flatpakRunArgs,
  flatpakScopeArgs,
  installedCommitArgs,
  installedInfoArgs,
  parseCommitOutput,
  parseFlatpakList,
  parseRemoteList,
  parseRemoteNames,
  parseVersionOutput,
  remoteListArgs,
  remotesArgs,
  STORE_REMOTES,
  selfUpdateArgs,
  storeBranchArgs,
  storeInfoArgs,
  storeInstallArgs,
  storeRemote,
  storeUpdateArgs,
  suiteFlatpakFor,
  withFlatpakInstalls,
} from "./flatpak.js";
import type { Host } from "./host.js";
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

  it("keeps the reverse-DNS pre-release id while the manifest id is kebab-case", () => {
    // The manifest id and the deployment id are two names for one identity:
    // `slop-canvas` is what `suite.app.json` carries, `run.suite.slop.canvas` is
    // what Flatpak deploys. Concatenating the prefix would invent `slop-canvas`.
    expect(flatpakIdFor("slop-canvas")).toBe("run.suite.slop.canvas");
    expect(flatpakIdFor("slop.canvas")).toBe("run.suite.slop.canvas");
  });
});

describe("appIdFromFlatpakId", () => {
  it("returns the canonical catalogue id, including for a legacy deployment", () => {
    expect(appIdFromFlatpakId("run.suite.canvas")).toBe("canvas");
    expect(appIdFromFlatpakId("run.suite.slop.canvas")).toBe("slop-canvas");
  });

  it("refuses an id outside the suite namespace", () => {
    expect(appIdFromFlatpakId("org.gnome.Calculator")).toBeNull();
    expect(appIdFromFlatpakId("run.suite.")).toBeNull();
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
      flatpak: { application: "run.suite.canvas", installation: "user", branch: "master" },
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

  it("carries the deployed commit so a store update can be told apart", () => {
    const commit = "a".repeat(64);
    const apps = parseFlatpakList(LIST).map((app) =>
      app.applicationId === "run.suite.canvas" ? { ...app, commit } : app,
    );
    const merged = withFlatpakInstalls(empty, apps, [CANVAS], "/usr/bin/flatpak");
    expect(merged.apps[0]?.flatpak?.commit).toBe(commit);
  });

  it("leaves refusals where discovery put them", () => {
    const rejected = [{ path: "/installs/budget/suite.app.json", reason: "no manifest" }];
    const merged = withFlatpakInstalls({ apps: [], rejected }, [], [CANVAS], "/usr/bin/flatpak");
    expect(merged.rejected).toEqual(rejected);
  });
});

describe("the store's branches", () => {
  const COMMIT = "a".repeat(64);

  it("reads the application, branch and commit of each published ref", () => {
    const refs = parseRemoteList(
      JSON.stringify([
        {
          application_id: "run.suite.slop.canvas",
          branch: "canary",
          commit: COMMIT,
        },
        { application_id: "run.suite.canvas", branch: "stable" },
      ]),
    );
    expect(refs).toEqual([
      { applicationId: "run.suite.slop.canvas", branch: "canary", commit: COMMIT },
    ]);
  });

  it("drops a row that cannot name a tier and a build", () => {
    expect(parseRemoteList("not json")).toEqual([]);
    expect(parseRemoteList(JSON.stringify([{ application_id: "run.suite.slop.canvas" }]))).toEqual(
      [],
    );
  });

  it("asks one remote for every app ref at once, including the abbreviated commit", () => {
    expect(remoteListArgs("suite-local")).toEqual([
      "remote-ls",
      "--user",
      "--app",
      "--json",
      "--columns=application,branch,commit",
      "suite-local",
    ]);
  });

  it("matches an abbreviated store commit to the deployment's full one", () => {
    expect(commitsMatch("97319cc24eb8", "97319cc24eb8aaaa")).toBe(true);
    expect(commitsMatch("97319cc24eb8aaaa", "97319cc24eb8")).toBe(true);
    expect(commitsMatch("97319cc24eb8", "000000000000")).toBe(false);
    expect(commitsMatch("", "97319cc24eb8")).toBe(false);
  });

  it("installs a pre-release branch, and switches with --reinstall", () => {
    expect(storeBranchArgs("suite-local", "run.suite.slop.canvas", "canary")).toEqual([
      "install",
      "--user",
      "--noninteractive",
      "suite-local",
      "run.suite.slop.canvas//canary",
    ]);
    expect(storeBranchArgs("suite-local", "run.suite.slop.canvas", "beta", true)).toContain(
      "--reinstall",
    );
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

const COMMIT = "0ba312d3ac85a838bcc25f73cf090978a4875a3a962ea38aca68553703ef1354";

describe("parseCommitOutput", () => {
  it("reads the one line --show-commit prints", () => {
    expect(parseCommitOutput(`${COMMIT}\n`)).toBe(COMMIT);
  });

  it("rejects anything that is not a commit", () => {
    expect(parseCommitOutput("")).toBeNull();
    expect(parseCommitOutput("abc123")).toBeNull();
    expect(parseCommitOutput(`error: ${COMMIT}`)).toBeNull();
  });
});

describe("parseVersionOutput", () => {
  it("finds the version among flatpak info's lines", () => {
    const text = [
      "",
      "Suite Canvas - Your documents",
      "",
      "       Version: 0.1.0",
      "        Branch: master",
      "",
    ].join("\n");
    expect(parseVersionOutput(text)).toBe("0.1.0");
  });

  it("answers null when there is no version line", () => {
    expect(parseVersionOutput("Suite Canvas\nBranch: master\n")).toBeNull();
  });
});

describe("store commands", () => {
  const install = { application: "run.suite.canvas", installation: "user" };

  it("asks the store for the commit it offers", () => {
    expect(storeInfoArgs("suite-local", "run.suite.canvas")).toEqual([
      "remote-info",
      "--user",
      "--show-commit",
      "suite-local",
      "run.suite.canvas",
    ]);
  });

  it("installs and updates non-interactively through the same remote", () => {
    expect(storeInstallArgs("suite-local", "run.suite.canvas")).toEqual([
      "install",
      "--user",
      "--noninteractive",
      "suite-local",
      "run.suite.canvas",
    ]);
    expect(storeUpdateArgs(install)).toEqual([
      "--user",
      "update",
      "--noninteractive",
      "run.suite.canvas",
    ]);
  });

  it("reads the installed commit and version from the deployment", () => {
    expect(installedCommitArgs(install)).toEqual([
      "--user",
      "info",
      "--show-commit",
      "run.suite.canvas",
    ]);
    expect(installedInfoArgs(install)).toEqual(["--user", "info", "run.suite.canvas"]);
  });
});

/** A Host with no process behind it: only the probe is exercised here. */
function probeHost(which: (name: string) => Promise<string | null>): Host {
  return {
    sandboxed: false,
    plan: (command) => command,
    run: async () => "",
    spawn: () => ({
      pid: null,
      onStderr: () => undefined,
      onExit: () => undefined,
      release: () => undefined,
    }),
    which,
  };
}

describe("findFlatpak", () => {
  function withOverride<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
    const previous = process.env.SUITE_START_FLATPAK;
    if (value === undefined) delete process.env.SUITE_START_FLATPAK;
    else process.env.SUITE_START_FLATPAK = value;
    return run().finally(() => {
      if (previous === undefined) delete process.env.SUITE_START_FLATPAK;
      else process.env.SUITE_START_FLATPAK = previous;
    });
  }

  it("asks the seam for the binary and returns what it found", async () => {
    await withOverride(undefined, async () => {
      const asked: string[] = [];
      const host = probeHost(async (name) => {
        asked.push(name);
        return `/usr/bin/${name}`;
      });
      expect(await findFlatpak(host)).toBe("/usr/bin/flatpak");
      expect(asked).toEqual(["flatpak"]);
    });
  });

  it("lets an explicit path win, and an empty one disable Flatpak", async () => {
    await withOverride("/tmp/fake-flatpak", async () => {
      expect(await findFlatpak(probeHost(async () => null))).toBe("/tmp/fake-flatpak");
    });
    await withOverride("", async () => {
      expect(await findFlatpak(probeHost(async () => "/usr/bin/flatpak"))).toBeNull();
    });
  });
});

describe("the store's remote", () => {
  function withRemote<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
    const previous = process.env.SUITE_START_FLATPAK_REMOTE;
    if (value === undefined) delete process.env.SUITE_START_FLATPAK_REMOTE;
    else process.env.SUITE_START_FLATPAK_REMOTE = value;
    return run().finally(() => {
      if (previous === undefined) delete process.env.SUITE_START_FLATPAK_REMOTE;
      else process.env.SUITE_START_FLATPAK_REMOTE = previous;
    });
  }

  it("names the two remotes the suite publishes to, in preference order", () => {
    expect([...STORE_REMOTES]).toEqual(["suite", "suite-local"]);
  });

  it("reads one remote name per line and ignores blank ones", () => {
    expect(parseRemoteNames("flathub\n\nsuite-local\n  suite  \n")).toEqual([
      "flathub",
      "suite-local",
      "suite",
    ]);
  });

  it("asks for the name column of the user installation", () => {
    expect(remotesArgs()).toEqual(["remotes", "--user", "--columns=name"]);
  });

  it("lets an explicit remote win without probing", async () => {
    await withRemote("suite-dev", async () => {
      let probed = false;
      const remote = await storeRemote(async () => {
        probed = true;
        return "suite\n";
      });
      expect(remote).toBe("suite-dev");
      expect(probed).toBe(false);
    });
  });

  it("prefers suite over suite-local, wherever they appear in the list", async () => {
    await withRemote(undefined, async () => {
      expect(await storeRemote(async () => "flathub\nsuite-local\nsuite\n")).toBe("suite");
    });
  });

  it("falls back to suite-local when that is the only one", async () => {
    await withRemote(undefined, async () => {
      expect(await storeRemote(async () => "flathub\nsuite-local\n")).toBe("suite-local");
    });
  });

  it("has no store when neither is configured, or when Flatpak cannot answer", async () => {
    await withRemote(undefined, async () => {
      expect(await storeRemote(async () => "flathub\n")).toBeNull();
      expect(
        await storeRemote(async () => {
          throw new Error("flatpak: not found");
        }),
      ).toBeNull();
    });
  });
});

describe("updating the hub through Flatpak", () => {
  it("asks for the newest build of its own application id, non-interactively", () => {
    expect(selfUpdateArgs()).toEqual(["update", "--user", "--noninteractive", "run.suite.start"]);
  });
});
