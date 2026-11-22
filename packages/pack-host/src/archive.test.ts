import {
  digestPackFiles,
  generatePackKeyPair,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  parsePackManifest,
  sha256Hex,
  signPackManifest,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  buildPackArchive,
  PackArchiveError,
  type PackArchiveErrorCode,
  readPackArchive,
} from "./archive.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A signed pack with a throwaway key.
 *
 * The real pin is never used here: a test that signed with it would need the release secret, and a
 * test that verified with it would pass only while the shipped key happened to be the one on the
 * machine. Generated keys keep the archive contract independent of the trust root.
 */
async function signedPack(): Promise<{
  readonly manifest: PackManifest;
  readonly files: Record<string, Uint8Array>;
  readonly publicKey: string;
}> {
  const files: Record<string, Uint8Array> = {
    "index.html": encoder.encode("<!doctype html><title>Demo</title>"),
    "assets/app.js": encoder.encode("console.log('demo');"),
  };
  const keys = await generatePackKeyPair();
  const core: PackManifestCore = {
    format: PACK_FORMAT,
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    entry: "index.html",
    contractVersion: 1,
    capabilities: [] as const,
    files: await digestPackFiles(files),
  };
  return {
    manifest: { ...core, signature: signPackManifest(core, keys.secretKeyBase64) },
    files,
    publicKey: keys.publicKeyBase64,
  };
}

async function readCode(bytes: Uint8Array, limits?: Parameters<typeof readPackArchive>[1]) {
  try {
    await readPackArchive(bytes, limits);
    return undefined;
  } catch (error) {
    return error instanceof PackArchiveError ? error.code : undefined;
  }
}

function buildCode(
  manifest: PackManifest,
  files: Readonly<Record<string, Uint8Array>>,
): PackArchiveErrorCode | undefined {
  try {
    buildPackArchive(manifest, files);
    return undefined;
  } catch (error) {
    return error instanceof PackArchiveError ? error.code : undefined;
  }
}

/**
 * A zip whose local headers declare their sizes.
 *
 * `zipSync` takes a record, so it cannot write the same name twice. This writer can, which is the
 * only way to exercise the duplicate rule with a real archive. The central directory is present so
 * the reader's completeness check sees a finished archive; the CRC is zero because the reader does
 * not trust it either.
 */
function zipEntries(
  entries: readonly { readonly name: string; readonly bytes: Uint8Array }[],
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04_03_4b_50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, entry.bytes.byteLength, true);
    localView.setUint32(22, entry.bytes.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02_01_4b_50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, entry.bytes.byteLength, true);
    centralView.setUint32(24, entry.bytes.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.byteLength;
  }

  const localSize = locals.reduce((total, part) => total + part.byteLength, 0);
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0);
  const out = new Uint8Array(localSize + centralSize + 22);

  let cursor = 0;
  for (const part of [...locals, ...centrals]) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }

  const view = new DataView(out.buffer);
  view.setUint32(cursor, 0x06_05_4b_50, true);
  view.setUint16(cursor + 8, entries.length, true);
  view.setUint16(cursor + 10, entries.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, localSize, true);

  return out;
}

describe("pack archives", () => {
  it("round-trips a signed manifest and its files", async () => {
    const { manifest, files, publicKey } = await signedPack();
    const archive = buildPackArchive(manifest, files);
    const read = await readPackArchive(archive);

    const parsed = parsePackManifest(JSON.parse(decoder.decode(read.manifestBytes)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(await verifyPackSignature(parsed.value, publicKey)).toBe(true);
    expect(
      await verifyPackFiles(parsed.value, async (path) => read.files.get(path) ?? null),
    ).toEqual([]);
    expect([...read.files.keys()].sort()).toEqual(["assets/app.js", "index.html"]);
    expect(decoder.decode(read.files.get("index.html"))).toContain("Demo");
  });

  it("refuses paths that leave the pack", async () => {
    for (const path of ["../escape", "/absolute", "a/../../b", "a\\b", "dir/", "a\u0000b"]) {
      const archive = zipSync({ [path]: encoder.encode("no") });
      expect(await readCode(archive)).toBe("invalid-path");
    }
  });

  it("refuses a path that appears twice", async () => {
    const archive = zipEntries([
      { name: "manifest.json", bytes: encoder.encode("{}") },
      { name: "index.html", bytes: encoder.encode("one") },
      { name: "index.html", bytes: encoder.encode("two") },
    ]);
    expect(await readCode(archive)).toBe("duplicate-path");
  });

  it("requires one manifest at the root", async () => {
    const missing = zipEntries([{ name: "index.html", bytes: encoder.encode("no manifest") }]);
    expect(await readCode(missing)).toBe("missing-manifest");

    const twice = zipEntries([
      { name: "manifest.json", bytes: encoder.encode("{}") },
      { name: "manifest.json", bytes: encoder.encode("{}") },
    ]);
    expect(await readCode(twice)).toBe("duplicate-path");
  });

  it("refuses input that is not a zip", async () => {
    expect(await readCode(encoder.encode("not a zip"))).toBe("invalid-zip");
  });

  it("enforces the input, file, total and count limits", async () => {
    const { manifest, files } = await signedPack();
    const archive = buildPackArchive(manifest, files);

    expect(await readCode(archive, { maxArchiveBytes: archive.byteLength - 1 })).toBe("too-large");
    expect(await readCode(archive, { maxFileBytes: 1 })).toBe("too-large");
    expect(await readCode(archive, { maxTotalBytes: 1 })).toBe("too-large");
    expect(await readCode(archive, { maxFiles: 2 })).toBe("too-many-files");
  });

  it("refuses a manifest.json payload when building", async () => {
    const { manifest, files } = await signedPack();
    const withManifest = { ...files, "manifest.json": encoder.encode("{}") };
    expect(buildCode(manifest, withManifest)).toBe("duplicate-path");
    expect(buildCode(manifest, { "../escape": encoder.encode("no") })).toBe("invalid-path");
  });

  it("builds the same bytes when the clock moves", async () => {
    const { manifest, files } = await signedPack();
    let first: Uint8Array = new Uint8Array();
    let second: Uint8Array = new Uint8Array();

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      first = buildPackArchive(manifest, files);
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      second = buildPackArchive(manifest, files);
    } finally {
      vi.useRealTimers();
    }

    expect(second).toEqual(first);
    expect(await sha256Hex(second)).toBe(await sha256Hex(first));

    // The fixed timestamp is also still a readable archive.
    const read = await readPackArchive(first);
    expect([...read.files.keys()].sort()).toEqual(["assets/app.js", "index.html"]);
  });

  it("keeps a payload file named __proto__", async () => {
    const { manifest } = await signedPack();
    const files: Record<string, Uint8Array> = Object.create(null);
    files["index.html"] = encoder.encode("<!doctype html><title>Demo</title>");
    Object.defineProperty(files, "__proto__", {
      value: encoder.encode("proto payload"),
      enumerable: true,
    });

    const read = await readPackArchive(buildPackArchive(manifest, files));
    expect([...read.files.keys()].filter((path) => path === "__proto__")).toEqual(["__proto__"]);
    expect(decoder.decode(read.files.get("__proto__"))).toBe("proto payload");
  });
});
