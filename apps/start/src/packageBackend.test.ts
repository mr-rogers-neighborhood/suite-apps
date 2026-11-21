import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appCards } from "./cards.js";
import { type CatalogueEntry, PRE_RELEASE_CATALOGUE_APPS } from "./catalogue.js";
import { hostFor } from "./host.js";
import type { Download } from "./install.js";
import { registryStore } from "./installs.js";
import { nativePackageBackend } from "./nativePackageBackend.js";
import type {
  InstalledPackage,
  PackageBackend,
  PackageCommand,
  PackageInstallRequest,
  PackageInstallResult,
  PackageLaunchObserver,
  PackageLaunchRequest,
  PackageListing,
  PackageListOptions,
  PackageRemoveRequest,
  PackageUpdateRequest,
} from "./packageBackend.js";
import type { DiscoveredApp } from "./registry.js";

/**
 * The seam, from both ends.
 *
 * The fake backend below is enough to build the window's cards and to record an
 * install request: nothing in the composition asks where a package came from. The
 * native backend is exercised on a throwaway applications root, which is the same
 * code Start runs, so the interface is not an abstraction with no implementation.
 */

const CANVAS: CatalogueEntry = {
  id: "canvas",
  name: "Suite Canvas",
  folder: "Canvas",
  extensions: ["canvas"],
  capabilities: ["document.file"],
  feed: "https://example.test/canvas",
  channel: "alpha",
};

function discovered(version = "0.1.0"): DiscoveredApp {
  return {
    manifest: {
      format: "suite.app",
      id: "canvas",
      name: "Suite Canvas",
      version,
      contractVersion: "1.0.0",
      deepLinkPrefix: "suite://canvas/",
      fileExtensions: ["canvas"],
      protocols: [],
      capabilities: ["document.file"],
    },
    manifestPath: "/home/me/Applications/Suite/Canvas/0.1.0/suite.app.json",
    executable: "/home/me/Applications/Suite/Canvas/0.1.0/suite-canvas.AppImage",
    installedAt: null,
  };
}

interface FakeBackend extends PackageBackend {
  readonly calls: readonly string[];
}

/** A backend with no process, no disk and no opinion about which channel is real. */
function fakeBackend(listing: PackageListing): FakeBackend {
  const calls: string[] = [];
  return {
    calls,
    async list(_options?: PackageListOptions) {
      calls.push("list");
      return listing;
    },
    async install(request: PackageInstallRequest): Promise<PackageInstallResult> {
      calls.push(`install:${request.entry.id}:${request.channel ?? "unset"}`);
      return { id: request.entry.id, version: request.version ?? null };
    },
    async update(request: PackageUpdateRequest): Promise<PackageInstallResult> {
      calls.push(`update:${request.entry.id}:${request.channel ?? "unset"}`);
      return { id: request.entry.id, version: request.version ?? null };
    },
    async remove(request: PackageRemoveRequest) {
      calls.push(`remove:${request.entry.id}`);
    },
    command(request: PackageLaunchRequest): PackageCommand {
      return { command: request.executable, args: [...request.argv] };
    },
    launch(request: PackageLaunchRequest, observer?: PackageLaunchObserver) {
      calls.push(`launch:${request.appId ?? "none"}`);
      observer?.started?.(1);
      observer?.exited?.(1);
    },
    async location(package_: InstalledPackage) {
      calls.push(`location:${package_.app.manifest.id}`);
      return null;
    },
    async adopt(executable: string) {
      calls.push(`adopt:${executable}`);
      return true;
    },
    async forget(id: string) {
      calls.push(`forget:${id}`);
    },
    async repairable() {
      return [];
    },
    async rollback(entry: CatalogueEntry) {
      calls.push(`rollback:${entry.id}`);
      return null;
    },
  };
}

function listingOf(app: DiscoveredApp, offers: ReadonlyMap<string, string> = new Map()) {
  const package_: InstalledPackage = {
    app,
    ownership: app.flatpak === undefined ? "managed" : "flatpak",
    channel: "alpha",
  };
  return {
    packages: [package_],
    rejected: [],
    versions: new Map([["canvas", ["0.1.0"]]]),
    offers,
    channels: new Map(),
  } satisfies PackageListing;
}

describe("a fake PackageBackend", () => {
  it("is enough to build a card without the catalogue or renderer knowing a channel", async () => {
    const app = discovered();
    const backend = fakeBackend(listingOf(app));
    const listing = await backend.list();

    const cards = appCards({
      apps: listing.packages.map((entry) => entry.app),
      rejected: listing.rejected,
      files: [],
      recents: [],
      updates: new Map(),
      catalogue: [
        {
          ...CANVAS,
          feed: CANVAS.feed,
          available: "0.2.0",
          reason: null,
          installed: "0.1.0",
          newer: true,
          artifact: null,
        },
      ],
      versions: new Map([...listing.versions].map(([id, versions]) => [id, versions.length])),
      running: new Set(),
      appsRoot: "/home/me/Applications/Suite",
      store: listing.offers,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "canvas",
      source: "managed",
      state: "update-available",
      version: "0.1.0",
      available: "0.2.0",
      installChannel: "appimage",
    });
  });

  it("carries the reserved channel through install and update unchanged", async () => {
    const backend = fakeBackend(listingOf(discovered()));
    await backend.install({ entry: CANVAS, channel: "alpha" });
    await backend.update({ entry: CANVAS, channel: "alpha" });
    expect(backend.calls).toEqual(["install:canvas:alpha", "update:canvas:alpha"]);
  });

  it("can point at a Flatpak deployment without the caller naming a binary", async () => {
    const flatpak: DiscoveredApp = {
      ...discovered(),
      executable: "/usr/bin/flatpak",
      flatpak: { application: "run.suite.canvas", installation: "user", commit: "a".repeat(64) },
    };
    const backend = fakeBackend(listingOf(flatpak, new Map([["canvas", "b".repeat(64)]])));
    const listing = await backend.list();

    const cards = appCards({
      apps: listing.packages.map((entry) => entry.app),
      rejected: [],
      files: [],
      recents: [],
      updates: new Map(),
      catalogue: [
        {
          ...CANVAS,
          feed: CANVAS.feed,
          available: null,
          reason: null,
          installed: "0.1.0",
          newer: false,
          artifact: null,
        },
      ],
      versions: new Map([["canvas", 1]]),
      running: new Set(),
      appsRoot: "/home/me/Applications/Suite",
      store: listing.offers,
    });

    expect(cards[0]).toMatchObject({
      source: "flatpak",
      installChannel: "flatpak",
      state: "update-available",
    });
  });
});

const BYTES = Buffer.from("suite app image bytes\n");

describe("the native PackageBackend", () => {
  it("places a managed AppImage and reports it through the interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-backend-"));
    try {
      const appsRoot = join(directory, "apps");
      const registry = registryStore(join(directory, "data"));
      const download: Download = async (_url, destination) => {
        await writeFile(destination, BYTES);
      };
      const backend = nativePackageBackend({
        appsRoot,
        roots: [join(directory, "installs")],
        registry,
        catalogue: [CANVAS],
        flatpak: null,
        download,
        now: () => new Date("2026-11-20T00:00:00.000Z"),
      });
      const artifact = {
        path: "suite-canvas.AppImage",
        sha512: createHash("sha512").update(BYTES).digest("base64"),
        size: BYTES.byteLength,
      };

      const result = await backend.install({
        entry: CANVAS,
        version: "0.1.0",
        artifact,
        feed: "https://example.test/canvas",
      });

      expect(result.installed?.executable).toBe(
        join(appsRoot, "Canvas", "0.1.0", "suite-canvas.AppImage"),
      );
      expect(await registry.list()).toEqual([
        {
          id: "canvas",
          executable: result.installed?.executable,
          manifestPath: join(appsRoot, "Canvas", "0.1.0", "suite.app.json"),
          installedAt: "2026-11-20T00:00:00.000Z",
          channel: "stable",
        },
      ]);

      const listing = await backend.list();
      expect(listing.packages).toHaveLength(1);
      expect(listing.packages[0]).toMatchObject({
        ownership: "managed",
        channel: "stable",
        app: { manifest: { id: "canvas", version: "0.1.0" } },
      });
      expect(listing.versions.get("canvas")).toEqual(["0.1.0"]);
      expect(backend.command({ executable: "/tmp/app", argv: ["suite://canvas/x"] })).toEqual({
        command: "/tmp/app",
        args: ["suite://canvas/x"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("switches one pre-release deployment to another branch instead of installing a second", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-switch-"));
    try {
      const appsRoot = join(directory, "apps");
      const registry = registryStore(join(directory, "data"));
      const state = join(directory, "state");
      const log = join(directory, "flatpak.log");
      const entry = PRE_RELEASE_CATALOGUE_APPS.find((candidate) => candidate.id === "slop.canvas");
      if (entry === undefined) throw new Error("the pre-release Canvas entry is missing");

      await writeFile(join(directory, "state-branch"), "slop");
      await writeFile(join(directory, "state-commit"), "a".repeat(64));
      const flatpak = join(directory, "flatpak");
      await writeFile(
        flatpak,
        `#!/bin/sh
STATE="${state}"
LOG="${log}"
case "$1" in
  list)
    printf '[{"name":"Suite Canvas (pre-release)","application_id":"run.suite.slop.canvas","version":"0.2.0","branch":"%s","origin":"suite-local","installation":"user"}]\\n' "$(cat "$STATE-branch")"
    exit 0
    ;;
  remote-ls)
    printf '[{"application_id":"run.suite.slop.canvas","branch":"slop","commit":"%s"},{"application_id":"run.suite.slop.canvas","branch":"canary","commit":"%s"}]\\n' "$(cat "$STATE-commit")" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    exit 0
    ;;
  remotes)
    printf 'suite-local\\n'
    exit 0
    ;;
esac
if [ "$1" = "--user" ] || [ "$1" = "--system" ]; then
  shift
fi
case "$1" in
  info)
    shift
    case "$1" in
      --show-commit) cat "$STATE-commit" ;;
      *)
        printf '\\nSuite Canvas\\n\\n       Version: 0.2.0\\n'
        ;;
    esac
    ;;
  install)
    printf '%s\\n' "$*" >>"$LOG"
    ref="$6"
    case "$ref" in
      *//canary) printf 'canary' >"$STATE-branch" ;;
      *//beta) printf 'beta' >"$STATE-branch" ;;
      *) printf 'slop' >"$STATE-branch" ;;
    esac
    ;;
esac
exit 0
`,
        { mode: 0o755 },
      );

      const backend = nativePackageBackend({
        appsRoot,
        roots: [join(directory, "installs")],
        registry,
        catalogue: [entry],
        flatpak,
      });

      const result = await backend.update({ entry, channel: "canary" });
      expect(result).toMatchObject({ id: "slop.canvas", version: "0.2.0" });

      const commands = (await readFile(log, "utf8")).trim().split("\n");
      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain("--reinstall");
      expect(commands[0]).toContain("run.suite.slop.canvas//canary");
      expect(commands[0]).not.toMatch(/--noninteractive suite-local run\.suite\.slop\.canvas$/u);

      const listing = await backend.list();
      expect(listing.channels.get("slop.canvas")).toEqual([
        expect.objectContaining({ tier: "slop", branch: "slop" }),
        expect.objectContaining({ tier: "canary", branch: "canary" }),
      ]);
      expect(listing.packages[0]?.app.flatpak?.branch).toBe("canary");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("the native backend's host seam", () => {
  it("plans a launch through flatpak-spawn when it is sandboxed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-seam-"));
    try {
      const backend = nativePackageBackend({
        appsRoot: join(directory, "apps"),
        roots: [join(directory, "installs")],
        registry: registryStore(join(directory, "data")),
        catalogue: [CANVAS],
        flatpak: null,
        host: hostFor(true),
      });

      expect(backend.command({ executable: "/opt/suite/canvas", argv: ["a"] })).toEqual({
        command: "flatpak-spawn",
        args: ["--host", "/opt/suite/canvas", "a"],
      });
      expect(
        backend.command({
          executable: "/usr/bin/flatpak",
          argv: [],
          flatpak: { application: "run.suite.canvas", installation: "user" },
        }),
      ).toEqual({
        command: "flatpak-spawn",
        args: ["--host", "/usr/bin/flatpak", "run", "run.suite.canvas"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("asks Flatpak to update its own deployment, and refuses for another id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-self-"));
    const previous = process.env.FLATPAK_ID;
    try {
      const log = join(directory, "self.log");
      const flatpak = join(directory, "flatpak");
      await writeFile(flatpak, `#!/bin/sh\nprintf '%s\\n' "$@" >>"${log}"\n`, { mode: 0o755 });
      const backend = nativePackageBackend({
        appsRoot: join(directory, "apps"),
        roots: [join(directory, "installs")],
        registry: registryStore(join(directory, "data")),
        catalogue: [CANVAS],
        flatpak,
        // The guard reads the id from the environment; the seam stays direct so the
        // stand-in is what runs.
        host: hostFor(false),
      });

      process.env.FLATPAK_ID = "run.suite.start";
      await backend.updateSelf();
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
        "update",
        "--user",
        "--noninteractive",
        "run.suite.start",
      ]);

      process.env.FLATPAK_ID = "org.example.not-start";
      await expect(backend.updateSelf()).rejects.toThrow(/Flatpak/u);
    } finally {
      if (previous === undefined) delete process.env.FLATPAK_ID;
      else process.env.FLATPAK_ID = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes a Flatpak by application id through the same binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-stop-"));
    try {
      const log = join(directory, "stop.log");
      const flatpak = join(directory, "flatpak");
      await writeFile(flatpak, `#!/bin/sh\nprintf '%s\\n' "$@" >>"${log}"\n`, { mode: 0o755 });
      const backend = nativePackageBackend({
        appsRoot: join(directory, "apps"),
        roots: [join(directory, "installs")],
        registry: registryStore(join(directory, "data")),
        catalogue: [CANVAS],
        flatpak,
        host: hostFor(false),
      });

      await backend.stopFlatpak("run.suite.canvas");
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
        "kill",
        "run.suite.canvas",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
