import type { PackPublisher } from "./manifest.js";
import { SUITE_PUBLISHER_ID } from "./pinnedKey.js";
import { base64ToBytes } from "./signature.js";

export { SUITE_PUBLISHER_ID } from "./pinnedKey.js";

/**
 * Publisher trust (S2.1, S2.2).
 *
 * A manifest names the Ed25519 key that signed it. That key is only meaningful
 * when a *local trust store* already holds it: a signature proves the pack came
 * from whoever owns a key, not that the person ever chose to trust that owner.
 * This module is the pure half of that decision. It computes the fingerprint a
 * person reads, matches a manifest against the keys a host trusts, and refuses
 * an addition whose fingerprint is not the one the person confirmed.
 *
 * The store itself is host policy and lives in the host (the shell keeps it in
 * `<dataRoot>/trust/publishers.json`). Keeping the decision here means the phone
 * and the desktop can agree on what a fingerprint is without agreeing on where
 * the file sits.
 */

/**
 * A fingerprint is the SHA-256 of the 32 raw key bytes, written as upper-case
 * pairs joined by colons: `AB:CD:…:89`.
 *
 * That is the shape `openssl` and the sync relay already print, so a person
 * reads the same kind of value everywhere. It identifies the key, not the
 * publisher: the stable `id` survives a rotation (S2.3).
 */
export async function publisherKeyFingerprint(keyBase64: string): Promise<string> {
  const hex = await publisherKeyDigest(keyBase64);
  return hex.match(/.{2}/gu)?.join(":").toUpperCase() ?? hex.toUpperCase();
}

/**
 * The same digest as lower-case hex with no separators: 64 characters, which
 * is a safe path segment and the id a key gets when a manifest omits one.
 */
export async function publisherKeyDigest(keyBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    base64ToBytes(keyBase64) as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read a fingerprint a person copied, in either case and with or without colons. */
export function normalisePublisherFingerprint(value: string): string | null {
  const hex = value
    .trim()
    .replace(/^sha-?256\s*[:=]?\s*/iu, "")
    .replace(/[\s:]/gu, "")
    .toUpperCase();
  if (!/^[0-9A-F]{64}$/u.test(hex)) return null;
  return hex.match(/.{2}/gu)?.join(":") ?? hex;
}

const PUBLISHER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** A stable publisher id, safe as one path segment. */
export function isSafePublisherId(value: string): boolean {
  return PUBLISHER_ID.test(value);
}

/** Whether a string decodes to exactly the 32 bytes an Ed25519 public key is. */
export function isPublisherKey(value: string): boolean {
  try {
    return base64ToBytes(value).byteLength === 32;
  } catch {
    return false;
  }
}

/** A key a rotation retired. It still verifies already installed versions (S2.3). */
export interface RetiredPublisherKey {
  /** Standard base64 of the raw 32-byte Ed25519 public key. */
  readonly key: string;
  readonly fingerprint: string;
  /** The last sequence this key was current at. */
  readonly sequence: number;
}

/** One key a host has chosen to trust, and the stable id it belongs to. */
export interface TrustedPublisher {
  readonly id: string;
  /** Standard base64 of the raw 32-byte Ed25519 public key. */
  readonly key: string;
  /** The digest at the time the key was added. Recomputed when it matters. */
  readonly fingerprint?: string;
  readonly source?: "preinstalled" | "added";
  /** The last rotation sequence this host accepted for the id (S2.3). */
  readonly sequence?: number;
  /**
   * Keys this id rotated away from. They verify installed versions, never a new
   * install: a new archive must be signed by the current key.
   */
  readonly retiredKeys?: readonly RetiredPublisherKey[];
}

/** A publisher resolved through the store, with the fingerprint this host computes. */
export interface ResolvedPublisher {
  readonly id: string;
  readonly key: string;
  readonly fingerprint: string;
}

export type PublisherTrustFailureReason =
  | "missing-publisher"
  | "unknown-publisher"
  | "publisher-id-mismatch";

export type PublisherTrust =
  | { readonly ok: true; readonly publisher: ResolvedPublisher; readonly legacy: boolean }
  | {
      readonly ok: false;
      readonly reason: PublisherTrustFailureReason;
      /** The fingerprint a person needs to see; null only when no key was named. */
      readonly fingerprint: string | null;
      readonly key: string | null;
      readonly id: string | null;
      readonly message: string;
    };

export interface PublisherTrustOptions {
  /**
   * Accept a manifest that names no publisher, resolving it to the preinstalled
   * first-party key. Only a scan of an install from before S2.1 passes this; a
   * new install never does, so a pack cannot skip the publisher field.
   */
  readonly allowMissingPublisher?: boolean;
  /** The id the preinstalled first-party key carries. Defaults to `suite`. */
  readonly firstPartyId?: string;
  /**
   * Resolve a key a rotation retired under the same id. Only an installed-version
   * scan passes this: a new install must use the current key (S2.3).
   */
  readonly allowRetiredKeys?: boolean;
}

async function resolve(entry: TrustedPublisher): Promise<ResolvedPublisher> {
  return {
    id: entry.id,
    key: entry.key,
    fingerprint: await publisherKeyFingerprint(entry.key),
  };
}

/**
 * Decide whether a manifest's publisher key is one this host trusts.
 *
 * A trusted key and a matching id are not the same as a good signature: the
 * caller still verifies the signature against the returned key. An unknown key
 * is refused with its fingerprint, which is the one fact that makes the refusal
 * actionable: it is what a person compares before adding the key.
 */
export async function checkPublisherTrust(
  publisher: PackPublisher | undefined,
  store: readonly TrustedPublisher[],
  options: PublisherTrustOptions = {},
): Promise<PublisherTrust> {
  const firstPartyId = options.firstPartyId ?? SUITE_PUBLISHER_ID;

  if (publisher === undefined || publisher.key.trim().length === 0) {
    if (options.allowMissingPublisher !== true) {
      return {
        ok: false,
        reason: "missing-publisher",
        fingerprint: null,
        key: null,
        id: null,
        message: "This pack does not name a publisher key, and a new install must carry one.",
      };
    }
    const firstParty = store.find((entry) => entry.id === firstPartyId);
    if (firstParty === undefined) {
      return {
        ok: false,
        reason: "missing-publisher",
        fingerprint: null,
        key: null,
        id: null,
        message: `This pack does not name a publisher key, and this host has no ${firstPartyId} key to fall back to.`,
      };
    }
    return { ok: true, legacy: true, publisher: await resolve(firstParty) };
  }

  if (!isPublisherKey(publisher.key)) {
    return {
      ok: false,
      reason: "unknown-publisher",
      fingerprint: null,
      key: publisher.key,
      id: publisher.id ?? null,
      message: "This pack names a publisher key that is not a 32-byte base64 Ed25519 key.",
    };
  }

  const fingerprint = await publisherKeyFingerprint(publisher.key);
  const current = store.find((candidate) => candidate.key === publisher.key);
  const retired =
    current === undefined && options.allowRetiredKeys === true
      ? store.find((candidate) =>
          candidate.retiredKeys?.some((candidateKey) => candidateKey.key === publisher.key),
        )
      : undefined;
  const entry = current ?? retired;
  if (entry === undefined) {
    const named = publisher.id === undefined ? "(no id)" : publisher.id;
    return {
      ok: false,
      reason: "unknown-publisher",
      fingerprint,
      key: publisher.key,
      id: publisher.id ?? null,
      message: `This pack is signed by publisher ${named} with key fingerprint ${fingerprint}, which is not in this host's trust store.`,
    };
  }

  if (publisher.id !== undefined && publisher.id !== entry.id) {
    return {
      ok: false,
      reason: "publisher-id-mismatch",
      fingerprint,
      key: publisher.key,
      id: publisher.id,
      message: `This pack claims publisher id ${publisher.id}, but that key belongs to ${entry.id}. A pack cannot claim another publisher's id.`,
    };
  }

  // S2.2: a publisher id is stable across rotation, so a manifest that omits one
  // has only its key to name it. The store confirms the key is trusted; the id
  // is the key's digest for the current key, and the id the store holds for a
  // retired one (its digest is no longer the id).
  const id =
    publisher.id ?? (retired === undefined ? await publisherKeyDigest(publisher.key) : entry.id);
  return {
    ok: true,
    legacy: false,
    publisher: { id, key: publisher.key, fingerprint },
  };
}

/** Whether a key is already in the store. The shell uses it to decide what to offer. */
export function isPublisherKeyTrusted(store: readonly TrustedPublisher[], key: string): boolean {
  return store.some((entry) => entry.key === key);
}

export type PublisherAdditionFailureReason =
  | "invalid-key"
  | "invalid-id"
  | "fingerprint-mismatch"
  | "key-already-added"
  | "id-taken";

export type PublisherAddition =
  | {
      readonly ok: true;
      readonly publisher: ResolvedPublisher;
      readonly store: readonly TrustedPublisher[];
    }
  | {
      readonly ok: false;
      readonly reason: PublisherAdditionFailureReason;
      readonly fingerprint: string | null;
      readonly message: string;
    };

export interface PublisherAdditionRequest {
  /** The key the person is adding, standard base64. */
  readonly key: string;
  /** The fingerprint the person was shown. It must be this key's fingerprint. */
  readonly fingerprint: string;
  /** The id the pack claims, when it names one. */
  readonly id?: string;
}

/**
 * Add a publisher key only after the person confirms its fingerprint.
 *
 * The confirmation is checked, not echoed: the caller passes the value it
 * displayed, and a different key is refused rather than trusted. The id is the
 * manifest's claimed id when it has one; an id that already belongs to another
 * key is refused, because changing the key under an id is rotation (S2.3), not
 * an addition.
 */
export async function addTrustedPublisher(
  store: readonly TrustedPublisher[],
  request: PublisherAdditionRequest,
): Promise<PublisherAddition> {
  if (!isPublisherKey(request.key)) {
    return {
      ok: false,
      reason: "invalid-key",
      fingerprint: null,
      message: "A publisher key is 32 bytes of standard base64.",
    };
  }

  const fingerprint = await publisherKeyFingerprint(request.key);
  const confirmed = normalisePublisherFingerprint(request.fingerprint);
  if (confirmed === null || confirmed !== fingerprint) {
    return {
      ok: false,
      reason: "fingerprint-mismatch",
      fingerprint,
      message: `The key's fingerprint is ${fingerprint}; the value confirmed was ${request.fingerprint}. Nothing was added.`,
    };
  }

  const id = request.id ?? (await publisherKeyDigest(request.key));
  if (!isSafePublisherId(id)) {
    return {
      ok: false,
      reason: "invalid-id",
      fingerprint,
      message: `"${id}" is not a safe publisher id.`,
    };
  }

  const sameKey = store.find((entry) => entry.key === request.key);
  if (sameKey !== undefined) {
    if (sameKey.id === id) {
      return { ok: true, publisher: { id, key: request.key, fingerprint }, store };
    }
    return {
      ok: false,
      reason: "key-already-added",
      fingerprint,
      message: `That key is already trusted as ${sameKey.id}.`,
    };
  }

  const sameId = store.find((entry) => entry.id === id);
  if (sameId !== undefined) {
    return {
      ok: false,
      reason: "id-taken",
      fingerprint,
      message: `Publisher id ${id} already belongs to another key. Replacing a key under an id is a signed rotation, not an addition.`,
    };
  }

  return {
    ok: true,
    publisher: { id, key: request.key, fingerprint },
    store: [...store, { id, key: request.key, fingerprint, source: "added" }],
  };
}
