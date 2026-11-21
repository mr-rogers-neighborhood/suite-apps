import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appCards } from "./cards.js";
import { type CatalogueEntry, PRE_RELEASE_CATALOGUE_APPS } from "./catalogue.js";
import { SYNC_APPLICATION } from "./flatpak.js";
import { hostFor } from "./host.js";
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
    executable: "/home/me/Applications/Suite/Canvas/0.1.0/suite-canvas",
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
      return { id: request.entry.id, version: null };
    },
    async update(request: PackageUpdateRequest): Promise<PackageInstallResult> {
      calls.push(`update:${request.entry.id}:${request.channel ?? "unset"}`);
      return { id: request.entry.id, version: null };
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
    async deployment(application: string) {
      calls.push(`deployment:${application}`);
      return {
        installed: false,
        version: null,
        commit: null,
        canInstall: true,
        problem: null,
      };
    },
    async installDeployment(application: string) {
      calls.push(`install-deployment:${application}`);
      return null;
    },
    async openDeployment(application: string) {
      calls.push(`open-deployment:${application}`);
    },
    async adopt(executable: string) {
      calls.push(`adopt:${executable}`);
      return true;
    },
    async forget(id: string) {
      calls.push(`forget:${id}`);
    },
  };
}

function listingOf(app: DiscoveredApp, offers: ReadonlyMap<string, string> = new Map()) {
  const package_: InstalledPackage = {
    app,
    ownership: app.flatpak === undefined ? "folder" : "flatpak",
    channel: "alpha",
  };
  return {
    packages: [package_],
    rejected: [],
    offers,
    channels: new Map(),
  } satisfies PackageListing;
}

describe("a fake PackageBackend", () => {
  it("is enough to build a card without the catalogue or renderer knowing a channel", async () => {
    const app = {
      ...discovered(),
      executable: "/usr/bin/flatpak",
      flatpak: { application: "run.suite.canvas", installation: "user", commit: "a".repeat(64) },
    };
    const backend = fakeBackend(listingOf(app, new Map([["canvas", "b".repeat(64)]])));
    const listing = await backend.list();

    const cards = appCards({
      apps: listing.packages.map((entry) => entry.app),
      rejected: listing.rejected,
      files: [],
      recents: [],
      catalogue: [
        {
          ...CANVAS,
          installed: "0.1.0",
        },
      ],
      running: new Set(),
      store: listing.offers,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "canvas",
      source: "flatpak",
      state: "update-available",
      version: "0.1.0",
    });
  });

  it("carries the reserved channel through install and update unchanged", async () => {
    const backend = fakeBackend(listingOf(discovered()));
    await backend.install({ entry: CANVAS, channel: "alpha" });
    await backend.update({ entry: CANVAS, channel: "alpha" });
    expect(backend.calls).toEqual(["install:canvas:alpha", "update:canvas:alpha"]);
  });
});

describe("the native PackageBackend", () => {
  it("switches one pre-release deployment to another branch instead of installing a second", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-switch-"));
    try {
      const registry = registryStore(join(directory, "data"));
      const state = join(directory, "state");
      const log = join(directory, "flatpak.log");
      const entry = PRE_RELEASE_CATALOGUE_APPS.find((candidate) => candidate.id === "slop-canvas");
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
        roots: [join(directory, "installs")],
        registry,
        catalogue: [entry],
        flatpak,
        host: hostFor(false),
      });

      const result = await backend.update({ entry, channel: "canary" });
      expect(result).toMatchObject({ id: "slop-canvas", version: "0.2.0" });

      const commands = (await readFile(log, "utf8")).trim().split("\n");
      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain("--reinstall");
      expect(commands[0]).toContain("run.suite.slop.canvas//canary");
      expect(commands[0]).not.toMatch(/--noninteractive suite-local run\.suite\.slop\.canvas$/u);

      const listing = await backend.list();
      expect(listing.channels.get("slop-canvas")).toEqual([
        expect.objectContaining({ tier: "slop", branch: "slop" }),
        expect.objectContaining({ tier: "canary", branch: "canary" }),
      ]);
      expect(listing.packages[0]?.app.flatpak?.branch).toBe("canary");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads and installs a deployment that has no catalogue card", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-sync-deploy-"));
    try {
      const state = join(directory, "state");
      const log = join(directory, "flatpak.log");
      const commit = "b".repeat(64);
      const flatpak = join(directory, "flatpak");
      await writeFile(
        flatpak,
        `#!/bin/sh
STATE="${state}"
LOG="${log}"
if [ "$1" = "list" ]; then
  if [ ! -f "$STATE-installed" ]; then
    printf '[]\\n'
    exit 0
  fi
  printf '[{"name":"Suite Sync","application_id":"run.suite.sync","version":"0.11.3","branch":"master","origin":"suite","installation":"user"}]\\n'
  exit 0
fi
if [ "$1" = "remotes" ]; then
  printf 'suite\\n'
  exit 0
fi
if [ "$1" = "--user" ] || [ "$1" = "--system" ]; then
  shift
fi
case "$1" in
  info)
    shift
    case "$1" in
      --show-commit) printf '${commit}\\n' ;;
      *) printf '\\nSuite Sync\\n\\n       Version: 0.11.3\\n' ;;
    esac
    ;;
  install)
    touch "$STATE-installed"
    printf '%s\\n' "$*" >>"$LOG"
    ;;
esac
exit 0
`,
        { mode: 0o755 },
      );

      const backend = nativePackageBackend({
        roots: [join(directory, "installs")],
        registry: registryStore(join(directory, "data")),
        catalogue: [CANVAS],
        flatpak,
        host: hostFor(false),
      });

      // No catalogue entry is needed: the deployment is read from Flatpak itself.
      expect(await backend.deployment(SYNC_APPLICATION)).toMatchObject({
        installed: false,
        canInstall: true,
        problem: null,
      });

      expect(await backend.installDeployment(SYNC_APPLICATION)).toBe("0.11.3");
      const installed = await backend.deployment(SYNC_APPLICATION);
      expect(installed.installed).toBe(true);
      expect(installed.commit).toBe(commit);
      expect((await readFile(log, "utf8")).trim()).toBe(
        "install --user --noninteractive suite run.suite.sync",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("offers a self update only when its own origin publishes another commit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-self-check-"));
    const previous = process.env.FLATPAK_ID;
    try {
      const installed = "a".repeat(64);
      const newer = "b".repeat(64);
      const state = join(directory, "self");
      const log = join(directory, "self.log");
      const flatpak = join(directory, "flatpak");
      await writeFile(`${state}-installed`, `${installed}\n`);
      await writeFile(`${state}-offered`, `${installed}\n`);
      await writeFile(
        flatpak,
        `#!/bin/sh
STATE="${state}"
LOG="${log}"
printf '%s\\n' "$*" >>"$LOG"
if [ "$1" = "list" ]; then
  printf '[{"name":"Suite Start","application_id":"run.suite.start","version":"0.5.0","branch":"master","origin":"suite-local","installation":"user"}]\\n'
  exit 0
fi
if [ "$1" = "--user" ] || [ "$1" = "--system" ]; then
  shift
fi
case "$1" in
  info)
    shift
    case "$1" in
      --show-commit) cat "$STATE-installed" ;;
      *) printf '\\nSuite Start\\n\\n       Version: 0.5.0\\n' ;;
    esac
    ;;
  remote-info)
    case "$2" in
      --show-commit)
        if [ -f "$STATE-fail" ]; then exit 1; fi
        cat "$STATE-offered"
        ;;
    esac
    ;;
esac
exit 0
`,
        { mode: 0o755 },
      );

      const backend = nativePackageBackend({
        roots: [join(directory, "installs")],
        registry: registryStore(join(directory, "data")),
        catalogue: [CANVAS],
        flatpak,
        host: hostFor(false),
      });

      process.env.FLATPAK_ID = "run.suite.start";
      // Same commit: the origin answered, and there is nothing to press.
      expect(await backend.checkSelfUpdate()).toEqual({
        available: false,
        checked: true,
        error: null,
      });

      // A newer commit on the same origin is the one update state.
      await writeFile(`${state}-offered`, `${newer}\n`);
      await backend.list({ refresh: true });
      expect(await backend.checkSelfUpdate()).toEqual({
        available: true,
        checked: true,
        error: null,
      });

      // A failed fetch is not an update, and not a claim that this is current.
      await writeFile(`${state}-fail`, "1");
      await backend.list({ refresh: true });
      const failed = await backend.checkSelfUpdate();
      expect(failed.available).toBe(false);
      expect(failed.checked).toBe(false);
      expect(failed.error).toContain("suite-local");

      // The comparison asks the deployment's own origin for its own app id.
      const commands = (await readFile(log, "utf8")).trim().split("\n");
      expect(commands).toContain("--user info --show-commit run.suite.start");
      expect(commands).toContain("--user remote-info --show-commit suite-local run.suite.start");

      // A copy Flatpak does not own has no origin to compare and no update.
      delete process.env.FLATPAK_ID;
      expect(await backend.checkSelfUpdate()).toEqual({
        available: false,
        checked: false,
        error: null,
      });
    } finally {
      if (previous === undefined) delete process.env.FLATPAK_ID;
      else process.env.FLATPAK_ID = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compares an installed app with its own origin, not the first store remote", async () => {
    // `suite-local` installed this build. The public `suite` remote carries a
    // different commit; measuring against it would invent an update that the
    // deployment's origin does not have.
    const directory = await mkdtemp(join(tmpdir(), "suite-origin-"));
    try {
      const registry = registryStore(join(directory, "data"));
      const commit = "a".repeat(64);
      const other = "b".repeat(64);
      const flatpak = join(directory, "flatpak");
      await writeFile(
        flatpak,
        `#!/bin/sh
if [ "$1" = "list" ]; then
  printf '[{"name":"Suite Canvas","application_id":"run.suite.canvas","version":"0.1.0","branch":"master","origin":"suite-local","installation":"user"}]\\n'
  exit 0
fi
if [ "$1" = "remotes" ]; then
  printf 'suite\\nsuite-local\\n'
  exit 0
fi
if [ "$1" = "--user" ] || [ "$1" = "--system" ]; then
  shift
fi
case "$1" in
  remote-info)
    case "$3" in
      suite) printf '${other}\\n' ;;
      suite-local) printf '${commit}\\n' ;;
    esac
    ;;
  info)
    shift
    case "$1" in
      --show-commit) printf '${commit}\\n' ;;
      *) printf '\\nSuite Canvas\\n\\n       Version: 0.1.0\\n' ;;
    esac
    ;;
esac
exit 0
`,
        { mode: 0o755 },
      );

      const backend = nativePackageBackend({
        roots: [join(directory, "installs")],
        registry,
        catalogue: [CANVAS],
        flatpak,
        host: hostFor(false),
      });

      const listing = await backend.list({ refresh: true });
      expect(listing.packages[0]?.app.flatpak).toMatchObject({
        origin: "suite-local",
        commit,
      });
      expect(listing.offers.get("canvas")).toBe(commit);
      expect(listing.offers.get("canvas")).not.toBe(other);
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
