import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Host, HostCommand } from "./host.js";
import {
  adoptLegacyRegistry,
  claimHubLock,
  dashboardPath,
  hostPaths,
  hubLockPath,
  hubLockText,
  isInsidePreReleaseTree,
  parseHubLock,
  preReleaseDocumentsRoot,
  registryPathFor,
  releaseHubLock,
  removePreReleaseTree,
  takeHubLock,
} from "./hostPaths.js";

/**
 * The host paths, and the two files under them that span packaging forms.
 *
 * Nothing here needs Flatpak: the point is that the table answers the same paths
 * on both sides and never reads a re-rooted XDG variable, and that a registry from
 * before the move is adopted exactly once.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "suite-host-paths-"));
  cleanups.push(path);
  return path;
}

/** A Host with no process behind it, so a deletion's argv is a value. */
function recordingHost(): { readonly host: Host; readonly runs: HostCommand[] } {
  const runs: HostCommand[] = [];
  return {
    runs,
    host: {
      sandboxed: true,
      plan: (command) => command,
      run: async (command) => {
        runs.push(command);
        return "";
      },
      spawn: () => ({
        pid: null,
        onStderr: () => undefined,
        onExit: () => undefined,
        release: () => undefined,
      }),
      which: async () => null,
    },
  };
}

const HOME = "/home/me";

describe("hostPaths", () => {
  it("names today's host paths", () => {
    expect(hostPaths({ platform: "linux", home: HOME })).toEqual({
      applications: "/home/me/.local/share/applications",
      icons: "/home/me/.local/share/icons",
      suiteData: "/home/me/.local/share/suite",
      suiteConfig: "/home/me/.config/suite",
      appsRoot: "/home/me/Applications/Suite",
    });
  });

  it("answers the host paths even when the XDG variables point into a sandbox", () => {
    const previous = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    };
    process.env.XDG_CONFIG_HOME = "/home/me/.var/app/run.suite.start/config";
    process.env.XDG_DATA_HOME = "/home/me/.var/app/run.suite.start/data";
    try {
      const paths = hostPaths({ platform: "linux", home: HOME });
      expect(paths.applications).toBe("/home/me/.local/share/applications");
      expect(paths.icons).toBe("/home/me/.local/share/icons");
      expect(paths.suiteData).toBe("/home/me/.local/share/suite");
      expect(paths.suiteConfig).toBe("/home/me/.config/suite");
      expect(JSON.stringify(paths)).not.toContain(".var/app");
    } finally {
      if (previous.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous.XDG_CONFIG_HOME;
      if (previous.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous.XDG_DATA_HOME;
    }
  });

  it("keeps the applications-root override a test installs into", () => {
    expect(
      hostPaths({ platform: "linux", home: HOME, appsRootOverride: "/tmp/suite-apps" }).appsRoot,
    ).toBe("/tmp/suite-apps");
    expect(hostPaths({ platform: "linux", home: HOME, appsRootOverride: "  " }).appsRoot).toBe(
      "/home/me/Applications/Suite",
    );
  });
});

describe("the registry path", () => {
  it("is under the suite config, where the published CLI also looks", () => {
    const paths = hostPaths({ platform: "linux", home: HOME });
    expect(registryPathFor(paths, {})).toBe("/home/me/.config/suite/start/installs.json");
    expect(registryPathFor(paths, { SUITE_START_REGISTRY: "/tmp/records.json" })).toBe(
      "/tmp/records.json",
    );
    expect(registryPathFor(paths, { SUITE_START_REGISTRY: "  " })).toBe(
      "/home/me/.config/suite/start/installs.json",
    );
  });
});

describe("the dashboard path", () => {
  it("is this host's own layout, beside the install registry", () => {
    const paths = hostPaths({ platform: "linux", home: HOME });
    expect(dashboardPath(paths)).toBe("/home/me/.config/suite/start/dashboard.json");
  });

  it("is not a document folder and not shared between apps", () => {
    const paths = hostPaths({ platform: "linux", home: HOME });
    expect(dashboardPath(paths).startsWith(paths.suiteConfig)).toBe(true);
    expect(dashboardPath(paths)).not.toContain("Documents");
  });
});

describe("adoptLegacyRegistry", () => {
  it("copies a pre-move registry once, and never over a newer one", async () => {
    const directory = await folder();
    const legacy = join(directory, "userData", "installs.json");
    const next = join(directory, "config", "start", "installs.json");
    await mkdir(join(directory, "userData"), { recursive: true });
    await writeFile(
      legacy,
      JSON.stringify({ apps: [{ id: "canvas", executable: "/opt/canvas" }] }),
    );

    const first = await adoptLegacyRegistry({ legacy, next });
    expect(first.adopted).toBe(true);
    expect(JSON.parse(await readFile(next, "utf8"))).toEqual({
      apps: [{ id: "canvas", executable: "/opt/canvas" }],
    });

    // The second launch finds the destination and leaves it exactly as it is.
    await writeFile(next, JSON.stringify({ apps: [] }));
    const second = await adoptLegacyRegistry({ legacy, next });
    expect(second.adopted).toBe(false);
    expect(JSON.parse(await readFile(next, "utf8"))).toEqual({ apps: [] });
  });

  it("does nothing when there is no old registry", async () => {
    const directory = await folder();
    const adoption = await adoptLegacyRegistry({
      legacy: join(directory, "userData", "installs.json"),
      next: join(directory, "config", "start", "installs.json"),
    });
    expect(adoption.adopted).toBe(false);
  });
});

describe("the cross-form hub lock", () => {
  it("reads a pid and a start time, and nothing else", () => {
    expect(parseHubLock(hubLockText(42, "2026-11-21T00:00:00.000Z"))).toEqual({
      pid: 42,
      startedAt: "2026-11-21T00:00:00.000Z",
    });
    expect(parseHubLock("{ nope")).toBeNull();
    expect(parseHubLock(JSON.stringify({ pid: 0, startedAt: "x" }))).toBeNull();
    expect(parseHubLock(JSON.stringify({ pid: 42 }))).toBeNull();
  });

  it("is held by a live process and taken over from a stale one", () => {
    const text = hubLockText(42, "2026-11-21T00:00:00.000Z");
    expect(claimHubLock(text, 7, (pid) => pid === 42)).toMatchObject({
      kind: "held",
      holder: { pid: 42 },
    });
    expect(claimHubLock(text, 7, () => false)).toEqual({ kind: "free" });
    expect(claimHubLock(null, 7, () => true)).toEqual({ kind: "free" });
  });

  it("writes atomically and is released only by its holder", async () => {
    const directory = await folder();
    const path = join(directory, "config", "start", "hub.lock");

    const outcome = await takeHubLock(path, 4242, () => false, "2026-11-21T00:00:00.000Z");
    expect(outcome).toEqual({ kind: "free" });
    expect(parseHubLock(await readFile(path, "utf8"))?.pid).toBe(4242);

    // A live holder keeps the next Start out.
    expect(await takeHubLock(path, 5353, (pid) => pid === 4242)).toMatchObject({ kind: "held" });

    // A process that is not the holder must not delete it.
    await releaseHubLock(path, 5353);
    expect(parseHubLock(await readFile(path, "utf8"))?.pid).toBe(4242);

    await releaseHubLock(path, 4242);
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("is named for the config directory, not Electron's userData", () => {
    const paths = hostPaths({ platform: "linux", home: HOME });
    expect(hubLockPath(paths)).toBe("/home/me/.config/suite/start/hub.lock");
  });
});

describe("pre-release data deletion", () => {
  const root = "/home/me/Documents/Suite Slop";

  it("names the pre-release tree beside Documents/Suite", () => {
    expect(preReleaseDocumentsRoot("/home/me")).toBe(root);
    expect(isInsidePreReleaseTree("/home/me", `${root}/Canvas`)).toBe(true);
  });

  it("accepts one app's folder and runs rm through the seam", async () => {
    const { host, runs } = recordingHost();
    expect(await removePreReleaseTree({ home: "/home/me", path: `${root}/Canvas`, host })).toBe(
      true,
    );
    // One argv element per part, and the `--` stops a leading dash being an option.
    expect(runs).toEqual([{ file: "rm", args: ["-rf", "--", `${root}/Canvas`] }]);
  });

  it("refuses a traversal out of the tree before running anything", async () => {
    const { host, runs } = recordingHost();
    const escaped = `${root}/../Suite/Canvas`;
    expect(await removePreReleaseTree({ home: "/home/me", path: escaped, host })).toBe(false);
    expect(runs).toEqual([]);
  });

  it("refuses the stable tree, a same-prefix sibling, and the shared root", async () => {
    const { host, runs } = recordingHost();
    expect(
      await removePreReleaseTree({
        home: "/home/me",
        path: "/home/me/Documents/Suite/Canvas",
        host,
      }),
    ).toBe(false);
    expect(
      await removePreReleaseTree({
        home: "/home/me",
        path: `${root}-other/Canvas`,
        host,
      }),
    ).toBe(false);
    expect(await removePreReleaseTree({ home: "/home/me", path: root, host })).toBe(false);
    expect(runs).toEqual([]);
  });
});
