import { describe, expect, it } from "vitest";
import {
  canonicalPackIndexBytes,
  generatePackKeyPair,
  MAX_INDEX_BYTES,
  PACK_INDEX_FORMAT,
  PACK_INDEX_VERSION,
  type PackIndex,
  type PackIndexCore,
  type PackIndexEntry,
  packIndexDigest,
  parsePackIndex,
  parsePackIndexJson,
  SUITE_PACK_PUBLIC_KEY,
  signPackIndex,
  verifyPackIndex,
} from "./index.js";

/** 2026-06-01: the verification time every test uses unless it is testing expiry. */
const NOW = new Date("2026-06-01T00:00:00.000Z");

function entry(overrides: Partial<PackIndexEntry> = {}): PackIndexEntry {
  return {
    id: "canvas",
    name: "Canvas",
    publisher: "suite",
    version: "0.2.0",
    description: "A whiteboard for the Suite.",
    capabilities: ["files", "relay"],
    size: 12_345,
    sha256: "a".repeat(64),
    url: "https://packs.suite.run/canvas-0.2.0.suitepack",
    ...overrides,
  };
}

function core(overrides: Partial<PackIndexCore> = {}): PackIndexCore {
  return {
    format: PACK_INDEX_FORMAT,
    version: PACK_INDEX_VERSION,
    sequence: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    expires: "2027-01-01T00:00:00.000Z",
    threshold: 1,
    entries: [entry()],
    ...overrides,
  };
}

describe("catalogue index", () => {
  // spec: S12.2
  it("signs an index with an operator key and verifies it", async () => {
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(core(), [operator.secretKeyBase64]);

    expect(signed.signatures).toHaveLength(1);
    expect(signed.signatures[0]?.key).toBe(operator.publicKeyBase64);

    const verified = await verifyPackIndex(signed, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.digest).toBe(await packIndexDigest(signed));
  });

  // spec: S12.2
  it("refuses an index signed by a key that is not a pinned operator", async () => {
    const operator = await generatePackKeyPair();
    const stranger = await generatePackKeyPair();
    const signed = signPackIndex(core(), [stranger.secretKeyBase64]);

    const verified = await verifyPackIndex(signed, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    expect(verified).toEqual({
      ok: false,
      reason: "threshold",
      message: "The index carries 0 valid signature(s) from a pinned operator key; 1 required.",
    });
  });

  // spec: S12.2
  it("does not fall back to the pack publisher key as a trust root", async () => {
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(core(), [operator.secretKeyBase64]);

    // The pinned pack key is a different trust root. Passing it as the operator
    // set is the only way it could verify, and this module never does that itself.
    expect(operator.publicKeyBase64).not.toBe(SUITE_PACK_PUBLIC_KEY);
    const asPackKey = await verifyPackIndex(signed, {
      operatorKeys: [SUITE_PACK_PUBLIC_KEY],
      now: NOW,
    });
    expect(asPackKey.ok).toBe(false);
    expect((asPackKey as { reason: string }).reason).toBe("threshold");
  });

  // spec: S12.2
  it("refuses an entry changed after signing", async () => {
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(core(), [operator.secretKeyBase64]);
    const tampered: PackIndex = {
      ...signed,
      entries: [{ ...entry(), size: 12_346 }],
    };

    const verified = await verifyPackIndex(tampered, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    expect(verified).toEqual({
      ok: false,
      reason: "signature",
      message: "An operator signature over the index does not verify; the bytes were changed.",
    });
  });

  // spec: S12.2
  it("refuses an unknown format or version before it verifies anything", async () => {
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(core(), [operator.secretKeyBase64]);

    const wrongFormat = parsePackIndex({ ...signed, format: "suite.other" });
    expect(wrongFormat.ok).toBe(false);
    if (!wrongFormat.ok) {
      expect(wrongFormat.issues.some((issue) => issue.path === "format")).toBe(true);
    }

    const wrongVersion = parsePackIndex({ ...signed, version: 2 });
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.issues.some((issue) => issue.path === "version")).toBe(true);
    }

    // A caller that skipped parsing still refuses a newer format.
    const verified = await verifyPackIndex({ ...signed, version: 2 } as unknown as PackIndex, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    expect(verified.ok).toBe(false);
    expect((verified as { reason: string }).reason).toBe("version");
  });

  // spec: S12.2
  it("refuses duplicate id and version entries and duplicate operator keys", async () => {
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(core(), [operator.secretKeyBase64]);

    const duplicateEntry = parsePackIndex({
      ...signed,
      entries: [entry(), entry({ sha256: "b".repeat(64) })],
    });
    expect(duplicateEntry.ok).toBe(false);
    if (!duplicateEntry.ok) {
      expect(duplicateEntry.issues.map((issue) => issue.path)).toContain("entries.1.version");
    }

    const duplicateKey = parsePackIndex({
      ...signed,
      signatures: [signed.signatures[0], signed.signatures[0]],
    });
    expect(duplicateKey.ok).toBe(false);
    if (!duplicateKey.ok) {
      expect(duplicateKey.issues.map((issue) => issue.path)).toContain("signatures.1.key");
    }
  });

  // spec: S12.2
  it("requires the threshold of distinct operator signatures", async () => {
    const first = await generatePackKeyPair();
    const second = await generatePackKeyPair();
    const twoOfTwo = signPackIndex(core({ threshold: 2 }), [
      first.secretKeyBase64,
      second.secretKeyBase64,
    ]);

    const accepted = await verifyPackIndex(twoOfTwo, {
      operatorKeys: [first.publicKeyBase64, second.publicKeyBase64],
      now: NOW,
    });
    expect(accepted.ok).toBe(true);

    const oneOfTwo = signPackIndex(core({ threshold: 2 }), [first.secretKeyBase64]);
    const refused = await verifyPackIndex(oneOfTwo, {
      operatorKeys: [first.publicKeyBase64, second.publicKeyBase64],
      now: NOW,
    });
    expect(refused.ok).toBe(false);
    expect((refused as { reason: string }).reason).toBe("threshold");

    // Lowering the threshold after signing changes the signed bytes.
    const lowered = { ...twoOfTwo, threshold: 1 };
    const tampered = await verifyPackIndex(lowered, {
      operatorKeys: [first.publicKeyBase64, second.publicKeyBase64],
      now: NOW,
    });
    expect(tampered.ok).toBe(false);
    expect((tampered as { reason: string }).reason).toBe("signature");
  });

  // spec: S12.2
  it("refuses an index whose expires has passed", async () => {
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(core(), [operator.secretKeyBase64]);

    const verified = await verifyPackIndex(signed, {
      operatorKeys: [operator.publicKeyBase64],
      now: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(verified).toEqual({
      ok: false,
      reason: "expired",
      message: "This index expired at 2027-01-01T00:00:00.000Z; a stale catalogue is refused.",
    });
  });

  // spec: S12.2
  it("refuses a rolled-back or unchained index", async () => {
    const operator = await generatePackKeyPair();
    const first = signPackIndex(core(), [operator.secretKeyBase64]);
    const head = { sequence: 2, digest: await packIndexDigest(first) };

    const same = signPackIndex(
      core({ sequence: 2, previous: head.digest, generatedAt: "2026-02-01T00:00:00.000Z" }),
      [operator.secretKeyBase64],
    );
    const rolledBack = await verifyPackIndex(same, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      head,
    });
    expect(rolledBack.ok).toBe(false);
    expect((rolledBack as { reason: string }).reason).toBe("rollback");

    const next = signPackIndex(
      core({ sequence: 3, previous: head.digest, generatedAt: "2026-03-01T00:00:00.000Z" }),
      [operator.secretKeyBase64],
    );
    const advanced = await verifyPackIndex(next, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      head,
    });
    expect(advanced.ok).toBe(true);

    const wrongParent = signPackIndex(
      core({
        sequence: 3,
        previous: "b".repeat(64),
        generatedAt: "2026-03-01T00:00:00.000Z",
      }),
      [operator.secretKeyBase64],
    );
    const brokenChain = await verifyPackIndex(wrongParent, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
      head,
    });
    expect(brokenChain.ok).toBe(false);
    expect((brokenChain as { reason: string }).reason).toBe("chain");

    const noParent = parsePackIndex({
      ...next,
      sequence: 4,
      previous: undefined,
    });
    expect(noParent.ok).toBe(false);
    if (!noParent.ok) {
      expect(noParent.issues.some((issue) => issue.path === "previous")).toBe(true);
    }
  });

  // spec: S12.2
  it("refuses unsafe ids, versions, hashes and archive URLs", () => {
    const cases: readonly [string, PackIndexEntry][] = [
      ["id", entry({ id: "../canvas" })],
      ["publisher", entry({ publisher: "Suite" })],
      ["version", entry({ version: "0.2" })],
      ["sha256", entry({ sha256: "A".repeat(64) })],
      ["url", entry({ url: "http://packs.suite.run/canvas.suitepack" })],
      ["url", entry({ url: "https://user:pass@packs.suite.run/canvas.suitepack" })],
      ["url", entry({ url: "https://packs.suite.run/canvas.suitepack#fragment" })],
    ];

    for (const [path, invalid] of cases) {
      const parsed = parsePackIndex(core({ entries: [invalid] }));
      expect(parsed.ok, `${path} ${JSON.stringify(invalid)}`).toBe(false);
      if (!parsed.ok) {
        expect(parsed.issues.map((issue) => issue.path)).toContain(`entries.0.${path}`);
      }
    }
  });

  // spec: S12.2
  it("reuses the canonical rules: sorted arrays, omitted optional fields, code-unit order", async () => {
    const first = core({
      entries: [entry({ capabilities: ["relay", "files"] })],
    });
    const second = core({
      entries: [
        entry({ capabilities: ["files", "relay"], description: "A whiteboard for the Suite." }),
      ],
    });

    // Capability order is sorted, not authored, so both produce the same bytes.
    expect(canonicalPackIndexBytes(second)).toEqual(canonicalPackIndexBytes(first));

    const canonical = JSON.parse(new TextDecoder().decode(canonicalPackIndexBytes(first))) as {
      entries: Record<string, unknown>[];
    };
    expect(Object.keys(canonical.entries[0] ?? {})).toEqual([
      "capabilities",
      "description",
      "id",
      "name",
      "publisher",
      "sha256",
      "size",
      "url",
      "version",
    ]);
    expect(canonical.entries[0]?.capabilities).toEqual(["files", "relay"]);

    // An absent optional field contributes no key at all.
    const text = new TextDecoder().decode(canonicalPackIndexBytes(core({ entries: [entry()] })));
    expect(JSON.parse(text).entries[0].description).toBe("A whiteboard for the Suite.");
    const noDescription: PackIndexEntry = {
      id: "canvas",
      name: "Canvas",
      publisher: "suite",
      version: "0.2.0",
      capabilities: ["files", "relay"],
      size: 12_345,
      sha256: "a".repeat(64),
      url: "https://packs.suite.run/canvas-0.2.0.suitepack",
    };
    const absent = new TextDecoder().decode(
      canonicalPackIndexBytes(core({ entries: [noDescription] })),
    );
    expect(JSON.parse(absent).entries[0]).not.toHaveProperty("description");

    // Entry and signature order do not change the signed bytes.
    const withTwo = core({
      entries: [entry({ id: "zeta" }), entry({ id: "alpha" })],
    });
    const withTwoReversed = core({
      entries: [entry({ id: "alpha" }), entry({ id: "zeta" })],
    });
    expect(canonicalPackIndexBytes(withTwo)).toEqual(canonicalPackIndexBytes(withTwoReversed));
    const operator = await generatePackKeyPair();
    const signed = signPackIndex(withTwo, [operator.secretKeyBase64]);
    expect(canonicalPackIndexBytes(signed)).toEqual(canonicalPackIndexBytes(withTwo));
  });

  // spec: S12.2
  it("refuses a duplicate JSON key before parsing and caps the index size", () => {
    const operatorSigned = {
      ...core(),
      signatures: [{ key: "a".repeat(32), signature: "c2ln" }],
    };
    const text = JSON.stringify(operatorSigned).replace(
      '"threshold":1',
      '"threshold":1,"threshold":1',
    );
    const duplicate = parsePackIndexJson(text);
    expect(duplicate).toEqual({
      ok: false,
      issues: [{ path: "threshold", message: 'duplicate key "threshold"' }],
    });

    const tooLarge = `{"padding":"${"a".repeat(MAX_INDEX_BYTES)}"}`;
    const large = parsePackIndexJson(tooLarge);
    expect(large.ok).toBe(false);
    if (!large.ok) expect(large.issues[0]?.message).toContain("larger");
  });
});
