import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackBlob } from "@suite/pack";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlobStores } from "./blobs.js";
import {
  ExportBundle,
  type ExportBundleError,
  type ExportBundleErrorKind,
  type ExportEntryRunner,
  type ExportPack,
} from "./exportBundle.js";

let root: string;
let stores: BlobStores;
let destination: string;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const checksumOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const scope = { containerId: "default", packId: "note-pack" };
const declarations: readonly PackBlob[] = [
  { store: "assets", class: "asset" },
  { store: "previews", class: "derived" },
  { store: "scratch", class: "cache" },
];
const pack: ExportPack = {
  id: "note-pack",
  version: "1.2.0",
  blobs: declarations,
  export: { entry: "export.html" },
};

/** The fixture pack's declared export entry: two documents through the host handle. */
function runner(calls: string[] = []): ExportEntryRunner {
  return {
    export: async (entry, save) => {
      calls.push(entry);
      await save.write("document.json", encode('{"title":"A note"}'));
      await save.write("reports/summary.md", encode("# Summary\n"));
    },
  };
}

function failingEntry(error: unknown): ExportEntryRunner {
  return {
    export: async () => {
      throw error;
    },
  };
}

function writes(path: string): ExportEntryRunner {
  return {
    export: async (_entry, save) => {
      await save.write(path, encode("bytes"));
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-shell-export-"));
  stores = new BlobStores(join(root, "blobs"));
  destination = join(root, "bundle");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("export bundle", () => {
  // spec: S6.8
  it("exports every asset as original bytes with a manifest entry and a verified hash", async () => {
    const sources = new Map<string, Uint8Array>();
    for (const text of ["the first photo", "a second attachment"]) {
      const entry = await stores.put(scope, declarations, "assets", encode(text));
      sources.set(entry.sha256, encode(text));
    }
    // Neither is exported: derived is not exported by default and cache is disposable.
    await stores.put(scope, declarations, "previews", encode("a generated thumbnail"));
    await stores.put(scope, declarations, "scratch", encode("a disposable index"));

    const calls: string[] = [];
    const manifest = await new ExportBundle(stores).export(scope, pack, destination, runner(calls));

    expect(calls).toEqual(["export.html"]);
    expect(manifest.format).toBe("suite.export");
    expect(manifest.version).toBe(1);
    expect(manifest.pack).toEqual({ id: "note-pack", version: "1.2.0" });
    expect(manifest.packExport).toBe("export.html");
    expect(manifest.documents.map((document) => document.path)).toEqual([
      "document.json",
      "reports/summary.md",
    ]);
    expect(manifest.assets).toHaveLength(2);
    expect(manifest.assets.every((asset) => asset.store === "assets")).toBe(true);

    // Every asset is its original bytes at assets/<sha256>, and every manifest
    // hash is the hash of the file on disk.
    for (const asset of manifest.assets) {
      expect(asset.path).toBe(`assets/${asset.sha256}`);
      const written = new Uint8Array(await readFile(join(destination, ...asset.path.split("/"))));
      expect(written).toEqual(sources.get(asset.sha256) ?? new Uint8Array());
      expect(checksumOf(written)).toBe(asset.sha256);
      expect(written.byteLength).toBe(asset.bytes);
    }
    expect((await readdir(join(destination, "assets"))).sort()).toEqual(
      manifest.assets.map((asset) => asset.sha256).sort(),
    );

    // The documents the pack entry wrote are in the manifest with their own hashes.
    for (const document of manifest.documents) {
      const written = new Uint8Array(
        await readFile(join(destination, ...document.path.split("/"))),
      );
      expect(checksumOf(written)).toBe(document.sha256);
      expect(written.byteLength).toBe(document.bytes);
    }

    // The manifest on disk is the manifest the host returned, and it names the
    // files that exist rather than anything the pack claimed.
    const onDisk = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    expect(onDisk).toEqual(manifest);
  });

  // spec: S6.8
  it("exports assets anyway when the pack declares no export entry", async () => {
    const asset = await stores.put(scope, declarations, "assets", encode("a person's photo"));
    const withoutEntry: ExportPack = {
      id: "note-pack",
      version: "1.2.0",
      blobs: declarations,
    };

    const manifest = await new ExportBundle(stores).export(
      scope,
      withoutEntry,
      destination,
      failingEntry(new Error("the pack declares no export entry, so nothing may run")),
    );

    // The decision: an omitted export entry does not strand the assets. The
    // manifest records the omission instead of pretending a document exported.
    expect(manifest.packExport).toBeNull();
    expect(manifest.documents).toEqual([]);
    expect(manifest.assets).toEqual([
      {
        path: `assets/${asset.sha256}`,
        store: "assets",
        sha256: asset.sha256,
        bytes: encode("a person's photo").byteLength,
      },
    ]);
    expect((await readdir(destination)).sort()).toEqual(["assets", "manifest.json"]);
    const onDisk = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    expect(onDisk.packExport).toBeNull();
    expect(onDisk.assets).toHaveLength(1);
  });

  // spec: S6.8
  it("refuses an export entry that writes outside the bundle or over a host name", async () => {
    const cases: readonly (readonly [string, ExportBundleErrorKind])[] = [
      ["../escape.json", "invalid-path"],
      ["/tmp/escape.json", "invalid-path"],
      ["a\\b.json", "invalid-path"],
      ["manifest.json", "reserved-name"],
      ["assets/x", "reserved-name"],
    ];

    for (const [index, [path, kind]] of cases.entries()) {
      const target = join(root, `case-${index}`);
      const refused = await new ExportBundle(stores)
        .export(scope, pack, target, writes(path))
        .catch((error) => error);
      expect(refused).toBeInstanceOf(Error);
      expect((refused as ExportBundleError).kind).toBe(kind);
    }

    const duplicate: ExportEntryRunner = {
      export: async (_entry, save) => {
        await save.write("same.json", encode("first"));
        await save.write("same.json", encode("second"));
      },
    };
    const refused = await new ExportBundle(stores)
      .export(scope, pack, join(root, "duplicate"), duplicate)
      .catch((error) => error);
    expect((refused as ExportBundleError).kind).toBe("duplicate");
  });

  // spec: S6.8
  it("writes no manifest when the pack's export entry fails", async () => {
    const refused = await new ExportBundle(stores)
      .export(scope, pack, destination, failingEntry(new Error("the pack's format broke")))
      .catch((error) => error);

    expect(refused).toBeInstanceOf(Error);
    expect((refused as ExportBundleError).kind).toBe("failed");
    expect((refused as ExportBundleError).message).toContain("export.html");
    const written = await stat(join(destination, "manifest.json")).then(
      () => true,
      () => false,
    );
    expect(written).toBe(false);
  });
});
