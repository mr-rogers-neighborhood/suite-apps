import { z } from "zod";
import { canonicalJsonValue, compareCodeUnits, findDuplicateJsonKey } from "./canonical.js";
import { PACK_CAPABILITIES, type PackCapability } from "./capabilities.js";
import {
  DEFAULT_PACK_RING,
  isSafePackId,
  isSafePackVersion,
  isSha256Hex,
  PACK_RINGS,
  type PackRing,
} from "./manifest.js";
import { isSafePackPlatform } from "./platforms.js";
import { publicKeyFromSecret, sha256Hex, signBytes, verifyBytes } from "./signature.js";
import { isPublisherKey, isSafePublisherId } from "./trust.js";

/**
 * The catalogue index (S12.2).
 *
 * A catalogue is an optional list of signed packs. The index is a separate
 * trust root from a pack: it is signed by **operator** keys, the people who
 * decide what the catalogue offers, and never by a pack publisher key. A host
 * that holds no operator key can still install a side-loaded pack (S12.1); it
 * just has no catalogue.
 *
 * The index is a versioned JSON document. Its canonical bytes follow the same
 * S3.3 rules as a manifest — fixed field order, absent optional fields omitted,
 * nested keys in code-unit order, arrays sorted where order is not authored —
 * rather than a second encoding. `signatures` is excluded, exactly as a
 * manifest's `signature` is.
 *
 * Rollback is refused by construction: `sequence` must not decrease (an equal
 * sequence is the index this host already trusts, accepted only when its digest
 * matches; the same sequence with different bytes is an equivocation and is
 * refused), `previous` names the digest of the canonical bytes of the index
 * being replaced, and an index whose `expires` has passed is refused.
 * `threshold` is inside the signed bytes, so an attacker cannot lower the number
 * of operator signatures a host needs.
 */

export const PACK_INDEX_FORMAT = "suite.catalogue";
/**
 * The index version this host writes. A host still reads version 1, whose entries
 * carry the archive fields at the top level and no ring, as pack contract 1.
 */
export const PACK_INDEX_VERSION = 2;
export const PACK_INDEX_VERSIONS = [1, 2] as const;
export type PackIndexVersion = (typeof PACK_INDEX_VERSIONS)[number];

/** A host refuses an index file larger than this before parsing it. */
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_INDEX_ENTRIES = 2048;
export const MAX_INDEX_SIGNATURES = 16;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * An archive URL the host may fetch: HTTPS, absolute, with no credentials and no
 * fragment. A query is allowed because object stores sometimes carry one; a
 * fragment is not, because it never reaches a server.
 */
export function isSafeArchiveUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.length > 0 &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}

/** Where a `.suitepack` is and what it hashes to (S12.9). */
export interface PackIndexArchive {
  /** An absolute HTTPS URL for the `.suitepack` archive. */
  readonly url: string;
  /** The archive's byte length. */
  readonly size: number;
  /** Lower-case hex SHA-256 of the archive bytes. */
  readonly sha256: string;
}

/**
 * What the catalogue says about one pack version.
 *
 * The shape is the v2 entry's, whichever index version it came from: a version 1
 * entry is normalised on read so a caller sees one entry type. A v1 entry has no
 * `ring`, `contractVersion` or manifest `signature` in its bytes, so reading it
 * yields `stable`, contract `1` and no signature, exactly what S12.9 says an
 * index written before the clause means.
 */
export interface PackIndexEntry {
  /** The pack id, the same one its manifest carries. */
  readonly id: string;
  /** One line for the catalogue, copied from the manifest. */
  readonly name: string;
  /** The publisher id whose key signed the pack. */
  readonly publisher: string;
  readonly version: string;
  /** The pack's effective ring; an index v1 entry is `stable`. */
  readonly ring: PackRing;
  /** The effective pack contract; an index v1 entry is contract `1`. */
  readonly contractVersion: number;
  /** The effective host floor, absent when the manifest declares none. */
  readonly minHost?: number;
  readonly description?: string;
  readonly capabilities: readonly PackCapability[];
  /**
   * The host kinds the manifest declared, so a catalogue row can judge platform
   * fit before downloading the archive. Absent on an index written before the
   * field existed; the host then reports the row as unknown, never universal.
   */
  readonly platforms?: readonly string[];
  /** Where the archive is and what it hashes to. */
  readonly archive: PackIndexArchive;
  /**
   * The manifest's Ed25519 signature, standard base64, so a host can compare the
   * entry with the archive it unpacked (S12.7). Absent on a v1 entry.
   */
  readonly signature?: string;
}

/** One operator's Ed25519 signature over the canonical index bytes. */
export interface PackIndexSignature {
  /** Standard base64 of the operator's 32-byte public key. */
  readonly key: string;
  /** Standard base64 of the 64-byte signature. */
  readonly signature: string;
}

/** The signed part of an index. `signatures` is added after signing. */
export interface PackIndexCore {
  readonly format: typeof PACK_INDEX_FORMAT;
  /** The index format version, not the catalogue's contents. */
  readonly version: PackIndexVersion;
  /** Increases by at least one with every published index. */
  readonly sequence: number;
  /** When this index was generated, as an ISO 8601 timestamp. */
  readonly generatedAt: string;
  /** The digest of the index this one replaces; absent only on sequence 1. */
  readonly previous?: string;
  /** After this instant the host refuses the index. */
  readonly expires: string;
  /** How many distinct operator signatures must verify. */
  readonly threshold: number;
  readonly entries: readonly PackIndexEntry[];
}

export interface PackIndex extends PackIndexCore {
  readonly signatures: readonly PackIndexSignature[];
}

export interface PackIndexIssue {
  readonly path: string;
  readonly message: string;
}

export type PackIndexParse =
  | { readonly ok: true; readonly value: PackIndex }
  | { readonly ok: false; readonly issues: readonly PackIndexIssue[] };

/** Standard base64 of a 64-byte Ed25519 signature, the manifest signature a v2 entry copies. */
const PACK_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;

const entryBaseShape = {
  id: z.string().refine(isSafePackId, "a lower-case pack id"),
  name: z.string().min(1).max(64),
  publisher: z.string().refine(isSafePublisherId, "a lower-case publisher id"),
  version: z.string().refine(isSafePackVersion, "a semver version"),
  description: z.string().min(1).max(200).optional(),
  capabilities: z.array(z.enum(PACK_CAPABILITIES)).refine(unique, "duplicate capability"),
  platforms: z
    .array(z.string().refine(isSafePackPlatform, "a lower-case host kind"))
    .min(1)
    .refine(unique, "duplicate platform")
    .optional(),
};

/** A version 1 entry: the archive fields at the top level and no ring (S12.9). */
const entryV1Schema = z
  .object({
    ...entryBaseShape,
    size: z.number().int().nonnegative(),
    sha256: z.string().refine(isSha256Hex, "a lower-case hex SHA-256"),
    url: z.string().refine(isSafeArchiveUrl, "an absolute HTTPS archive URL"),
  })
  .strict();

const archiveSchema = z
  .object({
    url: z.string().refine(isSafeArchiveUrl, "an absolute HTTPS archive URL"),
    size: z.number().int().nonnegative(),
    sha256: z.string().refine(isSha256Hex, "a lower-case hex SHA-256"),
  })
  .strict();

/** A version 2 entry: the grouped archive, effective ring and contract, and the manifest signature. */
const entryV2Schema = z
  .object({
    ...entryBaseShape,
    ring: z.enum(PACK_RINGS),
    contractVersion: z.number().int().positive(),
    minHost: z.number().int().positive().optional(),
    archive: archiveSchema,
    signature: z.string().regex(PACK_SIGNATURE, "a 64-byte base64 Ed25519 signature"),
  })
  .strict();

const signatureSchema = z
  .object({
    key: z.string().refine(isPublisherKey, "a 32-byte base64 Ed25519 public key"),
    signature: z.string().min(1),
  })
  .strict();

function unique<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

const indexV1Schema = z
  .object({
    format: z.literal(PACK_INDEX_FORMAT),
    version: z.literal(1),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    generatedAt: z.string().refine(isIsoTimestamp, "an ISO 8601 timestamp"),
    previous: z.string().refine(isSha256Hex, "a lower-case hex SHA-256").optional(),
    expires: z.string().refine(isIsoTimestamp, "an ISO 8601 timestamp"),
    threshold: z.number().int().positive(),
    entries: z.array(entryV1Schema).max(MAX_INDEX_ENTRIES),
    signatures: z.array(signatureSchema).min(1).max(MAX_INDEX_SIGNATURES),
  })
  .strict();

const indexV2Schema = z
  .object({
    format: z.literal(PACK_INDEX_FORMAT),
    version: z.literal(2),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    generatedAt: z.string().refine(isIsoTimestamp, "an ISO 8601 timestamp"),
    previous: z.string().refine(isSha256Hex, "a lower-case hex SHA-256").optional(),
    expires: z.string().refine(isIsoTimestamp, "an ISO 8601 timestamp"),
    threshold: z.number().int().positive(),
    entries: z.array(entryV2Schema).max(MAX_INDEX_ENTRIES),
    signatures: z.array(signatureSchema).min(1).max(MAX_INDEX_SIGNATURES),
  })
  .strict();

type RawPackIndex = z.infer<typeof indexV1Schema> | z.infer<typeof indexV2Schema>;

const indexSchema = z
  .discriminatedUnion("version", [indexV1Schema, indexV2Schema])
  .superRefine((value, context) => {
    const versions = new Set<string>();
    value.entries.forEach((entry, index) => {
      const key = `${entry.id}@${entry.version}`;
      if (versions.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "version"],
          message: `duplicate entry ${key}`,
        });
      }
      versions.add(key);
    });

    const keys = new Set<string>();
    value.signatures.forEach((signature, index) => {
      if (keys.has(signature.key)) {
        context.addIssue({
          code: "custom",
          path: ["signatures", index, "key"],
          message: "duplicate operator key",
        });
      }
      keys.add(signature.key);
    });

    if (value.threshold > value.signatures.length) {
      context.addIssue({
        code: "custom",
        path: ["threshold"],
        message: `threshold ${value.threshold} is higher than the ${value.signatures.length} signature(s) carried`,
      });
    }

    if (Date.parse(value.expires) <= Date.parse(value.generatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expires"],
        message: "must be later than generatedAt",
      });
    }

    if (value.sequence === 1 && value.previous !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["previous"],
        message: "the first index has no predecessor",
      });
    }
    if (value.sequence > 1 && value.previous === undefined) {
      context.addIssue({
        code: "custom",
        path: ["previous"],
        message: "a later index must name the digest it replaces",
      });
    }
  });

/**
 * Put a parsed index into the one entry shape callers see.
 *
 * A version 1 index is read as contract 1 and `stable`, with its top-level
 * archive fields grouped. Its bytes are untouched: `canonicalPackIndexBytes`
 * still writes the v1 shape for it, so the signature an older index carries
 * keeps verifying.
 */
function normaliseIndex(value: RawPackIndex): PackIndex {
  const head = {
    format: value.format,
    version: value.version,
    sequence: value.sequence,
    generatedAt: value.generatedAt,
    ...(value.previous === undefined ? {} : { previous: value.previous }),
    expires: value.expires,
    threshold: value.threshold,
    signatures: value.signatures,
  };

  if (value.version === 2) {
    return {
      ...head,
      entries: value.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        publisher: entry.publisher,
        version: entry.version,
        ring: entry.ring,
        contractVersion: entry.contractVersion,
        ...(entry.minHost === undefined ? {} : { minHost: entry.minHost }),
        ...(entry.description === undefined ? {} : { description: entry.description }),
        capabilities: entry.capabilities,
        ...(entry.platforms === undefined ? {} : { platforms: entry.platforms }),
        archive: entry.archive,
        signature: entry.signature,
      })),
    };
  }

  return {
    ...head,
    entries: value.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      publisher: entry.publisher,
      version: entry.version,
      ring: DEFAULT_PACK_RING,
      contractVersion: 1,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      capabilities: entry.capabilities,
      ...(entry.platforms === undefined ? {} : { platforms: entry.platforms }),
      archive: { url: entry.url, size: entry.size, sha256: entry.sha256 },
    })),
  };
}

export function parsePackIndex(value: unknown): PackIndexParse {
  const parsed = indexSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, value: normaliseIndex(parsed.data) };
}

/**
 * Parse `index.json` text, refusing an oversized file and a duplicate key
 * before `JSON.parse` can keep the last one.
 */
export function parsePackIndexJson(text: string): PackIndexParse {
  if (new TextEncoder().encode(text).byteLength > MAX_INDEX_BYTES) {
    return {
      ok: false,
      issues: [{ path: "", message: `the index is larger than ${MAX_INDEX_BYTES} bytes` }],
    };
  }

  const duplicate = findDuplicateJsonKey(text);
  if (duplicate !== null) {
    return {
      ok: false,
      issues: [
        {
          path: duplicate.path,
          message: `duplicate key ${JSON.stringify(duplicate.key)}`,
        },
      ],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          message: error instanceof Error ? error.message : "not valid JSON",
        },
      ],
    };
  }
  return parsePackIndex(value);
}

/** The entry order the catalogue is signed and written in: id, then version, then publisher. */
export function comparePackIndexEntries(left: PackIndexEntry, right: PackIndexEntry): number {
  return (
    compareCodeUnits(left.id, right.id) ||
    compareCodeUnits(left.version, right.version) ||
    compareCodeUnits(left.publisher, right.publisher)
  );
}

const INDEX_FIELD_ORDER: readonly (keyof PackIndexCore)[] = [
  "format",
  "version",
  "sequence",
  "generatedAt",
  "previous",
  "expires",
  "threshold",
  "entries",
];

/**
 * The exact bytes an operator signature covers.
 *
 * The field order is the schema's, minus `signatures`, and an absent `previous`
 * contributes no key. Entries are sorted by id and version; each entry's keys are
 * put in code-unit order and its capabilities are deduplicated and sorted. No
 * `null` holes, no whitespace.
 */
export function canonicalPackIndexBytes(index: PackIndexCore): Uint8Array {
  const canonical: Record<string, unknown> = {};
  for (const field of INDEX_FIELD_ORDER) {
    const value = index[field];
    if (value === undefined) continue;

    if (field === "entries") {
      canonical.entries = [...index.entries]
        .sort(comparePackIndexEntries)
        .map((entry) => canonicalEntry(entry, index.version));
    } else {
      canonical[field] = value;
    }
  }
  return new TextEncoder().encode(JSON.stringify(canonical));
}

/**
 * The entry as the index version writes it.
 *
 * A version 1 index keeps the flat archive fields its signature covers; a
 * version 2 index writes the grouped archive plus the effective ring, contract
 * and manifest signature.
 */
function canonicalEntry(entry: PackIndexEntry, version: PackIndexVersion): Record<string, unknown> {
  const capabilities = [...new Set(entry.capabilities)].sort(compareCodeUnits);

  if (version === 1) {
    const canonical: Record<string, unknown> = {
      id: entry.id,
      name: entry.name,
      publisher: entry.publisher,
      version: entry.version,
      capabilities,
      size: entry.archive.size,
      sha256: entry.archive.sha256,
      url: entry.archive.url,
    };
    if (entry.description !== undefined) canonical.description = entry.description;
    if (entry.platforms !== undefined) {
      canonical.platforms = [...new Set(entry.platforms)].sort(compareCodeUnits);
    }
    return canonicalJsonValue(canonical) as Record<string, unknown>;
  }

  const canonical = canonicalJsonValue(entry) as Record<string, unknown>;
  canonical.capabilities = capabilities;
  if (entry.platforms !== undefined) {
    canonical.platforms = [...new Set(entry.platforms)].sort(compareCodeUnits);
  }
  return canonical;
}

/** The digest a later index names in `previous`. */
export async function packIndexDigest(index: PackIndexCore): Promise<string> {
  return sha256Hex(canonicalPackIndexBytes(index));
}

/**
 * Sign an index core with one or more operator keys.
 *
 * The public half is derived from each secret, so a signature's `key` always
 * matches the key that made it. Two secrets that derive the same public key are
 * refused: they would not raise the count a threshold measures.
 */
export function signPackIndex(core: PackIndexCore, secretKeys: readonly string[]): PackIndex {
  if (secretKeys.length === 0) {
    throw new Error("A catalogue index needs at least one operator signing key.");
  }
  const bytes = canonicalPackIndexBytes(core);
  const signatures = secretKeys.map((secretKey) => ({
    key: publicKeyFromSecret(secretKey),
    signature: signBytes(bytes, secretKey),
  }));
  const keys = new Set(signatures.map((signature) => signature.key));
  if (keys.size !== signatures.length) {
    throw new Error("Two operator signing keys derive the same public key.");
  }
  return {
    ...core,
    signatures: signatures.sort((left, right) => compareCodeUnits(left.key, right.key)),
  };
}

/** The index this host currently trusts, for a rollback check. */
export interface PackIndexHead {
  readonly sequence: number;
  /** `packIndexDigest` of that index's canonical bytes. */
  readonly digest: string;
}

export interface PackIndexVerifyOptions {
  /**
   * The operator public keys this host pins. There is deliberately no default:
   * the pack's publisher key is a different trust root and never verifies an
   * index.
   */
  readonly operatorKeys: readonly string[];
  /** The verification time. Defaults to now. */
  readonly now?: Date;
  /** The trusted index this one replaces; omit on a first fetch. */
  readonly head?: PackIndexHead | null;
}

export type PackIndexFailureReason =
  | "invalid"
  | "format"
  | "version"
  | "expired"
  | "rollback"
  | "chain"
  | "threshold"
  | "signature";

export type PackIndexVerification =
  | { readonly ok: true; readonly index: PackIndex; readonly digest: string }
  | {
      readonly ok: false;
      readonly reason: PackIndexFailureReason;
      readonly message: string;
    };

/**
 * Verify a parsed index against the host's operator keys and the index it
 * replaces.
 *
 * The checks are, in order: the format and version are the ones this host
 * implements, at least one operator signature is present and enough distinct
 * pinned keys verify, the index has not expired, and it moves the catalogue
 * forward from `head`. The returned digest is what the next index must name in
 * `previous`.
 */
export async function verifyPackIndex(
  index: PackIndex,
  options: PackIndexVerifyOptions,
): Promise<PackIndexVerification> {
  if (index.format !== PACK_INDEX_FORMAT) {
    return {
      ok: false,
      reason: "format",
      message: `This is not a Suite catalogue index: format is ${JSON.stringify(index.format)}.`,
    };
  }
  if (!(PACK_INDEX_VERSIONS as readonly number[]).includes(index.version)) {
    return {
      ok: false,
      reason: "version",
      message: `This index is format version ${index.version}; this host implements ${PACK_INDEX_VERSIONS.join(" and ")}.`,
    };
  }

  const operatorKeys = new Set(options.operatorKeys.filter(isPublisherKey));
  if (operatorKeys.size === 0) {
    return {
      ok: false,
      reason: "threshold",
      message: "This host pins no operator key, so it cannot verify a catalogue index.",
    };
  }

  const bytes = canonicalPackIndexBytes(index);
  const seen = new Set<string>();
  let verified = 0;
  for (const signature of index.signatures) {
    if (seen.has(signature.key)) {
      return {
        ok: false,
        reason: "signature",
        message: "The index carries two signatures from the same operator key.",
      };
    }
    seen.add(signature.key);
    if (!operatorKeys.has(signature.key)) continue;
    if (!verifyBytes(bytes, signature.signature, signature.key)) {
      return {
        ok: false,
        reason: "signature",
        message: "An operator signature over the index does not verify; the bytes were changed.",
      };
    }
    verified += 1;
  }

  if (index.threshold > index.signatures.length) {
    return {
      ok: false,
      reason: "threshold",
      message: `The index requires ${index.threshold} signatures but carries ${index.signatures.length}.`,
    };
  }
  if (verified < index.threshold) {
    return {
      ok: false,
      reason: "threshold",
      message: `The index carries ${verified} valid signature(s) from a pinned operator key; ${index.threshold} required.`,
    };
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { ok: false, reason: "expired", message: "The verification time is not a valid date." };
  }
  if (!(Date.parse(index.expires) > now.getTime())) {
    return {
      ok: false,
      reason: "expired",
      message: `This index expired at ${index.expires}; a stale catalogue is refused.`,
    };
  }

  const head = options.head ?? null;
  const digest = await packIndexDigest(index);
  if (head !== null) {
    if (!Number.isInteger(head.sequence) || head.sequence < 0 || !isSha256Hex(head.digest)) {
      return {
        ok: false,
        reason: "chain",
        message: "The trusted index head is malformed.",
      };
    }
    if (index.sequence < head.sequence) {
      return {
        ok: false,
        reason: "rollback",
        message: `This index is sequence ${index.sequence}; the trusted index is ${head.sequence}. A catalogue cannot move backwards.`,
      };
    }
    // The same sequence with the same bytes is the index this host already
    // trusts: a refetch on the next launch, not a replay. Refusing it would make
    // the catalogue work once and then fail until the publisher cut a new
    // sequence, which is exactly what a person sees when they reopen the app.
    if (index.sequence === head.sequence) {
      if (digest !== head.digest) {
        return {
          ok: false,
          reason: "chain",
          message:
            `This index reuses sequence ${index.sequence} with different content; ` +
            `the trusted index at that sequence is ${head.digest.slice(0, 12)}…. ` +
            "A catalogue cannot rewrite a sequence.",
        };
      }
      return { ok: true, index, digest };
    }
    if (index.previous !== head.digest) {
      return {
        ok: false,
        reason: "chain",
        message: "This index does not name the digest of the index it would replace.",
      };
    }
  }

  return { ok: true, index, digest };
}

/** Parse and verify index text in one call. */
export async function verifyPackIndexJson(
  text: string,
  options: PackIndexVerifyOptions,
): Promise<PackIndexVerification> {
  const parsed = parsePackIndexJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    };
  }
  return verifyPackIndex(parsed.value, options);
}
