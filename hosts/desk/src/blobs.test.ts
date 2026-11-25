import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackBlob } from "@suite/pack";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlobError, BlobStores } from "./blobs.js";

let root: string;
let stores: BlobStores;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desk-blobs-"));
  stores = new BlobStores(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const checksumOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const scope = { containerId: "default", packId: "note-pack" };
const otherScope = { containerId: "default", packId: "other-pack" };

const declarations: readonly PackBlob[] = [
  { store: "assets", class: "asset" },
  { store: "previews", class: "derived" },
  { store: "scratch", class: "cache" },
];

const blobPath = (...parts: string[]): string => join(root, "default", "note-pack", ...parts);

describe("blob classes", () => {
  // spec: S6.7
  it("keeps asset, derived and cache in separate pack-scoped stores", async () => {
    const asset = await stores.put(scope, declarations, "assets", encode("a photo"));
    const derived = await stores.put(scope, declarations, "previews", encode("a thumbnail"));
    const cache = await stores.put(scope, declarations, "scratch", encode("a search index"));

    expect([asset.class, derived.class, cache.class]).toEqual(["asset", "derived", "cache"]);
    expect(await readdir(blobPath("asset"))).toEqual([asset.sha256]);
    expect(await readdir(blobPath("derived"))).toEqual([derived.sha256]);
    expect(await readdir(blobPath("cache"))).toEqual([cache.sha256]);

    expect((await stores.get(scope, declarations, "assets", asset.sha256))?.data).toEqual(
      encode("a photo"),
    );
    expect((await stores.get(scope, declarations, "previews", derived.sha256))?.class).toBe(
      "derived",
    );
    expect((await stores.get(scope, declarations, "scratch", cache.sha256))?.class).toBe("cache");

    // A second pack at the same container has its own roots: the address alone
    // is not enough to read another pack's blob.
    expect(await stores.get(otherScope, declarations, "assets", asset.sha256)).toBeNull();
    expect(await stores.list(otherScope, declarations, "assets")).toEqual([]);
  });

  // spec: S2.2
  it("keeps two publishers' blobs apart under one pack id", async () => {
    const alpha = { ...scope, publisherId: "alpha" };
    const beta = { ...scope, publisherId: "beta" };

    const photo = await stores.put(alpha, declarations, "assets", encode("alpha's photo"));
    expect(await readdir(join(root, "default", "alpha~note-pack", "asset"))).toEqual([
      photo.sha256,
    ]);
    expect(await stores.list(beta, declarations, "assets")).toEqual([]);
    expect(await stores.get(beta, declarations, "assets", photo.sha256)).toBeNull();
    expect((await stores.get(alpha, declarations, "assets", photo.sha256))?.data).toEqual(
      encode("alpha's photo"),
    );

    // The first-party publisher keeps the pre-S2.1 directory, so an existing
    // install's blobs are not moved by the publisher scope.
    const firstParty = await stores.put(scope, declarations, "assets", encode("suite's photo"));
    expect(await readdir(blobPath("asset"))).toContain(firstParty.sha256);
  });

  // spec: S6.7
  it("addresses a blob by the SHA-256 of its bytes and refuses a corrupt copy", async () => {
    const bytes = encode("the original bytes");
    const first = await stores.put(scope, declarations, "assets", bytes);
    const again = await stores.put(scope, declarations, "assets", bytes);

    expect(first.sha256).toBe(checksumOf(bytes));
    expect(again.sha256).toBe(first.sha256);
    // Content addressing means one file for the same bytes, not a second copy.
    expect(await readdir(blobPath("asset"))).toEqual([first.sha256]);

    const different = await stores.put(scope, declarations, "assets", encode("different bytes"));
    expect(different.sha256).not.toBe(first.sha256);
    expect((await stores.list(scope, declarations, "assets")).map((blob) => blob.sha256)).toEqual(
      [different.sha256, first.sha256].sort((left, right) => left.localeCompare(right)),
    );

    // A file that no longer hashes to its name is not the blob it claims to be.
    await writeFile(blobPath("asset", first.sha256), encode("tampered"));
    await expect(stores.get(scope, declarations, "assets", first.sha256)).rejects.toMatchObject({
      kind: "corrupt",
    });
  });

  // spec: S6.7
  it("clearing the cache leaves every asset and derived blob intact", async () => {
    const assetBytes = encode("a person's photo");
    const derivedBytes = encode("a generated thumbnail");
    const cacheBytes = encode("a disposable index");

    const asset = await stores.put(scope, declarations, "assets", assetBytes);
    const derived = await stores.put(scope, declarations, "previews", derivedBytes);
    await stores.put(scope, declarations, "scratch", cacheBytes);

    expect(await stores.clearCache(scope, declarations)).toBe(1);

    expect(await stores.get(scope, declarations, "scratch", checksumOf(cacheBytes))).toBeNull();
    expect(await stores.list(scope, declarations, "scratch")).toEqual([]);
    expect((await stores.get(scope, declarations, "assets", asset.sha256))?.data).toEqual(
      assetBytes,
    );
    expect((await stores.get(scope, declarations, "previews", derived.sha256))?.data).toEqual(
      derivedBytes,
    );
    // The cache is gone from disk, not just from the listing.
    expect(await readdir(blobPath("cache")).catch(() => [])).toEqual([]);
  });

  // spec: S6.7
  it("refuses a store the pack did not declare", async () => {
    const refused = await stores
      .put(scope, declarations, "elsewhere", encode("bytes"))
      .catch((error) => error);
    expect(refused).toBeInstanceOf(BlobError);
    expect((refused as BlobError).kind).toBe("undeclared");

    const read = await stores
      .get(scope, declarations, "elsewhere", "a".repeat(64))
      .catch((error) => error);
    expect((read as BlobError).kind).toBe("undeclared");
  });
});
