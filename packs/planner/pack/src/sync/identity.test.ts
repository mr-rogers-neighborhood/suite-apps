import { describe, expect, it } from "vitest";
import { loadOrCreateIdentity, verifyEd25519 } from "./identity";
import { memoryScopedFiles } from "./testFiles";

describe("the pack's sync identity", () => {
  it("keeps one installation key in the pack's own files root", async () => {
    const store = memoryScopedFiles();
    const first = await loadOrCreateIdentity(store.service);
    const second = await loadOrCreateIdentity(store.service);

    expect(second.deviceId).toBe(first.deviceId);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.path).toBe("sync/identity.json");
    expect(store.paths).toContain("sync/identity.json");
    expect(store.files.has("sync/identity.json")).toBe(true);
    // The key is a pack file, never browser storage.
    expect(localStorage.length).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(store.files.get("sync/identity.json")))).toMatchObject(
      { version: 1 },
    );
  });

  it("signs a frame header with a signature the same key verifies", async () => {
    const store = memoryScopedFiles();
    const identity = await loadOrCreateIdentity(store.service);
    const payload = new TextEncoder().encode("suite:frame:test");
    const signature = identity.sign(payload);

    expect(verifyEd25519("suite:frame:test", signature, identity.publicKey)).toBe(true);
    expect(verifyEd25519("suite:frame:changed", signature, identity.publicKey)).toBe(false);
  });

  it("refuses to invent a key without a files service", async () => {
    await expect(loadOrCreateIdentity(undefined)).rejects.toThrow(/files root/u);
  });
});
