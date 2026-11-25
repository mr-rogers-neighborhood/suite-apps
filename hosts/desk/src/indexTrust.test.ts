import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generatePackKeyPair,
  PACK_INDEX_FORMAT,
  PACK_INDEX_VERSION,
  type PackIndexCore,
  type PackIndexEntry,
  packIndexDigest,
  sha256Hex,
  signPackIndex,
} from "@suite/pack";
import { afterEach, describe, expect, it } from "vitest";
import { installCataloguePack, loadCatalogue } from "./catalogue.js";
import {
  catalogueIndexUrlFor,
  DEFAULT_CATALOGUE_INDEX_URL,
  loadCatalogueIndex,
  readCatalogueIndexHead,
  writeCatalogueIndexHead,
} from "./indexTrust.js";
import type { PackTrustOptions } from "./installedPacks.js";

const encoder = new TextEncoder();
const roots: string[] = [];
const NOW = new Date("2026-11-24T00:00:00.000Z");
const INDEX_URL = "https://flatpak.suite.run/index.json";
const ARCHIVE_URL = "https://flatpak.suite.run/packs/demo-1.0.0.suitepack";

const trust: PackTrustOptions = {
  publishers: [],
  hostContractVersion: 1,
  hostVersion: 1,
  hostCapabilities: [],
};

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-desk-index-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Fixture {
  readonly core: PackIndexCore;
  readonly archive: Uint8Array;
}

async function fixture(overrides: Partial<PackIndexCore> = {}): Promise<Fixture> {
  const archive = encoder.encode("a pack archive, not inspected by this module");
  const entry: PackIndexEntry = {
    id: "demo",
    name: "Demo",
    publisher: "suite",
    version: "1.0.0",
    capabilities: [],
    size: archive.byteLength,
    sha256: await sha256Hex(archive),
    url: ARCHIVE_URL,
  };
  return {
    core: {
      format: PACK_INDEX_FORMAT,
      version: PACK_INDEX_VERSION,
      sequence: 1,
      generatedAt: "2026-11-20T00:00:00.000Z",
      expires: "2026-12-20T00:00:00.000Z",
      threshold: 1,
      entries: [entry],
      ...overrides,
    },
    archive,
  };
}

function fetcher(files: Readonly<Record<string, Uint8Array | string>>): typeof fetch {
  return async (input) => {
    const body = files[String(input)];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body as unknown as BodyInit, { status: 200 });
  };
}

describe("the catalogue index source", () => {
  it("defaults to the published index and can be turned off for the local directory", () => {
    expect(catalogueIndexUrlFor({})).toBe(DEFAULT_CATALOGUE_INDEX_URL);
    expect(catalogueIndexUrlFor({ SUITE_DESK_INDEX: "none" })).toBeNull();
    expect(catalogueIndexUrlFor({ SUITE_DESK_INDEX: "local" })).toBeNull();
    expect(catalogueIndexUrlFor({ SUITE_DESK_INDEX: "https://example.test/index.json" })).toBe(
      "https://example.test/index.json",
    );
  });
});

describe("loading a verified index", () => {
  it("verifies a signed index, records its head and exposes its entries", async () => {
    // spec: S12.2
    const operator = await generatePackKeyPair();
    const { core, archive } = await fixture();
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const headRoot = await temporaryRoot();

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot,
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index), [ARCHIVE_URL]: archive }),
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.sequence).toBe(1);
    expect(loaded.index.packs).toHaveLength(1);
    expect(loaded.index.packs[0]).toMatchObject({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      sizeBytes: archive.byteLength,
    });
    expect(await loaded.index.packs[0]?.readArchive()).toEqual(archive);
    expect(await readCatalogueIndexHead(headRoot)).toEqual({
      sequence: 1,
      digest: await packIndexDigest(index),
    });
  });

  it("refuses an index whose bytes changed after signing", async () => {
    // spec: S12.2
    const operator = await generatePackKeyPair();
    const { core } = await fixture();
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const tampered = {
      ...index,
      entries: [{ ...index.entries[0], name: "Changed after signing" }],
    };

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot: await temporaryRoot(),
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(tampered) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("changed after it was signed");
  });

  it("refuses an unsigned index", async () => {
    // spec: S12.2
    const operator = await generatePackKeyPair();
    const { core } = await fixture();
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const unsigned = { ...index, signatures: [] };

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot: await temporaryRoot(),
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(unsigned) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("unsigned");
  });

  it("refuses an index signed by an operator key this host does not pin", async () => {
    // spec: S12.2
    const pinned = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    const { core } = await fixture();
    const index = signPackIndex(core, [other.secretKeyBase64]);

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot: await temporaryRoot(),
      operatorKeys: [pinned.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("does not pin");
  });

  it("refuses an expired index", async () => {
    // spec: S12.2
    const operator = await generatePackKeyPair();
    const { core } = await fixture({
      generatedAt: "2026-10-01T00:00:00.000Z",
      expires: "2026-10-02T00:00:00.000Z",
    });
    const index = signPackIndex(core, [operator.secretKeyBase64]);

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot: await temporaryRoot(),
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("expired");
  });

  it("refuses a lower sequence than the trusted head", async () => {
    // spec: S12.2
    const operator = await generatePackKeyPair();
    const previous = "a".repeat(64);
    const { core } = await fixture({ sequence: 2, previous });
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const headRoot = await temporaryRoot();
    await writeCatalogueIndexHead(headRoot, { sequence: 3, digest: previous });

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot,
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("cannot move backwards");
  });

  it("accepts a refetch of the index it already trusts", async () => {
    // spec: S12.2 — the same sequence with the same bytes is a relaunch, not a
    // replay. Refusing it makes the catalogue work once and then fail.
    const operator = await generatePackKeyPair();
    const { core } = await fixture({ sequence: 4, previous: "a".repeat(64) });
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const headRoot = await temporaryRoot();
    const load = () =>
      loadCatalogueIndex({
        url: INDEX_URL,
        headRoot,
        operatorKeys: [operator.publicKeyBase64],
        now: NOW,
        fetch: fetcher({ [INDEX_URL]: JSON.stringify(index) }),
      });

    const first = await load();
    expect(first).toMatchObject({ ok: true });
    const second = await load();
    expect(second).toMatchObject({ ok: true });
  });

  it("refuses the same sequence with different bytes as an equivocation", async () => {
    // spec: S12.2 — a publisher rewriting a sequence is refused, and the refusal
    // has to reach the person with the reason, not the generic chain sentence.
    const operator = await generatePackKeyPair();
    const { core } = await fixture({ sequence: 4, previous: "a".repeat(64) });
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const headRoot = await temporaryRoot();
    await writeCatalogueIndexHead(headRoot, { sequence: 4, digest: "b".repeat(64) });

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot,
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("cannot rewrite a sequence");
  });

  it("refuses a previous that names another index", async () => {
    // spec: S12.2
    const operator = await generatePackKeyPair();
    const { core } = await fixture({ sequence: 2, previous: "c".repeat(64) });
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const headRoot = await temporaryRoot();
    await writeCatalogueIndexHead(headRoot, { sequence: 1, digest: "b".repeat(64) });

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot,
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index) }),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("does not name the digest");
  });

  it("refuses an archive whose bytes do not match the verified entry before extraction", async () => {
    // spec: S12.7
    const operator = await generatePackKeyPair();
    const { core } = await fixture();
    const index = signPackIndex(core, [operator.secretKeyBase64]);
    const changed = encoder.encode("archive bytes that are not what the index names");
    const packsRoot = await temporaryRoot();

    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot: await temporaryRoot(),
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      fetch: fetcher({ [INDEX_URL]: JSON.stringify(index), [ARCHIVE_URL]: changed }),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const entries = await loadCatalogue(await temporaryRoot(), trust, loaded.index);
    expect(entries[0]).toMatchObject({ trusted: false, reason: "invalid" });
    expect(entries[0]?.refusal).toContain("does not match");

    const entry = entries[0];
    if (entry === undefined) throw new Error("missing catalogue entry");
    await expect(installCataloguePack(entry, packsRoot, trust)).rejects.toMatchObject({
      reason: "invalid",
    });
    expect(await readdir(packsRoot)).toEqual([]);
  });

  it("reports an unreachable index without refusing the local directory", async () => {
    // spec: S12.1
    const loaded = await loadCatalogueIndex({
      url: INDEX_URL,
      headRoot: await temporaryRoot(),
      now: NOW,
      fetch: fetcher({}),
    });

    expect(loaded).toMatchObject({ ok: false, reason: "unreachable" });
    if (loaded.ok) return;
    expect(loaded.message).toContain("could not be fetched");
  });
});
