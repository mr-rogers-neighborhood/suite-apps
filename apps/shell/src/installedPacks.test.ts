import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestPackFiles,
  generatePackKeyPair,
  PACK_CAPABILITIES,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  signPackManifest,
} from "@suite/pack";
import { buildPackArchive } from "@suite/pack-host";
import { afterEach, describe, expect, it } from "vitest";
import {
  comparePackVersions,
  type InstalledPackInfo,
  installPackArchive,
  loadInstalledPacks,
  type PackTrustOptions,
  uninstallPackVersion,
} from "./installedPacks.js";
import type { PackCapability } from "./shared.js";

const encoder = new TextEncoder();
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-installed-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FixtureOptions {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
  readonly contractVersion?: number;
  readonly minimumHostVersion?: number;
  readonly capabilities?: readonly PackCapability[];
  /** What the signed manifest lists. */
  readonly payload?: Record<string, Uint8Array>;
  /** What the archive actually contains. Defaults to the payload. */
  readonly archiveFiles?: Record<string, Uint8Array>;
  /** Reuse one key pair when several versions should share a trust root. */
  readonly keys?: { readonly secretKeyBase64: string; readonly publicKeyBase64: string };
}

interface Fixture {
  readonly manifest: PackManifest;
  readonly payload: Record<string, Uint8Array>;
  readonly archive: Uint8Array;
  readonly publicKey: string;
}

/**
 * A signed pack built with a throwaway key. The real pin is deliberately never
 * imported here: generated keys keep the loader's policy testable on any machine.
 */
async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const keys = options.keys ?? (await generatePackKeyPair());
  const payload = options.payload ?? {
    "index.html": encoder.encode("<!doctype html><title>Demo</title>"),
  };
  const core: PackManifestCore = {
    format: PACK_FORMAT,
    id: options.id ?? "demo",
    name: options.name ?? "Demo",
    version: options.version ?? "1.0.0",
    entry: "index.html",
    contractVersion: options.contractVersion ?? 1,
    capabilities: options.capabilities ?? [],
    files: await digestPackFiles(payload),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.minimumHostVersion === undefined
      ? {}
      : { minimumHostVersion: options.minimumHostVersion }),
  };
  const manifest: PackManifest = {
    ...core,
    signature: signPackManifest(core, keys.secretKeyBase64),
  };
  return {
    manifest,
    payload,
    archive: buildPackArchive(manifest, options.archiveFiles ?? payload),
    publicKey: keys.publicKeyBase64,
  };
}

function trust(publicKey: string, overrides: Partial<PackTrustOptions> = {}): PackTrustOptions {
  return {
    publicKey,
    hostContractVersion: 1,
    hostVersion: 1,
    hostCapabilities: ["documents", "files", "network"],
    ...overrides,
  };
}

async function install(
  root: string,
  pack: Fixture,
  overrides: Partial<PackTrustOptions> = {},
): Promise<InstalledPackInfo> {
  return installPackArchive(pack.archive, root, trust(pack.publicKey, overrides));
}

describe("installed pack verification", () => {
  it("loads a valid signed pack with its files", async () => {
    const root = await temporaryRoot();
    const pack = await fixture({ description: "A demo for the host boundary." });
    const installed = await install(root, pack);

    expect(installed).toMatchObject({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      description: "A demo for the host boundary.",
      entry: "index.html",
      capabilities: [],
      source: "installed",
      root: join(root, "demo", "1.0.0"),
    });
    expect(await readFile(join(installed.root, "index.html"), "utf8")).toContain("Demo");

    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.issues).toEqual([]);
    expect(scan.packs).toHaveLength(1);
    expect(scan.packs[0]).toMatchObject({
      id: "demo",
      version: "1.0.0",
      description: "A demo for the host boundary.",
      source: "installed",
    });
  });

  it("refuses a pack signed by a different key", async () => {
    const root = await temporaryRoot();
    const pack = await fixture();
    await install(root, pack);

    const other = await generatePackKeyPair();
    const scan = await loadInstalledPacks(root, trust(other.publicKeyBase64));
    expect(scan.packs).toEqual([]);
    expect(scan.issues).toHaveLength(1);
    expect(scan.issues[0]).toMatchObject({ id: "demo", version: "1.0.0", reason: "untrusted" });
  });

  it("refuses a file that changed after it was signed", async () => {
    const root = await temporaryRoot();
    const pack = await fixture();
    const installed = await install(root, pack);
    await writeFile(join(installed.root, "index.html"), "tampered");

    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.packs).toEqual([]);
    expect(scan.issues[0]).toMatchObject({ id: "demo", version: "1.0.0", reason: "files" });
  });

  it("refuses a manifest without a signature", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const files = { "index.html": encoder.encode("<!doctype html><title>Unsigned</title>") };
    const core: PackManifestCore = {
      format: PACK_FORMAT,
      id: "unsigned",
      name: "Unsigned",
      version: "1.0.0",
      entry: "index.html",
      contractVersion: 1,
      capabilities: [],
      files: await digestPackFiles(files),
    };
    const directory = join(root, "unsigned", "1.0.0");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), JSON.stringify(core));
    await writeFile(join(directory, "index.html"), files["index.html"] as Uint8Array);

    const scan = await loadInstalledPacks(root, trust(keys.publicKeyBase64));
    expect(scan.packs).toEqual([]);
    expect(scan.issues[0]).toMatchObject({ id: "unsigned", version: "1.0.0", reason: "invalid" });
  });

  it("refuses a capability this host does not implement", async () => {
    const root = await temporaryRoot();
    const pack = await fixture({ capabilities: ["storage"] });

    await expect(install(root, pack)).rejects.toMatchObject({
      id: "demo",
      version: "1.0.0",
      reason: "capability",
    });

    // Install it under a host that implements everything, then scan with the real policy.
    await installPackArchive(
      pack.archive,
      root,
      trust(pack.publicKey, { hostCapabilities: [...PACK_CAPABILITIES] }),
    );
    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.packs).toEqual([]);
    expect(scan.issues[0]).toMatchObject({ id: "demo", version: "1.0.0", reason: "capability" });
  });

  it("refuses a newer contract or a newer minimum host", async () => {
    const root = await temporaryRoot();
    const futureContract = await fixture({ contractVersion: 2 });
    await expect(install(root, futureContract)).rejects.toMatchObject({
      id: "demo",
      version: "1.0.0",
      reason: "host",
    });

    const futureHost = await fixture({ version: "1.0.1", minimumHostVersion: 2 });
    await expect(install(root, futureHost)).rejects.toMatchObject({
      id: "demo",
      version: "1.0.1",
      reason: "host",
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses an archive with a file the manifest does not list", async () => {
    const root = await temporaryRoot();
    const pack = await fixture({
      archiveFiles: {
        "index.html": encoder.encode("<!doctype html><title>Demo</title>"),
        "extra.js": encoder.encode("console.log('extra');"),
      },
    });

    await expect(install(root, pack)).rejects.toMatchObject({ reason: "extra-files" });
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses an archive missing a file the manifest lists", async () => {
    const root = await temporaryRoot();
    const pack = await fixture({
      payload: {
        "index.html": encoder.encode("<!doctype html><title>Demo</title>"),
        "assets/app.js": encoder.encode("console.log('app');"),
      },
      archiveFiles: {
        "index.html": encoder.encode("<!doctype html><title>Demo</title>"),
      },
    });

    await expect(install(root, pack)).rejects.toMatchObject({ reason: "files" });
    expect(await readdir(root)).toEqual([]);
  });
  it("ignores crash-left temporary directories", async () => {
    const root = await temporaryRoot();
    const pack = await fixture();
    await install(root, pack);
    await mkdir(join(root, ".tmp-orphan"));
    await mkdir(join(root, "demo", ".tmp-leftover"));

    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.issues).toEqual([]);
    expect(scan.packs).toHaveLength(1);
    expect(scan.packs[0]?.version).toBe("1.0.0");
  });
});

describe("installed pack selection", () => {
  it("chooses the highest valid version of a pack", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const older = await fixture({ version: "1.0.0", keys });
    const newer = await fixture({ version: "1.10.0", keys });
    await install(root, older);
    await install(root, newer);

    const scan = await loadInstalledPacks(root, trust(newer.publicKey));
    expect(scan.issues).toEqual([]);
    expect(scan.packs).toHaveLength(1);
    expect(scan.packs[0]?.version).toBe("1.10.0");
  });

  it("falls back to an older valid version and reports the corrupt newest", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const older = await fixture({ version: "1.0.0", keys });
    const newer = await fixture({ version: "1.1.0", keys });
    await install(root, older);
    const installed = await install(root, newer);
    await rm(join(installed.root, "index.html"));

    const scan = await loadInstalledPacks(root, trust(newer.publicKey));
    expect(scan.packs).toHaveLength(1);
    expect(scan.packs[0]?.version).toBe("1.0.0");
    expect(scan.issues).toContainEqual(
      expect.objectContaining({ id: "demo", version: "1.1.0", reason: "files" }),
    );
  });
});

describe("installed pack installation", () => {
  it("writes the version directory and leaves no temporary directory", async () => {
    const root = await temporaryRoot();
    const pack = await fixture();
    await install(root, pack);

    expect(await readdir(join(root, "demo"))).toEqual(["1.0.0"]);
    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.packs[0]?.root).toBe(join(root, "demo", "1.0.0"));
  });

  it("refuses to overwrite a version that is already installed", async () => {
    const root = await temporaryRoot();
    const pack = await fixture();
    await install(root, pack);
    await expect(install(root, pack)).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("already installed"),
    });

    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.issues).toEqual([]);
    expect(scan.packs).toHaveLength(1);
  });

  it("refuses an id that is not safe and writes nothing", async () => {
    const root = await temporaryRoot();
    const pack = await fixture({ id: "../escape" });
    await expect(install(root, pack)).rejects.toMatchObject({ reason: "invalid" });
    expect(await readdir(root)).toEqual([]);
  });

  it("ignores a version directory that is not a safe path segment", async () => {
    const root = await temporaryRoot();
    const pack = await fixture();
    await install(root, pack);
    // `parsePackManifest` refuses a slash in a version before an archive can
    // reach the install guard, but a directory can exist under the install root
    // with a name the scan must not join into a path.
    await mkdir(join(root, "demo", "1.0.0\\..\\escape"), { recursive: true });

    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.packs).toHaveLength(1);
    expect(scan.packs[0]?.version).toBe("1.0.0");
    expect(scan.issues).toContainEqual(
      expect.objectContaining({
        reason: "invalid",
        version: "1.0.0\\..\\escape",
      }),
    );
  });

  it("refuses a symlinked id root and writes nothing outside", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const pack = await fixture();
    await symlink(outside, join(root, "demo"));

    await expect(install(root, pack)).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("symbolic link"),
    });

    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(root)).toEqual(["demo"]);
    expect(await readdir(join(root, "demo"))).toEqual([]);
  });

  it("refuses a symlinked version directory and writes nothing outside", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const pack = await fixture();
    await mkdir(join(root, "demo"));
    await symlink(outside, join(root, "demo", "1.0.0"));

    await expect(install(root, pack)).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("symbolic link"),
    });

    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(join(root, "demo"))).toEqual(["1.0.0"]);
  });
});

describe("installed pack uninstall", () => {
  it("removes only the named version and leaves the other one", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    await install(root, await fixture({ version: "1.0.0", keys }));
    await install(root, await fixture({ version: "1.1.0", keys }));

    await uninstallPackVersion(root, "demo", "1.0.0");
    expect(await readdir(join(root, "demo"))).toEqual(["1.1.0"]);

    const scan = await loadInstalledPacks(root, trust(keys.publicKeyBase64));
    expect(scan.versions.map((version) => version.version)).toEqual(["1.1.0"]);
  });

  it("never touches the pack's documents or files", async () => {
    const dataRoot = await temporaryRoot();
    const root = join(dataRoot, "packs");
    const pack = await fixture();
    await install(root, pack);

    const document = join(dataRoot, "documents", "default", "demo", "note.json");
    const packFile = join(dataRoot, "files", "default", "demo", "notes.txt");
    await mkdir(join(dataRoot, "documents", "default", "demo"), { recursive: true });
    await mkdir(join(dataRoot, "files", "default", "demo"), { recursive: true });
    await writeFile(document, "{}");
    await writeFile(packFile, "kept");

    await uninstallPackVersion(root, "demo", "1.0.0");
    expect(await readFile(document, "utf8")).toBe("{}");
    expect(await readFile(packFile, "utf8")).toBe("kept");
  });

  it("refuses a symlinked install root without following it", async () => {
    const actual = await temporaryRoot();
    const outside = await temporaryRoot();
    const pack = await fixture();
    await install(actual, pack);
    const link = join(outside, "packs-link");
    await symlink(actual, link);

    await expect(uninstallPackVersion(link, "demo", "1.0.0")).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("symbolic link"),
    });
    expect(await readdir(join(actual, "demo"))).toEqual(["1.0.0"]);
  });

  it("refuses a symlinked version directory without following it", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await mkdir(join(root, "demo"), { recursive: true });
    await mkdir(join(outside, "kept"), { recursive: true });
    await symlink(join(outside, "kept"), join(root, "demo", "1.0.0"));

    await expect(uninstallPackVersion(root, "demo", "1.0.0")).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("symbolic link"),
    });
    expect(await readdir(join(outside, "kept"))).toEqual([]);
  });

  it("refuses a version that is not a safe path segment", async () => {
    const root = await temporaryRoot();
    await expect(uninstallPackVersion(root, "demo", "../escape")).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("refuses a version that is not installed", async () => {
    const root = await temporaryRoot();
    await expect(uninstallPackVersion(root, "demo", "1.0.0")).rejects.toMatchObject({
      reason: "io",
    });
  });
});

describe("pack version comparison", () => {
  it("puts a release above its prereleases", () => {
    expect(comparePackVersions("1.0.0", "1.0.0-beta.2")).toBe(1);
    expect(comparePackVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
  });

  it("compares numeric prerelease identifiers numerically", () => {
    expect(comparePackVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
    expect(comparePackVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
  });

  it("ignores build metadata", () => {
    expect(comparePackVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(comparePackVersions("1.0.0-rc.1+one", "1.0.0-rc.1+two")).toBe(0);
  });

  it("compares numeric core parts as numbers", () => {
    expect(comparePackVersions("1.10.0", "1.2.0")).toBe(1);
    expect(comparePackVersions("2.0.0", "10.0.0")).toBe(-1);
  });
});
