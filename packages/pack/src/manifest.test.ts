import { describe, expect, it } from "vitest";
import type { PackCapability } from "./capabilities.js";
import {
  canonicalManifestBytes,
  DEFAULT_PACK_RING,
  isSafePackPath,
  PACK_CONTRACT_VERSION,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  packAllows,
  packFitsHost,
  packMinimumHost,
  packRing,
  parsePackManifest,
  parsePackManifestJson,
} from "./manifest.js";
import {
  digestPackFiles,
  generatePackKeyPair,
  sha256Hex,
  signPackManifest,
  verifyPackSignature,
} from "./signature.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: PACK_FORMAT,
    id: "canvas",
    name: "Canvas",
    version: "0.2.0",
    entry: "index.html",
    contractVersion: PACK_CONTRACT_VERSION,
    capabilities: ["files", "relay"],
    contributions: {
      commands: [{ id: "canvas.new-card", title: "New card", keybinding: "CmdOrCtrl+N" }],
      menus: [{ menu: "file", command: "canvas.new-card" }],
      fileExtensions: [".canvas"],
      deepLinks: ["canvas"],
    },
    files: [
      { path: "index.html", sha256: "a".repeat(64), bytes: 10 },
      { path: "assets/app.js", sha256: "b".repeat(64), bytes: 20 },
    ],
    signature: "c2lnbmF0dXJl",
    ...overrides,
  };
}

/** One value for every optional field family in `manifest.schema.json`. */
function everyOptionalField(): Record<string, unknown> {
  return {
    description: "A local-first chart pack.",
    ring: "preview",
    minHost: 2,
    publisher: { key: "A".repeat(44), id: "suite" },
    optionalCapabilities: ["notifications"],
    documents: [
      {
        id: "chart",
        format: "suite.chart",
        version: 3,
        mode: "single",
        migrations: [{ from: 1, to: 2, entry: "migrate-1-2.html" }],
        projection: "project.html",
        criticalFields: ["title"],
      },
    ],
    blobs: [{ store: "assets", class: "asset" }],
    sync: { documents: ["chart"], blobs: ["assets"] },
    network: { allow: ["https://api.example.com"] },
    platforms: ["desktop", "mobile"],
    input: ["pointer", "keyboard"],
    defaultLocale: "en",
    locales: ["en", "fr"],
    widgets: [
      {
        id: "summary",
        title: "Summary",
        size: "2x1",
        capabilities: ["capture"],
        action: {
          kind: "capture",
          fields: [{ id: "note", label: "Note", type: "text" }],
        },
      },
    ],
    codeWidgets: [
      {
        id: "chart-card",
        title: "Chart card",
        size: "1x1",
        capabilities: ["capture"],
        action: { kind: "capture" },
        settings: [],
        entry: "widget.html",
        sha256: "e".repeat(64),
        fallback: {
          id: "chart-card",
          title: "Chart card",
          size: "1x1",
          capabilities: ["capture"],
          action: { kind: "capture" },
        },
      },
    ],
    components: [{ kind: "map", fallback: "web" }],
    subpackages: [{ id: "reports", entry: "reports/index.html" }],
    addons: [{ id: "chart-export", version: "1.0.0", sha256: "b".repeat(64) }],
    export: { entry: "export.html" },
    license: "MIT",
    source: "https://example.com/chart",
    deprecated: false,
    replacement: "chart-pro",
    sunset: "2027-01-01",
  };
}

/** Whether a parsed JSON value carries `null` anywhere. */
function hasNull(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some((item) => hasNull(item));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasNull(item));
  }
  return false;
}

function canonicalJson(value: PackManifest): Record<string, unknown> {
  return JSON.parse(decoder.decode(canonicalManifestBytes(value))) as Record<string, unknown>;
}

describe("the pack manifest", () => {
  it("accepts a complete manifest", () => {
    const parsed = parsePackManifest(manifest());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe("canvas");
    expect(parsed.value.capabilities).toEqual(["files", "relay"]);
    expect(parsed.value.contributions?.fileExtensions).toEqual([".canvas"]);
  });

  // spec: S3.5
  it("accepts every optional field family the spec names", () => {
    const parsed = parsePackManifest(manifest(everyOptionalField()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.publisher?.id).toBe("suite");
    expect(parsed.value.documents?.[0]?.id).toBe("chart");
    expect(parsed.value.codeWidgets?.[0]?.fallback.id).toBe("chart-card");
    expect(parsed.value.addons?.[0]?.version).toBe("1.0.0");
  });

  it("requires every file to be unique and the entry to be listed", () => {
    const parsed = parsePackManifest(
      manifest({
        entry: "missing.html",
        files: [
          { path: "index.html", sha256: "a".repeat(64), bytes: 10 },
          { path: "index.html", sha256: "b".repeat(64), bytes: 20 },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((issue) => issue.path.includes("entry"))).toBe(true);
    expect(parsed.issues.some((issue) => issue.message.includes("duplicate"))).toBe(true);
  });

  // spec: S3.5
  it("accepts a host kind this tree has never heard of", () => {
    const parsed = parsePackManifest(manifest({ platforms: ["desktop", "tv", "watch"] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.platforms).toEqual(["desktop", "tv", "watch"]);
  });

  // spec: S3.5
  it("still refuses a malformed platform value or a duplicate", () => {
    const malformed = parsePackManifest(manifest({ platforms: ["Desktop"] }));
    expect(malformed.ok).toBe(false);
    const duplicate = parsePackManifest(manifest({ platforms: ["desktop", "desktop"] }));
    expect(duplicate.ok).toBe(false);
  });

  it("refuses an unknown capability and an unknown field", () => {
    const parsed = parsePackManifest(manifest({ capabilities: ["files", "root"], extra: true }));
    expect(parsed.ok).toBe(false);
  });

  it("refuses a duplicate command and a bad file extension", () => {
    const parsed = parsePackManifest(
      manifest({
        contributions: {
          commands: [
            { id: "canvas.new", title: "New" },
            { id: "canvas.new", title: "Again" },
          ],
          fileExtensions: ["canvas"],
        },
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("refuses a non-HTML entry", () => {
    const parsed = parsePackManifest(
      manifest({
        entry: "index.js",
        files: [{ path: "index.js", sha256: "a".repeat(64), bytes: 10 }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((issue) => issue.path === "entry")).toBe(true);
  });

  it("refuses a traversal in a file path", () => {
    const parsed = parsePackManifest(
      manifest({
        files: [
          { path: "index.html", sha256: "a".repeat(64), bytes: 10 },
          { path: "../outside", sha256: "b".repeat(64), bytes: 20 },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("refuses a version that is not semver", () => {
    // The install path never needs its own segment check for an archive: the
    // schema refuses the slash before a path can be joined.
    const parsed = parsePackManifest(manifest({ version: "1.0.0/../../escape" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((issue) => issue.path === "version")).toBe(true);
  });

  it("refuses a description longer than the launcher can show", () => {
    expect(parsePackManifest(manifest({ description: "x".repeat(201) })).ok).toBe(false);
    expect(parsePackManifest(manifest({ description: "" })).ok).toBe(false);
  });
});

describe("canonical manifest bytes", () => {
  // spec: S3.3
  it("does not depend on the order of capabilities or files", () => {
    const first = parsePackManifest(manifest({ capabilities: ["relay", "files"] }));
    const second = parsePackManifest(
      manifest({
        capabilities: ["files", "relay"],
        files: [
          { path: "assets/app.js", sha256: "b".repeat(64), bytes: 20 },
          { path: "index.html", sha256: "a".repeat(64), bytes: 10 },
        ],
      }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(canonicalManifestBytes(first.value)).toEqual(canonicalManifestBytes(second.value));
    expect(canonicalJson(first.value).capabilities).toEqual(["files", "relay"]);
  });

  // spec: S3.3
  it("sorts file paths by code unit, not by the host's locale", () => {
    // `en-US` collation orders these `ab.html`, `ä.html`, `z.html`; `sv-SE` moves `ä` after `z`.
    // Code unit order is `ab.html`, `index.html`, `z.html`, `ä.html` in every locale, which is the
    // only order a signature made on one machine can rely on another machine to reproduce.
    const parsed = parsePackManifest(
      manifest({
        files: [
          { path: "z.html", sha256: "c".repeat(64), bytes: 30 },
          { path: "ä.html", sha256: "d".repeat(64), bytes: 40 },
          { path: "ab.html", sha256: "e".repeat(64), bytes: 50 },
          { path: "index.html", sha256: "a".repeat(64), bytes: 10 },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const canonical = JSON.parse(decoder.decode(canonicalManifestBytes(parsed.value))) as {
      files: { path: string }[];
    };
    expect(canonical.files.map((file) => file.path)).toEqual([
      "ab.html",
      "index.html",
      "z.html",
      "ä.html",
    ]);

    // The bytes are the same however the manifest happens to list the files.
    const reordered = parsePackManifest(
      manifest({
        files: [
          { path: "ä.html", sha256: "d".repeat(64), bytes: 40 },
          { path: "index.html", sha256: "a".repeat(64), bytes: 10 },
          { path: "ab.html", sha256: "e".repeat(64), bytes: 50 },
          { path: "z.html", sha256: "c".repeat(64), bytes: 30 },
        ],
      }),
    );
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(canonicalManifestBytes(reordered.value)).toEqual(canonicalManifestBytes(parsed.value));
  });

  it("keeps menu order as authored", () => {
    const first = parsePackManifest(
      manifest({
        contributions: {
          menus: [
            { menu: "file", command: "canvas.new-card" },
            { menu: "edit", command: "canvas.new-card" },
          ],
        },
      }),
    );
    const second = parsePackManifest(
      manifest({
        contributions: {
          menus: [
            { menu: "edit", command: "canvas.new-card" },
            { menu: "file", command: "canvas.new-card" },
          ],
        },
      }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(canonicalManifestBytes(first.value)).not.toEqual(canonicalManifestBytes(second.value));
  });

  // spec: S3.3
  it("adds a description to the canonical bytes only when it is present", () => {
    const plain = parsePackManifest(manifest());
    const described = parsePackManifest(manifest({ description: "Notes for the launcher." }));
    expect(plain.ok && described.ok).toBe(true);
    if (!plain.ok || !described.ok) return;

    const absent = JSON.parse(decoder.decode(canonicalManifestBytes(plain.value))) as Record<
      string,
      unknown
    >;
    const present = JSON.parse(decoder.decode(canonicalManifestBytes(described.value))) as Record<
      string,
      unknown
    >;
    // Absent means the key is absent, so a manifest signed before the field
    // existed still produces the bytes its signature covers.
    expect(absent).not.toHaveProperty("description");
    expect(present.description).toBe("Notes for the launcher.");
  });

  // spec: S3.3
  it("covers every manifest field in the schema's order", () => {
    const parsed = parsePackManifest(manifest(everyOptionalField()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const canonical = canonicalJson(parsed.value);
    // The schema's properties, minus `signature`. A field added above the schema
    // without a place here would fail this list; a field added to both without
    // reaching canonical bytes would fail it too.
    expect(Object.keys(canonical)).toEqual([
      "format",
      "id",
      "name",
      "description",
      "version",
      "ring",
      "entry",
      "contractVersion",
      "minHost",
      "publisher",
      "capabilities",
      "optionalCapabilities",
      "documents",
      "blobs",
      "sync",
      "network",
      "platforms",
      "input",
      "defaultLocale",
      "locales",
      "widgets",
      "codeWidgets",
      "components",
      "contributions",
      "subpackages",
      "addons",
      "export",
      "license",
      "source",
      "deprecated",
      "replacement",
      "sunset",
      "files",
    ]);
    // A required field the fixture does not carry is still signed, so the list
    // above is the whole of a manifest rather than a subset of one.
    expect(canonical.files).toHaveLength(2);
    expect(hasNull(canonical)).toBe(false);
  });

  // spec: S3.3
  it("omits an absent optional field instead of emitting null", () => {
    const parsed = parsePackManifest(manifest());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const canonical = canonicalJson(parsed.value);
    for (const field of [
      "description",
      "ring",
      "minHost",
      "minimumHostVersion",
      "publisher",
      "optionalCapabilities",
      "documents",
      "blobs",
      "sync",
      "network",
      "platforms",
      "input",
      "defaultLocale",
      "locales",
      "widgets",
      "codeWidgets",
      "components",
      "subpackages",
      "addons",
      "export",
      "license",
      "source",
      "deprecated",
      "replacement",
      "sunset",
    ]) {
      expect(canonical).not.toHaveProperty(field);
    }
    expect(hasNull(canonical)).toBe(false);
  });

  // spec: S3.3
  it("does not depend on the key order of a nested object", () => {
    const first = parsePackManifest(
      manifest({ documents: [{ id: "chart", format: "suite.chart", version: 3 }] }),
    );
    const second = parsePackManifest(
      manifest({ documents: [{ version: 3, format: "suite.chart", id: "chart" }] }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(canonicalManifestBytes(first.value)).toEqual(canonicalManifestBytes(second.value));
  });
});

describe("manifest JSON text", () => {
  // spec: S3.3
  it("refuses duplicate keys before parsing", () => {
    const text = JSON.stringify(manifest());
    expect(parsePackManifestJson(text).ok).toBe(true);

    // `JSON.parse` keeps the last value without a word. The scan has to see the
    // second `id` first, because a verifier and a reader that disagree on which
    // one wins are verifying different documents.
    const topLevel = parsePackManifestJson(
      text.replace('"id":"canvas"', '"id":"canvas","id":"evil"'),
    );
    expect(topLevel.ok).toBe(false);
    if (topLevel.ok) return;
    expect(topLevel.issues).toEqual([{ path: "id", message: 'duplicate key "id"' }]);

    const nested = parsePackManifestJson(
      text.replace(
        '"files":[{"path":"index.html"',
        '"files":[{"path":"index.html","path":"evil.html"',
      ),
    );
    expect(nested.ok).toBe(false);
    if (nested.ok) return;
    expect(nested.issues[0]?.path).toBe("files.0.path");
  });

  // spec: S3.3
  it("refuses text that is not JSON", () => {
    const parsed = parsePackManifestJson("{");
    expect(parsed.ok).toBe(false);
  });

  // spec: S3.10
  it("two builds of the same tree produce the same canonical bytes, hash and signature", async () => {
    const tree: Record<string, Uint8Array> = {
      "index.html": encoder.encode("<!doctype html><title>Deterministic</title>"),
      "assets/app.js": encoder.encode("console.log('deterministic')"),
    };
    const keys = await generatePackKeyPair();

    // `readdir` order is not promised, so a second build may feed the files in
    // another order; the source manifest may list capabilities in another order.
    // Neither may reach the signature.
    const build = async (order: readonly string[], capabilities: readonly string[]) => {
      const files = Object.fromEntries(order.map((path) => [path, tree[path] as Uint8Array]));
      const core: PackManifestCore = {
        format: PACK_FORMAT,
        id: "deterministic",
        name: "Deterministic",
        version: "1.0.0",
        entry: "index.html",
        contractVersion: PACK_CONTRACT_VERSION,
        capabilities: capabilities as readonly PackCapability[],
        files: await digestPackFiles(files),
      };
      return { core, signature: signPackManifest(core, keys.secretKeyBase64) };
    };

    const first = await build(["index.html", "assets/app.js"], ["files", "relay"]);
    const second = await build(["assets/app.js", "index.html"], ["relay", "files"]);

    const firstBytes = canonicalManifestBytes(first.core);
    const secondBytes = canonicalManifestBytes(second.core);
    expect(secondBytes).toEqual(firstBytes);
    expect(await sha256Hex(secondBytes)).toBe(await sha256Hex(firstBytes));
    // Ed25519 is deterministic per RFC 8032: the same bytes and key are the same signature.
    expect(second.signature).toBe(first.signature);
  });
});

describe("rings and the host floor", () => {
  // spec: S3.11
  it("defaults an absent ring to stable and an absent floor to none", () => {
    const value = parsePackManifest(manifest());
    expect(value.ok).toBe(true);
    if (!value.ok) return;

    // The default is read, never written: a manifest that carries neither field
    // signs the same bytes it would have before the fields existed.
    expect(value.value.ring).toBeUndefined();
    expect(value.value.minHost).toBeUndefined();
    expect(packRing(value.value)).toBe(DEFAULT_PACK_RING);
    expect(packMinimumHost(value.value)).toBeUndefined();
    expect(DEFAULT_PACK_RING).toBe("stable");

    const canonical = canonicalJson(value.value);
    expect(canonical).not.toHaveProperty("ring");
    expect(canonical).not.toHaveProperty("minHost");
  });

  // spec: S3.11
  it("refuses an unknown ring, including a host channel name", () => {
    for (const ring of ["nightly", "slop", "beta", "Stable", ""]) {
      const value = parsePackManifest(manifest({ ring }));
      expect(value.ok, ring).toBe(false);
      if (value.ok) continue;
      expect(value.issues.map((issue) => issue.path)).toContain("ring");
      expect(value.issues[0]?.message).toContain('"stable" or "preview"');
      expect(value.issues[0]?.message).toContain("host property");
      // The refusal echoes the value the author wrote, so it can be found.
      expect(value.issues[0]?.message).toContain(JSON.stringify(ring));
    }
  });

  // spec: S3.11
  it("accepts either spelling of the host floor and refuses both together", () => {
    const current = parsePackManifest(manifest({ minHost: 3 }));
    expect(current.ok).toBe(true);
    if (current.ok) expect(packMinimumHost(current.value)).toBe(3);

    const legacy = parsePackManifest(manifest({ minimumHostVersion: 3 }));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(packMinimumHost(legacy.value)).toBe(3);

    for (const spelling of ["minHost", "minimumHostVersion"] as const) {
      for (const floor of [0, -1, 1.5, "3"]) {
        const value = parsePackManifest(manifest({ [spelling]: floor }));
        expect(value.ok, `${spelling} ${String(floor)}`).toBe(false);
        if (value.ok) continue;
        expect(value.issues.map((issue) => issue.path)).toContain(spelling);
        expect(value.issues[0]?.message).toContain(JSON.stringify(floor));
        expect(value.issues[0]?.message).toContain("1 or more");
      }
    }

    const both = parsePackManifest(manifest({ minHost: 3, minimumHostVersion: 3 }));
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.issues.map((issue) => issue.path)).toContain("minHost");
    expect(both.issues[0]?.message).toContain("carry one spelling, not both");
    expect(both.issues[0]?.message).toContain("(3)");
  });

  // spec: S3.11
  it("refuses a duplicate ring or floor key before parsing it", () => {
    const withRing = JSON.stringify(manifest({ ring: "stable" })).replace(
      '"ring":"stable"',
      '"ring":"stable","ring":"preview"',
    );
    expect(parsePackManifestJson(withRing)).toEqual({
      ok: false,
      issues: [{ path: "ring", message: 'duplicate key "ring"' }],
    });

    const withFloor = JSON.stringify(manifest({ minHost: 1 })).replace(
      '"minHost":1',
      '"minHost":1,"minHost":2',
    );
    expect(parsePackManifestJson(withFloor)).toEqual({
      ok: false,
      issues: [{ path: "minHost", message: 'duplicate key "minHost"' }],
    });
  });

  // spec: S3.12
  it("refuses a host below the floor and a ring the host does not offer", () => {
    const floored = parsePackManifest(manifest({ minHost: 3 }));
    expect(floored.ok).toBe(true);
    if (!floored.ok) return;
    expect(packFitsHost(floored.value, { contractVersion: 1, hostVersion: 2 })).toEqual({
      ok: false,
      reason: "host",
      message: "Canvas needs host 3; this host is 2.",
    });
    expect(packFitsHost(floored.value, { contractVersion: 1, hostVersion: 3 })).toEqual({
      ok: true,
    });

    const preview = parsePackManifest(manifest({ ring: "preview" }));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(packFitsHost(preview.value, { contractVersion: 1, hostVersion: 1 })).toEqual({
      ok: false,
      reason: "ring",
      message: "Canvas is a preview ring pack; this host offers stable.",
    });
    expect(
      packFitsHost(preview.value, {
        contractVersion: 1,
        hostVersion: 1,
        rings: ["stable", "preview"],
      }),
    ).toEqual({ ok: true });

    const stable = parsePackManifest(manifest());
    expect(stable.ok).toBe(true);
    if (stable.ok) {
      expect(
        packFitsHost(stable.value, {
          contractVersion: 1,
          hostVersion: 1,
          rings: ["preview"],
        }),
      ).toEqual({
        ok: false,
        reason: "ring",
        message: "Canvas is a stable ring pack; this host offers preview.",
      });

      // A host that offers nothing refuses everything, with a readable sentence.
      expect(packFitsHost(stable.value, { contractVersion: 1, hostVersion: 1, rings: [] })).toEqual(
        {
          ok: false,
          reason: "ring",
          message: "Canvas is a stable ring pack; this host offers no ring.",
        },
      );
    }
  });

  // spec: S3.12
  it("checks the contract, then the floor, then the ring", () => {
    const all = parsePackManifest(manifest({ contractVersion: 9, minHost: 9, ring: "preview" }));
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    expect(packFitsHost(all.value, { contractVersion: 1, hostVersion: 1 })).toEqual({
      ok: false,
      reason: "contract",
      message: "Canvas needs pack contract 9; this host implements 1.",
    });
    expect(packFitsHost(all.value, { contractVersion: 9, hostVersion: 1 })).toEqual({
      ok: false,
      reason: "host",
      message: "Canvas needs host 9; this host is 1.",
    });
    expect(
      packFitsHost(all.value, { contractVersion: 9, hostVersion: 9, rings: ["stable"] }),
    ).toEqual({
      ok: false,
      reason: "ring",
      message: "Canvas is a preview ring pack; this host offers stable.",
    });
    expect(
      packFitsHost(all.value, {
        contractVersion: 9,
        hostVersion: 9,
        rings: ["stable", "preview"],
      }),
    ).toEqual({ ok: true });
  });

  // spec: S3.3
  // spec: S3.11
  it("signs a manifest with a ring and a floor, and a changed ring breaks the signature", async () => {
    const keys = await generatePackKeyPair();
    const parsed = parsePackManifest(
      manifest({
        ring: "preview",
        minHost: 2,
        publisher: { key: keys.publicKeyBase64, id: "suite" },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { signature: _unsigned, ...core } = parsed.value;
    const signature = signPackManifest(core, keys.secretKeyBase64);
    const text = JSON.stringify({ ...core, signature });

    const signed = parsePackManifestJson(text);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value.ring).toBe("preview");
    expect(packMinimumHost(signed.value)).toBe(2);
    expect(await verifyPackSignature(signed.value, keys.publicKeyBase64)).toBe(true);

    // The ring is inside the signed bytes: promoting it under the same version
    // is a different document and the old signature no longer verifies.
    const promoted = parsePackManifestJson(JSON.stringify({ ...core, ring: "stable", signature }));
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(await verifyPackSignature(promoted.value, keys.publicKeyBase64)).toBe(false);

    const raised = parsePackManifestJson(JSON.stringify({ ...core, minHost: 3, signature }));
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    expect(await verifyPackSignature(raised.value, keys.publicKeyBase64)).toBe(false);

    // The older spelling signs and verifies the same way, under its own key.
    const legacyCore = { ...core, minimumHostVersion: 2 } as typeof core;
    delete (legacyCore as { minHost?: number }).minHost;
    const legacySignature = signPackManifest(legacyCore, keys.secretKeyBase64);
    const legacy = parsePackManifestJson(
      JSON.stringify({ ...legacyCore, signature: legacySignature }),
    );
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(packMinimumHost(legacy.value)).toBe(2);
    expect(await verifyPackSignature(legacy.value, keys.publicKeyBase64)).toBe(true);
  });

  // spec: S3.3
  // spec: S3.11
  it("keeps the canonical bytes of a manifest without a ring or floor unchanged", async () => {
    const parsed = parsePackManifest(manifest());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const bytes = canonicalManifestBytes(parsed.value);
    // The digest this fixture produced before `ring` and `minHost` existed. An
    // optional field that is absent contributes no key, so the signature of a
    // pack signed earlier still verifies.
    expect(await sha256Hex(bytes)).toBe(
      "304cafc1a07d430060d2455579d5fa8df314fdb7cfc2c09851fe81ee26415a2d",
    );

    // The fields are signed in the schema's order when present, and the rest of
    // the document does not move around them.
    const withFields = parsePackManifest(manifest({ ring: "preview", minHost: 2 }));
    expect(withFields.ok).toBe(true);
    if (!withFields.ok) return;
    const canonical = canonicalJson(withFields.value);
    const keys = Object.keys(canonical);
    expect(keys[keys.indexOf("version") + 1]).toBe("ring");
    expect(keys[keys.indexOf("contractVersion") + 1]).toBe("minHost");
    expect(canonical.ring).toBe("preview");
    expect(canonical.minHost).toBe(2);
    expect(await sha256Hex(canonicalManifestBytes(withFields.value))).not.toBe(
      await sha256Hex(bytes),
    );

    // The older spelling is signed in its own slot, after `minHost`.
    const legacy = parsePackManifest(manifest({ minimumHostVersion: 2 }));
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const legacyKeys = Object.keys(canonicalJson(legacy.value));
    expect(legacyKeys[legacyKeys.indexOf("contractVersion") + 1]).toBe("minimumHostVersion");
    expect(legacyKeys).not.toContain("minHost");
  });
});

describe("host fit", () => {
  it("refuses a newer contract or host", () => {
    const value = parsePackManifest(manifest({ contractVersion: 2, minimumHostVersion: 5 }));
    expect(value.ok).toBe(true);
    if (!value.ok) return;

    expect(packFitsHost(value.value, { contractVersion: 1, hostVersion: 1 })).toEqual({
      ok: false,
      reason: "contract",
      message: expect.stringContaining("contract 2"),
    });

    const newerHost = parsePackManifest(manifest({ contractVersion: 1, minimumHostVersion: 5 }));
    expect(newerHost.ok).toBe(true);
    if (!newerHost.ok) return;
    expect(packFitsHost(newerHost.value, { contractVersion: 1, hostVersion: 1 })).toEqual({
      ok: false,
      reason: "host",
      message: expect.stringContaining("host 5"),
    });
  });

  it("grants only the declared capabilities", () => {
    const value = parsePackManifest(manifest({ capabilities: ["files"] }));
    expect(value.ok).toBe(true);
    if (!value.ok) return;
    expect(packAllows(value.value, "files")).toBe(true);
    expect(packAllows(value.value, "relay")).toBe(false);
  });
});

describe("pack paths", () => {
  it("accepts relative paths and refuses the rest", () => {
    expect(isSafePackPath("index.html")).toBe(true);
    expect(isSafePackPath("assets/app.js")).toBe(true);
    expect(isSafePackPath("/index.html")).toBe(false);
    expect(isSafePackPath("../index.html")).toBe(false);
    expect(isSafePackPath("a/../../b")).toBe(false);
    expect(isSafePackPath("a\\b")).toBe(false);
    expect(isSafePackPath("a\u0000b")).toBe(false);
  });
});

describe("manifest type", () => {
  it("has a signature field", () => {
    const value: PackManifest = {
      ...(manifest() as unknown as PackManifest),
      signature: "c2lnbmF0dXJl",
    };
    expect(value.signature).toBe("c2lnbmF0dXJl");
  });
});
