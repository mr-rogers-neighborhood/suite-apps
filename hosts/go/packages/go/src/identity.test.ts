import { verify } from "@noble/ed25519";
import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  derivePackKey,
  derivePackSecretKey,
  FIRST_PARTY_PUBLISHER_ID,
  generateDeviceKey,
  type PackRecordPurpose,
  PackSigningRefusal,
  packIdentityView,
  publicKeyFromSecret,
  signPackRecord,
} from "./identity.js";

/**
 * Cross-host vectors for the per-pack identity (S2.6, S4.7).
 *
 * The expected values were produced by the desktop host's derivation
 * (`hosts/desk/src/packIdentityKey.ts`, HKDF-SHA256 over a fixed 0x07 device
 * seed). Go must derive the same key from the same tuple, or one identity does
 * not work across both hosts.
 */

/** A fixed device seed: 32 bytes of 0x07, the desktop test's seed. */
const DEVICE_SECRET = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

const DEVICE = {
  version: 1 as const,
  secretKey: DEVICE_SECRET,
  publicKey: publicKeyFromSecret(DEVICE_SECRET),
};

describe("the per-pack derivation vectors", () => {
  // spec: S2.6
  it("derives the same secret and public key the desktop host derives", () => {
    expect(derivePackSecretKey(DEVICE_SECRET, "suite", "canvas")).toBe(
      "MMW8laoHeYhN7SaUAsKt35DbiEP5WwiCcIP61taUnyg=",
    );
    expect(derivePackKey(DEVICE, "suite", "canvas").publicKey).toBe(
      "vQCpE4OhnQYGhnD/7BqK6x7AoipKZyTpznRwzzEp11U=",
    );

    expect(derivePackSecretKey(DEVICE_SECRET, "suite", "planner")).toBe(
      "m9e59wACeqJw2YsMR5/RU/QjE8QrdDvZ/fEjcPZX4vw=",
    );
    expect(derivePackKey(DEVICE, "suite", "planner").publicKey).toBe(
      "Q3faLywYlXu3fqaIeKdX6Zn/LBC6q1HGlUuZZO9ktM8=",
    );
  });

  // spec: S2.6
  it("keys the derivation on (publisher id, pack id), not the pack id alone", () => {
    const suiteCanvas = derivePackKey(DEVICE, "suite", "canvas");
    const acmeCanvas = derivePackKey(DEVICE, "acme", "canvas");

    expect(acmeCanvas.secretKey).toBe("9gwt+YwKUBt73g0JyPPPS6dJSys2jTlKK8h95+mcC+Q=");
    expect(acmeCanvas.publicKey).toBe("Hj/LmiUlsZAvYRUjZAPFm+VYUSPf+1vCQtMyrbERZGE=");
    expect(acmeCanvas.publicKey).not.toBe(suiteCanvas.publicKey);

    // The same tuple is stable across calls, so a restart does not change it.
    expect(derivePackKey(DEVICE, "suite", "canvas").publicKey).toBe(suiteCanvas.publicKey);
    // The device key is not the pack key.
    expect(suiteCanvas.publicKey).not.toBe(DEVICE.publicKey);
    expect(suiteCanvas.secretKey).not.toBe(DEVICE.secretKey);
  });

  // spec: S4.7
  it("returns the public identity, its fingerprint, and no secret", async () => {
    const key = derivePackKey(DEVICE, "suite", "canvas");
    const view = await packIdentityView(key);

    expect(view).toEqual({
      publisherId: "suite",
      packId: "canvas",
      algorithm: "Ed25519",
      publicKey: "vQCpE4OhnQYGhnD/7BqK6x7AoipKZyTpznRwzzEp11U=",
      fingerprint:
        "74:E5:0B:94:06:5B:12:51:7D:94:D6:9B:0C:8F:8A:EB:91:0D:5D:9C:7D:29:47:20:22:15:94:A4:1B:06:74:47",
    });
    expect("secretKey" in view).toBe(false);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(DEVICE.secretKey);
    expect(serialised).not.toContain(key.secretKey);
  });

  // spec: S2.6
  it("mints a device key whose public half matches its secret", () => {
    const created = generateDeviceKey();
    expect(created.publicKey).toBe(publicKeyFromSecret(created.secretKey));
    expect(base64ToBytes(created.secretKey)).toHaveLength(32);
  });

  it("uses the first-party publisher id as the default identity namespace", () => {
    expect(FIRST_PARTY_PUBLISHER_ID).toBe("suite");
  });
});

describe("what a pack key may sign", () => {
  // spec: S4.7
  it("refuses a relay frame, a role record and a membership change", () => {
    const key = derivePackKey(DEVICE, "suite", "canvas");
    const bytes = new TextEncoder().encode("not the pack's data");

    const refusals: readonly PackRecordPurpose[] = [
      "relay-frame",
      "role-record",
      "membership-change",
    ];
    for (const purpose of refusals) {
      expect(() => signPackRecord(purpose, bytes, key.secretKey)).toThrow(PackSigningRefusal);
    }
    expect(() => signPackRecord("relay-frame", bytes, key.secretKey)).toThrow(/relay frame/u);
    expect(() => signPackRecord("role-record", bytes, key.secretKey)).toThrow(/relay role record/u);
    expect(() => signPackRecord("membership-change", bytes, key.secretKey)).toThrow(
      /membership change/u,
    );
  });

  // spec: S2.6
  it("signs the pack's own data with the derived key, not the device key", async () => {
    const key = derivePackKey(DEVICE, "suite", "canvas");
    const bytes = new TextEncoder().encode("canvas document bytes");
    const signature = signPackRecord("pack-data", bytes, key.secretKey);

    expect(await verify(base64ToBytes(signature), bytes, base64ToBytes(key.publicKey))).toBe(true);
    expect(await verify(base64ToBytes(signature), bytes, base64ToBytes(DEVICE.publicKey))).toBe(
      false,
    );
  });
});
