import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestPackFiles,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  publicKeyFromSecret,
  signPackManifest,
} from "@suite/pack";
import { buildPackArchive } from "@suite/pack-host";
import { afterEach, describe, expect, it } from "vitest";
import { BlobStores } from "./blobs.js";
import { installCataloguePack, loadCatalogue, type VerifiedCatalogueIndex } from "./catalogue.js";
import { DEFAULT_CONTAINER_ID } from "./container.js";
import { DocumentStore, declaredDocumentSchemaVersion } from "./documents.js";
import { ExportBundle } from "./exportBundle.js";
import {
  type InstalledPackInfo,
  installPackArchive,
  loadInstalledPacks,
  type PackTrustOptions,
} from "./installedPacks.js";
import { documentScopeLabel, documentsRootFor } from "./packIdentity.js";
import { packAllows, packUrl, resolvePackRequest } from "./packs.js";
import type { DocumentRecord, DocumentSummary } from "./shared.js";

/**
 * One pack through a host that has no window.
 *
 * This is the committed counterpart to the hand-run proof in #334: a small,
 * really-signed archive is installed into a temporary data root, opened, written
 * through the host document envelope, exported and imported again. The pack's
 * own entry bodies are the only doubles here; install, the document store, the
 * export bundle and the archive reader are the host code the window would use.
 *
 * The Electron `Session` (its partition and protocol handler) is not created:
 * that needs a running Electron process. What the host can reach headlessly is
 * the pack's declared entry and its document scope, which is what this drives.
 */

const encoder = new TextEncoder();

const PACK_ID = "session-demo";

/**
 * A test-only signing key, pinned in this file.
 *
 * It is not the release key and cannot install anywhere that trusts the release
 * pin. Pinning it keeps the archive reproducible and proves the same manifest,
 * files and signature on every run and on every machine.
 */
const PINNED_TEST_SECRET = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const PINNED_TEST_PUBLIC = publicKeyFromSecret(PINNED_TEST_SECRET);

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-pack-e2e-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface BuiltPack {
  readonly manifest: PackManifest;
  readonly payload: Record<string, Uint8Array>;
  readonly archive: Uint8Array;
}

interface BuildOptions {
  readonly version?: string;
  /** The bytes the archive carries, when they must differ from the signed manifest. */
  readonly archiveFiles?: Record<string, Uint8Array>;
}

/** The pack's payload: an entry, the declared export entry and nothing else. */
function payloadFor(version: string): Record<string, Uint8Array> {
  return {
    "index.html": encoder.encode(`<!doctype html><title>${PACK_ID} ${version}</title>`),
    "export.html": encoder.encode(`<!doctype html><title>${PACK_ID} export ${version}</title>`),
  };
}

/**
 * Build and sign a small pack the way the release signer does.
 *
 * `digestPackFiles` hashes every payload file into the manifest, the Ed25519
 * signature covers the canonical manifest bytes and `buildPackArchive` writes
 * the archive the installer reads. The pack declares one document at schema 1
 * and one export entry, so the host has a format to stamp and an entry to call.
 */
async function buildPack(options: BuildOptions = {}): Promise<BuiltPack> {
  const version = options.version ?? "1.0.0";
  const payload = payloadFor(version);
  const core: PackManifestCore = {
    format: PACK_FORMAT,
    id: PACK_ID,
    name: "Session demo",
    version,
    entry: "index.html",
    contractVersion: 1,
    publisher: { id: "suite", key: PINNED_TEST_PUBLIC },
    capabilities: ["documents"],
    documents: [{ id: "note", format: "suite.note", version: 1, mode: "single" }],
    export: { entry: "export.html" },
    files: await digestPackFiles(payload),
  };
  const manifest: PackManifest = {
    ...core,
    signature: signPackManifest(core, PINNED_TEST_SECRET),
  };
  return {
    manifest,
    payload,
    archive: buildPackArchive(manifest, options.archiveFiles ?? payload),
  };
}

/** The trust a host preinstalled with this test's pinned key would carry. */
function trust(): PackTrustOptions {
  return {
    publishers: [{ id: "suite", key: PINNED_TEST_PUBLIC, source: "preinstalled" }],
    hostContractVersion: 1,
    hostVersion: 1,
    hostCapabilities: ["documents", "files", "network"],
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The headless half of a pack session.
 *
 * `main.ts` builds one `DocumentStore` per publisher (`documentsFor`) and its
 * document IPC handlers add the capability and declared-schema rules; this is
 * those same lines without Electron. The container and pack ids are fixed by
 * the host, never supplied by a pack, exactly as the sender mapping does it.
 */
interface PackSession {
  readonly store: DocumentStore;
  create(id: string): Promise<DocumentSummary>;
  save(id: string, bytes: Uint8Array): Promise<DocumentSummary>;
  open(id: string): Promise<DocumentRecord | null>;
}

function openPackSession(pack: InstalledPackInfo, dataRoot: string): PackSession {
  if (!packAllows(pack, "documents")) {
    throw new Error(`${pack.id} does not hold the documents capability`);
  }
  const publisherId = pack.publisher.id;
  const store = new DocumentStore(
    documentsRootFor(dataRoot, publisherId),
    publisherId,
    documentScopeLabel(publisherId),
  );
  const schemaFor = (id: string): number => declaredDocumentSchemaVersion(pack.documents, id);

  return {
    store,
    create: (id) =>
      store.create(DEFAULT_CONTAINER_ID, pack.id, id, { schemaVersion: schemaFor(id) }),
    save: (id, bytes) =>
      store.save(DEFAULT_CONTAINER_ID, pack.id, id, bytes, { schemaVersion: schemaFor(id) }),
    open: (id) => store.open(DEFAULT_CONTAINER_ID, pack.id, id, { schemaVersion: schemaFor(id) }),
  };
}

describe("a pack end to end, headlessly", () => {
  it("installs, opens, writes through the envelope, exports and imports the same content", async () => {
    // spec: S6.1, S6.8
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    const built = await buildPack();

    const installed = await installPackArchive(built.archive, packsRoot, trust());
    expect(installed).toMatchObject({
      id: PACK_ID,
      version: "1.0.0",
      source: "installed",
      publisher: { id: "suite" },
    });
    expect(installed.documents).toEqual([
      { id: "note", format: "suite.note", version: 1, mode: "single" },
    ]);

    // The loaded scan is what a session opens from, not the install return.
    const scan = await loadInstalledPacks(packsRoot, trust());
    expect(scan.issues).toEqual([]);
    expect(scan.packs.map((pack) => pack.version)).toEqual(["1.0.0"]);
    const opened = scan.packs[0];
    if (opened === undefined) throw new Error("the installed pack did not load");

    // Open: the entry resolves from the installed version, the way the
    // `suite-pack://` handler resolves it before a view loads it.
    const request = resolvePackRequest(packUrl(opened.id, opened.entry), [opened]);
    expect(request).not.toBeNull();
    if (request === null) throw new Error("the installed entry did not resolve");
    expect(await readFile(request.file, "utf8")).toContain(`${PACK_ID} 1.0.0`);

    const session = openPackSession(opened, dataRoot);
    const payload = encoder.encode(
      JSON.stringify({ title: "A note", body: "the first pack end to end", tags: ["proof"] }),
    );

    await session.create("note");
    await session.save("note", payload);

    // The write crossed the host envelope, not a raw pack file: the header names
    // the host's publisher, the pack, the declared schema and the payload hash.
    const header = await session.store.header(DEFAULT_CONTAINER_ID, PACK_ID, "note");
    expect(header).toMatchObject({
      publisher: "suite",
      packId: PACK_ID,
      documentId: "note",
      schemaVersion: 1,
      payloadLength: payload.byteLength,
      payloadChecksum: `sha256:${digest(payload)}`,
    });
    const envelope = new Uint8Array(
      await readFile(join(dataRoot, "documents", DEFAULT_CONTAINER_ID, PACK_ID, "note")),
    );
    expect(new TextDecoder().decode(envelope.subarray(0, 8))).toBe("SUITEDOC");
    expect((await session.open("note"))?.bytes).toEqual(payload);

    // Export: the pack's export entry writes the document it holds; the host
    // writes the bundle manifest and verifies the bytes it recorded.
    const exportRoot = await temporaryRoot();
    const bundle = join(exportRoot, "bundle");
    const exportEntry = built.manifest.export;
    if (exportEntry === undefined) throw new Error("the fixture pack declares no export entry");
    const exported = await new ExportBundle(new BlobStores(join(exportRoot, "blobs"))).export(
      { containerId: DEFAULT_CONTAINER_ID, packId: PACK_ID },
      { id: opened.id, version: opened.version, export: exportEntry },
      bundle,
      {
        export: async (entry, save) => {
          expect(entry).toBe(exportEntry.entry);
          const record = await session.open("note");
          if (record === null) throw new Error("the note vanished before export");
          await save.write("note.json", record.bytes);
        },
      },
    );
    expect(exported.packExport).toBe(exportEntry.entry);
    expect(exported.documents).toEqual([
      { path: "note.json", sha256: digest(payload), bytes: payload.byteLength },
    ]);
    const exportedBytes = new Uint8Array(await readFile(join(bundle, "note.json")));
    expect(exportedBytes).toEqual(payload);

    // Import: a second install and a second data root. The pack's import entry
    // would read the bundle and write through the same host handle; this is that
    // write, with no display in between.
    const importRoot = await temporaryRoot();
    const imported = await installPackArchive(built.archive, join(importRoot, "packs"), trust());
    const importSession = openPackSession(imported, importRoot);
    await importSession.create("note");
    await importSession.save("note", exportedBytes);

    const reimported = await importSession.open("note");
    expect(reimported?.bytes).toEqual(payload);
    expect(await importSession.store.header(DEFAULT_CONTAINER_ID, PACK_ID, "note")).toMatchObject({
      publisher: "suite",
      packId: PACK_ID,
      documentId: "note",
      schemaVersion: 1,
    });
  });

  it("keeps the previous version installed when an update fails verification", async () => {
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    const first = await buildPack({ version: "1.0.0" });
    await installPackArchive(first.archive, packsRoot, trust());

    // A correctly signed 1.1.0 manifest over different bytes: the signature is
    // valid, the file hashes are not, so the archive must be refused.
    const update = await buildPack({ version: "1.1.0" });
    const tampered = buildPackArchive(update.manifest, {
      ...update.payload,
      "index.html": encoder.encode("<!doctype html><title>not what was signed</title>"),
    });

    await expect(installPackArchive(tampered, packsRoot, trust())).rejects.toMatchObject({
      reason: "files",
      id: PACK_ID,
      version: "1.1.0",
    });

    const scan = await loadInstalledPacks(packsRoot, trust());
    expect(scan.issues).toEqual([]);
    expect(scan.packs.map((pack) => pack.version)).toEqual(["1.0.0"]);
    expect(scan.versions.map((version) => version.version)).toEqual(["1.0.0"]);
    expect(await readdir(join(packsRoot, PACK_ID))).toEqual(["1.0.0", "publisher.json"]);
    expect(await readFile(join(packsRoot, PACK_ID, "1.0.0", "index.html"), "utf8")).toContain(
      `${PACK_ID} 1.0.0`,
    );
  });

  it("refuses an archive whose SHA-256 no longer matches its index entry, before extraction", async () => {
    // spec: S12.7
    const dataRoot = await temporaryRoot();
    const packsRoot = join(dataRoot, "packs");
    await mkdir(packsRoot);
    const built = await buildPack();

    // The index was verified against this archive, so the catalogue lists it.
    let served = built.archive;
    const index: VerifiedCatalogueIndex = {
      packs: [
        {
          id: PACK_ID,
          name: "Session demo",
          version: "1.0.0",
          description: null,
          capabilities: ["documents"],
          sizeBytes: built.archive.byteLength,
          sha256: digest(built.archive),
          readArchive: async () => served,
        },
      ],
    };
    const entries = await loadCatalogue(join(dataRoot, "catalogue"), trust(), index);
    const entry = entries[0];
    if (entry === undefined) throw new Error("the index entry did not list");
    expect(entry).toMatchObject({ id: PACK_ID, version: "1.0.0", trusted: true });

    // The bytes behind the entry change after the listing, as a replaced or
    // damaged file would. The installer must compare the digest again.
    served = (await buildPack({ version: "9.9.9" })).archive;
    await expect(installCataloguePack(entry, packsRoot, trust())).rejects.toMatchObject({
      reason: "invalid",
      message: expect.stringContaining("no longer matches"),
    });

    // Nothing was extracted: no version directory and no temporary sibling.
    expect(await readdir(packsRoot)).toEqual([]);
  });
});
