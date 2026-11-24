import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestPackFiles,
  generatePackKeyPair,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  signPackManifest,
} from "@suite/pack";
import { buildPackArchive } from "@suite/pack-host";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogueEntry,
  catalogueRootFor,
  installCataloguePack,
  loadCatalogue,
} from "./catalogue.js";
import {
  type InstalledPackInfo,
  loadInstalledPacks,
  type PackTrustOptions,
  uninstallPackVersion,
} from "./installedPacks.js";

const encoder = new TextEncoder();
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-catalogue-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FixtureOptions {
  readonly id?: string;
  readonly version?: string;
  readonly description?: string;
  readonly keys?: { readonly secretKeyBase64: string; readonly publicKeyBase64: string };
  /** What the archive actually contains, when it should not match the manifest. */
  readonly archivePayload?: Record<string, Uint8Array>;
  readonly unsigned?: boolean;
}

interface Fixture {
  readonly archive: Uint8Array;
  readonly publicKey: string;
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const keys = options.keys ?? (await generatePackKeyPair());
  const payload = {
    "index.html": encoder.encode(`<!doctype html><title>${options.id ?? "demo"}</title>`),
  };
  const core: PackManifestCore = {
    format: PACK_FORMAT,
    id: options.id ?? "demo",
    name: options.id ?? "Demo",
    version: options.version ?? "1.0.0",
    entry: "index.html",
    contractVersion: 1,
    publisher: { id: "suite", key: keys.publicKeyBase64 },
    capabilities: [],
    files: await digestPackFiles(payload),
    ...(options.description === undefined ? {} : { description: options.description }),
  };
  const manifest = {
    ...core,
    ...(options.unsigned === true
      ? {}
      : { signature: signPackManifest(core, keys.secretKeyBase64) }),
  } as PackManifest;
  return {
    archive: buildPackArchive(manifest, options.archivePayload ?? payload),
    publicKey: keys.publicKeyBase64,
  };
}

function trust(publicKey: string): PackTrustOptions {
  return {
    publishers: [{ id: "suite", key: publicKey, source: "preinstalled" }],
    hostContractVersion: 1,
    hostVersion: 1,
    hostCapabilities: ["documents", "files", "network"],
  };
}

async function writeArchive(root: string, name: string, archive: Uint8Array): Promise<void> {
  await writeFile(join(root, name), archive);
}

async function installFromCatalogue(
  catalogueRoot: string,
  packsRoot: string,
  publicKey: string,
  id: string,
  version: string,
): Promise<InstalledPackInfo> {
  const entries = await loadCatalogue(catalogueRoot, trust(publicKey));
  const entry = entries.find((candidate) => candidate.id === id && candidate.version === version);
  if (entry === undefined) throw new Error(`missing catalogue entry ${id} ${version}`);
  return installCataloguePack(entry, packsRoot, trust(publicKey));
}

describe("the catalogue root", () => {
  it("defaults to the data root and honours the override", () => {
    expect(catalogueRootFor("/data/shell", {})).toBe("/data/shell/catalogue");
    expect(catalogueRootFor("/data/shell", { SUITE_SHELL_CATALOGUE: "/media/packs" })).toBe(
      "/media/packs",
    );
    expect(catalogueRootFor("/data/shell", { SUITE_SHELL_CATALOGUE: "   " })).toBe(
      "/data/shell/catalogue",
    );
  });
});

describe("catalogue scanning", () => {
  it("lists a valid signed archive as trusted", async () => {
    const root = await temporaryRoot();
    const fixturePack = await fixture({ description: "A catalogue demo." });
    await writeArchive(root, "demo-1.0.0.suitepack", fixturePack.archive);

    const entries = await loadCatalogue(root, trust(fixturePack.publicKey));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      description: "A catalogue demo.",
      entry: "index.html",
      trusted: true,
      refusal: null,
      reason: null,
    });

    const view = catalogueEntry(entries[0] as NonNullable<(typeof entries)[0]>);
    expect(view.trusted).toBe(true);
    expect(view).not.toHaveProperty("file");
    expect(view).not.toHaveProperty("reason");
  });

  it("lists an archive signed by another key as refused and will not install it", async () => {
    const root = await temporaryRoot();
    const packsRoot = await temporaryRoot();
    const trusted = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    const fixturePack = await fixture({ keys: other });
    await writeArchive(root, "demo-1.0.0.suitepack", fixturePack.archive);

    const entries = await loadCatalogue(root, trust(trusted.publicKeyBase64));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "demo", version: "1.0.0", trusted: false });
    expect(entries[0]?.refusal).toContain("trust store");

    const entry = entries[0];
    if (entry === undefined) throw new Error("missing entry");
    await expect(
      installCataloguePack(entry, packsRoot, trust(trusted.publicKeyBase64)),
    ).rejects.toMatchObject({ reason: "publisher" });
    expect(await readdir(packsRoot)).toEqual([]);
  });

  it("lists a tampered archive as refused and leaves no files behind", async () => {
    const root = await temporaryRoot();
    const packsRoot = await temporaryRoot();
    const fixturePack = await fixture({
      archivePayload: {
        "index.html": encoder.encode("<!doctype html><title>Tampered</title>"),
      },
    });
    await writeArchive(root, "demo-1.0.0.suitepack", fixturePack.archive);

    const entries = await loadCatalogue(root, trust(fixturePack.publicKey));
    expect(entries[0]).toMatchObject({ trusted: false, reason: "files" });
    expect(entries[0]?.refusal).toContain("failed");

    const entry = entries[0];
    if (entry === undefined) throw new Error("missing entry");
    await expect(
      installCataloguePack(entry, packsRoot, trust(fixturePack.publicKey)),
    ).rejects.toMatchObject({ reason: "files" });
    expect(await readdir(packsRoot)).toEqual([]);
  });

  it("refuses an unsigned manifest", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const fixturePack = await fixture({ unsigned: true });
    await writeArchive(root, "demo-1.0.0.suitepack", fixturePack.archive);

    const entries = await loadCatalogue(root, trust(keys.publicKeyBase64));
    expect(entries[0]).toMatchObject({ trusted: false, reason: "invalid" });
  });
});

describe("catalogue installation and lifecycle", () => {
  it("installs a trusted archive and then lists it as an installed pack", async () => {
    const catalogueRoot = await temporaryRoot();
    const packsRoot = await temporaryRoot();
    const fixturePack = await fixture();
    await writeArchive(catalogueRoot, "demo-1.0.0.suitepack", fixturePack.archive);

    const installed = await installFromCatalogue(
      catalogueRoot,
      packsRoot,
      fixturePack.publicKey,
      "demo",
      "1.0.0",
    );
    expect(installed.root).toBe(join(packsRoot, "demo", "1.0.0"));
    expect(await readFile(join(installed.root, "index.html"), "utf8")).toContain("demo");

    const scan = await loadInstalledPacks(packsRoot, trust(fixturePack.publicKey));
    expect(scan.packs.map((pack) => pack.version)).toEqual(["1.0.0"]);
  });

  it("installs a new version beside the old one and removes only the retired version", async () => {
    const catalogueRoot = await temporaryRoot();
    const packsRoot = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const older = await fixture({ version: "1.0.0", keys });
    const newer = await fixture({ version: "1.1.0", keys });
    await writeArchive(catalogueRoot, "demo-1.0.0.suitepack", older.archive);
    await writeArchive(catalogueRoot, "demo-1.1.0.suitepack", newer.archive);

    await installFromCatalogue(catalogueRoot, packsRoot, newer.publicKey, "demo", "1.0.0");
    await installFromCatalogue(catalogueRoot, packsRoot, newer.publicKey, "demo", "1.1.0");

    const both = await loadInstalledPacks(packsRoot, trust(newer.publicKey));
    expect(both.packs.map((pack) => pack.version)).toEqual(["1.1.0"]);
    expect(both.versions.map((version) => version.version)).toEqual(["1.0.0", "1.1.0"]);

    await uninstallPackVersion(packsRoot, "demo", "1.0.0");
    const after = await loadInstalledPacks(packsRoot, trust(newer.publicKey));
    expect(after.packs.map((pack) => pack.version)).toEqual(["1.1.0"]);
    expect(after.versions.map((version) => version.version)).toEqual(["1.1.0"]);
  });
});
