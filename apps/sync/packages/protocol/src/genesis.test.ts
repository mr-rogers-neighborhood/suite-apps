import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type GenesisRecord,
  genesisNamesItsRoot,
  genesisPayload,
  genesisRecordSchema,
  verifyGenesis,
  workspaceIdFromRootKey,
} from "./genesis.js";

const rootPublicKey = Buffer.alloc(32, 7).toString("base64");
const deviceId = "b".repeat(64);
const workspaceId = workspaceIdFromRootKey(rootPublicKey);

function record(overrides: Partial<GenesisRecord> = {}): GenesisRecord {
  const unsigned = {
    workspaceId,
    rootPublicKey,
    createdAt: "2026-11-06T12:00:00.000Z",
    deviceId,
    devicePublicKey: Buffer.alloc(32, 9).toString("base64"),
    relay: "ws://127.0.0.1:8787/sync",
  };
  return { ...unsigned, signature: `root-signed:${genesisPayload(unsigned)}`, ...overrides };
}

/** The host's rule, stood in for: the signature names the key that made it. */
const verifier = (payload: string, signature: string, key: string) =>
  key === rootPublicKey && signature === `root-signed:${payload}`;

describe("the root names the workspace", () => {
  it("derives the workspace id from the root public key", () => {
    // Same derivation as the device id: SHA-256 of the raw public key, lower-case hex.
    expect(workspaceId).toBe(createHash("sha256").update(Buffer.alloc(32, 7)).digest("hex"));
    expect(workspaceId).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("refuses a key that is not 32 bytes, rather than hashing whatever it is", () => {
    expect(() => workspaceIdFromRootKey(Buffer.alloc(31, 7).toString("base64"))).toThrow();
    expect(() => workspaceIdFromRootKey("not base64")).toThrow();
  });

  it("says whether an id is a root hash", () => {
    expect(genesisNamesItsRoot(record())).toBe(true);
    // A workspace whose id predates the root: the root signs the id in use rather than
    // replacing it, so the record is valid and the id is not a hash of the root.
    expect(genesisNamesItsRoot(record({ workspaceId: "c".repeat(64) }))).toBe(false);
  });
});

describe("the genesis the root signs", () => {
  it("verifies against the key it carries", () => {
    expect(verifyGenesis(record(), verifier)).toBe(true);
  });

  it("stops verifying when any signed field is rewritten", () => {
    expect(verifyGenesis(record({ deviceId: "d".repeat(64) }), verifier)).toBe(false);
    expect(verifyGenesis(record({ relay: "ws://elsewhere.test/sync" }), verifier)).toBe(false);
    expect(verifyGenesis(record({ createdAt: "2026-11-07T12:00:00.000Z" }), verifier)).toBe(false);
    expect(verifyGenesis(record({ signature: "forged" }), verifier)).toBe(false);
  });

  it("signs the values, not the order they were written in", () => {
    const one = genesisPayload({ ...record() });
    const two = genesisPayload({
      relay: "ws://127.0.0.1:8787/sync",
      devicePublicKey: Buffer.alloc(32, 9).toString("base64"),
      deviceId,
      createdAt: "2026-11-06T12:00:00.000Z",
      rootPublicKey,
      workspaceId,
    });
    expect(two).toBe(one);
  });

  it("is strict about what a record may carry", () => {
    expect(genesisRecordSchema.safeParse(record()).success).toBe(true);
    expect(genesisRecordSchema.safeParse({ ...record(), documentId: "not a field" }).success).toBe(
      false,
    );
    expect(genesisRecordSchema.safeParse({ ...record(), workspaceId: "not-an-id" }).success).toBe(
      false,
    );
  });
});
