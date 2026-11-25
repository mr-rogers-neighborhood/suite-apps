import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addTrustedPublisher as addToStore,
  isPublisherKey,
  isSafePublisherId,
  normalisePublisherFingerprint,
  type PublisherAddition,
  type PublisherAdditionRequest,
  type ResolvedPublisher,
  SUITE_PACK_PUBLIC_KEY,
  SUITE_PUBLISHER_ID,
  type TrustedPublisher,
} from "@suite/pack";
import { publisherKeyFingerprint } from "@suite/pack/trust";
import {
  checkPublisherRotation,
  type RotationCheck,
  type RotationStatement,
} from "./publisherRotation.js";

/**
 * The host's publisher trust store (S2.1).
 *
 * A local file, `<dataRoot>/trust/publishers.json` by default and
 * `SUITE_DESK_TRUST` when set. The first-party key is preinstalled and the pin
 * wins over whatever the file says; any other key is added only by
 * `addTrustedPublisher`, which refuses a fingerprint the person did not see.
 *
 * Reading is fail-closed. A missing file is created with the preinstalled key.
 * A malformed file yields the preinstalled key only: a corrupt store must not
 * become a reason to trust an unknown publisher, and it is left untouched so
 * the person can repair it.
 *
 * Nothing here imports Electron. The main process owns the path and the
 * dialogs; this module owns the file and the merge rule.
 */

export const TRUST_STORE_FILE = "publishers.json";
export const TRUST_STORE_VERSION = 1;

export interface PublisherTrustStore {
  readonly version: typeof TRUST_STORE_VERSION;
  readonly publishers: readonly TrustedPublisher[];
}

/** `<dataRoot>/trust`, or the `SUITE_DESK_TRUST` override. */
export function trustRootFor(
  dataRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env.SUITE_DESK_TRUST?.trim();
  return override !== undefined && override.length > 0 ? override : join(dataRoot, "trust");
}

/** The one key every Suite host trusts before a person does anything. */
export async function preinstalledPublisher(): Promise<TrustedPublisher> {
  return {
    id: SUITE_PUBLISHER_ID,
    key: SUITE_PACK_PUBLIC_KEY,
    fingerprint: await publisherKeyFingerprint(SUITE_PACK_PUBLIC_KEY),
    source: "preinstalled",
  };
}

export async function preinstalledTrustStore(): Promise<PublisherTrustStore> {
  return { version: TRUST_STORE_VERSION, publishers: [await preinstalledPublisher()] };
}

/**
 * The publisher's own key entry, replacing anything the file stored under the
 * same id or key. The pin is the trust root; a file cannot remove or replace it.
 */
function mergePreinstalled(
  preinstalled: TrustedPublisher,
  stored: readonly TrustedPublisher[],
): readonly TrustedPublisher[] {
  const others = stored.filter(
    (entry) => entry.id !== preinstalled.id && entry.key !== preinstalled.key,
  );
  return [preinstalled, ...others];
}

function parseStore(text: string): readonly TrustedPublisher[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== TRUST_STORE_VERSION) return null;
  if (!Array.isArray(record.publishers)) return null;

  const entries: TrustedPublisher[] = [];
  for (const candidate of record.publishers) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
      return null;
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== "string" || !isSafePublisherId(entry.id)) return null;
    if (typeof entry.key !== "string" || !isPublisherKey(entry.key)) return null;
    if (entry.fingerprint !== undefined && typeof entry.fingerprint !== "string") return null;
    if (entry.source !== undefined && entry.source !== "preinstalled" && entry.source !== "added") {
      return null;
    }
    if (
      entry.sequence !== undefined &&
      (typeof entry.sequence !== "number" ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 0)
    ) {
      return null;
    }

    const retiredKeys: { key: string; fingerprint: string; sequence: number }[] = [];
    if (entry.retiredKeys !== undefined) {
      if (!Array.isArray(entry.retiredKeys)) return null;
      for (const candidateKey of entry.retiredKeys) {
        if (
          typeof candidateKey !== "object" ||
          candidateKey === null ||
          Array.isArray(candidateKey)
        ) {
          return null;
        }
        const retired = candidateKey as Record<string, unknown>;
        if (typeof retired.key !== "string" || !isPublisherKey(retired.key)) return null;
        if (typeof retired.fingerprint !== "string") return null;
        if (
          typeof retired.sequence !== "number" ||
          !Number.isSafeInteger(retired.sequence) ||
          retired.sequence < 0
        ) {
          return null;
        }
        retiredKeys.push({
          key: retired.key,
          fingerprint: retired.fingerprint,
          sequence: retired.sequence,
        });
      }
    }

    const source = entry.source;
    const sequence = entry.sequence;
    entries.push({
      id: entry.id,
      key: entry.key,
      ...(entry.fingerprint === undefined ? {} : { fingerprint: entry.fingerprint }),
      ...(source === undefined ? {} : { source }),
      ...(sequence === undefined ? {} : { sequence }),
      ...(retiredKeys.length === 0 ? {} : { retiredKeys }),
    });
  }
  return entries;
}

async function writeStore(root: string, store: PublisherTrustStore): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = join(root, TRUST_STORE_FILE);
  const temporary = join(root, `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Read the trust store, creating it with the preinstalled key when it is absent.
 *
 * A malformed file is reported and ignored, not rewritten: the returned store
 * trusts the first-party key only, which refuses every other publisher rather
 * than guessing what a broken file meant.
 */
export async function openPublisherTrust(root: string): Promise<PublisherTrustStore> {
  const preinstalled = await preinstalledPublisher();
  const file = join(root, TRUST_STORE_FILE);

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const store: PublisherTrustStore = {
      version: TRUST_STORE_VERSION,
      publishers: [preinstalled],
    };
    await writeStore(root, store);
    return store;
  }

  const stored = parseStore(text);
  if (stored === null) {
    console.warn(
      `[shell] ${file} is not a publisher trust store; trusting the first-party key only`,
    );
    return { version: TRUST_STORE_VERSION, publishers: [preinstalled] };
  }

  const publishers = mergePreinstalled(preinstalled, stored);
  const store: PublisherTrustStore = { version: TRUST_STORE_VERSION, publishers };
  // Keep the file honest about the pin when it predates it or was edited.
  if (publishers.length !== stored.length || stored[0]?.key !== preinstalled.key) {
    await writeStore(root, store);
  }
  return store;
}

/**
 * Add a publisher key after the person confirmed its fingerprint.
 *
 * The store is re-read first so an external edit between opening and adding is
 * not silently overwritten. The preinstalled key is merged back by the caller's
 * next `openPublisherTrust`; this function writes the returned full store.
 */
export async function addTrustedPublisher(
  root: string,
  request: PublisherAdditionRequest,
): Promise<PublisherAddition> {
  const current = await openPublisherTrust(root);
  const result = await addToStore(current.publishers, request);
  if (!result.ok) return result;
  await writeStore(root, { version: TRUST_STORE_VERSION, publishers: result.store });
  return result;
}

/** A rotation the person has confirmed by fingerprint (S2.3). */
export interface PublisherRotationRequest {
  readonly statement: RotationStatement;
  /** The fingerprint the host showed and the person confirmed. */
  readonly fingerprint: string;
}

export type PublisherRotationResult =
  | {
      readonly ok: true;
      readonly publisher: ResolvedPublisher;
      readonly sequence: number;
      readonly store: PublisherTrustStore;
    }
  | Extract<RotationCheck, { readonly ok: false }>
  | {
      readonly ok: false;
      readonly reason: "fingerprint-mismatch";
      readonly message: string;
      readonly fingerprint: string | null;
    };

/**
 * Replace a publisher's current key after the person confirmed the new one.
 *
 * Verification and the write are deliberately separate: `checkPublisherRotation`
 * shows the new fingerprint and this function requires the value the person saw.
 * The old key moves to `retiredKeys`; it still verifies installed versions, but
 * a new install must use the current key. The sequence is recorded with the new
 * key, so the same statement cannot be replayed against a later store.
 */
export async function applyPublisherRotation(
  root: string,
  request: PublisherRotationRequest,
): Promise<PublisherRotationResult> {
  const current = await openPublisherTrust(root);
  const check = await checkPublisherRotation(request.statement, current.publishers);
  if (!check.ok) return check;

  const confirmed = normalisePublisherFingerprint(request.fingerprint);
  if (confirmed === null || confirmed !== check.preview.newFingerprint) {
    return {
      ok: false,
      reason: "fingerprint-mismatch",
      fingerprint: check.preview.newFingerprint,
      message: `The new key's fingerprint is ${check.preview.newFingerprint}; the value confirmed was ${request.fingerprint}. Nothing was changed.`,
    };
  }

  const publishers: TrustedPublisher[] = [];
  for (const entry of current.publishers) {
    if (entry.id !== check.preview.publisherId) {
      publishers.push(entry);
      continue;
    }
    const previousFingerprint = entry.fingerprint ?? (await publisherKeyFingerprint(entry.key));
    const retired = [
      ...(entry.retiredKeys ?? []).filter((key) => key.key !== entry.key),
      { key: entry.key, fingerprint: previousFingerprint, sequence: entry.sequence ?? 0 },
    ];
    publishers.push({
      ...entry,
      key: request.statement.newKey,
      fingerprint: check.preview.newFingerprint,
      sequence: check.preview.sequence,
      retiredKeys: retired,
    });
  }

  const store: PublisherTrustStore = { version: TRUST_STORE_VERSION, publishers };
  await writeStore(root, store);
  return {
    ok: true,
    publisher: {
      id: check.preview.publisherId,
      key: request.statement.newKey,
      fingerprint: check.preview.newFingerprint,
    },
    sequence: check.preview.sequence,
    store,
  };
}
