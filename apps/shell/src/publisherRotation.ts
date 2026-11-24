import {
  base64ToBytes,
  isPublisherKey,
  isSafePublisherId,
  publisherKeyFingerprint,
  signBytes,
  type TrustedPublisher,
  verifyBytes,
} from "@suite/pack";

/**
 * Publisher key rotation (S2.3).
 *
 * A rotation is a statement, not a new manifest: the outgoing key signs the new
 * key, the stable publisher id and a sequence. The host resolves it against the
 * trust store before it shows the person the new fingerprint; only a second
 * call, carrying the fingerprint the person confirmed, writes the store.
 *
 * The statement has its own canonical bytes so the signature covers exactly the
 * facts it claims. The shape is deliberately flat and closed: a newer field is
 * refused rather than guessed at, and an optional field is omitted, never
 * `null`. The runtime field order is the canonical order.
 *
 * A rotation retires the outgoing key instead of deleting it. Installed
 * versions were signed with it, so the scan still accepts them; a new install
 * must use the current key. That is what "installed packs keep running" means
 * here.
 */

export const ROTATION_KIND = "suite.publisher-rotation";
/** A statement without its signature; the part the outgoing key signs. */
export interface RotationStatementCore {
  readonly kind: typeof ROTATION_KIND;
  /** The stable publisher id. It does not change across a rotation. */
  readonly publisher: string;
  /** Strictly increasing, starting at 1. A replay reuses an accepted value. */
  readonly sequence: number;
  /** The outgoing key, standard base64. It must be the store's current key. */
  readonly previousKey: string;
  /** The incoming key, standard base64. */
  readonly newKey: string;
}

export interface RotationStatement extends RotationStatementCore {
  /** Ed25519 by `previousKey` over `rotationStatementBytes`. Standard base64. */
  readonly signature: string;
}

const STATEMENT_FIELDS = new Set([
  "kind",
  "publisher",
  "sequence",
  "previousKey",
  "newKey",
  "signature",
]);

function isSignature(value: string): boolean {
  try {
    return base64ToBytes(value).byteLength === 64;
  } catch {
    return false;
  }
}

/**
 * The bytes the outgoing key signs.
 *
 * Field order is fixed, absent optional fields are omitted (there are none
 * today) and the signature is not part of its own input. The same bytes are
 * produced from a core or a full statement.
 */
export function rotationStatementBytes(statement: RotationStatementCore): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      kind: statement.kind,
      publisher: statement.publisher,
      sequence: statement.sequence,
      previousKey: statement.previousKey,
      newKey: statement.newKey,
    }),
  );
}

/** Sign a rotation statement with the outgoing key. Publisher tooling uses this. */
export function signRotationStatement(
  statement: RotationStatementCore,
  outgoingSecretKeyBase64: string,
): RotationStatement {
  return {
    ...statement,
    signature: signBytes(rotationStatementBytes(statement), outgoingSecretKeyBase64),
  };
}

/** Parse a statement from JSON, refusing every unknown field. */
export function parseRotationStatement(raw: unknown): RotationStatement | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!STATEMENT_FIELDS.has(key)) return null;
  }
  if (record.kind !== ROTATION_KIND) return null;
  if (typeof record.publisher !== "string" || !isSafePublisherId(record.publisher)) return null;
  if (
    typeof record.sequence !== "number" ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1
  ) {
    return null;
  }
  if (typeof record.previousKey !== "string" || !isPublisherKey(record.previousKey)) return null;
  if (typeof record.newKey !== "string" || !isPublisherKey(record.newKey)) return null;
  if (typeof record.signature !== "string" || !isSignature(record.signature)) return null;
  return {
    kind: ROTATION_KIND,
    publisher: record.publisher,
    sequence: record.sequence,
    previousKey: record.previousKey,
    newKey: record.newKey,
    signature: record.signature,
  };
}

export type RotationFailureReason =
  | "unknown-publisher"
  | "wrong-outgoing-key"
  | "bad-signature"
  | "same-key"
  | "key-taken"
  | "replayed";

export interface RotationPreview {
  readonly publisherId: string;
  readonly sequence: number;
  /** The new key and the fingerprint the person must confirm. */
  readonly newKey: string;
  readonly newFingerprint: string;
  readonly previousFingerprint: string;
}

export type RotationCheck =
  | { readonly ok: true; readonly preview: RotationPreview }
  | {
      readonly ok: false;
      readonly reason: RotationFailureReason;
      readonly message: string;
      /** The new key's fingerprint for a refusal after the signature held. */
      readonly fingerprint: string | null;
    };

function refusal(
  reason: RotationFailureReason,
  message: string,
  fingerprint: string | null = null,
): RotationCheck {
  return { ok: false, reason, message, fingerprint };
}

/**
 * Decide whether a statement is a rotation this host can offer to the person.
 *
 * This writes nothing. `applyPublisherRotation` runs the same check and then
 * requires the fingerprint the person confirmed. Every failure is a reason the
 * host can name, so a refusal can say "replayed" rather than "invalid".
 */
export async function checkPublisherRotation(
  statement: RotationStatement,
  store: readonly TrustedPublisher[],
): Promise<RotationCheck> {
  const entry = store.find((candidate) => candidate.id === statement.publisher);
  if (entry === undefined) {
    return refusal("unknown-publisher", `No trusted publisher has the id ${statement.publisher}.`);
  }

  if (statement.previousKey !== entry.key) {
    return refusal(
      "wrong-outgoing-key",
      `Publisher ${statement.publisher} is trusted with key fingerprint ${await publisherKeyFingerprint(entry.key)}; the statement was signed by a key that is not the outgoing key.`,
    );
  }

  if (!verifyBytes(rotationStatementBytes(statement), statement.signature, statement.previousKey)) {
    return refusal(
      "bad-signature",
      `The rotation for ${statement.publisher} is not signed by its outgoing key.`,
    );
  }

  const newFingerprint = await publisherKeyFingerprint(statement.newKey);
  if (statement.newKey === statement.previousKey) {
    return refusal(
      "same-key",
      "The rotation names the key that is already current.",
      newFingerprint,
    );
  }

  const taken = store.find(
    (candidate) =>
      candidate.key === statement.newKey ||
      candidate.retiredKeys?.some((retired) => retired.key === statement.newKey) === true,
  );
  if (taken !== undefined) {
    return refusal(
      "key-taken",
      `The new key is already trusted${taken.id === statement.publisher ? "" : ` as ${taken.id}`}.`,
      newFingerprint,
    );
  }

  if (statement.sequence <= (entry.sequence ?? 0)) {
    return refusal(
      "replayed",
      `The rotation for ${statement.publisher} carries sequence ${statement.sequence}, which is not above the last accepted ${entry.sequence ?? 0}. A replay is refused.`,
      newFingerprint,
    );
  }

  return {
    ok: true,
    preview: {
      publisherId: entry.id,
      sequence: statement.sequence,
      newKey: statement.newKey,
      newFingerprint,
      previousFingerprint: await publisherKeyFingerprint(entry.key),
    },
  };
}
