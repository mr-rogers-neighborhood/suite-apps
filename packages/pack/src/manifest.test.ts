import { describe, expect, it } from "vitest";
import {
  canonicalManifestBytes,
  isSafePackPath,
  PACK_CONTRACT_VERSION,
  PACK_FORMAT,
  type PackManifest,
  packAllows,
  packFitsHost,
  parsePackManifest,
} from "./manifest.js";

const decoder = new TextDecoder();

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
    const parsed = parsePackManifest(
      manifest({
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
      }),
    );
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
  });

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
