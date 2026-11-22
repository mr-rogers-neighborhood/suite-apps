import { describe, expect, it } from "vitest";
import {
  digestPackFiles,
  generatePackKeyPair,
  PACK_CONTRACT_VERSION,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  parsePackManifest,
  sha256Hex,
  signPackManifest,
  verifyPackFiles,
  verifyPackSignature,
} from "./index.js";

const encoder = new TextEncoder();

async function core(): Promise<PackManifestCore> {
  const files = {
    "index.html": encoder.encode("<!doctype html><title>Canvas</title>"),
    "assets/app.js": encoder.encode("console.log('canvas')"),
  };
  return {
    format: PACK_FORMAT,
    id: "canvas",
    name: "Canvas",
    version: "0.2.0",
    entry: "index.html",
    contractVersion: PACK_CONTRACT_VERSION,
    capabilities: ["files", "relay"],
    files: await digestPackFiles(files),
  };
}

describe("pack signatures", () => {
  it("signs and verifies a manifest", async () => {
    const keys = await generatePackKeyPair();
    const unsigned = await core();
    const signature = signPackManifest(unsigned, keys.secretKeyBase64);
    const signed: PackManifest = { ...unsigned, signature };

    expect(await verifyPackSignature(signed, keys.publicKeyBase64)).toBe(true);
  });

  it("refuses a changed capability or signature", async () => {
    const keys = await generatePackKeyPair();
    const unsigned = await core();
    const signed: PackManifest = {
      ...unsigned,
      signature: signPackManifest(unsigned, keys.secretKeyBase64),
    };

    expect(
      await verifyPackSignature(
        { ...signed, capabilities: ["files", "relay", "network"] },
        keys.publicKeyBase64,
      ),
    ).toBe(false);
    expect(await verifyPackSignature({ ...signed, signature: "AAAA" }, keys.publicKeyBase64)).toBe(
      false,
    );
  });
});

describe("pack files", () => {
  it("digests and verifies the exact files", async () => {
    const unsigned = await core();
    const signed: PackManifest = {
      ...unsigned,
      signature: (await generatePackKeyPair()).publicKeyBase64,
    };
    const files: Record<string, Uint8Array> = {
      "index.html": encoder.encode("<!doctype html><title>Canvas</title>"),
      "assets/app.js": encoder.encode("console.log('canvas')"),
    };

    expect(await verifyPackFiles(signed, async (path) => files[path] ?? null)).toEqual([]);
  });

  it("reports a missing file, a size change and a hash change", async () => {
    const unsigned = await core();
    const signed: PackManifest = {
      ...unsigned,
      signature: (await generatePackKeyPair()).publicKeyBase64,
    };
    const files: Record<string, Uint8Array> = {
      "index.html": encoder.encode("short"),
      "assets/app.js": encoder.encode("console.log('canva5')"),
    };

    const mismatches = await verifyPackFiles(signed, async (path) => files[path] ?? null);
    expect(mismatches.map((entry) => entry.reason).sort()).toEqual(["hash", "size"]);
  });

  it("orders digests by code unit, not by locale", async () => {
    const digests = await digestPackFiles({
      "z.html": encoder.encode("z"),
      "ä.html": encoder.encode("a-umlaut"),
      "ab.html": encoder.encode("ab"),
    });
    expect(digests.map((file) => file.path)).toEqual(["ab.html", "z.html", "ä.html"]);
  });

  it("digests a file named __proto__", async () => {
    // A plain object drops this key by changing its prototype; a prototype-free record keeps it.
    const files: Record<string, Uint8Array> = Object.create(null);
    files["index.html"] = encoder.encode("<!doctype html><title>Proto</title>");
    Object.defineProperty(files, "__proto__", {
      value: encoder.encode("payload"),
      enumerable: true,
    });

    const digests = await digestPackFiles(files);
    expect(digests.map((file) => file.path)).toEqual(["__proto__", "index.html"]);
  });

  it("hashes bytes as lower-case hex", async () => {
    expect(await sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("parsed signed manifests", () => {
  it("round-trips through the parser", async () => {
    const keys = await generatePackKeyPair();
    const unsigned = await core();
    const signed: PackManifest = {
      ...unsigned,
      signature: signPackManifest(unsigned, keys.secretKeyBase64),
    };

    const parsed = parsePackManifest(JSON.parse(JSON.stringify(signed)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(await verifyPackSignature(parsed.value, keys.publicKeyBase64)).toBe(true);
  });
});
