import { type PackManifest, sha256Hex } from "@suite/go";
import {
  generatePackKeyPair,
  type PackIndexCore,
  type PackIndexEntry,
  packIndexDigest,
  signPackIndex,
} from "@suite/pack";
import { describe, expect, it } from "vitest";
import {
  actionFor,
  createCatalogue,
  DEFAULT_CATALOGUE_INDEX_URL,
  INDEX_HEAD_KEY,
} from "./catalogue.js";
import type { InstalledPack, PackStore } from "./packs.js";

/**
 * The catalogue is a second trust root, so these tests are about refusals rather than rendering:
 * an index that did not verify must not produce a single row, and an archive must match the row
 * that was displayed before the pack store is asked to install it.
 *
 * The `PackStore` is a fake here on purpose. Go's own archive and disk rules live in
 * `packs.test.ts`; this file proves the index verification, the head record and the hand-off.
 */

const NOW = new Date("2026-06-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const operator = await generatePackKeyPair();
const otherOperator = await generatePackKeyPair();

function entry(overrides: Partial<PackIndexEntry> = {}): PackIndexEntry {
  return {
    id: "probe",
    name: "Probe",
    publisher: "suite",
    version: "1.0.0",
    description: "A small app",
    capabilities: ["documents"],
    size: 120,
    sha256: "a".repeat(64),
    url: "https://flatpak.suite.run/packs/probe-1.0.0.suitepack",
    ...overrides,
  };
}

function core(
  entries: readonly PackIndexEntry[],
  overrides: Partial<PackIndexCore> = {},
): PackIndexCore {
  return {
    format: "suite.catalogue",
    version: 1,
    sequence: 1,
    generatedAt: new Date(NOW.getTime() - HOUR).toISOString(),
    expires: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    threshold: 1,
    entries,
    ...overrides,
  };
}

function signedText(
  entries: readonly PackIndexEntry[],
  overrides: Partial<PackIndexCore> = {},
  secretKeys: readonly string[] = [operator.secretKeyBase64],
): string {
  return JSON.stringify(signPackIndex(core(entries, overrides), secretKeys));
}

function memoryStore(initial: Record<string, string> = {}): {
  readonly store: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    store: {
      async get(key) {
        return values.get(key) ?? null;
      },
      async set(key, value) {
        values.set(key, value);
      },
    },
  };
}

interface RecordedInstall {
  readonly bytes: Uint8Array;
  readonly options: Parameters<PackStore["install"]>[1];
}

function installed(
  manifest: Partial<PackManifest> & Pick<PackManifest, "id" | "version">,
): InstalledPack {
  const full: PackManifest = {
    format: "suite.pack",
    name: manifest.id,
    entry: "index.html",
    contractVersion: 1,
    independent: false,
    isolation: "isolated",
    capabilities: ["documents"],
    files: [{ path: "index.html", sha256: "a".repeat(64), bytes: 1 }],
    signature: "not-used-here",
    ...manifest,
  };
  return {
    manifest: full,
    entryUrl: `https://localhost/_capacitor_file_/data/packs/${full.id}/${full.version}/index.html`,
    installedAt: 0,
    bytes: 1,
  };
}

function fakePacks(installedPacks: readonly InstalledPack[] = []): {
  readonly packs: PackStore;
  readonly installs: RecordedInstall[];
  readonly removals: string[];
} {
  const installs: RecordedInstall[] = [];
  const removals: string[] = [];
  const packs: PackStore = {
    async discover() {
      return installedPacks;
    },
    async issues() {
      return [];
    },
    async list() {
      return installedPacks;
    },
    async install(bytes, options) {
      installs.push({ bytes, options });
      return {
        ok: true,
        pack: installed({ id: "probe", version: "2.0.0" }),
      };
    },
    async uninstall(id) {
      removals.push(id);
    },
    async directoryOf(id) {
      return `/data/packs/${id}`;
    },
  };
  return { packs, installs, removals };
}

function response(body: string | Uint8Array, status = 200): Response {
  return new Response(body as BodyInit, { status });
}

function fetchMap(routes: Record<string, string | Uint8Array>): {
  readonly fetch: (input: string) => Promise<Response>;
  readonly requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    async fetch(input) {
      requested.push(input);
      const body = routes[input];
      if (body === undefined) return response("not found", 404);
      return response(body);
    },
  };
}

function catalogueFor(
  text: string,
  routes: Record<string, string | Uint8Array> = {},
  packs: PackStore = fakePacks().packs,
  stored: Record<string, string> = {},
) {
  const { store, values } = memoryStore(stored);
  const fetch = fetchMap({ [DEFAULT_CATALOGUE_INDEX_URL]: text, ...routes });
  const catalogue = createCatalogue({
    packs,
    store,
    fetch: fetch.fetch,
    now: NOW,
    // Pinning a test key keeps the production key out of fixtures; the shared pin is tested in
    // `packages/pack/src/pinnedKey.test.ts`.
    operatorKeys: [operator.publicKeyBase64],
  });
  return { catalogue, values, fetch };
}

describe("the catalogue index source", () => {
  it("reads the same published index as the desktop shell", () => {
    expect(DEFAULT_CATALOGUE_INDEX_URL).toBe("https://flatpak.suite.run/index.json");
  });
});

describe("loading a catalogue index", () => {
  it("lists the newest version of each pack with the installed action", async () => {
    const text = signedText([
      entry({ version: "1.0.0" }),
      entry({ version: "2.0.0", size: 240 }),
      entry({ id: "other", name: "Other", version: "1.0.0" }),
      entry({ id: "fresh", name: "Fresh", version: "1.0.0" }),
    ]);
    const packs = fakePacks([
      installed({ id: "probe", version: "1.0.0" }),
      installed({ id: "other", version: "1.0.0" }),
    ]).packs;

    const loaded = await catalogueFor(text, {}, packs).catalogue.load();

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.entries.map((row) => [row.id, row.version, row.action])).toEqual([
      ["fresh", "1.0.0", "install"],
      ["other", "1.0.0", "reinstall"],
      ["probe", "2.0.0", "update"],
    ]);
    expect(loaded.entries.find((row) => row.id === "probe")?.installedVersion).toBe("1.0.0");
  });

  it("marks a pack needing an unserved capability unavailable and refuses it before download", async () => {
    const text = signedText([entry({ capabilities: ["documents", "relay"] })]);
    const { catalogue, fetch } = catalogueFor(text);

    const loaded = await catalogue.load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.entries[0]?.platform).toEqual({
      state: "unavailable",
      reason: "not available on Go — needs `relay`",
    });

    const result = await catalogue.install("probe", "1.0.0");
    expect(result).toMatchObject({ ok: false, reason: "platform" });
    expect(fetch.requested).toEqual([DEFAULT_CATALOGUE_INDEX_URL]);
  });

  it("reports a desktop-only pack as built for desktop, not unknown", async () => {
    const text = signedText([entry({ capabilities: ["documents"], platforms: ["desktop"] })]);
    const { catalogue } = catalogueFor(text);

    const loaded = await catalogue.load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.entries[0]?.platform).toEqual({
      state: "unavailable",
      reason: "not available on Go — built for `desktop`",
    });
  });

  it("refuses an unsigned index", async () => {
    const unsigned = JSON.stringify({ ...core([entry()]), signatures: [] });

    const loaded = await catalogueFor(unsigned).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("unsigned");
  });

  it("refuses an index changed after it was signed", async () => {
    const signed = JSON.parse(signedText([entry()])) as {
      entries: { name: string }[];
    };
    const first = signed.entries[0];
    if (first === undefined) throw new Error("the fixture index carried no entry");
    first.name = "Something else";

    const loaded = await catalogueFor(JSON.stringify(signed)).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("changed after it was signed");
  });

  it("refuses an index signed by an operator key this host does not pin", async () => {
    const text = signedText([entry()], {}, [otherOperator.secretKeyBase64]);

    const loaded = await catalogueFor(text).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("does not pin");
  });

  it("refuses an expired index", async () => {
    const text = signedText([entry()], {
      generatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
      expires: new Date(NOW.getTime() - HOUR).toISOString(),
    });

    const loaded = await catalogueFor(text).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("expired");
  });

  it("refuses a lower sequence than the trusted head", async () => {
    const head = JSON.stringify({ version: 1, sequence: 3, digest: "b".repeat(64) });
    const text = signedText([entry()], { sequence: 2, previous: "b".repeat(64) });

    const loaded = await catalogueFor(text, {}, fakePacks().packs, {
      [INDEX_HEAD_KEY]: head,
    }).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("cannot move backwards");
  });

  it("refuses the same sequence with different bytes as an equivocation", async () => {
    const head = JSON.stringify({ version: 1, sequence: 4, digest: "b".repeat(64) });
    const text = signedText([entry()], { sequence: 4, previous: "b".repeat(64) });

    const loaded = await catalogueFor(text, {}, fakePacks().packs, {
      [INDEX_HEAD_KEY]: head,
    }).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("cannot rewrite a sequence");
  });

  it("refuses an index whose previous does not name the trusted digest", async () => {
    const head = JSON.stringify({ version: 1, sequence: 3, digest: "b".repeat(64) });
    const text = signedText([entry()], { sequence: 4, previous: "c".repeat(64) });

    const loaded = await catalogueFor(text, {}, fakePacks().packs, {
      [INDEX_HEAD_KEY]: head,
    }).catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "refused" });
    expect(loaded.ok ? "" : loaded.message).toContain("does not name the digest");
  });

  it("accepts the next index in the chain and records its digest", async () => {
    const previousCore = core([entry()], { sequence: 3 });
    const previous = await packIndexDigest(previousCore);
    const head = JSON.stringify({ version: 1, sequence: 3, digest: previous });
    const next = core([entry({ version: "2.0.0" })], { sequence: 4, previous });
    const text = JSON.stringify(signPackIndex(next, [operator.secretKeyBase64]));

    const { catalogue, values } = catalogueFor(text, {}, fakePacks().packs, {
      [INDEX_HEAD_KEY]: head,
    });

    const loaded = await catalogue.load();

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.sequence).toBe(4);
    const recorded = JSON.parse(values.get(INDEX_HEAD_KEY) as string) as {
      sequence: number;
      digest: string;
    };
    expect(recorded.sequence).toBe(4);
    expect(recorded.digest).toBe(loaded.digest);
  });

  it("accepts the same index again on Refresh without calling it a rollback", async () => {
    const text = signedText([entry()]);
    const { catalogue } = catalogueFor(text);

    const first = await catalogue.load();
    const second = await catalogue.load();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.digest).toBe(first.digest);
    expect(second.entries).toHaveLength(1);
  });

  it("reports a network failure without inventing an empty catalogue", async () => {
    const catalogue = createCatalogue({
      packs: fakePacks().packs,
      store: memoryStore().store,
      fetch: async () => response("no", 503),
      now: NOW,
      operatorKeys: [operator.publicKeyBase64],
    });

    const loaded = await catalogue.load();

    expect(loaded).toMatchObject({ ok: false, reason: "unreachable" });
  });
});

const archive = new TextEncoder().encode("a pack archive, not a zip the store will read");
const digest = await sha256Hex(archive);

describe("installing from the catalogue", () => {
  function available(installedVersion: string | null): PackIndexEntry {
    return entry({
      version: installedVersion === null ? "1.0.0" : "2.0.0",
      size: archive.byteLength,
      sha256: digest,
      url: "https://flatpak.suite.run/packs/probe.suitepack",
    });
  }

  it("passes the displayed digest, size, id and version to the installer", async () => {
    const text = signedText([available(null)]);
    const fake = fakePacks();
    const { catalogue } = catalogueFor(
      text,
      { "https://flatpak.suite.run/packs/probe.suitepack": archive },
      fake.packs,
    );
    await catalogue.load();

    const result = await catalogue.install("probe", "1.0.0");

    expect(result).toMatchObject({ ok: true, action: "install" });
    expect(fake.installs).toHaveLength(1);
    expect(fake.installs[0]?.options).toMatchObject({
      replace: false,
      expected: {
        id: "probe",
        version: "1.0.0",
        sha256: digest,
        size: archive.byteLength,
      },
    });
  });

  it("updates without replacing the installed version directory", async () => {
    const text = signedText([available("1.0.0")]);
    const fake = fakePacks([installed({ id: "probe", version: "1.0.0" })]);
    const { catalogue } = catalogueFor(
      text,
      { "https://flatpak.suite.run/packs/probe.suitepack": archive },
      fake.packs,
    );
    await catalogue.load();

    const result = await catalogue.install("probe", "2.0.0");

    expect(result).toMatchObject({ ok: true, action: "update" });
    expect(fake.installs[0]?.options?.replace).toBe(false);
  });

  it("replaces the same version on a reinstall", async () => {
    const text = signedText([available("2.0.0")]);
    const fake = fakePacks([installed({ id: "probe", version: "2.0.0" })]);
    const { catalogue } = catalogueFor(
      text,
      { "https://flatpak.suite.run/packs/probe.suitepack": archive },
      fake.packs,
    );
    await catalogue.load();

    const result = await catalogue.install("probe", "2.0.0");

    expect(result).toMatchObject({ ok: true, action: "reinstall" });
    expect(fake.installs[0]?.options?.replace).toBe(true);
  });

  it("refuses an archive that does not match the index before asking the store", async () => {
    const text = signedText([available(null)]);
    const fake = fakePacks();
    const { catalogue } = catalogueFor(
      text,
      { "https://flatpak.suite.run/packs/probe.suitepack": new TextEncoder().encode("changed") },
      fake.packs,
    );
    await catalogue.load();

    const result = await catalogue.install("probe", "1.0.0");

    expect(result).toMatchObject({ ok: false, reason: "digest" });
    expect(fake.installs).toEqual([]);
  });

  it("refuses a version that was not in the loaded index", async () => {
    const text = signedText([available(null)]);
    const fake = fakePacks();
    const { catalogue } = catalogueFor(
      text,
      { "https://flatpak.suite.run/packs/probe.suitepack": archive },
      fake.packs,
    );
    await catalogue.load();

    const result = await catalogue.install("probe", "9.9.9");

    expect(result).toMatchObject({ ok: false, reason: "missing" });
    expect(fake.installs).toEqual([]);
  });

  it("removes every installed version of a pack", async () => {
    const text = signedText([available("2.0.0")]);
    const fake = fakePacks([installed({ id: "probe", version: "2.0.0" })]);
    const { catalogue } = catalogueFor(text, {}, fake.packs);
    await catalogue.load();

    await catalogue.remove("probe");

    expect(fake.removals).toEqual(["probe"]);
  });
});

describe("the row action", () => {
  it("names install, update, reinstall and current", () => {
    expect(actionFor(null, "1.0.0")).toBe("install");
    expect(actionFor("1.0.0", "2.0.0")).toBe("update");
    expect(actionFor("2.0.0", "2.0.0")).toBe("reinstall");
    expect(actionFor("3.0.0", "2.0.0")).toBe("current");
  });

  it("uses semver so 1.10.0 is an update from 1.9.0", () => {
    expect(actionFor("1.9.0", "1.10.0")).toBe("update");
  });
});
