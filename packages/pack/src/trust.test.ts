import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addTrustedPublisher,
  checkPublisherTrust,
  generatePackKeyPair,
  isPublisherKey,
  isSafePublisherId,
  normalisePublisherFingerprint,
  type PackManifest,
  parsePackManifest,
  publisherKeyDigest,
  publisherKeyFingerprint,
  SUITE_PUBLISHER_ID,
  type TrustedPublisher,
  verifyPackSignature,
} from "./index.js";

const GOLDEN = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  "docs/spec/golden",
);

function golden(): { manifest: PackManifest; publicKey: string } {
  const raw: unknown = JSON.parse(readFileSync(join(GOLDEN, "manifest.json"), "utf8"));
  const parsed = parsePackManifest(raw);
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join("; "));
  return {
    manifest: parsed.value,
    publicKey: readFileSync(join(GOLDEN, "public-key.b64"), "utf8").trim(),
  };
}

function store(...entries: readonly TrustedPublisher[]): readonly TrustedPublisher[] {
  return entries;
}

describe("publisher fingerprints", () => {
  // spec: S2.1
  it("writes the SHA-256 of the key as upper-case colon pairs", async () => {
    const keys = await generatePackKeyPair();
    const fingerprint = await publisherKeyFingerprint(keys.publicKeyBase64);
    expect(fingerprint).toMatch(/^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/u);
    expect(await normalisePublisherFingerprint(`sha256:${fingerprint.toLowerCase()}`)).toBe(
      fingerprint,
    );
    expect(normalisePublisherFingerprint(fingerprint.replaceAll(":", " "))).toBe(fingerprint);
    // The lower-case digest is the same value in the shape a path segment needs.
    expect(fingerprint.replaceAll(":", "").toLowerCase()).toBe(
      await publisherKeyDigest(keys.publicKeyBase64),
    );
  });

  it("refuses something that is not a fingerprint and a key that is not 32 bytes", async () => {
    expect(normalisePublisherFingerprint("nope")).toBeNull();
    expect(normalisePublisherFingerprint("AA:BB")).toBeNull();
    expect(isPublisherKey("AAAA")).toBe(false);
    expect(isPublisherKey("not base64 at all!")).toBe(false);
    const keys = await generatePackKeyPair();
    expect(isPublisherKey(keys.publicKeyBase64)).toBe(true);
  });

  it("accepts a publisher id that is one safe path segment", () => {
    expect(isSafePublisherId("acme")).toBe(true);
    expect(isSafePublisherId("acme-labs")).toBe(true);
    expect(isSafePublisherId("Acme")).toBe(false);
    expect(isSafePublisherId("../acme")).toBe(false);
    expect(isSafePublisherId("a".repeat(65))).toBe(false);
  });
});

describe("publisher trust decisions", () => {
  // spec: S2.1
  it("trusts the golden vector only through its publisher key", async () => {
    const { manifest, publicKey } = golden();
    expect(manifest.publisher?.key).toBe(publicKey);

    const unknown = await checkPublisherTrust(manifest.publisher, store());
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.reason).toBe("unknown-publisher");
    expect(unknown.fingerprint).toBe(await publisherKeyFingerprint(publicKey));
    // The refusal is actionable: it names the fingerprint a person compares.
    expect(unknown.message).toContain(unknown.fingerprint ?? "");

    const trusted = await checkPublisherTrust(
      manifest.publisher,
      store({ id: "golden", key: publicKey }),
    );
    expect(trusted.ok).toBe(true);
    if (!trusted.ok) return;
    expect(trusted.publisher).toMatchObject({ id: "golden", key: publicKey });
    expect(await verifyPackSignature(manifest, trusted.publisher.key)).toBe(true);
  });

  // spec: S2.1
  it("refuses a key that is not a 32-byte Ed25519 public key", async () => {
    const decision = await checkPublisherTrust({ key: "A".repeat(40), id: "acme" }, store());
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("unknown-publisher");
    expect(decision.fingerprint).toBeNull();
  });

  // spec: S2.1
  it("refuses a key whose signature is valid but whose publisher is unknown", async () => {
    const keys = await generatePackKeyPair();
    const decision = await checkPublisherTrust(
      { key: keys.publicKeyBase64, id: "stranger" },
      store({ id: "suite", key: "x5QN5OKEGya9gsrbNGaKZMfznsAv6+Cux/qrBYHuSfc=" }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("unknown-publisher");
    expect(decision.id).toBe("stranger");
  });

  // spec: S2.2
  it("refuses a pack that claims another publisher's id", async () => {
    const keys = await generatePackKeyPair();
    const decision = await checkPublisherTrust(
      { key: keys.publicKeyBase64, id: "suite" },
      store({ id: "acme", key: keys.publicKeyBase64 }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("publisher-id-mismatch");
    expect(decision.message).toContain("acme");
  });

  // spec: S2.2
  it("derives the id from the key when a manifest omits one", async () => {
    const keys = await generatePackKeyPair();
    const decision = await checkPublisherTrust(
      { key: keys.publicKeyBase64 },
      store({ id: "acme", key: keys.publicKeyBase64 }),
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.publisher.id).toBe(await publisherKeyDigest(keys.publicKeyBase64));

    // A key that is not in the store is refused; its digest is what the id would
    // have been, which is why the refusal can still read as a publisher.
    const stranger = await checkPublisherTrust({ key: keys.publicKeyBase64 }, store());
    expect(stranger.ok).toBe(false);
    if (stranger.ok) return;
    expect(stranger.id).toBeNull();
  });

  // spec: S2.1
  it("only falls back to the first-party key for a legacy manifest when asked", async () => {
    const keys = await generatePackKeyPair();
    const firstParty = store({
      id: SUITE_PUBLISHER_ID,
      key: keys.publicKeyBase64,
      source: "preinstalled",
    });

    const strict = await checkPublisherTrust(undefined, firstParty);
    expect(strict.ok).toBe(false);
    if (strict.ok) return;
    expect(strict.reason).toBe("missing-publisher");

    const legacy = await checkPublisherTrust(undefined, firstParty, {
      allowMissingPublisher: true,
    });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.legacy).toBe(true);
    expect(legacy.publisher.id).toBe(SUITE_PUBLISHER_ID);
  });
});

describe("adding a publisher", () => {
  // spec: S2.1
  it("adds a key only when the confirmed fingerprint is that key's fingerprint", async () => {
    const keys = await generatePackKeyPair();
    const fingerprint = await publisherKeyFingerprint(keys.publicKeyBase64);

    const wrong = await addTrustedPublisher(store(), {
      key: keys.publicKeyBase64,
      fingerprint: "00".repeat(32),
      id: "acme",
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.reason).toBe("fingerprint-mismatch");
    expect(wrong.fingerprint).toBe(fingerprint);

    const added = await addTrustedPublisher(store(), {
      key: keys.publicKeyBase64,
      fingerprint,
      id: "acme",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.publisher).toMatchObject({ id: "acme", fingerprint });
    expect(added.store).toHaveLength(1);

    const decision = await checkPublisherTrust(
      { key: keys.publicKeyBase64, id: "acme" },
      added.store,
    );
    expect(decision.ok).toBe(true);
  });

  // spec: S2.1
  it("derives the id from the key when a pack does not name one", async () => {
    const keys = await generatePackKeyPair();
    const fingerprint = await publisherKeyFingerprint(keys.publicKeyBase64);
    const added = await addTrustedPublisher(store(), {
      key: keys.publicKeyBase64,
      fingerprint,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.publisher.id).toBe(await publisherKeyDigest(keys.publicKeyBase64));
  });

  // spec: S2.2
  it("refuses an id another key already owns and a key already trusted elsewhere", async () => {
    const first = await generatePackKeyPair();
    const second = await generatePackKeyPair();
    const firstPrint = await publisherKeyFingerprint(first.publicKeyBase64);
    const secondPrint = await publisherKeyFingerprint(second.publicKeyBase64);
    const existing = store({ id: "acme", key: first.publicKeyBase64 });

    const taken = await addTrustedPublisher(existing, {
      key: second.publicKeyBase64,
      fingerprint: secondPrint,
      id: "acme",
    });
    expect(taken.ok).toBe(false);
    if (taken.ok) return;
    expect(taken.reason).toBe("id-taken");

    const again = await addTrustedPublisher(existing, {
      key: first.publicKeyBase64,
      fingerprint: firstPrint,
      id: "other",
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("key-already-added");
  });
});
