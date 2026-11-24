import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isPublisherKey } from "@suite/pack";
import { publisherKeyDigest, publisherKeyFingerprint } from "@suite/pack/trust";
import {
  checkPackArchive,
  comparePackVersions,
  InstalledPackError,
  type InstalledPackInfo,
  type InstalledPackIssue,
  installPackArchive,
  MAX_ARCHIVE_BYTES,
  type PackTrustOptions,
} from "./installedPacks.js";
import type { CatalogueEntry, PackCapability, PackPublisherView } from "./shared.js";

/**
 * The pack catalogue.
 *
 * The local directory is the distribution path the decision record names:
 * `.suitepack` files in `<dataRoot>/catalogue` by default, overridable with
 * `SUITE_SHELL_CATALOGUE`. A person may always install from a file without it
 * (S12.1).
 *
 * When the operator-signed index has been verified, the same surface also consumes it. This module
 * never parses or checks the index; it receives only the verified result through
 * `VerifiedCatalogueIndex`. Every archive is still read and verified here with the installer's
 * rules: manifest signature against the trust store, host fit, capability list and every file hash.
 * An indexed entry must also match the digest-size-identity the index displayed, or it is refused
 * (S12.7).
 *
 * A refused archive still appears, with the refusal sentence, because hiding it
 * would leave a person wondering why a file did nothing. It is never partially
 * extracted and `installCataloguePack` refuses it again before reading bytes.
 */

const PACK_SUFFIX = ".suitepack";
const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * The verified-index seam.
 *
 * `indexTrust.ts` owns the index format, its operator signature, fetching and its own refusals. It
 * hands this module entries that already passed those checks and a reader for each archive. Index
 * parsing and verification are deliberately not implemented here; `main` passes the verified
 * result, and the local directory remains a source when no index is available.
 */
export interface VerifiedCatalogueIndex {
  readonly packs: readonly VerifiedIndexPack[];
}

/** One index entry after `indexTrust.ts` verified the index. The archive is not trusted yet. */
export interface VerifiedIndexPack {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly capabilities: readonly PackCapability[];
  readonly sizeBytes: number;
  readonly sha256: string;
  /** Fetch the archive the index names. It is verified again before install. */
  readonly readArchive: () => Promise<Uint8Array>;
}

/** A catalogue entry plus the host-only fields the chrome never sees. */
export interface CataloguePack extends CatalogueEntry {
  /** Absolute archive path for a local file; null for an index entry. Main-process only. */
  readonly file: string | null;
  /** Which refusal rule produced `refusal`, for the installer's vocabulary. */
  readonly reason: InstalledPackIssue["reason"] | null;
  /** The digest the verified index displayed; null for a local directory entry. */
  readonly expectedSha256: string | null;
  /** Read the archive bytes again; the file may have changed since the scan. */
  readonly readArchive: () => Promise<Uint8Array>;
}

/** What a catalogue install should do to an existing version directory. */
export interface CatalogueInstallOptions {
  /** Replace the existing version directory. A reinstall names this; an update does not. */
  readonly replace?: boolean;
}

/** The catalogue directory: the environment override, or `<dataRoot>/catalogue`. */
export function catalogueRootFor(
  dataRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env.SUITE_SHELL_CATALOGUE?.trim();
  return override !== undefined && override.length > 0 ? override : join(dataRoot, "catalogue");
}

/**
 * Scan a catalogue directory and, when present, the verified index.
 *
 * A missing directory is an empty catalogue, not a failure: a new machine has
 * nothing to offer yet. Only regular files with the `.suitepack` suffix are
 * considered; a directory, a symlink or another extension is skipped.
 *
 * An index entry supersedes a local file with the same id and version: the
 * index is the copy that was displayed.
 */
export async function loadCatalogue(
  root: string,
  options: PackTrustOptions,
  index: VerifiedCatalogueIndex | null = null,
): Promise<readonly CataloguePack[]> {
  const local = await scanDirectory(root, options);
  const indexed =
    index === null
      ? []
      : await Promise.all(index.packs.map((pack) => inspectIndexPack(pack, options)));

  const merged = new Map<string, CataloguePack>();
  for (const pack of local) merged.set(catalogueKey(pack), pack);
  for (const pack of indexed) merged.set(catalogueKey(pack), pack);

  return [...merged.values()].sort(compareCataloguePacks);
}

/** The shape the chrome receives. The archive path and refusal reason stay home. */
export function catalogueEntry(
  pack: CataloguePack,
  installedVersion: string | null = null,
): CatalogueEntry {
  return {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    description: pack.description,
    entry: pack.entry,
    trusted: pack.trusted,
    refusal: pack.refusal,
    publisher: pack.publisher,
    capabilities: pack.capabilities,
    sizeBytes: pack.sizeBytes,
    updateAvailable: isUpdate(pack.version, installedVersion),
  };
}

/**
 * Install one catalogue entry.
 *
 * The bytes are read and checked again here rather than trusting the listing:
 * the file may have changed since the scan, and the refusal vocabulary is the
 * same one the file picker uses. An indexed entry must still match the digest
 * the index displayed (S12.7). An untrusted entry is refused before its bytes
 * are read.
 *
 * `replace` is a reinstall: it swaps the version directory only after the new
 * archive verified and extracted into a temporary sibling, so a failed reinstall
 * leaves the previous version running. Documents and files live outside the
 * pack root and are never part of either action.
 */
export async function installCataloguePack(
  entry: CataloguePack,
  packsRoot: string,
  options: PackTrustOptions,
  install: CatalogueInstallOptions = {},
): Promise<InstalledPackInfo> {
  if (!entry.trusted) {
    throw new InstalledPackError(
      {
        reason: entry.reason ?? "untrusted",
        message: entry.refusal ?? "The catalogue entry was not verified.",
      },
      entry.id.length > 0 ? entry.id : null,
      entry.version.length > 0 ? entry.version : null,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await entry.readArchive();
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new InstalledPackError(
        { reason: "io", message: "The catalogue archive is no longer a readable pack file." },
        entry.id,
        entry.version,
      );
    }
  } catch (error) {
    if (error instanceof InstalledPackError) throw error;
    throw new InstalledPackError(
      { reason: "io", message: "The catalogue archive could not be read." },
      entry.id,
      entry.version,
    );
  }

  if (entry.expectedSha256 !== null && sha256(bytes) !== entry.expectedSha256) {
    throw new InstalledPackError(
      {
        reason: "invalid",
        message: "The catalogue archive no longer matches the index that was displayed.",
      },
      entry.id,
      entry.version,
    );
  }

  return installPackArchive(bytes, packsRoot, options, { replace: install.replace === true });
}

async function scanDirectory(
  root: string,
  options: PackTrustOptions,
): Promise<readonly CataloguePack[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];

  const found: CataloguePack[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(PACK_SUFFIX)) continue;
    found.push(await inspectFile(join(root, entry.name), entry.name, options));
  }

  return found;
}

async function inspectFile(
  file: string,
  name: string,
  options: PackTrustOptions,
): Promise<CataloguePack> {
  const stem = name.slice(0, name.length - PACK_SUFFIX.length);
  const readArchive = localReader(file);
  const fallback: CataloguePack = {
    id: stem,
    name: stem,
    version: "",
    description: null,
    entry: "",
    trusted: false,
    refusal: "The archive could not be read.",
    publisher: null,
    capabilities: [],
    sizeBytes: 0,
    updateAvailable: false,
    file,
    reason: "unreadable",
    expectedSha256: null,
    readArchive,
  };

  let bytes: Uint8Array;
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_ARCHIVE_BYTES) {
      return {
        ...fallback,
        sizeBytes: metadata.size,
        refusal: "That file is too large to be a Suite pack.",
        reason: "io",
      };
    }
    bytes = await readArchive();
    return await inspectArchive(bytes, { ...fallback, sizeBytes: metadata.size }, options);
  } catch {
    return fallback;
  }
}

/**
 * Check one index entry's archive against what the index displayed, then the
 * installer's own rules. `indexTrust.ts` already verified the index itself.
 */
async function inspectIndexPack(
  pack: VerifiedIndexPack,
  options: PackTrustOptions,
): Promise<CataloguePack> {
  const fallback: CataloguePack = {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    description: pack.description,
    entry: "",
    trusted: false,
    refusal: "The archive could not be read.",
    publisher: null,
    capabilities: pack.capabilities,
    sizeBytes: pack.sizeBytes,
    updateAvailable: false,
    file: null,
    reason: "unreadable",
    expectedSha256: null,
    readArchive: pack.readArchive,
  };

  let bytes: Uint8Array;
  try {
    bytes = await pack.readArchive();
  } catch {
    return fallback;
  }

  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    return { ...fallback, refusal: "That archive is too large to be a Suite pack.", reason: "io" };
  }

  const expected = pack.sha256.trim().toLowerCase();
  if (!SHA256.test(expected) || bytes.byteLength !== pack.sizeBytes || sha256(bytes) !== expected) {
    return {
      ...fallback,
      refusal: "The catalogue index does not match the archive it names.",
      reason: "invalid",
    };
  }

  return inspectArchive(bytes, { ...fallback, expectedSha256: expected }, options);
}

async function inspectArchive(
  bytes: Uint8Array,
  base: CataloguePack,
  options: PackTrustOptions,
): Promise<CataloguePack> {
  const check = await checkPackArchive(bytes, options);
  if (check.ok) {
    const manifest = check.value.manifest;
    // S12.7: the verified manifest must be the one the catalogue displayed.
    if (base.expectedSha256 !== null && !sameDisplayedPack(base, manifest)) {
      return {
        ...base,
        trusted: false,
        refusal: "The catalogue index does not match the archive it names.",
        publisher: {
          id: check.value.publisher.id,
          fingerprint: check.value.publisher.fingerprint,
        },
        reason: "identity",
      };
    }
    return {
      ...base,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      entry: manifest.entry,
      trusted: true,
      refusal: null,
      publisher: {
        id: check.value.publisher.id,
        fingerprint: check.value.publisher.fingerprint,
      },
      capabilities: manifest.capabilities,
      reason: null,
    };
  }

  const manifest = check.manifest;
  return {
    ...base,
    id: manifest?.id ?? base.id,
    name: manifest?.name ?? base.name,
    version: manifest?.version ?? base.version,
    description: manifest?.description ?? null,
    entry: manifest?.entry ?? base.entry,
    trusted: false,
    refusal: check.error.message,
    publisher: await cataloguePublisher(manifest, check.error.fingerprint ?? null),
    capabilities: (manifest?.capabilities ?? []) as readonly PackCapability[],
    reason: check.error.reason,
  };
}

function localReader(file: string): () => Promise<Uint8Array> {
  return async () => {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_ARCHIVE_BYTES) {
      throw new InstalledPackError({
        reason: "io",
        message: "The catalogue archive is no longer a readable pack file.",
      });
    }
    return readFile(file);
  };
}

function sameDisplayedPack(
  base: CataloguePack,
  manifest: {
    readonly id: string;
    readonly version: string;
  },
): boolean {
  return manifest.id === base.id && manifest.version === base.version;
}

function isUpdate(version: string, installedVersion: string | null): boolean {
  if (installedVersion === null || version.length === 0 || installedVersion.length === 0)
    return false;
  try {
    return comparePackVersions(version, installedVersion) > 0;
  } catch {
    return false;
  }
}

function catalogueKey(pack: CataloguePack): string {
  return `${pack.id}\u0000${pack.version}`;
}

function compareCataloguePacks(left: CataloguePack, right: CataloguePack): number {
  return (
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id) ||
    left.version.localeCompare(right.version)
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The publisher a refused archive claims, if it names a key.
 *
 * The fingerprint comes from the refusal when the trust decision computed one;
 * otherwise it is computed here. A refused entry still shows who signed it, so
 * the person can compare the value before deciding to add the key.
 */
async function cataloguePublisher(
  manifest: {
    readonly publisher?: { readonly id?: string; readonly key: string } | undefined;
  } | null,
  fingerprint: string | null,
): Promise<PackPublisherView | null> {
  const publisher = manifest?.publisher;
  if (publisher === undefined || !isPublisherKey(publisher.key)) return null;
  return {
    id: publisher.id ?? (await publisherKeyDigest(publisher.key)),
    fingerprint: fingerprint ?? (await publisherKeyFingerprint(publisher.key)),
  };
}
