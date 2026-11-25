import { type PackRecordPurpose, PackSigningRefusal, verifyPackRecord } from "@suite/go";
import { describe, expect, it } from "vitest";
import {
  createPackIdentity,
  DEVICE_KEY_FILE,
  IDENTITY_ROOT,
  type IdentityStorage,
  openDeviceKey,
} from "./packIdentity.js";

function memoryStorage(): IdentityStorage & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, text) {
      files.set(path, text);
    },
  };
}

describe("the host device key", () => {
  it("creates one key on first use and reopens the same key", async () => {
    const storage = memoryStorage();
    const created = await openDeviceKey(storage);
    const reopened = await openDeviceKey(storage);

    expect(reopened.secretKey).toBe(created.secretKey);
    expect(reopened.publicKey).toBe(created.publicKey);
    expect(storage.files.has(`${IDENTITY_ROOT}/${DEVICE_KEY_FILE}`)).toBe(true);
  });

  it("refuses a malformed key instead of minting a new identity", async () => {
    const storage = memoryStorage();
    const path = `${IDENTITY_ROOT}/${DEVICE_KEY_FILE}`;
    await storage.write(path, "{}");

    await expect(openDeviceKey(storage)).rejects.toThrow(/device key/u);
    // The bad file stays exactly where the person can inspect or remove it; a
    // silent replacement would change every pack identity at once.
    expect(storage.files.get(path)).toBe("{}");
  });
});

describe("the identity a mounted pack sees", () => {
  it("exposes the public half and a scoped signature, never the secret", async () => {
    const device = await openDeviceKey(memoryStorage());
    const identity = createPackIdentity(device, "suite", "canvas");

    const view = await identity.pack();
    expect(view).toMatchObject({
      publisherId: "suite",
      packId: "canvas",
      algorithm: "Ed25519",
    });
    expect("secretKey" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain(device.secretKey);

    const bytes = new TextEncoder().encode("canvas data");
    const signature = await identity.sign("pack-data", bytes);
    expect(await verifyPackRecord(bytes, signature, view.publicKey)).toBe(true);
  });

  it("refuses a relay frame, a role record and a membership change", async () => {
    const device = await openDeviceKey(memoryStorage());
    const identity = createPackIdentity(device, "suite", "canvas");

    const refusals: readonly PackRecordPurpose[] = [
      "relay-frame",
      "role-record",
      "membership-change",
    ];
    for (const purpose of refusals) {
      await expect(identity.sign(purpose, new Uint8Array(1))).rejects.toBeInstanceOf(
        PackSigningRefusal,
      );
    }
  });
});
