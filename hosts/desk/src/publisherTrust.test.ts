import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generatePackKeyPair,
  isSafePublisherId,
  publisherKeyFingerprint,
  SUITE_PACK_PUBLIC_KEY,
  SUITE_PUBLISHER_ID,
} from "@suite/pack";
import { afterEach, describe, expect, it } from "vitest";
import {
  addTrustedPublisher,
  openPublisherTrust,
  preinstalledTrustStore,
  TRUST_STORE_FILE,
  trustRootFor,
} from "./publisherTrust.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-desk-trust-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("the publisher trust store", () => {
  // spec: S2.1
  it("preinstalls the first-party key and writes the store where a person can read it", async () => {
    const root = await temporaryRoot();
    const store = await openPublisherTrust(root);

    expect(store.publishers).toHaveLength(1);
    expect(store.publishers[0]).toMatchObject({
      id: SUITE_PUBLISHER_ID,
      key: SUITE_PACK_PUBLIC_KEY,
      source: "preinstalled",
    });
    expect(store.publishers[0]?.fingerprint).toBe(
      await publisherKeyFingerprint(SUITE_PACK_PUBLIC_KEY),
    );

    const file = JSON.parse(await readFile(join(root, TRUST_STORE_FILE), "utf8")) as {
      version: number;
      publishers: { id: string }[];
    };
    expect(file.version).toBe(1);
    expect(file.publishers.map((publisher) => publisher.id)).toEqual([SUITE_PUBLISHER_ID]);
  });

  // spec: S2.1
  it("adds a key only after the person confirms the fingerprint that key actually has", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    const fingerprint = await publisherKeyFingerprint(keys.publicKeyBase64);

    const wrong = await addTrustedPublisher(root, {
      key: keys.publicKeyBase64,
      fingerprint: "00".repeat(32),
      id: "acme",
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.reason).toBe("fingerprint-mismatch");
    expect((await openPublisherTrust(root)).publishers).toHaveLength(1);

    const added = await addTrustedPublisher(root, {
      key: keys.publicKeyBase64,
      fingerprint,
      id: "acme",
    });
    expect(added.ok).toBe(true);

    const reopened = await openPublisherTrust(root);
    expect(reopened.publishers).toHaveLength(2);
    expect(reopened.publishers[1]).toMatchObject({
      id: "acme",
      key: keys.publicKeyBase64,
      fingerprint,
      source: "added",
    });
    expect(isSafePublisherId("acme")).toBe(true);
  });

  // spec: S2.1
  it("keeps the pinned key when the file omits, edits or duplicates it", async () => {
    const root = await temporaryRoot();
    const keys = await generatePackKeyPair();
    await writeFile(
      join(root, TRUST_STORE_FILE),
      JSON.stringify({
        version: 1,
        publishers: [
          { id: SUITE_PUBLISHER_ID, key: keys.publicKeyBase64, source: "added" },
          { id: "other", key: keys.publicKeyBase64, source: "added" },
        ],
      }),
    );

    const store = await openPublisherTrust(root);
    expect(store.publishers).toHaveLength(2);
    expect(store.publishers[0]).toMatchObject({
      id: SUITE_PUBLISHER_ID,
      key: SUITE_PACK_PUBLIC_KEY,
      source: "preinstalled",
    });
    expect(store.publishers[1]?.id).toBe("other");
  });

  // spec: S2.1
  it("fails closed on a malformed store and leaves it alone", async () => {
    const root = await temporaryRoot();
    const path = join(root, TRUST_STORE_FILE);
    const broken = "{ this is not a trust store";
    await writeFile(path, broken);

    const store = await openPublisherTrust(root);
    expect(store.publishers).toHaveLength(1);
    expect(store.publishers[0]?.id).toBe(SUITE_PUBLISHER_ID);
    expect(await readFile(path, "utf8")).toBe(broken);
  });

  it("defaults to the data root and honours the override", () => {
    expect(trustRootFor("/data/desk", {})).toBe("/data/desk/trust");
    expect(trustRootFor("/data/desk", { SUITE_DESK_TRUST: "/media/trust" })).toBe("/media/trust");
    expect(trustRootFor("/data/desk", { SUITE_DESK_TRUST: "   " })).toBe("/data/desk/trust");
  });

  it("builds an in-memory preinstalled store when the file cannot be opened", async () => {
    const store = await preinstalledTrustStore();
    expect(store.publishers).toHaveLength(1);
    expect(store.publishers[0]?.key).toBe(SUITE_PACK_PUBLIC_KEY);
  });
});
