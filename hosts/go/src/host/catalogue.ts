import type { KeyValueStore } from "@suite/go";
import { comparePackVersions, sha256Hex } from "@suite/go";
import {
  MAX_INDEX_BYTES,
  type PackCapability,
  type PackIndexEntry,
  type PackIndexFailureReason,
  type PlatformFitView,
  parsePackIndexJson,
  platformFit,
  platformFitView,
  SUITE_INDEX_PUBLIC_KEY,
  verifyPackIndex,
} from "@suite/pack";
import { GO_HOST } from "@suite/pack/platforms";
import {
  GO_HOST_CAPABILITIES,
  type InstallFailureReason,
  type InstallOutcome,
  MAX_ARCHIVE_BYTES,
  type PackStore,
} from "./packs.js";

/**
 * The published catalogue, read on the phone.
 *
 * This is the same index the desktop shell reads: the same pinned operator key, imported from
 * `@suite/pack` (`packages/pack/src/pinnedKey.ts`) rather than copied, the same
 * `https://flatpak.suite.run/index.json`, and the same `@suite/pack` verifier. Go does not parse
 * or check the index itself. `parsePackIndexJson` refuses an oversized file, a duplicate key and a
 * malformed entry; `verifyPackIndex` refuses an unsigned index, a changed one, one signed by a key
 * this host does not pin, an expired one, a lower `sequence` and a `previous` that names another
 * index. Only after all of that does a row become visible.
 *
 * What this module adds is a host-side head record: the last verified `sequence` and digest, kept
 * in the app's own key-value store so a replay is refused on the next launch too. The head is
 * written only after every check passed.
 */

/** The published index, beside the Flatpak summary on the store's own origin (same as desktop). */
export const DEFAULT_CATALOGUE_INDEX_URL = "https://flatpak.suite.run/index.json";

export const INDEX_HEAD_KEY = "index-head";
const INDEX_HEAD_VERSION = 1;

const INDEX_TIMEOUT_MS = 15_000;
const ARCHIVE_TIMEOUT_MS = 60_000;

/** Go's declaration for a platform check, including the capabilities this build serves. */
const CATALOGUE_HOST = { ...GO_HOST, capabilities: GO_HOST_CAPABILITIES };

/** A request function, injected so tests never touch the network. */
export type CatalogueFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The last verified index, so a replay cannot move the catalogue backwards. */
export interface CatalogueHead {
  readonly sequence: number;
  readonly digest: string;
}

/** The action the catalogue row offers for one available version. */
export type CatalogueAction = "install" | "update" | "reinstall" | "current";

/** One pack the verified index offers, with what is installed beside it. */
export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  /**
   * The position the verified index gave this pack.
   *
   * The index is the one ordered declaration the host has, so Home can show a
   * shadow shelf in the publisher's order without a domain id in the shell.
   */
  readonly order: number;
  readonly description: string | null;
  readonly version: string;
  readonly capabilities: readonly PackCapability[];
  /**
   * What this phone knows about the pack's `platforms`.
   *
   * The index does not carry a platform declaration, so a covered capability
   * set is `unknown` here — never `available`. The archive's manifest is read at
   * install and the store refuses a kind this phone is not (S4.8).
   */
  readonly platform: PlatformFitView;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly url: string;
  readonly publisher: string;
  readonly installedVersion: string | null;
  readonly action: CatalogueAction;
}

export type CatalogueLoad =
  | {
      readonly ok: true;
      readonly entries: readonly CatalogueEntry[];
      readonly sequence: number;
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly reason: "unreachable" | "refused";
      readonly message: string;
    };

export type CatalogueInstall =
  | {
      readonly ok: true;
      readonly entry: CatalogueEntry;
      readonly action: Exclude<CatalogueAction, "current">;
      readonly outcome: Extract<InstallOutcome, { readonly ok: true }>;
    }
  | {
      readonly ok: false;
      readonly reason: InstallFailureReason | "missing" | "unreachable";
      readonly message: string;
    };

export interface CatalogueOptions {
  readonly packs: PackStore;
  /** The store that holds the head record. Namespaced by the caller. */
  readonly store: Pick<KeyValueStore, "get" | "set">;
  /** Production never passes this; a test does. */
  readonly indexUrl?: string;
  readonly operatorKeys?: readonly string[];
  readonly now?: Date;
  readonly fetch?: CatalogueFetch;
}

export interface Catalogue {
  /** Fetch, verify and list. Nothing is returned unless the whole index verified. */
  load(): Promise<CatalogueLoad>;
  /** Install the displayed version, replacing the same version only when it is a reinstall. */
  install(id: string, version: string): Promise<CatalogueInstall>;
  /** Remove every installed version of a pack. Documents live outside the pack root and stay. */
  remove(id: string): Promise<void>;
  /** The last verified head, for tests and a status line. */
  head(): Promise<CatalogueHead | null>;
}

export function createCatalogue(options: CatalogueOptions): Catalogue {
  const fetchImpl = options.fetch ?? fetch;
  const indexUrl = options.indexUrl ?? DEFAULT_CATALOGUE_INDEX_URL;
  const operatorKeys = options.operatorKeys ?? [SUITE_INDEX_PUBLIC_KEY];
  const now = () => options.now ?? new Date();

  /** The last loaded index, kept so `install` installs what was displayed. */
  let offered: ReadonlyMap<string, PackIndexEntry> = new Map();

  const readHead = async (): Promise<CatalogueHead | null> => {
    const raw = await options.store.get(INDEX_HEAD_KEY);
    if (raw === null || raw.length === 0) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("the recorded catalogue head is not valid JSON");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("the recorded catalogue head is malformed");
    }
    const record = value as Record<string, unknown>;
    if (record.version !== INDEX_HEAD_VERSION) {
      throw new Error("the recorded catalogue head has an unknown version");
    }
    if (
      typeof record.sequence !== "number" ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence < 0
    ) {
      throw new Error("the recorded catalogue head has no usable sequence");
    }
    if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/u.test(record.digest)) {
      throw new Error("the recorded catalogue head has no usable digest");
    }
    return { sequence: record.sequence, digest: record.digest };
  };

  const writeHead = async (head: CatalogueHead): Promise<void> => {
    await options.store.set(
      INDEX_HEAD_KEY,
      JSON.stringify({ version: INDEX_HEAD_VERSION, ...head }),
    );
  };

  const load = async (): Promise<CatalogueLoad> => {
    let text: string;
    try {
      text = await fetchIndexText(indexUrl, fetchImpl);
    } catch (error) {
      return {
        ok: false,
        reason: "unreachable",
        message: `The published catalogue could not be fetched: ${errorText(error)}.`,
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

    let head: CatalogueHead | null;
    try {
      head = await readHead();
    } catch (error) {
      return {
        ok: false,
        reason: "refused",
        message: `The trusted catalogue head could not be read: ${errorText(error)}.`,
      };
    }

    const verified = await verifyPackIndex(parsed.value, {
      operatorKeys,
      now: now(),
      head,
    });
    if (!verified.ok) {
      return {
        ok: false,
        reason: "refused",
        message: describeVerification(
          parsed.value,
          verified.reason,
          verified.message,
          operatorKeys,
        ),
      };
    }

    try {
      await writeHead({ sequence: parsed.value.sequence, digest: verified.digest });
    } catch (error) {
      return {
        ok: false,
        reason: "refused",
        message: `The verified index could not be recorded, so a later rollback could not be refused: ${errorText(error)}.`,
      };
    }

    const installed = new Map(
      (await options.packs.discover()).map((pack) => [pack.manifest.id, pack] as const),
    );

    // One row per pack. The index may carry several versions; the newest is what a person is
    // offered, and the installed version beside it says whether that is an update.
    const newest = new Map<string, PackIndexEntry>();
    for (const entry of parsed.value.entries) {
      const current = newest.get(entry.id);
      if (current === undefined || comparePackVersions(entry.version, current.version) > 0) {
        newest.set(entry.id, entry);
      }
    }

    offered = newest;

    // The index's own order is the shelf's order. Sorting by name here would
    // replace the publisher's declaration with an accident of the alphabet, and
    // a host-owned order table would be the container learning a domain.
    const entries = [...newest.values()].map((entry, order): CatalogueEntry => {
      const pack = installed.get(entry.id);
      const installedVersion = pack?.manifest.version ?? null;
      return {
        id: entry.id,
        name: entry.name,
        order,
        description: entry.description ?? null,
        version: entry.version,
        capabilities: entry.capabilities,
        platform: cataloguePlatform(entry.platforms, entry.capabilities),
        sizeBytes: entry.archive.size,
        sha256: entry.archive.sha256,
        url: entry.archive.url,
        publisher: entry.publisher,
        installedVersion,
        action: actionFor(installedVersion, entry.version),
      };
    });

    return { ok: true, entries, sequence: parsed.value.sequence, digest: verified.digest };
  };

  const install = async (id: string, version: string): Promise<CatalogueInstall> => {
    const entry = offered.get(id);
    if (entry === undefined || entry.version !== version) {
      return {
        ok: false,
        reason: "missing",
        message: "That app is not in the catalogue this screen verified. Refresh and try again.",
      };
    }

    const installedVersion = await installedVersionOf(options.packs, id);
    const action = actionFor(installedVersion, entry.version);
    if (action === "current") {
      return {
        ok: false,
        reason: "invalid",
        message: `${entry.name} ${entry.version} is already the newest installed version. Reinstall only replaces the same version.`,
      };
    }

    // The index carries capabilities, so a definite mismatch is refused before the
    // archive is downloaded. A platform-only mismatch is caught by the pack store
    // once it reads the manifest.
    const fit = platformFit(
      {
        ...(entry.platforms === undefined ? {} : { platforms: entry.platforms }),
        capabilities: entry.capabilities,
      },
      CATALOGUE_HOST,
    );
    if (fit.state === "unavailable") {
      return {
        ok: false,
        reason: "platform",
        message: fit.reason ?? "That pack is not available on this phone.",
      };
    }

    let bytes: Uint8Array;
    try {
      bytes = await fetchArchive(entry.archive.url, fetchImpl);
    } catch (error) {
      return {
        ok: false,
        reason: "unreachable",
        message: `The archive for ${entry.name} ${entry.version} could not be fetched: ${errorText(error)}.`,
      };
    }

    // Checked here as well as inside the store so the refusal happens before the zip reader sees
    // a byte. The store repeats it because it is the last gate before extraction.
    if ((await sha256Hex(bytes)) !== entry.archive.sha256) {
      return {
        ok: false,
        reason: "digest",
        message:
          "That archive does not match the digest the catalogue displayed; it was refused before it was opened.",
      };
    }

    const outcome = await options.packs.install(bytes, {
      // A reinstall of the same version replaces that directory. An update is a new version
      // directory beside the old one, so the previous version stays for rollback.
      replace: action === "reinstall",
      expected: {
        id: entry.id,
        version: entry.version,
        sha256: entry.archive.sha256,
        size: entry.archive.size,
      },
    });
    if (!outcome.ok) {
      return { ok: false, reason: outcome.reason, message: outcome.message };
    }

    return {
      ok: true,
      entry: {
        ...entryToCatalogue(entry),
        installedVersion: entry.version,
        action: "current",
      },
      action,
      outcome,
    };
  };

  const remove = async (id: string): Promise<void> => {
    await options.packs.uninstall(id);
  };

  return { load, install, remove, head: readHead };
}

/**
 * What the index lets this phone know about a pack's platforms.
 *
 * A current index carries the manifest's declaration, so the row can say the
 * pack is built for `desktop` without downloading it. An older index has no
 * declaration: a covered capability set is then unknown, never available. The
 * archive's manifest is read at install either way, where the pack store refuses
 * a kind this phone is not (S4.8).
 */
function cataloguePlatform(
  platforms: readonly string[] | undefined,
  capabilities: readonly PackCapability[],
): PlatformFitView {
  const fit = platformFit(
    {
      ...(platforms === undefined ? {} : { platforms }),
      capabilities,
    },
    CATALOGUE_HOST,
  );
  if (fit.state === "unknown") {
    return {
      state: "unknown",
      reason:
        "platform unknown — the catalogue index carries no platform declaration; the install checks the pack",
    };
  }
  return platformFitView(fit);
}

/** What the row offers: nothing installed, an older version, the same version, or a newer one. */
export function actionFor(
  installedVersion: string | null,
  offeredVersion: string,
): CatalogueAction {
  if (installedVersion === null) return "install";
  const order = comparePackVersions(offeredVersion, installedVersion);
  if (order > 0) return "update";
  if (order === 0) return "reinstall";
  return "current";
}

async function installedVersionOf(packs: PackStore, id: string): Promise<string | null> {
  const pack = (await packs.discover()).find((candidate) => candidate.manifest.id === id);
  return pack?.manifest.version ?? null;
}

function entryToCatalogue(entry: PackIndexEntry): CatalogueEntry {
  return {
    id: entry.id,
    name: entry.name,
    // A single install result has no shelf position; the next load assigns one.
    order: 0,
    description: entry.description ?? null,
    version: entry.version,
    capabilities: entry.capabilities,
    platform: cataloguePlatform(entry.platforms, entry.capabilities),
    sizeBytes: entry.archive.size,
    sha256: entry.archive.sha256,
    url: entry.archive.url,
    publisher: entry.publisher,
    installedVersion: null,
    action: "install",
  };
}

/**
 * A refusal in the sentence a person sees.
 *
 * Each branch names the rule instead of "invalid": a changed index, a key this host does not pin,
 * an expired catalogue, a lower sequence and a broken chain are different facts with different
 * next steps.
 */
function describeVerification(
  index: { readonly threshold: number; readonly signatures: readonly { readonly key: string }[] },
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
  if (reason === "expired") return message;
  if (reason === "rollback") return message;
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

async function fetchArchive(url: string, fetchImpl: CatalogueFetch): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("the catalogue entry names an archive URL this host will not fetch");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error("the catalogue entry names an archive URL this host will not fetch");
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

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "an unknown error";
}
