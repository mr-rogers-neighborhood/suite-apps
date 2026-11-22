import { bytesToBase64, canonicalManifestBytes, type PackManifest } from "@suite/go";
import { describe, expect, it, vi } from "vitest";

/**
 * The pack loader is a trust boundary.
 *
 * Two paths matter: `install` refuses an arriving archive, and `discover` re-verifies what is
 * already on disk so a pack edited after install is refused rather than launched. The fake
 * filesystem below is deliberately small; every refusal is reachable through it without a device.
 */

/** What is "on disk", in the shape the Filesystem plugin would hand back. */
const disk = new Map<string, Uint8Array>();
/** Paths the fake reports as links, for the non-regular-entry refusal on load. */
const links = new Set<string>();

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    async readdir({ path }: { path: string }) {
      const prefix = `${path}/`;
      const names = new Map<string, string>();
      for (const key of disk.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0] as string;
        if (name.length === 0) continue;
        names.set(name, rest.includes("/") ? "directory" : links.has(key) ? "symlink" : "file");
      }
      if (names.size === 0) throw new Error("no such directory");
      return { files: [...names].map(([name, type]) => ({ name, type })) };
    },
    async readFile({ path }: { path: string }) {
      const bytes = disk.get(path);
      if (bytes === undefined) throw new Error(`no file ${path}`);
      return { data: bytesToBase64(bytes) };
    },
    async writeFile({ path, data }: { path: string; data: string }) {
      disk.set(
        path,
        Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      );
      links.delete(path);
    },
    async getUri({ path }: { path: string }) {
      return { uri: `file:///data/user/0/app/files/${path}` };
    },
    async mkdir() {},
    async rmdir({ path }: { path: string }) {
      for (const key of [...disk.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) disk.delete(key);
      }
      for (const key of [...links]) {
        if (key === path || key.startsWith(`${path}/`)) links.delete(key);
      }
    },
  },
}));

// `packArchive` and `manifestFiles` are the writer half of the same store, which is the point: the
// test builds its packs with the app's own code rather than a second implementation of the format.
const { createPackStore, manifestFiles, packArchive } = await import("./packs.js");

const encoder = new TextEncoder();

/** A keypair for this file, so nothing depends on the key baked into the app. */
const pair = await (async () => {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return { keys, publicKey: bytesToBase64(raw) };
})();

async function signedManifest(
  html: string,
  capabilities: PackManifest["capabilities"] = ["documents"],
): Promise<{ manifest: PackManifest; files: Record<string, Uint8Array> }> {
  const files = { "index.html": encoder.encode(html) };
  const core = {
    format: "suite.pack" as const,
    id: "probe",
    name: "Probe",
    version: "1.0.0",
    entry: "index.html",
    contractVersion: 1,
    independent: false,
    isolation: "isolated" as const,
    capabilities,
    files: await manifestFiles(files),
  };
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    pair.keys.privateKey,
    canonicalManifestBytes(core) as BufferSource,
  );
  return {
    manifest: { ...core, signature: bytesToBase64(new Uint8Array(signature)) },
    files,
  };
}

const sealed = `<!doctype html><meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; connect-src 'self'"><div id="root"></div>`;
const unsealed = '<!doctype html><div id="root"></div>';

function store(
  options: Partial<Parameters<typeof createPackStore>[0]> = {},
): ReturnType<typeof createPackStore> {
  return createPackStore({
    publicKey: pair.publicKey,
    contractVersion: 1,
    hostVersion: 1,
    ...options,
  });
}

/**
 * A zip whose entries this test controls.
 *
 * `zipSync` takes a record, so it cannot write the same name twice or set a Unix mode. Both are
 * needed to reach the duplicate and symlink rules with a real archive. The central directory is
 * present so the reader's completeness check sees a finished archive; the CRC is zero because the
 * reader does not trust it either.
 */
function zipEntries(
  entries: readonly {
    readonly name: string;
    readonly bytes: Uint8Array;
    /** A Unix file mode, to write into the central directory only. */
    readonly unixMode?: number;
  }[],
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
    localView.setUint32(18, entry.bytes.byteLength, true);
    localView.setUint32(22, entry.bytes.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02_01_4b_50, true);
    centralView.setUint16(4, entry.unixMode === undefined ? 20 : 0x03_1e, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, entry.bytes.byteLength, true);
    centralView.setUint32(24, entry.bytes.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    if (entry.unixMode !== undefined) {
      centralView.setUint32(38, (entry.unixMode << 16) >>> 0, true);
    }
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

describe("the network rule, through the pack store", () => {
  it("installs a pack that seals the network itself", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const outcome = await store().install(packArchive(manifest, files));
    expect(outcome).toMatchObject({ ok: true });
  });

  it("refuses a pack that does not, and names what is missing", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(unsealed);
    const outcome = await store().install(packArchive(manifest, files));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("policy");
      expect(outcome.message).toContain("connect-src");
    }
    // Nothing was written, so the refusal is not a half-install.
    expect([...disk.keys()].some((key) => key.includes("packs/"))).toBe(false);
  });

  it("installs an unsealed pack that declares the capability", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(unsealed, ["documents", "network"]);
    expect(await store().install(packArchive(manifest, files))).toMatchObject({ ok: true });
  });

  it("does not offer a pack already on disk that fails the rule", async () => {
    // The case install-time checking cannot reach: installed by an older build, or left over from
    // before the rule existed. It has a valid signature and must still not appear.
    disk.clear();
    const { manifest, files } = await signedManifest(unsealed);
    const dir = `packs/probe/1.0.0`;
    disk.set(`${dir}/manifest.json`, encoder.encode(JSON.stringify(manifest)));
    for (const [path, bytes] of Object.entries(files)) disk.set(`${dir}/${path}`, bytes);

    const discovered = await store().discover();
    expect(discovered).toEqual([]);
  });

  it("offers a sealed pack already on disk", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const dir = `packs/probe/1.0.0`;
    disk.set(`${dir}/manifest.json`, encoder.encode(JSON.stringify(manifest)));
    for (const [path, bytes] of Object.entries(files)) disk.set(`${dir}/${path}`, bytes);

    const discovered = await store().discover();
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.entryUrl).toContain("/packs/probe/1.0.0/index.html");
  });
});

describe("the archive contract, at install", () => {
  it("installs a valid pack and loads it back from disk", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();

    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });
    const discovered = await packs.discover();
    expect(discovered).toHaveLength(1);
    expect(await packs.issues()).toEqual([]);
  });

  it("refuses an extra file the manifest does not list", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const archive = packArchive(manifest, {
      ...files,
      "extra.txt": encoder.encode("not listed"),
    });

    const outcome = await store().install(archive);
    expect(outcome).toMatchObject({ ok: false, reason: "files" });
    expect([...disk.keys()].some((key) => key.includes("packs/"))).toBe(false);
  });

  it("refuses a listed file that is missing from the archive", async () => {
    disk.clear();
    const { manifest } = await signedManifest(sealed);

    const outcome = await store().install(packArchive(manifest, {}));
    expect(outcome).toMatchObject({ ok: false, reason: "files" });
  });

  it("refuses a duplicate entry", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const index = files["index.html"] as Uint8Array;
    const archive = zipEntries([
      { name: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest)) },
      { name: "index.html", bytes: index },
      { name: "index.html", bytes: index },
    ]);

    const outcome = await store().install(archive);
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok ? "" : outcome.message).toContain("twice");
  });

  it("refuses a path that leaves the pack", async () => {
    disk.clear();
    const { manifest } = await signedManifest(sealed);
    const archive = zipEntries([
      { name: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest)) },
      { name: "../escape", bytes: encoder.encode("no") },
    ]);

    const outcome = await store().install(archive);
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok ? "" : outcome.message).toContain("leaves the pack");
  });

  it("refuses a symlink entry", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const index = files["index.html"] as Uint8Array;
    const archive = zipEntries([
      { name: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest)) },
      { name: "index.html", bytes: index, unixMode: 0o12_07_77 },
    ]);

    const outcome = await store().install(archive);
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok ? "" : outcome.message).toContain("non-regular");
  });

  it("refuses an entry over the cap, a total over the cap and too many files", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const archive = packArchive(manifest, files);

    expect(await store({ archiveLimits: { maxFileBytes: 8 } }).install(archive)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await store({ archiveLimits: { maxTotalBytes: 8 } }).install(archive)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await store({ archiveLimits: { maxFiles: 1 } }).install(archive)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses an archive over the cap before reading an entry", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const archive = packArchive(manifest, files);

    const outcome = await store({ archiveLimits: { maxArchiveBytes: 8 } }).install(archive);
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok ? "" : outcome.message).toContain("larger");
  });
});

describe("verification at load", () => {
  it("refuses an installed file that changed after install", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });

    // Same length, different bytes: this must fail the hash rather than the size check.
    const tampered = Uint8Array.from(files["index.html"] as Uint8Array);
    tampered[0] = "X".charCodeAt(0);
    disk.set("packs/probe/1.0.0/index.html", tampered);

    expect(await packs.discover()).toEqual([]);
    const issues = await packs.issues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: "probe", version: "1.0.0", reason: "files" });
  });

  it("refuses an extra file added to an installed pack", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });

    disk.set("packs/probe/1.0.0/extra.txt", encoder.encode("not listed"));

    expect(await packs.discover()).toEqual([]);
    expect((await packs.issues())[0]?.reason).toBe("files");
  });

  it("refuses a listed file removed from an installed pack", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });

    disk.delete("packs/probe/1.0.0/index.html");

    expect(await packs.discover()).toEqual([]);
    expect((await packs.issues())[0]?.reason).toBe("files");
  });

  it("refuses a link standing in for an installed file", async () => {
    disk.clear();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });

    links.add("packs/probe/1.0.0/index.html");

    expect(await packs.discover()).toEqual([]);
    const issues = await packs.issues();
    expect(issues[0]?.reason).toBe("files");
    expect(issues[0]?.message).toContain("non-regular");
  });
});
