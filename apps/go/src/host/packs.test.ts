import { bytesToBase64, canonicalManifestBytes, type PackManifest, sha256Hex } from "@suite/go";
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
/** Writes left before the plugin starts failing, for the failed-install rollback test. */
let writesUntilFailure = Number.POSITIVE_INFINITY;

function resetDisk(): void {
  disk.clear();
  links.clear();
  writesUntilFailure = Number.POSITIVE_INFINITY;
}

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
      writesUntilFailure -= 1;
      if (writesUntilFailure < 0) throw new Error("disk full");
      disk.set(
        path,
        Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      );
      links.delete(path);
    },
    async getUri({ path }: { path: string }) {
      return { uri: `file:///data/user/0/app/files/${path}` };
    },
    async stat({ path }: { path: string }) {
      const exists = [...disk.keys()].some((key) => key === path || key.startsWith(`${path}/`));
      if (!exists) throw new Error(`no such path ${path}`);
      return { type: "file", size: 0, ctime: 0, mtime: 0, uri: path };
    },
    async rename({ from, to }: { from: string; to: string }) {
      const moves = [...disk.keys()].filter((key) => key === from || key.startsWith(`${from}/`));
      if (moves.length === 0) throw new Error(`no such path ${from}`);
      for (const key of moves) {
        disk.set(`${to}${key.slice(from.length)}`, disk.get(key) as Uint8Array);
        disk.delete(key);
      }
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
  overrides: Partial<Pick<PackManifest, "id" | "name" | "version">> = {},
  extraFiles: Record<string, Uint8Array> = {},
): Promise<{ manifest: PackManifest; files: Record<string, Uint8Array> }> {
  const files = { "index.html": encoder.encode(html), ...extraFiles };
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
    ...overrides,
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
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const outcome = await store().install(packArchive(manifest, files));
    expect(outcome).toMatchObject({ ok: true });
  });

  it("refuses a pack that does not, and names what is missing", async () => {
    resetDisk();
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
    resetDisk();
    const { manifest, files } = await signedManifest(unsealed, ["documents", "network"]);
    expect(await store().install(packArchive(manifest, files))).toMatchObject({ ok: true });
  });

  it("does not offer a pack already on disk that fails the rule", async () => {
    // The case install-time checking cannot reach: installed by an older build, or left over from
    // before the rule existed. It has a valid signature and must still not appear.
    resetDisk();
    const { manifest, files } = await signedManifest(unsealed);
    const dir = `packs/probe/1.0.0`;
    disk.set(`${dir}/manifest.json`, encoder.encode(JSON.stringify(manifest)));
    for (const [path, bytes] of Object.entries(files)) disk.set(`${dir}/${path}`, bytes);

    const discovered = await store().discover();
    expect(discovered).toEqual([]);
  });

  it("offers a sealed pack already on disk", async () => {
    resetDisk();
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
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();

    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });
    const discovered = await packs.discover();
    expect(discovered).toHaveLength(1);
    expect(await packs.issues()).toEqual([]);
  });

  it("refuses an extra file the manifest does not list", async () => {
    resetDisk();
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
    resetDisk();
    const { manifest } = await signedManifest(sealed);

    const outcome = await store().install(packArchive(manifest, {}));
    expect(outcome).toMatchObject({ ok: false, reason: "files" });
  });

  it("refuses a duplicate entry", async () => {
    resetDisk();
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
    resetDisk();
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
    resetDisk();
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
    resetDisk();
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
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const archive = packArchive(manifest, files);

    const outcome = await store({ archiveLimits: { maxArchiveBytes: 8 } }).install(archive);
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok ? "" : outcome.message).toContain("larger");
  });
});

describe("verification at load", () => {
  it("refuses an installed file that changed after install", async () => {
    resetDisk();
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
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });

    disk.set("packs/probe/1.0.0/extra.txt", encoder.encode("not listed"));

    expect(await packs.discover()).toEqual([]);
    expect((await packs.issues())[0]?.reason).toBe("files");
  });

  it("refuses a listed file removed from an installed pack", async () => {
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    expect(await packs.install(packArchive(manifest, files))).toMatchObject({ ok: true });

    disk.delete("packs/probe/1.0.0/index.html");

    expect(await packs.discover()).toEqual([]);
    expect((await packs.issues())[0]?.reason).toBe("files");
  });

  it("refuses a link standing in for an installed file", async () => {
    resetDisk();
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

describe("the capability a host serves (S4.8)", () => {
  it("refuses a pack that asks for a capability Go does not serve, by name", async () => {
    resetDisk();
    const { manifest, files } = await signedManifest(sealed, ["documents", "files"]);

    const outcome = await store().install(packArchive(manifest, files));

    expect(outcome).toMatchObject({ ok: false, reason: "capability" });
    expect(outcome.ok ? "" : outcome.message).toContain("files");
    // Nothing was written: a pack that would half-work is not installed and then hidden.
    expect([...disk.keys()].some((key) => key.includes("packs/"))).toBe(false);
  });

  it("does not offer an installed pack built for a capability Go does not serve", async () => {
    resetDisk();
    const { manifest, files } = await signedManifest(sealed, ["files"]);
    const dir = "packs/probe/1.0.0";
    disk.set(`${dir}/manifest.json`, encoder.encode(JSON.stringify(manifest)));
    for (const [path, bytes] of Object.entries(files)) disk.set(`${dir}/${path}`, bytes);

    const packs = store();
    expect(await packs.discover()).toEqual([]);
    const issues = await packs.issues();
    expect(issues[0]).toMatchObject({ id: "probe", version: "1.0.0", reason: "capability" });
    expect(issues[0]?.message).toContain("files");
  });
});

describe("versions on disk", () => {
  it("keeps the previous version beside an update and makes the newer one active", async () => {
    resetDisk();
    const first = await signedManifest(sealed, ["documents"], { version: "1.0.0" });
    const second = await signedManifest(sealed, ["documents"], { version: "2.0.0" });
    const packs = store();

    expect(await packs.install(packArchive(first.manifest, first.files))).toMatchObject({
      ok: true,
    });
    expect(await packs.install(packArchive(second.manifest, second.files))).toMatchObject({
      ok: true,
    });

    // Both directories are on disk, so an update has the previous version to fall back to.
    expect(disk.has("packs/probe/1.0.0/index.html")).toBe(true);
    expect(disk.has("packs/probe/2.0.0/index.html")).toBe(true);
    const discovered = await packs.discover();
    expect(discovered.map((pack) => pack.manifest.version)).toEqual(["2.0.0"]);
  });

  it("orders versions by semver rather than by directory name", async () => {
    resetDisk();
    const older = await signedManifest(sealed, ["documents"], { version: "1.9.0" });
    const newer = await signedManifest(sealed, ["documents"], { version: "1.10.0" });
    const packs = store();

    await packs.install(packArchive(older.manifest, older.files));
    await packs.install(packArchive(newer.manifest, newer.files));

    // String order would put "1.9.0" above "1.10.0" and keep the older app active.
    expect((await packs.discover()).map((pack) => pack.manifest.version)).toEqual(["1.10.0"]);
  });

  it("refuses a second archive for an installed version unless it is a reinstall", async () => {
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const packs = store();
    await packs.install(packArchive(manifest, files));

    const again = await packs.install(packArchive(manifest, files));

    expect(again).toMatchObject({ ok: false, reason: "failed" });
    expect(again.ok ? "" : again.message).toContain("already installed");
  });

  it("replaces the same version on reinstall and drops files from the old copy", async () => {
    resetDisk();
    const first = await signedManifest(
      sealed,
      ["documents"],
      {},
      {
        "old.txt": encoder.encode("from the previous copy"),
      },
    );
    const second = await signedManifest(sealed, ["documents"]);
    const packs = store();

    await packs.install(packArchive(first.manifest, first.files));
    expect(disk.has("packs/probe/1.0.0/old.txt")).toBe(true);

    expect(
      await packs.install(packArchive(second.manifest, second.files), { replace: true }),
    ).toMatchObject({ ok: true });

    expect(disk.has("packs/probe/1.0.0/old.txt")).toBe(false);
    expect(await packs.discover()).toHaveLength(1);
  });

  it("leaves the installed version when an update fails while writing", async () => {
    resetDisk();
    const first = await signedManifest(sealed, ["documents"], { version: "1.0.0" });
    const second = await signedManifest(sealed, ["documents"], { version: "2.0.0" });
    const packs = store();
    await packs.install(packArchive(first.manifest, first.files));

    // The next write, whichever temporary file it is, fails as a full disk would.
    writesUntilFailure = 0;
    const outcome = await packs.install(packArchive(second.manifest, second.files));
    writesUntilFailure = Number.POSITIVE_INFINITY;

    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(disk.has("packs/probe/2.0.0/index.html")).toBe(false);
    expect((await packs.discover()).map((pack) => pack.manifest.version)).toEqual(["1.0.0"]);
  });

  it("removes every version and leaves documents alone", async () => {
    resetDisk();
    const first = await signedManifest(sealed, ["documents"], { version: "1.0.0" });
    const second = await signedManifest(sealed, ["documents"], { version: "2.0.0" });
    const packs = store();
    await packs.install(packArchive(first.manifest, first.files));
    await packs.install(packArchive(second.manifest, second.files));

    // The pack store must not reach into the container's document area.
    disk.set("documents/probe-note.json", encoder.encode("a document the container cannot read"));

    await packs.uninstall("probe");

    expect([...disk.keys()].some((key) => key.startsWith("packs/probe"))).toBe(false);
    expect(disk.has("documents/probe-note.json")).toBe(true);
    expect(await packs.discover()).toEqual([]);
  });
});

describe("an archive matched to a catalogue entry (S12.7)", () => {
  it("refuses a digest that does not match before it opens the archive", async () => {
    resetDisk();
    const { manifest, files } = await signedManifest(sealed);
    const archive = packArchive(manifest, files);

    const outcome = await store().install(archive, {
      expected: {
        id: "probe",
        version: "1.0.0",
        sha256: "0".repeat(64),
        size: archive.byteLength,
      },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "digest" });
    expect([...disk.keys()].some((key) => key.includes("packs/"))).toBe(false);
  });

  it("refuses an archive whose manifest names another version", async () => {
    resetDisk();
    const { manifest, files } = await signedManifest(sealed, ["documents"], { version: "1.0.0" });
    const archive = packArchive(manifest, files);

    const outcome = await store().install(archive, {
      expected: {
        id: "probe",
        version: "2.0.0",
        sha256: await sha256Hex(archive),
        size: archive.byteLength,
      },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok ? "" : outcome.message).toContain("2.0.0");
    expect([...disk.keys()].some((key) => key.includes("packs/"))).toBe(false);
  });
});
