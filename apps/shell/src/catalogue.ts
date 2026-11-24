import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isPublisherKey } from "@suite/pack";
import { publisherKeyDigest, publisherKeyFingerprint } from "@suite/pack/trust";
import {
  checkPackArchive,
  InstalledPackError,
  type InstalledPackInfo,
  type InstalledPackIssue,
  installPackArchive,
  MAX_ARCHIVE_BYTES,
  type PackTrustOptions,
} from "./installedPacks.js";
import type { CatalogueEntry, PackCapability, PackPublisherView } from "./shared.js";

/**
 * The local pack catalogue.
 *
 * This is the distribution path the decision record names: a directory of
 * `.suitepack` files, `<dataRoot>/catalogue` by default, overridable with
 * `SUITE_SHELL_CATALOGUE`. A remote index is a later slice with the same shape.
 *
 * Every archive is read and verified before it is listed. Verification is the
 * same decision the installer makes: the manifest signature against the pinned
 * key, the host fit, the capability list and every file hash. A refused archive
 * still appears, with the refusal sentence, because hiding it would leave a
 * person wondering why a file did nothing. It is never partially extracted and
 * `installCataloguePack` refuses it again before reading bytes.
 */

const PACK_SUFFIX = ".suitepack";

/** A catalogue entry plus the host-only fields the chrome never sees. */
export interface CataloguePack extends CatalogueEntry {
  /** Absolute archive path. Main-process only. */
  readonly file: string;
  /** Which refusal rule produced `refusal`, for the installer's vocabulary. */
  readonly reason: InstalledPackIssue["reason"] | null;
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
 * Scan a catalogue directory.
 *
 * A missing directory is an empty catalogue, not a failure: a new machine has
 * nothing to offer yet. Only regular files with the `.suitepack` suffix are
 * considered; a directory, a symlink or another extension is skipped.
 */
export async function loadCatalogue(
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

  return found.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id) ||
      left.version.localeCompare(right.version),
  );
}

/** The shape the chrome receives. The archive path and refusal reason stay home. */
export function catalogueEntry(pack: CataloguePack): CatalogueEntry {
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
  };
}

/**
 * Install one catalogue entry.
 *
 * The bytes are read and checked again here rather than trusting the listing:
 * the file may have changed since the scan, and the refusal vocabulary is the
 * same one the file picker uses. An untrusted entry is refused before its bytes
 * are read.
 */
export async function installCataloguePack(
  entry: CataloguePack,
  packsRoot: string,
  options: PackTrustOptions,
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
    const metadata = await stat(entry.file);
    if (!metadata.isFile() || metadata.size > MAX_ARCHIVE_BYTES) {
      throw new InstalledPackError(
        { reason: "io", message: "The catalogue archive is no longer a readable pack file." },
        entry.id,
        entry.version,
      );
    }
    bytes = await readFile(entry.file);
  } catch (error) {
    if (error instanceof InstalledPackError) throw error;
    throw new InstalledPackError(
      { reason: "io", message: "The catalogue archive could not be read." },
      entry.id,
      entry.version,
    );
  }

  return installPackArchive(bytes, packsRoot, options);
}

async function inspectFile(
  file: string,
  name: string,
  options: PackTrustOptions,
): Promise<CataloguePack> {
  const stem = name.slice(0, name.length - PACK_SUFFIX.length);
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
    file,
    reason: "unreadable",
  };

  let bytes: Uint8Array;
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_ARCHIVE_BYTES) {
      return { ...fallback, refusal: "That file is too large to be a Suite pack.", reason: "io" };
    }
    bytes = await readFile(file);
  } catch {
    return fallback;
  }

  const check = await checkPackArchive(bytes, options);
  if (check.ok) {
    const manifest = check.value.manifest;
    return {
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
      file,
      reason: null,
    };
  }

  const manifest = check.manifest;
  return {
    id: manifest?.id ?? fallback.id,
    name: manifest?.name ?? fallback.name,
    version: manifest?.version ?? fallback.version,
    description: manifest?.description ?? null,
    entry: manifest?.entry ?? fallback.entry,
    trusted: false,
    refusal: check.error.message,
    publisher: await cataloguePublisher(manifest, check.error.fingerprint ?? null),
    capabilities: (manifest?.capabilities ?? []) as readonly PackCapability[],
    file,
    reason: check.error.reason,
  };
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
