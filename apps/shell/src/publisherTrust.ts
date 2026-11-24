import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addTrustedPublisher as addToStore,
  isPublisherKey,
  isSafePublisherId,
  type PublisherAddition,
  type PublisherAdditionRequest,
  SUITE_PACK_PUBLIC_KEY,
  SUITE_PUBLISHER_ID,
  type TrustedPublisher,
} from "@suite/pack";
import { publisherKeyFingerprint } from "@suite/pack/trust";

/**
 * The host's publisher trust store (S2.1).
 *
 * A local file, `<dataRoot>/trust/publishers.json` by default and
 * `SUITE_SHELL_TRUST` when set. The first-party key is preinstalled and the pin
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

/** `<dataRoot>/trust`, or the `SUITE_SHELL_TRUST` override. */
export function trustRootFor(
  dataRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env.SUITE_SHELL_TRUST?.trim();
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
    const source = entry.source;
    entries.push({
      id: entry.id,
      key: entry.key,
      ...(entry.fingerprint === undefined ? {} : { fingerprint: entry.fingerprint }),
      ...(source === undefined ? {} : { source }),
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
