import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  base64ToBytes,
  isPublisherKey,
  isSafePackId,
  isSafePublisherId,
  signBytes,
  type TrustedPublisher,
  verifyBytes,
} from "@suite/pack";

/**
 * Pack revocation advisories (S2.4).
 *
 * A revocation is a signed file delivered the way a pack is: a person adds a
 * signed advisory, the host verifies it, and the host records it. There is no
 * network fetch and no revocation service.
 *
 * The rules are narrow on purpose:
 *
 * - the key that signed the installed pack, or the person, may issue it;
 * - a publisher may not revoke another publisher's pack;
 * - a recorded advisory blocks a *new* install only. It never disables an
 *   installed pack; disabling or removing one stays the person's choice.
 *
 * A catalogue operator is a valid issuer in the spec, but this host has no
 * catalogue trust root yet, so that form is refused with a named reason instead
 * of being guessed at. That gap is the reason S2.4 stays `Partial`.
 */

export const REVOCATION_KIND = "suite.pack-revocation";
export const REVOCATION_STORE_FILE = "revocations.json";
export const REVOCATION_STORE_VERSION = 1;

export type RevocationIssuer =
  | { readonly kind: "publisher"; readonly id: string }
  | { readonly kind: "catalogue"; readonly id: string; readonly key: string }
  | { readonly kind: "person" };

export interface RevocationAdvisoryCore {
  readonly kind: typeof REVOCATION_KIND;
  /** The publisher id whose pack is revoked. */
  readonly publisher: string;
  /** The pack id being revoked. */
  readonly pack: string;
  readonly issuer: RevocationIssuer;
  readonly reason?: string;
}

export interface RevocationAdvisory extends RevocationAdvisoryCore {
  /**
   * Ed25519 over `revocationAdvisoryBytes`, standard base64. Required for a
   * publisher or catalogue issuer; a person advisory is local and unsigned.
   */
  readonly signature?: string;
}

/** The bytes the issuer signs. Field order is fixed and absent fields are omitted. */
export function revocationAdvisoryBytes(advisory: RevocationAdvisoryCore): Uint8Array {
  const issuer =
    advisory.issuer.kind === "publisher"
      ? { kind: "publisher", id: advisory.issuer.id }
      : advisory.issuer.kind === "catalogue"
        ? { kind: "catalogue", id: advisory.issuer.id, key: advisory.issuer.key }
        : { kind: "person" };
  return new TextEncoder().encode(
    JSON.stringify({
      kind: advisory.kind,
      publisher: advisory.publisher,
      pack: advisory.pack,
      issuer,
      ...(advisory.reason === undefined ? {} : { reason: advisory.reason }),
    }),
  );
}

/** Sign an advisory with the issuer's key. A publisher uses the pack's key. */
export function signRevocationAdvisory(
  advisory: RevocationAdvisoryCore,
  issuerSecretKeyBase64: string,
): RevocationAdvisory {
  return {
    ...advisory,
    signature: signBytes(revocationAdvisoryBytes(advisory), issuerSecretKeyBase64),
  };
}

const ADVISORY_FIELDS = new Set(["kind", "publisher", "pack", "issuer", "reason", "signature"]);

function isSignature(value: string): boolean {
  try {
    return base64ToBytes(value).byteLength === 64;
  } catch {
    return false;
  }
}

function parseIssuer(raw: unknown): RevocationIssuer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.kind === "person") {
    if (Object.keys(record).some((key) => key !== "kind")) return null;
    return { kind: "person" };
  }
  if (record.kind === "publisher") {
    if (Object.keys(record).some((key) => key !== "kind" && key !== "id")) return null;
    if (typeof record.id !== "string" || !isSafePublisherId(record.id)) return null;
    return { kind: "publisher", id: record.id };
  }
  if (record.kind === "catalogue") {
    if (Object.keys(record).some((key) => key !== "kind" && key !== "id" && key !== "key")) {
      return null;
    }
    if (typeof record.id !== "string" || !isSafePublisherId(record.id)) return null;
    if (typeof record.key !== "string" || !isPublisherKey(record.key)) return null;
    return { kind: "catalogue", id: record.id, key: record.key };
  }
  return null;
}

/** Parse an advisory from JSON, refusing every unknown field and issuer shape. */
export function parseRevocationAdvisory(raw: unknown): RevocationAdvisory | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ADVISORY_FIELDS.has(key)) return null;
  }
  if (record.kind !== REVOCATION_KIND) return null;
  if (typeof record.publisher !== "string" || !isSafePublisherId(record.publisher)) return null;
  if (typeof record.pack !== "string" || !isSafePackId(record.pack)) return null;
  const issuer = parseIssuer(record.issuer);
  if (issuer === null) return null;
  if (record.reason !== undefined && typeof record.reason !== "string") return null;

  if (issuer.kind === "person") {
    if (record.signature !== undefined) return null;
    return {
      kind: REVOCATION_KIND,
      publisher: record.publisher,
      pack: record.pack,
      issuer,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
    };
  }

  if (typeof record.signature !== "string" || !isSignature(record.signature)) return null;
  return {
    kind: REVOCATION_KIND,
    publisher: record.publisher,
    pack: record.pack,
    issuer,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    signature: record.signature,
  };
}

export type RevocationFailureReason =
  | "unknown-publisher"
  | "cross-publisher"
  | "bad-signature"
  | "deferred-issuer";

export type RevocationCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: RevocationFailureReason;
      readonly message: string;
    };

/**
 * Decide whether an advisory is one this host can record.
 *
 * The publisher form resolves the issuer through the pack's own key chain, so a
 * key retired by a rotation can still revoke a pack it signed. The catalogue
 * form is refused until a catalogue operator key has a trust root. A person
 * form has no signature: it is the local host acting for the person, and the
 * caller decides whether that form is offered.
 */
export function checkRevocationAdvisory(
  advisory: RevocationAdvisory,
  publishers: readonly TrustedPublisher[],
): RevocationCheck {
  if (advisory.issuer.kind === "catalogue") {
    return {
      ok: false,
      reason: "deferred-issuer",
      message:
        "A catalogue operator cannot issue a revocation until this host has a catalogue trust root; nothing was recorded.",
    };
  }

  if (advisory.issuer.kind === "person") {
    return { ok: true };
  }

  if (advisory.issuer.id !== advisory.publisher) {
    return {
      ok: false,
      reason: "cross-publisher",
      message: `Publisher ${advisory.issuer.id} cannot revoke ${advisory.publisher}'s pack ${advisory.pack}.`,
    };
  }

  const entry = publishers.find((candidate) => candidate.id === advisory.publisher);
  if (entry === undefined) {
    return {
      ok: false,
      reason: "unknown-publisher",
      message: `No trusted publisher has the id ${advisory.publisher}.`,
    };
  }

  const keys = [entry.key, ...(entry.retiredKeys ?? []).map((retired) => retired.key)];
  const signature = advisory.signature;
  if (
    signature === undefined ||
    !keys.some((key) => verifyBytes(revocationAdvisoryBytes(advisory), signature, key))
  ) {
    return {
      ok: false,
      reason: "bad-signature",
      message: `The advisory for ${advisory.publisher} ${advisory.pack} is not signed by that publisher's key.`,
    };
  }

  return { ok: true };
}

/** Whether a recorded advisory covers this publisher and pack. */
export function isPackRevoked(
  revocations: readonly RevocationAdvisory[],
  publisherId: string,
  packId: string,
): boolean {
  return revocations.some(
    (advisory) => advisory.publisher === publisherId && advisory.pack === packId,
  );
}

export interface RevocationStore {
  readonly version: typeof REVOCATION_STORE_VERSION;
  readonly revocations: readonly RevocationAdvisory[];
}

function parseStore(text: string): readonly RevocationAdvisory[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== REVOCATION_STORE_VERSION) return null;
  if (!Array.isArray(record.revocations)) return null;

  const advisories: RevocationAdvisory[] = [];
  for (const candidate of record.revocations) {
    const advisory = parseRevocationAdvisory(candidate);
    if (advisory === null) return null;
    advisories.push(advisory);
  }
  return advisories;
}

async function writeStore(root: string, advisories: readonly RevocationAdvisory[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = join(root, REVOCATION_STORE_FILE);
  const temporary = join(root, `.tmp-${randomUUID()}`);
  try {
    const store: RevocationStore = { version: REVOCATION_STORE_VERSION, revocations: advisories };
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Read the recorded advisories.
 *
 * A missing file is an empty list. A malformed one is reported and treated as
 * empty rather than guessed at: the host records advisories one at a time, so a
 * broken file is a repair problem, not a trust-root decision.
 */
export async function openRevocations(root: string): Promise<RevocationStore> {
  const file = join(root, REVOCATION_STORE_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { version: REVOCATION_STORE_VERSION, revocations: [] };
  }

  const stored = parseStore(text);
  if (stored === null) {
    console.warn(`[desk] ${file} is not a revocation store; treating it as empty`);
    return { version: REVOCATION_STORE_VERSION, revocations: [] };
  }
  return { version: REVOCATION_STORE_VERSION, revocations: stored };
}

export interface RevocationImportOptions {
  /** The trust store the advisory is checked against. */
  readonly publishers: readonly TrustedPublisher[];
  /** Offer the unsigned person form. Only the local host should pass this. */
  readonly allowPersonIssuer?: boolean;
}

export type RevocationImport =
  | { readonly ok: true; readonly advisory: RevocationAdvisory; readonly store: RevocationStore }
  | {
      readonly ok: false;
      readonly reason: "invalid-advisory" | "person-issuer-refused" | RevocationFailureReason;
      readonly message: string;
    };

function sameAdvisory(left: RevocationAdvisory, right: RevocationAdvisory): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Verify and record one advisory. The bytes are read from a file the person
 * chose, the way an archive is; nothing is fetched.
 */
export async function importRevocationAdvisory(
  root: string,
  bytes: Uint8Array,
  options: RevocationImportOptions,
): Promise<RevocationImport> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {
      ok: false,
      reason: "invalid-advisory",
      message: "That file is not a signed advisory.",
    };
  }

  const advisory = parseRevocationAdvisory(raw);
  if (advisory === null) {
    return {
      ok: false,
      reason: "invalid-advisory",
      message: "That file is not a signed advisory.",
    };
  }

  if (advisory.issuer.kind === "person" && options.allowPersonIssuer !== true) {
    return {
      ok: false,
      reason: "person-issuer-refused",
      message: "A person-issued revocation is only recorded from the local host.",
    };
  }

  const check = checkRevocationAdvisory(advisory, options.publishers);
  if (!check.ok) return check;

  const current = await openRevocations(root);
  if (current.revocations.some((recorded) => sameAdvisory(recorded, advisory))) {
    return { ok: true, advisory, store: current };
  }

  const revocations = [...current.revocations, advisory];
  await writeStore(root, revocations);
  return {
    ok: true,
    advisory,
    store: { version: REVOCATION_STORE_VERSION, revocations },
  };
}
