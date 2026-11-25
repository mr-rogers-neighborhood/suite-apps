import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { decodeBase64 } from "./base64.js";
import { canonicalJson } from "./canonical.js";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";

/**
 * The one record a workspace's root key signs.
 *
 * A workspace made under the blind relay has an identity root: an Ed25519 key that
 * names the workspace and signs its first record. It encrypts nothing and signs
 * nothing else. This module defines the record and the id derivation; the crypto
 * that generates and signs a key stays in the app, as it does for device ids.
 *
 * The record is deliberately public metadata: a workspace id, a creation time, the
 * creating device and its key, the relay the workspace was made against. It carries
 * no document id and no content, so it is safe to read and safe to keep.
 *
 * A workspace shared before this record exists has an id that is not a root hash and
 * no genesis. That is not an invalid workspace; it is one without an identity root,
 * and nothing here migrates it.
 */
export const genesisRecordSchema = z
  .object({
    /** The workspace this record founds. */
    workspaceId: workspaceIdSchema,
    /** Base64 of the workspace's Ed25519 root public key. */
    rootPublicKey: z.string().min(1),
    /** ISO-8601, written by the device that founded the workspace. */
    createdAt: z.string().min(1),
    /** The creating device, which is the only device that holds the root. */
    deviceId: deviceIdSchema,
    /** Base64 of the creating device's install key, so the genesis names who made it. */
    devicePublicKey: z.string().min(1),
    /** The relay address the workspace was created against. */
    relay: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict();

export type GenesisRecord = z.infer<typeof genesisRecordSchema>;

/** The part of a genesis that is signed, and the part that is not. */
export type GenesisBody = Omit<GenesisRecord, "signature">;

export type GenesisVerifier = (
  payload: string,
  signature: string,
  rootPublicKey: string,
) => boolean;

/** The bytes the root signs. Canonical, so two builders of one record agree. */
export function genesisPayload(record: GenesisBody): string {
  return canonicalJson({
    workspaceId: record.workspaceId,
    rootPublicKey: record.rootPublicKey,
    createdAt: record.createdAt,
    deviceId: record.deviceId,
    devicePublicKey: record.devicePublicKey,
    relay: record.relay,
  });
}

const ROOT_KEY_BYTES = 32;

/**
 * The workspace id a root public key implies: SHA-256 of its 32 raw bytes, hex.
 *
 * This is the derivation the identity table names. It is a function rather than a
 * field so a host or a peer can check that a workspace id really is a root hash
 * instead of taking the claim on trust.
 */
export function workspaceIdFromRootKey(rootPublicKey: string): string {
  const bytes = decodeBase64(rootPublicKey);
  if (bytes === null || bytes.length !== ROOT_KEY_BYTES) {
    throw new Error("a root public key is 32 bytes of base64");
  }
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether the id this genesis names is derived from the root it carries.
 *
 * A workspace created under the blind relay answers true. A `genesis` written for a
 * workspace whose id predates the root — the tree's Canvas documents, which own their
 * ids before sharing — answers false and is still a valid record: the root signs the
 * id in use rather than replacing it. Callers that require a root hash must ask.
 */
export function genesisNamesItsRoot(
  record: Pick<GenesisRecord, "workspaceId" | "rootPublicKey">,
): boolean {
  try {
    return workspaceIdFromRootKey(record.rootPublicKey) === record.workspaceId;
  } catch {
    return false;
  }
}

/**
 * Whether the root really signed this record.
 *
 * The key is taken from the record, so this proves possession of the root, not that
 * the root belongs to the workspace: `genesisNamesItsRoot` is the second half. Both
 * are checks a reader can make without trusting whoever handed the record over.
 */
export function verifyGenesis(record: GenesisRecord, verify: GenesisVerifier): boolean {
  try {
    return verify(genesisPayload(record), record.signature, record.rootPublicKey);
  } catch {
    return false;
  }
}
