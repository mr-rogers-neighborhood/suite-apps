import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isSafeArchiveUrl,
  isSha256Hex,
  MAX_INDEX_BYTES,
  type PackIndex,
  type PackIndexEntry,
  type PackIndexFailureReason,
  parsePackIndexJson,
  SUITE_INDEX_PUBLIC_KEY,
  verifyPackIndex,
} from "@suite/pack";
import type { VerifiedCatalogueIndex, VerifiedIndexPack } from "./catalogue.js";
import { MAX_ARCHIVE_BYTES } from "./installedPacks.js";

/**
 * The published catalogue index (S12.2).
 *
 * The index is a second trust root, separate from a pack's publisher key. Its operator key is
 * pinned once in `@suite/pack`, beside the pack pin (`packages/pack/src/pinnedKey.ts`), and
 * imported here: a constant compiled into the host, never a value the network supplies, and never
 * a second copy. An index that names its own trust set proves only that a signature matches
 * whatever the caller was handed, so the key this module verifies against is fixed in source and
 * a caller cannot replace it.
 *
 * The private half is `SUITE_INDEX_KEY` in the release environment; only the public half belongs
 * in this repository. `scripts/release-index.mjs` signs with it, and
 * `SUITE_INDEX_KEY_FINGERPRINT` is the same key's fingerprint. What a host trusts and what the
 * publisher signs with stay separate values on purpose.
 *
 * Fetching is read-only: one request for the index and one per archive, each carrying only an
 * `accept` header. Nothing about the machine, the user or the install is sent.
 */

/** The variable that points a host at a different index, or turns it off. */
export const CATALOGUE_INDEX_URL_VARIABLE = "SUITE_DESK_INDEX";

/**
 * The published index, beside the Flatpak summary on the store's own origin.
 * `scripts/lib/flatpakRemote.mjs` is the release-side home of this URL.
 */
export const DEFAULT_CATALOGUE_INDEX_URL = "https://flatpak.suite.run/index.json";

/** How long one index or archive request may take before it is abandoned. */
const INDEX_TIMEOUT_MS = 15_000;
const ARCHIVE_TIMEOUT_MS = 60_000;

/** The last verified index, so a replay cannot move the catalogue backwards. */
export const INDEX_HEAD_FILE = "index-head.json";
const INDEX_HEAD_VERSION = 1;

export interface CatalogueIndexHead {
  readonly sequence: number;
  readonly digest: string;
}

/**
 * Where the catalogue index comes from.
 *
 * The published index is the default, because a person who opens the catalogue
 * should see what the store publishes. `SUITE_DESK_INDEX=none` keeps only the
 * local directory, which is still a first-class way to install a file (S12.1).
 */
export function catalogueIndexUrlFor(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const override = env[CATALOGUE_INDEX_URL_VARIABLE]?.trim();
  if (override === undefined || override.length === 0) return DEFAULT_CATALOGUE_INDEX_URL;
  if (override === "none" || override === "off" || override === "local") return null;
  return override;
}

/** A request function, injected so the verifier stays free of Electron. */
export type CatalogueFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CatalogueIndexOptions {
  readonly url: string;
  /** The trust directory that holds the last verified head. */
  readonly headRoot: string;
  /** The pinned operator keys. Production never passes this; tests do. */
  readonly operatorKeys?: readonly string[];
  readonly now?: Date;
  readonly fetch?: CatalogueFetch;
}

export type CatalogueIndexLoad =
  | {
      readonly ok: true;
      readonly index: VerifiedCatalogueIndex;
      readonly sequence: number;
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly reason: "unreachable" | "refused";
      readonly message: string;
    };

/**
 * Fetch, verify and expose one index.
 *
 * Nothing is listed unless the whole index verified against the pin and against
 * the last head this host recorded: an unsigned or tampered index, a signature
 * from a key this host does not pin, an expired index, a lower sequence and a
 * `previous` that names another index are all refusals before the entries are
 * returned. The first fetch has no head to chain to; its signature and expiry
 * still have to pass, and every later fetch must extend the head it records. The
 * head is written only after every check passed.
 */
export async function loadCatalogueIndex(
  options: CatalogueIndexOptions,
): Promise<CatalogueIndexLoad> {
  const operatorKeys = options.operatorKeys ?? [SUITE_INDEX_PUBLIC_KEY];
  const fetchImpl = options.fetch ?? fetch;

  let text: string;
  try {
    text = await fetchIndexText(options.url, fetchImpl);
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: `The published index could not be fetched: ${errorText(error)}.`,
    };
  }

  const parsed = parsePackIndexJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "refused",
      message: looksUnsigned(text)
        ? "This catalogue index is unsigned; a catalogue must carry at least one operator signature."
        : `This catalogue index is not valid: ${parsed.issues
            .map((issue) =>
              issue.path.length > 0 ? `${issue.path}: ${issue.message}` : issue.message,
            )
            .join("; ")}.`,
    };
  }

  let head: CatalogueIndexHead | null;
  try {
    head = await readCatalogueIndexHead(options.headRoot);
  } catch (error) {
    return {
      ok: false,
      reason: "refused",
      message: `The trusted catalogue index head could not be read: ${errorText(error)}.`,
    };
  }

  const verified = await verifyPackIndex(parsed.value, {
    operatorKeys,
    ...(options.now === undefined ? {} : { now: options.now }),
    head,
  });
  if (!verified.ok) {
    return {
      ok: false,
      reason: "refused",
      message: describeVerification(parsed.value, verified.reason, verified.message, operatorKeys),
    };
  }

  try {
    await writeCatalogueIndexHead(options.headRoot, {
      sequence: parsed.value.sequence,
      digest: verified.digest,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "refused",
      message: `The verified index could not be recorded, so a later rollback could not be refused: ${errorText(error)}.`,
    };
  }

  return {
    ok: true,
    index: { packs: parsed.value.entries.map((entry) => indexPack(entry, fetchImpl)) },
    sequence: parsed.value.sequence,
    digest: verified.digest,
  };
}

/**
 * Turn a refusal into the sentence a person sees.
 *
 * Each branch names the rule, not just "invalid": a changed index, an index
 * signed by a key this host does not pin, an expired index, a lower sequence and
 * a broken chain are different facts and lead to different next steps.
 */
function describeVerification(
  index: PackIndex,
  reason: PackIndexFailureReason,
  message: string,
  operatorKeys: readonly string[],
): string {
  if (reason === "signature") {
    return "This catalogue index was changed after it was signed: an operator signature does not verify.";
  }
  if (reason === "threshold") {
    const pinned = new Set(operatorKeys);
    if (!index.signatures.some((signature) => pinned.has(signature.key))) {
      return "This catalogue index is signed by an operator key this host does not pin, so it was refused.";
    }
    return `This catalogue index carries fewer valid operator signatures than its threshold of ${index.threshold}.`;
  }
  if (reason === "expired") {
    return message;
  }
  if (reason === "rollback") {
    return message;
  }
  if (reason === "chain") {
    return message.length > 0
      ? message
      : "This catalogue index does not name the digest of the index it would replace, so the chain is refused.";
  }
  return message;
}

/** True when the text parses as an object with no signatures at all. */
function looksUnsigned(text: string): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const signatures = (raw as Record<string, unknown>).signatures;
  return !Array.isArray(signatures) || signatures.length === 0;
}

async function fetchIndexText(url: string, fetchImpl: CatalogueFetch): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_INDEX_BYTES) {
    throw new Error(`the index is larger than ${MAX_INDEX_BYTES} bytes`);
  }
  return new TextDecoder().decode(bytes);
}

/** One index entry's archive, fetched only when the catalogue inspects or installs it. */
function indexPack(entry: PackIndexEntry, fetchImpl: CatalogueFetch): VerifiedIndexPack {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description ?? null,
    capabilities: entry.capabilities,
    sizeBytes: entry.archive.size,
    sha256: entry.archive.sha256,
    readArchive: () => readArchive(entry.archive.url, fetchImpl),
  };
}

async function readArchive(url: string, fetchImpl: CatalogueFetch): Promise<Uint8Array> {
  if (!isSafeArchiveUrl(url)) {
    throw new Error("The catalogue entry names an archive URL this host will not fetch.");
  }
  const response = await fetchImpl(url, {
    headers: { accept: "application/octet-stream" },
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the archive server answered ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    throw new Error("the archive is larger than this host will read");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("the archive is larger than this host will read");
  }
  return bytes;
}

/** The last verified index, or null before the first one. A malformed file is an error. */
export async function readCatalogueIndexHead(root: string): Promise<CatalogueIndexHead | null> {
  let text: string;
  try {
    text = await readFile(join(root, INDEX_HEAD_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const head = parseIndexHead(text);
  if (head === null) throw new Error(`the recorded head in ${INDEX_HEAD_FILE} is malformed`);
  return head;
}

function parseIndexHead(text: string): CatalogueIndexHead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== INDEX_HEAD_VERSION) return null;
  if (
    typeof record.sequence !== "number" ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0
  ) {
    return null;
  }
  if (typeof record.digest !== "string" || !isSha256Hex(record.digest)) return null;
  return { sequence: record.sequence, digest: record.digest };
}

/** Record a verified head. Written through a temporary file so a crash leaves the old one. */
export async function writeCatalogueIndexHead(
  root: string,
  head: CatalogueIndexHead,
): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = join(root, INDEX_HEAD_FILE);
  const temporary = join(root, `.tmp-${randomUUID()}`);
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({ version: INDEX_HEAD_VERSION, ...head }, null, 2)}\n`,
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "an unknown error";
}
