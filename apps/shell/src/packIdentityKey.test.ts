import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToBase64, publicKeyFromSecret, verifyBytes } from "@suite/pack";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEVICE_KEY_FILE,
  type DeviceKey,
  derivePackKey,
  openDeviceKey,
  PackSigningRefusal,
  packIdentityView,
  signPackRecord,
} from "./packIdentityKey.js";

const here = dirname(fileURLToPath(import.meta.url));

/** A fixed device seed, so two runs derive the same keys. */
const DEVICE_SECRET = bytesToBase64(new Uint8Array(32).fill(7));
const DEVICE: DeviceKey = {
  version: 1,
  secretKey: DEVICE_SECRET,
  publicKey: publicKeyFromSecret(DEVICE_SECRET),
};

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-identity-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("per-pack identity derivation", () => {
  // spec: S2.6
  it("derives a different key for each pack from one host device key", () => {
    const canvas = derivePackKey(DEVICE, "suite", "canvas");
    const planner = derivePackKey(DEVICE, "suite", "planner");

    expect(canvas.publicKey).not.toBe(planner.publicKey);
    expect(canvas.secretKey).not.toBe(planner.secretKey);
    expect(canvas.publicKey).not.toBe(DEVICE.publicKey);
    expect(canvas.secretKey).not.toBe(DEVICE.secretKey);
  });

  // spec: S2.6
  it("keys the derivation on (publisher id, pack id), not the pack id alone", () => {
    const suiteCanvas = derivePackKey(DEVICE, "suite", "canvas");
    const acmeCanvas = derivePackKey(DEVICE, "acme", "canvas");

    // One id under two publishers is two install identities (S2.2), so it is
    // two keys; a migrated publisher inherits no identity.
    expect(acmeCanvas.publicKey).not.toBe(suiteCanvas.publicKey);
    // The same tuple is stable across calls, so a restart does not change it.
    expect(derivePackKey(DEVICE, "suite", "canvas").publicKey).toBe(suiteCanvas.publicKey);
  });

  // spec: S2.6
  it("keeps a host device key in its own file with owner-only permissions", async () => {
    const root = await temporaryRoot();
    const created = await openDeviceKey(root);
    const reopened = await openDeviceKey(root);

    expect(reopened.secretKey).toBe(created.secretKey);
    expect(reopened.publicKey).toBe(created.publicKey);
    const mode = (await stat(join(root, DEVICE_KEY_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // spec: S2.6
  it("refuses a malformed device key instead of minting a new identity", async () => {
    const root = await temporaryRoot();
    await openDeviceKey(root);
    await writeFile(join(root, DEVICE_KEY_FILE), "{}\n");

    await expect(openDeviceKey(root)).rejects.toThrow(/device key/u);
  });
});

describe("what a pack receives", () => {
  // spec: S4.7
  it("returns the public identity and no device key or derived secret", async () => {
    const key = derivePackKey(DEVICE, "suite", "canvas");
    const view = await packIdentityView(key);

    expect(view).toEqual({
      publisherId: "suite",
      packId: "canvas",
      algorithm: "Ed25519",
      publicKey: key.publicKey,
      fingerprint: expect.stringMatching(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u),
    });
    expect("secretKey" in view).toBe(false);

    // The bridge's value must not contain either secret. The public device key
    // is not secret, but it is still not the pack's identity and never appears.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(DEVICE.secretKey);
    expect(serialised).not.toContain(DEVICE.publicKey);
  });

  // spec: S4.7
  it("exposes only a public identity and a scoped sign call on the bridge", async () => {
    const preload = await readFile(join(here, "preload", "pack.cjs"), "utf8");

    expect(preload).toContain("identity: {");
    expect(preload).toContain('"suite:identity:pack"');
    expect(preload).toContain('"suite:identity:sign"');
    // No device key, no derived secret, and no way to name one across the IPC.
    expect(preload).not.toMatch(/device/iu);
    expect(preload).not.toMatch(/secret/iu);
  });
});

describe("what a pack key may sign", () => {
  // spec: S4.7
  it("refuses a relay frame, a role record and a membership change", () => {
    const key = derivePackKey(DEVICE, "suite", "canvas");
    const bytes = new TextEncoder().encode("not the pack's data");

    const refusals = [
      ["relay-frame", /relay frame/u],
      ["role-record", /relay role record/u],
      ["membership-change", /membership change/u],
    ] as const;
    for (const [purpose, message] of refusals) {
      expect(() => signPackRecord(purpose, bytes, key.secretKey)).toThrow(PackSigningRefusal);
      expect(() => signPackRecord(purpose, bytes, key.secretKey)).toThrow(message);
    }
  });

  // spec: S2.6
  it("signs the pack's own data with the derived key, not the device key", () => {
    const key = derivePackKey(DEVICE, "suite", "canvas");
    const bytes = new TextEncoder().encode("canvas document bytes");

    const signature = signPackRecord("pack-data", bytes, key.secretKey);
    expect(verifyBytes(bytes, signature, key.publicKey)).toBe(true);
    expect(verifyBytes(bytes, signature, DEVICE.publicKey)).toBe(false);
  });
});
