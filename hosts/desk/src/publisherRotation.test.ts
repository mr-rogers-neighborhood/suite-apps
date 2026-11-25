import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPublisherTrust, generatePackKeyPair, publisherKeyFingerprint } from "@suite/pack";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPublisherRotation,
  ROTATION_KIND,
  type RotationStatementCore,
  signRotationStatement,
} from "./publisherRotation.js";
import {
  addTrustedPublisher,
  applyPublisherRotation,
  openPublisherTrust,
} from "./publisherTrust.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-desk-rotation-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function addPublisher(root: string, id: string, key: string): Promise<void> {
  const result = await addTrustedPublisher(root, {
    id,
    key,
    fingerprint: await publisherKeyFingerprint(key),
  });
  expect(result.ok).toBe(true);
}

function statement(
  publisher: string,
  sequence: number,
  previousKey: string,
  newKey: string,
  secret: string,
) {
  const core: RotationStatementCore = {
    kind: ROTATION_KIND,
    publisher,
    sequence,
    previousKey,
    newKey,
  };
  return signRotationStatement(core, secret);
}

describe("publisher key rotation", () => {
  // spec: S2.3
  it("accepts a rotation signed by the outgoing key after the person confirms the new fingerprint", async () => {
    const root = await temporaryRoot();
    const outgoing = await generatePackKeyPair();
    const incoming = await generatePackKeyPair();
    await addPublisher(root, "acme", outgoing.publicKeyBase64);

    const before = await openPublisherTrust(root);
    const rotation = statement(
      "acme",
      1,
      outgoing.publicKeyBase64,
      incoming.publicKeyBase64,
      outgoing.secretKeyBase64,
    );
    const check = await checkPublisherRotation(rotation, before.publishers);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.preview.newFingerprint).toBe(
      await publisherKeyFingerprint(incoming.publicKeyBase64),
    );
    // Verification alone writes nothing.
    expect((await openPublisherTrust(root)).publishers[1]?.key).toBe(outgoing.publicKeyBase64);

    // A different fingerprint is not the one the person saw.
    const unconfirmed = await applyPublisherRotation(root, {
      statement: rotation,
      fingerprint: "00".repeat(32),
    });
    expect(unconfirmed.ok).toBe(false);
    if (unconfirmed.ok) return;
    expect(unconfirmed.reason).toBe("fingerprint-mismatch");
    expect((await openPublisherTrust(root)).publishers[1]?.key).toBe(outgoing.publicKeyBase64);

    const applied = await applyPublisherRotation(root, {
      statement: rotation,
      fingerprint: await publisherKeyFingerprint(incoming.publicKeyBase64),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const after = await openPublisherTrust(root);
    const acme = after.publishers.find((publisher) => publisher.id === "acme");
    expect(acme).toMatchObject({
      id: "acme",
      key: incoming.publicKeyBase64,
      sequence: 1,
    });
    expect(acme?.retiredKeys?.[0]).toMatchObject({
      key: outgoing.publicKeyBase64,
      sequence: 0,
    });

    // The new key is what a new install resolves; the retired key still
    // resolves an already installed version when the scan asks for it.
    const current = await checkPublisherTrust(
      { id: "acme", key: incoming.publicKeyBase64 },
      after.publishers,
    );
    expect(current.ok).toBe(true);
    const retired = await checkPublisherTrust(
      { id: "acme", key: outgoing.publicKeyBase64 },
      after.publishers,
    );
    expect(retired.ok).toBe(false);
    const installedScan = await checkPublisherTrust(
      { id: "acme", key: outgoing.publicKeyBase64 },
      after.publishers,
      { allowRetiredKeys: true },
    );
    expect(installedScan.ok).toBe(true);
    if (!installedScan.ok) return;
    expect(installedScan.publisher.id).toBe("acme");
  });

  // spec: S2.3
  it("refuses a replayed rotation whose sequence is not above the accepted one", async () => {
    const root = await temporaryRoot();
    const first = await generatePackKeyPair();
    const second = await generatePackKeyPair();
    const third = await generatePackKeyPair();
    await addPublisher(root, "acme", first.publicKeyBase64);

    const rotation = statement(
      "acme",
      1,
      first.publicKeyBase64,
      second.publicKeyBase64,
      first.secretKeyBase64,
    );
    const applied = await applyPublisherRotation(root, {
      statement: rotation,
      fingerprint: await publisherKeyFingerprint(second.publicKeyBase64),
    });
    expect(applied.ok).toBe(true);

    // Same sequence, a different new key, correctly signed by the now current key.
    const replay = statement(
      "acme",
      1,
      second.publicKeyBase64,
      third.publicKeyBase64,
      second.secretKeyBase64,
    );
    const check = await checkPublisherRotation(replay, (await openPublisherTrust(root)).publishers);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("replayed");

    const refused = await applyPublisherRotation(root, {
      statement: replay,
      fingerprint: await publisherKeyFingerprint(third.publicKeyBase64),
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("replayed");
    expect((await openPublisherTrust(root)).publishers.find((p) => p.id === "acme")?.key).toBe(
      second.publicKeyBase64,
    );
  });

  // spec: S2.3
  it("refuses a rotation not signed by the publisher's outgoing key", async () => {
    const root = await temporaryRoot();
    const outgoing = await generatePackKeyPair();
    const incoming = await generatePackKeyPair();
    const stranger = await generatePackKeyPair();
    await addPublisher(root, "acme", outgoing.publicKeyBase64);

    // Claims the outgoing key, but the signature is by someone else.
    const forged = statement(
      "acme",
      1,
      outgoing.publicKeyBase64,
      incoming.publicKeyBase64,
      stranger.secretKeyBase64,
    );
    const forgedCheck = await checkPublisherRotation(
      forged,
      (await openPublisherTrust(root)).publishers,
    );
    expect(forgedCheck.ok).toBe(false);
    if (forgedCheck.ok) return;
    expect(forgedCheck.reason).toBe("bad-signature");

    // Signed by a key that is not the store's current key for this id.
    const wrongOutgoing = statement(
      "acme",
      1,
      stranger.publicKeyBase64,
      incoming.publicKeyBase64,
      stranger.secretKeyBase64,
    );
    const wrongCheck = await checkPublisherRotation(
      wrongOutgoing,
      (await openPublisherTrust(root)).publishers,
    );
    expect(wrongCheck.ok).toBe(false);
    if (wrongCheck.ok) return;
    expect(wrongCheck.reason).toBe("wrong-outgoing-key");

    for (const refusal of [
      await applyPublisherRotation(root, {
        statement: forged,
        fingerprint: await publisherKeyFingerprint(incoming.publicKeyBase64),
      }),
      await applyPublisherRotation(root, {
        statement: wrongOutgoing,
        fingerprint: await publisherKeyFingerprint(incoming.publicKeyBase64),
      }),
    ]) {
      expect(refusal.ok).toBe(false);
    }
    expect((await openPublisherTrust(root)).publishers.find((p) => p.id === "acme")?.key).toBe(
      outgoing.publicKeyBase64,
    );
  });
});
