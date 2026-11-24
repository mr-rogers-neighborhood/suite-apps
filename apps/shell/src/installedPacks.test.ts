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
  publisherKeyFingerprint,
  signPackManifest,
  type TrustedPublisher,
} from "@suite/pack";
import { buildPackArchive } from "@suite/pack-host";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentStore } from "./documents.js";
import { filesScope, PackFilesService } from "./files.js";
import {
  comparePackVersions,
  describePackInstall,
  type InstalledPackInfo,
  installPackArchive,
  loadInstalledPacks,
  type PackTrustOptions,
  packInstallSummary,
  uninstallPackVersion,
} from "./installedPacks.js";
import { documentScopeLabel, documentsRootFor } from "./packIdentity.js";
import { packPartition } from "./packs.js";
import { ROTATION_KIND, signRotationStatement } from "./publisherRotation.js";
import {
  addTrustedPublisher,
  applyPublisherRotation,
  openPublisherTrust,
} from "./publisherTrust.js";
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
  /** The publisher id the manifest claims. Defaults to the first-party id. */
  readonly publisherId?: string;
  /** Sign a manifest from before S2.1, with no publisher field at all. */
  readonly legacyPublisher?: boolean;
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
    ...(options.legacyPublisher === true
      ? {}
      : { publisher: { id: options.publisherId ?? "suite", key: keys.publicKeyBase64 } }),
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
    publishers: [{ id: "suite", key: publicKey, source: "preinstalled" }],
    hostContractVersion: 1,
    hostVersion: 1,
    hostCapabilities: ["documents", "files", "network"],
    ...overrides,
  };
}

function trustFor(
  publishers: readonly TrustedPublisher[],
  overrides: Partial<PackTrustOptions> = {},
): PackTrustOptions {
  return {
    publishers,
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
    expect(scan.issues[0]).toMatchObject({ id: "demo", version: "1.0.0", reason: "publisher" });
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

    expect(await readdir(join(root, "demo"))).toEqual(["1.0.0", "publisher.json"]);
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
    expect(await readdir(join(root, "demo"))).toEqual(["1.1.0", "publisher.json"]);

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
    expect(await readdir(join(actual, "demo"))).toEqual(["1.0.0", "publisher.json"]);
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

describe("publisher trust at install", () => {
  // spec: S2.1
  it("refuses an archive signed by an unknown publisher and names its fingerprint", async () => {
    const root = await temporaryRoot();
    const stranger = await generatePackKeyPair();
    const trusted = await generatePackKeyPair();
    const pack = await fixture({ keys: stranger, publisherId: "acme" });
    const fingerprint = await publisherKeyFingerprint(stranger.publicKeyBase64);

    const failure = installPackArchive(pack.archive, root, trust(trusted.publicKeyBase64));
    await expect(failure).rejects.toMatchObject({
      reason: "publisher",
      fingerprint,
      message: expect.stringContaining(fingerprint),
    });
    await expect(failure).rejects.toThrow(/trust store/u);
    expect(await readdir(root)).toEqual([]);
  });

  // spec: S2.1
  it("installs once the person has added the publisher key", async () => {
    const root = await temporaryRoot();
    const stranger = await generatePackKeyPair();
    const pack = await fixture({ keys: stranger, publisherId: "acme" });
    const options = trustFor([
      { id: "suite", key: (await generatePackKeyPair()).publicKeyBase64, source: "preinstalled" },
      { id: "acme", key: stranger.publicKeyBase64, source: "added" },
    ]);

    const installed = await installPackArchive(pack.archive, root, options);
    expect(installed.publisher).toMatchObject({
      id: "acme",
      fingerprint: await publisherKeyFingerprint(stranger.publicKeyBase64),
    });
  });

  // spec: S2.5
  it("reports the publisher fingerprint, pack id, version and capabilities", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const pack = await fixture({
      keys,
      publisherId: "acme",
      capabilities: ["documents", "files"],
    });
    const options = trustFor([
      { id: "suite", key: (await generatePackKeyPair()).publicKeyBase64, source: "preinstalled" },
      { id: "acme", key: keys.publicKeyBase64, source: "added" },
    ]);
    const installed = await installPackArchive(pack.archive, root, options);

    const summary = packInstallSummary(pack.manifest, {
      id: installed.publisher.id,
      key: keys.publicKeyBase64,
      fingerprint: installed.publisher.fingerprint,
    });
    expect(summary).toEqual({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      capabilities: ["documents", "files"],
      publisher: {
        id: "acme",
        fingerprint: await publisherKeyFingerprint(keys.publicKeyBase64),
      },
    });

    const sentence = describePackInstall(summary, "update");
    for (const fact of [
      "Update",
      "Demo",
      "demo",
      "1.0.0",
      "acme",
      installed.publisher.fingerprint,
      "documents, files",
    ]) {
      expect(sentence).toContain(fact);
    }
    expect(describePackInstall({ ...summary, capabilities: [] }, "install")).toContain(
      "no capabilities",
    );
  });

  // spec: S2.1
  it("loads a pre-S2.1 install without a publisher only under the first-party key", async () => {
    const root = await temporaryRoot();
    const pack = await fixture({ legacyPublisher: true });

    // A new install must name its publisher; the old shape is not an install path.
    await expect(install(root, pack)).rejects.toMatchObject({ reason: "publisher" });
    expect(await readdir(root)).toEqual([]);

    // An install from before this seam still loads, because its bytes verify
    // against the one key every host preinstalls.
    const directory = join(root, "demo", "1.0.0");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), JSON.stringify(pack.manifest));
    await writeFile(join(directory, "index.html"), pack.payload["index.html"] as Uint8Array);

    const scan = await loadInstalledPacks(root, trust(pack.publicKey));
    expect(scan.issues).toEqual([]);
    expect(scan.packs[0]?.publisher.id).toBe("suite");

    // A file signed by another key is never accepted under the legacy rule.
    const other = await generatePackKeyPair();
    const wrong = await loadInstalledPacks(root, trust(other.publicKeyBase64));
    expect(wrong.packs).toEqual([]);
    expect(wrong.issues[0]).toMatchObject({ reason: "untrusted" });
  });
});

describe("publisher install identity", () => {
  // spec: S2.2
  it("refuses a different publisher under an existing id without a migration", async () => {
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    const alphaKeys = await generatePackKeyPair();
    const betaKeys = await generatePackKeyPair();
    const options = trustFor([
      { id: "alpha", key: alphaKeys.publicKeyBase64, source: "added" },
      { id: "beta", key: betaKeys.publicKeyBase64, source: "added" },
    ]);

    await installPackArchive(
      (await fixture({ keys: alphaKeys, publisherId: "alpha" })).archive,
      packsRoot,
      options,
    );
    const beta = await fixture({ keys: betaKeys, publisherId: "beta", version: "2.0.0" });

    await expect(installPackArchive(beta.archive, packsRoot, options)).rejects.toMatchObject({
      reason: "publisher",
      message: expect.stringContaining("explicit migration"),
    });

    const identity = JSON.parse(
      await readFile(join(packsRoot, "demo", "publisher.json"), "utf8"),
    ) as { id: string };
    expect(identity.id).toBe("alpha");
    const scan = await loadInstalledPacks(packsRoot, options);
    expect(scan.packs[0]?.publisher.id).toBe("alpha");
  });

  // spec: S2.2
  it("does not let a new publisher take an id installed before the identity record", async () => {
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    const suiteKeys = await generatePackKeyPair();
    const betaKeys = await generatePackKeyPair();
    const legacy = await fixture({ keys: suiteKeys, legacyPublisher: true });

    // An install from before S2.2: a version directory, no publisher record.
    const directory = join(packsRoot, "demo", "1.0.0");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), JSON.stringify(legacy.manifest));
    await writeFile(join(directory, "index.html"), legacy.payload["index.html"] as Uint8Array);

    const options = trustFor([
      { id: "suite", key: suiteKeys.publicKeyBase64, source: "preinstalled" },
      { id: "beta", key: betaKeys.publicKeyBase64, source: "added" },
    ]);
    const beta = await fixture({ keys: betaKeys, publisherId: "beta", version: "2.0.0" });

    await expect(installPackArchive(beta.archive, packsRoot, options)).rejects.toMatchObject({
      reason: "publisher",
      message: expect.stringContaining("explicit migration"),
    });
    expect((await loadInstalledPacks(packsRoot, options)).packs[0]?.publisher.id).toBe("suite");
  });

  // spec: S2.2
  it("migrates only when asked and inherits no documents, files or session storage", async () => {
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    const alphaKeys = await generatePackKeyPair();
    const betaKeys = await generatePackKeyPair();
    const options = trustFor([
      { id: "alpha", key: alphaKeys.publicKeyBase64, source: "added" },
      { id: "beta", key: betaKeys.publicKeyBase64, source: "added" },
    ]);

    await installPackArchive(
      (await fixture({ keys: alphaKeys, publisherId: "alpha" })).archive,
      packsRoot,
      options,
    );

    const bytes = new TextEncoder().encode("alpha's note");
    const alphaDocuments = new DocumentStore(
      documentsRootFor(dataRoot, "alpha"),
      "alpha",
      documentScopeLabel("alpha"),
    );
    await alphaDocuments.create("default", "demo", "note");
    await alphaDocuments.save("default", "demo", "note", bytes);

    const files = new PackFilesService(join(dataRoot, "files"));
    const alphaScope = filesScope({
      containerId: "default",
      packId: "demo",
      tabId: "tab-alpha",
      pack: { capabilities: ["documents", "files"], publisher: { id: "alpha" } },
    });
    if (alphaScope === null) throw new Error("alpha should have a files scope");
    await files.write(alphaScope, "notes.txt", bytes);

    await installPackArchive(
      (await fixture({ keys: betaKeys, publisherId: "beta", version: "2.0.0" })).archive,
      packsRoot,
      { ...options, allowPublisherMigration: true },
    );

    // The new publisher starts empty, in every store the host owns.
    const betaDocuments = new DocumentStore(
      documentsRootFor(dataRoot, "beta"),
      "beta",
      documentScopeLabel("beta"),
    );
    expect(await betaDocuments.list("default", "demo")).toEqual([]);
    const betaScope = filesScope({
      containerId: "default",
      packId: "demo",
      tabId: "tab-beta",
      pack: { capabilities: ["documents", "files"], publisher: { id: "beta" } },
    });
    if (betaScope === null) throw new Error("beta should have a files scope");
    expect(await files.list(betaScope)).toEqual([]);
    await expect(files.read(betaScope, "notes.txt")).rejects.toThrow();
    expect(packPartition("demo", "default", "alpha")).not.toBe(
      packPartition("demo", "default", "beta"),
    );

    // The previous publisher's data is untouched.
    expect(await alphaDocuments.list("default", "demo")).toHaveLength(1);
    expect((await alphaDocuments.open("default", "demo", "note"))?.bytes).toEqual(bytes);
    expect((await files.list(alphaScope)).map((entry) => entry.path)).toEqual(["notes.txt"]);

    // The identity record now names beta; alpha's version is reported, not loaded.
    const identity = JSON.parse(
      await readFile(join(packsRoot, "demo", "publisher.json"), "utf8"),
    ) as { id: string };
    expect(identity.id).toBe("beta");
    const scan = await loadInstalledPacks(packsRoot, options);
    expect(scan.packs[0]?.publisher.id).toBe("beta");
    expect(scan.issues).toContainEqual(
      expect.objectContaining({ id: "demo", version: "1.0.0", reason: "identity" }),
    );
  });

  // spec: S2.3
  it("keeps an installed version running across a rotation and installs the next one with the new key", async () => {
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    const trustRoot = join(dataRoot, "trust");
    const outgoing = await generatePackKeyPair();
    const incoming = await generatePackKeyPair();

    const added = await addTrustedPublisher(trustRoot, {
      id: "acme",
      key: outgoing.publicKeyBase64,
      fingerprint: await publisherKeyFingerprint(outgoing.publicKeyBase64),
    });
    expect(added.ok).toBe(true);

    const first = await fixture({ version: "1.0.0", keys: outgoing, publisherId: "acme" });
    await installPackArchive(
      first.archive,
      packsRoot,
      trustFor((await openPublisherTrust(trustRoot)).publishers),
    );

    const rotation = signRotationStatement(
      {
        kind: ROTATION_KIND,
        publisher: "acme",
        sequence: 1,
        previousKey: outgoing.publicKeyBase64,
        newKey: incoming.publicKeyBase64,
      },
      outgoing.secretKeyBase64,
    );
    const applied = await applyPublisherRotation(trustRoot, {
      statement: rotation,
      fingerprint: await publisherKeyFingerprint(incoming.publicKeyBase64),
    });
    expect(applied.ok).toBe(true);

    const rotated = await openPublisherTrust(trustRoot);
    const kept = await loadInstalledPacks(packsRoot, trustFor(rotated.publishers));
    expect(kept.packs).toHaveLength(1);
    expect(kept.packs[0]).toMatchObject({ id: "demo", version: "1.0.0" });
    expect(kept.issues).toHaveLength(0);

    const second = await fixture({ version: "1.1.0", keys: incoming, publisherId: "acme" });
    await installPackArchive(second.archive, packsRoot, trustFor(rotated.publishers));

    const scan = await loadInstalledPacks(packsRoot, trustFor(rotated.publishers));
    expect(scan.packs[0]).toMatchObject({ id: "demo", version: "1.1.0" });
    expect(scan.versions.map((entry) => entry.version)).toEqual(["1.0.0", "1.1.0"]);

    const identity = JSON.parse(
      await readFile(join(packsRoot, "demo", "publisher.json"), "utf8"),
    ) as { id: string; key: string };
    expect(identity.id).toBe("acme");
    expect(identity.key).toBe(incoming.publicKeyBase64);
  });
});
