import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import {
  checkPublisherTrust,
  DESK_HOST,
  type HostDeclaration,
  isPublisherKey,
  isSafePackId,
  isSafePackPath,
  isSafePublisherId,
  type PackManifest,
  type PackRing,
  packFitsHost,
  packMinimumHost,
  packRing,
  parsePackManifest,
  platformFit,
  type ResolvedPublisher,
  SUITE_PUBLISHER_ID,
  type TrustedPublisher,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";
import { isPackRevoked, type RevocationAdvisory } from "./packRevocation.js";
import type { PackInfo } from "./packs.js";
import type { PackCapability, PackPublisherView } from "./shared.js";

/**
 * Installed packs.
 *
 * A pack is a signed manifest plus the files it lists. The archive reader owns
 * the zip format (traversal, duplicates and decompression limits); this module
 * owns the trust decision and the on-disk layout: `<root>/<id>/<version>/`, with
 * the manifest and every listed file inside that version directory.
 *
 * Nothing here imports Electron or talks to a window. The host's integration
 * layer decides where `root` is and which pinned key to trust.
 */

const MIB = 1024 * 1024;
/** The compressed archive size this host accepts. The reader enforces its own entry limits too. */
export const MAX_ARCHIVE_BYTES = 64 * MIB;
const MANIFEST_NAME = "manifest.json";
/** The identity record in a pack's id directory: who owns this public id here. */
const IDENTITY_NAME = "publisher.json";
const TEMPORARY_PREFIX = ".tmp-";

/**
 * The host policy a pack is checked against (S2.1, S2.2).
 *
 * `publishers` is the local trust store, not a single pinned key. A generated
 * key is enough for tests. `allowPublisherMigration` is the explicit migration
 * S2.2 requires; the host never passes it, so a different publisher under an
 * existing id is refused unless the host names the migration.
 */
export interface PackTrustOptions {
  readonly publishers: readonly TrustedPublisher[];
  readonly hostContractVersion: number;
  readonly hostVersion: number;
  readonly hostCapabilities: readonly PackCapability[];
  /**
   * The rings this host offers (S12.10). Absent means `stable` alone; `preview`
   * is added only by the person's explicit host setting.
   */
  readonly rings?: readonly PackRing[];
  /** The kind this host reports. Defaults to the desktop host's `desktop`. */
  readonly hostKind?: string;
  /** Permit replacing an id's publisher. The migration changes no stored data. */
  readonly allowPublisherMigration?: boolean;
  /**
   * Signed revocation advisories (S2.4). They refuse a *new* install; the
   * installed-version scan never consults them, so a running pack is not
   * disabled.
   */
  readonly revocations?: readonly RevocationAdvisory[];
}

/** What an install may do to an existing version directory. */
export interface PackInstallOptions {
  /**
   * Replace an existing version directory. Only a reinstall names this; an
   * ordinary install and an update refuse to overwrite.
   */
  readonly replace?: boolean;
}

/** A pack installed under the host's pack root. `root` is its version directory. */
export interface InstalledPackInfo extends PackInfo {
  readonly source: "installed";
  /** Every installed pack resolved a publisher; only a development directory has none. */
  readonly publisher: PackPublisherView;
}

/** One candidate that was refused. `id` and `version` are null when the path never yielded them. */
export interface InstalledPackIssue {
  readonly id: string | null;
  readonly version: string | null;
  readonly reason:
    | "unreadable"
    | "invalid"
    | "untrusted"
    | "publisher"
    | "identity"
    | "files"
    | "host"
    | "capability"
    | "platform"
    | "revocation"
    | "extra-files"
    | "io";
  readonly message: string;
  /** The publisher fingerprint when the refusal turned on a key. */
  readonly fingerprint?: string | null;
}

/** One verified version directory, whether or not it is the selected version. */
export interface InstalledVersion {
  readonly id: string;
  readonly version: string;
  readonly root: string;
  readonly publisher: PackPublisherView;
}

export interface InstalledPackScan {
  readonly packs: readonly InstalledPackInfo[];
  readonly issues: readonly InstalledPackIssue[];
  /** Every valid version on disk, including older versions kept after an update. */
  readonly versions: readonly InstalledVersion[];
}

/** A verified archive: the signed manifest and the payload the reader extracted. */
export interface VerifiedPackArchive {
  readonly manifest: PackManifest;
  readonly manifestBytes: Uint8Array;
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The publisher the trust store resolved, whose key verified the signature. */
  readonly publisher: ResolvedPublisher;
}

/**
 * The result of checking an archive without writing anything.
 *
 * `manifest` is present whenever the archive yielded a parseable manifest, even
 * when the signature or file hashes refused it, so the catalogue can show what
 * the archive claims to be next to the refusal.
 */
export type PackArchiveCheck =
  | { readonly ok: true; readonly value: VerifiedPackArchive }
  | {
      readonly ok: false;
      readonly error: InstalledPackError;
      readonly manifest: PackManifest | null;
    };

/** A refusal before it is given an id and version. */
interface Refusal {
  readonly reason: InstalledPackIssue["reason"];
  readonly message: string;
  readonly fingerprint?: string | null;
}

/** An installation that never reached its target directory. */
export class InstalledPackError extends Error {
  readonly reason: InstalledPackIssue["reason"];
  readonly id: string | null;
  readonly version: string | null;
  /** The publisher fingerprint, when the refusal is about a publisher key. */
  readonly fingerprint: string | null;

  constructor(refusal: Refusal, id: string | null = null, version: string | null = null) {
    super(refusal.message);
    this.name = "InstalledPackError";
    this.reason = refusal.reason;
    this.id = id;
    this.version = version;
    this.fingerprint = refusal.fingerprint ?? null;
  }
}

/**
 * What S2.5 requires the host to show at install and update: who signed the
 * pack, its id, its version and the capabilities it will hold.
 */
export interface PackInstallSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly PackCapability[];
  readonly publisher: PackPublisherView;
}

export function packInstallSummary(
  manifest: Pick<PackManifest, "id" | "name" | "version" | "capabilities">,
  publisher: ResolvedPublisher,
): PackInstallSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    capabilities: manifest.capabilities,
    publisher: { id: publisher.id, fingerprint: publisher.fingerprint },
  };
}

/** One sentence a person can read before or after an install or update. */
export function describePackInstall(
  summary: PackInstallSummary,
  action: "install" | "update" | "reinstall",
): string {
  const capabilities =
    summary.capabilities.length === 0 ? "no capabilities" : summary.capabilities.join(", ");
  const verb = action === "install" ? "Install" : action === "update" ? "Update" : "Reinstall";
  return `${verb} ${summary.name} ${summary.version} (${summary.id}) from publisher ${summary.publisher.id}, key SHA-256 ${summary.publisher.fingerprint}; capabilities: ${capabilities}.`;
}

/**
 * Scan an install root and return the highest valid version of each pack.
 *
 * A bad version is reported and skipped, not fatal: a newer failed download must
 * not hide the older version that still works. Every refused candidate is in
 * `issues`; lower valid versions that lost to a higher one are not, because
 * choosing the newest is not a refusal.
 */
export async function loadInstalledPacks(
  root: string,
  options: PackTrustOptions,
): Promise<InstalledPackScan> {
  if (!(await pathExists(root))) return { packs: [], issues: [], versions: [] };

  const idEntries = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (idEntries === null) {
    return {
      packs: [],
      issues: [
        {
          id: null,
          version: null,
          reason: "io",
          message: "The pack install root could not be read.",
        },
      ],
      versions: [],
    };
  }

  const issues: InstalledPackIssue[] = [];
  const packs: InstalledPackInfo[] = [];
  const versions: InstalledVersion[] = [];

  for (const idEntry of idEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    // A crash can leave a temporary directory behind. It is not a pack id.
    if (idEntry.name.startsWith(TEMPORARY_PREFIX)) continue;
    if (!idEntry.isDirectory()) continue;

    const id = idEntry.name;
    if (!isSafePackId(id)) {
      issues.push({
        id: null,
        version: null,
        reason: "invalid",
        message: `"${id}" is not a pack id; the directory is ignored.`,
      });
      continue;
    }

    const idRoot = join(root, id);
    const versionEntries = await readdir(idRoot, { withFileTypes: true }).catch(() => null);
    if (versionEntries === null) {
      issues.push({ id, version: null, reason: "io", message: `${id} could not be read.` });
      continue;
    }

    // Who owns this public id here. A record written by an install is the
    // authority; a pre-S2.1 install has none until its first install, so the
    // versions themselves answer the question.
    const identity = await readInstalledIdentity(idRoot);

    const valid: InstalledPackInfo[] = [];
    for (const versionEntry of versionEntries.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true }),
    )) {
      // A crash can leave a temporary sibling of a version directory behind.
      if (versionEntry.name.startsWith(TEMPORARY_PREFIX)) continue;
      if (!versionEntry.isDirectory()) continue;
      const version = versionEntry.name;
      if (!isSafePackPath(`${id}/${version}`)) {
        issues.push({
          id,
          version,
          reason: "invalid",
          message: `${id} has a version directory that leaves the pack root; it is ignored.`,
        });
        continue;
      }

      const verified = await verifyInstalledDirectory(join(idRoot, version), id, version, options);
      if (verified.ok) {
        valid.push(verified.info);
        versions.push({
          id,
          version,
          root: verified.info.root,
          publisher: verified.info.publisher,
        });
      } else {
        issues.push(verified.issue);
      }
    }

    const publisherIds = new Set(
      valid
        .map((pack) => pack.publisher?.id)
        .filter((publisherId): publisherId is string => publisherId !== undefined),
    );
    const activePublisher = identity?.id ?? singlePublisher(publisherIds);
    if (identity === null && publisherIds.size > 1) {
      issues.push({
        id,
        version: null,
        reason: "identity",
        message: `${id} has versions from more than one publisher (${[...publisherIds].join(", ")}); only ${activePublisher ?? "none"} is loaded.`,
      });
    }

    const owned = valid.filter((pack) => pack.publisher?.id === activePublisher);
    for (const foreign of valid.filter((pack) => pack.publisher?.id !== activePublisher)) {
      issues.push({
        id,
        version: foreign.version,
        reason: "identity",
        message: `${id} ${foreign.version} is signed by ${foreign.publisher?.id ?? "an unknown publisher"}, but this id is installed by ${identity?.id ?? activePublisher ?? "another publisher"}; it is not loaded.`,
        fingerprint: foreign.publisher?.fingerprint ?? null,
      });
    }

    const best = highestVersion(owned);
    if (best !== null) packs.push(best);
  }

  packs.sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  versions.sort(
    (left, right) =>
      left.id.localeCompare(right.id) || comparePackVersions(left.version, right.version),
  );
  return { packs, issues, versions };
}

/**
 * Read and verify an archive without writing anything.
 *
 * This is the catalogue's whole trust decision: the archive reader owns the zip
 * format, the manifest parser owns the shape, and `verifyManifest` owns the
 * signature, the host fit and every file hash. Nothing is extracted here, so a
 * refused archive leaves no directory behind.
 */
export async function checkPackArchive(
  bytes: Uint8Array,
  options: PackTrustOptions,
): Promise<PackArchiveCheck> {
  let archive: Awaited<ReturnType<typeof readPackArchive>>;
  try {
    archive = await readPackArchive(bytes, { maxArchiveBytes: MAX_ARCHIVE_BYTES });
  } catch (error) {
    return {
      ok: false,
      manifest: null,
      error: new InstalledPackError({
        reason: "unreadable",
        message: error instanceof Error ? error.message : "The pack archive could not be read.",
      }),
    };
  }

  let manifest: PackManifest;
  try {
    manifest = parseArchiveManifest(archive.manifestBytes);
  } catch (error) {
    if (error instanceof InstalledPackError) return { ok: false, manifest: null, error };
    throw error;
  }

  // The manifest schema already refuses a slash in `version`, but the guard
  // stays as the last check before a path is joined; a schema change must not
  // turn this into a traversal.
  if (!isSafePackId(manifest.id) || !isSafePackPath(`${manifest.id}/${manifest.version}`)) {
    return {
      ok: false,
      manifest,
      error: new InstalledPackError(
        { reason: "invalid", message: "The manifest names an id or version that is not safe." },
        manifest.id,
        manifest.version,
      ),
    };
  }

  const verification = await verifyManifest(
    manifest,
    () => [...archive.files.keys()],
    async (path) => archive.files.get(path) ?? null,
    options,
    // A new install (and the catalogue listing that offers it) consults the
    // revocation advisories; the installed-version scan deliberately does not.
    { refuseRevoked: true },
  );
  if (!verification.ok) {
    return {
      ok: false,
      manifest,
      error: new InstalledPackError(verification.refusal, manifest.id, manifest.version),
    };
  }

  return {
    ok: true,
    value: {
      manifest,
      manifestBytes: archive.manifestBytes,
      files: archive.files,
      publisher: verification.publisher,
    },
  };
}

/**
 * Verify an archive and install it at `<root>/<id>/<version>/`.
 *
 * The files are written to a temporary sibling first and renamed into place, so
 * a scan never sees a half-written version. An existing version is refused
 * rather than overwritten unless `install.replace` names a reinstall. That
 * replacement renames the old directory aside only after the new one has
 * extracted, and restores it if the swap fails, so a failed reinstall leaves the
 * previous version intact.
 */
export async function installPackArchive(
  bytes: Uint8Array,
  root: string,
  options: PackTrustOptions,
  install: PackInstallOptions = {},
): Promise<InstalledPackInfo> {
  const check = await checkPackArchive(bytes, options);
  if (!check.ok) throw check.error;
  const { manifest, manifestBytes, files: archiveFiles, publisher } = check.value;

  const idRoot = join(root, manifest.id);
  const target = join(idRoot, manifest.version);
  const refuseIo = (message: string): InstalledPackError =>
    new InstalledPackError({ reason: "io", message }, manifest.id, manifest.version);
  const inspect = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> => {
    try {
      return await lstat(path);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw refuseIo("The pack install directory could not be read.");
    }
  };

  // The data root may sit behind a symlinked ancestor (a home directory is the
  // common case), so containment is checked against its real path.
  let realRoot: string;
  try {
    await mkdir(root, { recursive: true });
    realRoot = await realpath(root);
  } catch {
    throw refuseIo("The pack install root could not be created.");
  }

  // `mkdir(..., { recursive: true })` accepts an existing `<root>/<id>` and
  // follows a symlink there, which could redirect the temporary directory and
  // the rename outside the root. Refuse the link, then prove the created
  // directory is really inside the root.
  const idEntry = await inspect(idRoot);
  if (idEntry?.isSymbolicLink() === true) {
    throw refuseIo(`${manifest.id}'s install directory is a symbolic link; it was not followed.`);
  }
  let realIdRoot: string;
  try {
    await mkdir(idRoot, { recursive: true });
    realIdRoot = await realpath(idRoot);
  } catch {
    throw refuseIo("The pack install directory could not be created.");
  }
  if (!isInside(realIdRoot, realRoot)) {
    throw refuseIo(`${manifest.id}'s install directory resolves outside the pack root.`);
  }

  // One public id has one publisher in a container (S2.2). A different
  // publisher under an existing id is refused unless the caller names the
  // migration, and even then it inherits no document, file or session storage:
  // every store is keyed by `(publisher id, pack id)`.
  const existing = await existingInstalledIdentity(idRoot, options);
  if (existing.ambiguous && options.allowPublisherMigration !== true) {
    throw new InstalledPackError(
      {
        reason: "identity",
        message: `${manifest.id} has versions from more than one publisher and no identity record. Installing ${manifest.version} needs an explicit migration.`,
        fingerprint: publisher.fingerprint,
      },
      manifest.id,
      manifest.version,
    );
  }
  const identity = existing.identity;
  const migrating = identity !== null && identity.id !== publisher.id;
  if (migrating && options.allowPublisherMigration !== true) {
    throw new InstalledPackError(
      {
        reason: "publisher",
        message: `${manifest.id} ${manifest.version} is signed by ${publisher.id} (key fingerprint ${publisher.fingerprint}), but this container has ${manifest.id} installed by ${identity.id}. Installing a different publisher's pack under an existing id needs an explicit migration.`,
        fingerprint: publisher.fingerprint,
      },
      manifest.id,
      manifest.version,
    );
  }
  if (
    identity !== null &&
    identity.id === publisher.id &&
    identity.key !== publisher.key &&
    !isRetiredKeyUnder(options.publishers, publisher.id, identity.key)
  ) {
    // Same id, different key, no signed rotation: refuse rather than trust a
    // silently swapped key. A rotation retires the old key in the trust store
    // (S2.3), and only then may the new current key install beside it.
    throw new InstalledPackError(
      {
        reason: "publisher",
        message: `${manifest.id} ${manifest.version} is signed by a new key for publisher ${publisher.id} (key fingerprint ${publisher.fingerprint}), but this id is installed with key fingerprint ${identity.fingerprint}. A key change is a signed rotation.`,
        fingerprint: publisher.fingerprint,
      },
      manifest.id,
      manifest.version,
    );
  }

  // A symlinked version directory is refused for the same reason: the rename
  // would replace the link, and a later install could write through it.
  const targetEntry = await inspect(target);
  if (targetEntry?.isSymbolicLink() === true) {
    throw refuseIo(`${manifest.id} ${manifest.version} is a symbolic link; it was not followed.`);
  }
  if (targetEntry !== null && install.replace !== true) {
    throw refuseIo(
      `${manifest.id} ${manifest.version} is already installed; it was not overwritten.`,
    );
  }

  const temporary = join(idRoot, `${TEMPORARY_PREFIX}${randomUUID()}`);
  try {
    await mkdir(temporary);
    await writeFile(join(temporary, MANIFEST_NAME), manifestBytes);
    for (const file of manifest.files) {
      const content = archiveFiles.get(file.path);
      if (content === undefined) {
        throw new InstalledPackError(
          { reason: "files", message: `The archive is missing ${file.path}.` },
          manifest.id,
          manifest.version,
        );
      }
      const destination = join(temporary, ...file.path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }

    // A concurrent install may have won the race; rename would fail, but say why first.
    const targetNow = await inspect(target);
    if (targetNow?.isSymbolicLink() === true) {
      throw refuseIo(`${manifest.id} ${manifest.version} is a symbolic link; it was not followed.`);
    }
    if (targetNow !== null && install.replace !== true) {
      throw refuseIo(
        `${manifest.id} ${manifest.version} is already installed; it was not overwritten.`,
      );
    }
    if (targetNow === null) {
      await rename(temporary, target);
    } else {
      // A reinstall: move the old version aside, swap the verified one in, and put
      // the old one back if the swap fails. The temporary prefix keeps a leftover
      // backup out of the installed scan.
      const backup = join(idRoot, `${TEMPORARY_PREFIX}${randomUUID()}-previous`);
      await rename(target, backup);
      try {
        await rename(temporary, target);
      } catch (error) {
        await rename(backup, target).catch(() => undefined);
        throw error;
      }
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
    if (identity === null || migrating || identity.key !== publisher.key) {
      await writeInstalledIdentity(idRoot, publisher);
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof InstalledPackError) throw error;
    throw new InstalledPackError(
      { reason: "io", message: "The pack could not be written to its install root." },
      manifest.id,
      manifest.version,
    );
  }

  return installedInfo(manifest, target, publisher);
}

/**
 * Remove exactly one installed version: `<root>/<id>/<version>/`.
 *
 * Nothing else is touched. The id directory, the older or newer versions beside
 * it, and the pack's documents and files under the host data root outlive this
 * call. A symlinked install root, id directory or version directory is refused
 * rather than followed, and the real version path must still resolve inside the
 * real install root.
 */
export async function uninstallPackVersion(
  root: string,
  id: string,
  version: string,
): Promise<void> {
  const refuse = (message: string): InstalledPackError =>
    new InstalledPackError({ reason: "io", message }, id, version);

  if (!isSafePackId(id) || !isSafePackPath(`${id}/${version}`)) {
    throw new InstalledPackError(
      { reason: "invalid", message: "That id or version is not a safe pack path." },
      id,
      version,
    );
  }

  const inspect = async (path: string): Promise<Awaited<ReturnType<typeof lstat>>> => {
    try {
      return await lstat(path);
    } catch (error) {
      if (isNotFound(error)) throw refuse(`${id} ${version} is not installed.`);
      throw refuse("The pack install root could not be read.");
    }
  };

  const rootEntry = await inspect(root);
  if (rootEntry.isSymbolicLink()) {
    throw refuse("The pack install root is a symbolic link; it was not followed.");
  }
  if (!rootEntry.isDirectory()) {
    throw refuse("The pack install root is not a directory.");
  }

  const idEntry = await inspect(join(root, id));
  if (idEntry.isSymbolicLink()) {
    throw refuse(`${id}'s install directory is a symbolic link; it was not followed.`);
  }
  if (!idEntry.isDirectory()) {
    throw refuse(`${id} has no installed versions.`);
  }

  const target = join(root, id, version);
  const targetEntry = await inspect(target);
  if (targetEntry.isSymbolicLink()) {
    throw refuse(`${id} ${version} is a symbolic link; it was not followed.`);
  }
  if (!targetEntry.isDirectory()) {
    throw refuse(`${id} ${version} is not an installed version.`);
  }

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = await realpath(root);
    realTarget = await realpath(target);
  } catch {
    throw refuse("The pack version could not be resolved.");
  }
  if (!isInside(realTarget, realRoot)) {
    throw refuse(`${id} ${version} resolves outside the pack root.`);
  }

  try {
    await rm(target, { recursive: true, force: false });
  } catch {
    throw refuse(`${id} ${version} could not be removed.`);
  }
}

/**
 * Compare two manifest versions.
 *
 * Numeric major/minor/patch first, then prerelease precedence: a prerelease is
 * lower than the release it belongs to, numeric identifiers compare numerically,
 * and build metadata is ignored. Throws for a string the manifest schema would
 * have refused.
 */
export function comparePackVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) {
    throw new TypeError(`Not a pack version: ${a === null ? left : right}`);
  }

  for (let index = 0; index < 3; index += 1) {
    const leftPart = a.core[index];
    const rightPart = b.core[index];
    if (leftPart === undefined || rightPart === undefined) continue;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

interface ParsedVersion {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const NUMERIC = /^\d+$/u;

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION.exec(value);
  if (match === null) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return {
    core: [BigInt(major), BigInt(minor), BigInt(patch)],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    // A shorter set of otherwise equal identifiers has lower precedence.
    if (a === undefined) return -1;
    if (b === undefined) return 1;

    const aNumeric = NUMERIC.test(a);
    const bNumeric = NUMERIC.test(b);
    if (aNumeric && bNumeric) {
      const leftNumber = BigInt(a);
      const rightNumber = BigInt(b);
      if (leftNumber < rightNumber) return -1;
      if (leftNumber > rightNumber) return 1;
      continue;
    }
    // Numeric identifiers are lower than alphanumeric ones.
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function highestVersion(packs: readonly InstalledPackInfo[]): InstalledPackInfo | null {
  let best: InstalledPackInfo | null = null;
  for (const pack of packs) {
    if (best === null || comparePackVersions(pack.version, best.version) > 0) best = pack;
  }
  return best;
}

/**
 * The publisher that owns one public id in this container.
 *
 * The record written by the first install is the authority. A version from a
 * different publisher is reported and not loaded, even if its version is newer:
 * one public id has one publisher (S2.2), and a takeover is a migration, not an
 * update.
 */
interface InstalledIdentity {
  readonly id: string;
  readonly key: string;
  readonly fingerprint: string;
}

/** Whether a rotation retired this key under the id, so a newer key may take over. */
function isRetiredKeyUnder(
  publishers: readonly TrustedPublisher[],
  publisherId: string,
  key: string,
): boolean {
  const entry = publishers.find((candidate) => candidate.id === publisherId);
  return entry?.retiredKeys?.some((retired) => retired.key === key) === true;
}

function singlePublisher(publisherIds: ReadonlySet<string>): string | null {
  // No record and more than one publisher: the id is ambiguous, so nothing
  // loads. An install would have written a record; a hand-copied directory is
  // not a reason to hand the id to whichever version sorts highest.
  return publisherIds.size === 1 ? ([...publisherIds][0] ?? null) : null;
}

async function versionDirectories(idRoot: string): Promise<readonly string[]> {
  const entries = await readdir(idRoot, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(TEMPORARY_PREFIX))
    .map((entry) => entry.name);
}

function parseIdentity(text: string): InstalledIdentity | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !isSafePublisherId(record.id)) return null;
  if (typeof record.key !== "string" || !isPublisherKey(record.key)) return null;
  if (typeof record.fingerprint !== "string") return null;
  return { id: record.id, key: record.key, fingerprint: record.fingerprint };
}

/**
 * The identity record for an id directory, or null.
 *
 * A record with no version directory beside it is ignored: uninstalling the last
 * version frees the id, and a stale file must not block a fresh publisher.
 */
async function readInstalledIdentity(idRoot: string): Promise<InstalledIdentity | null> {
  const versions = await versionDirectories(idRoot);
  if (versions.length === 0) return null;
  try {
    const text = await readFile(join(idRoot, IDENTITY_NAME), "utf8");
    return parseIdentity(text);
  } catch {
    return null;
  }
}

/** The manifest inside one version directory, without verifying its files. */
async function readDirectoryManifest(directory: string): Promise<PackManifest | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(directory, MANIFEST_NAME), "utf8"));
    const parsed = parsePackManifest(raw);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

interface ExistingIdentity {
  readonly identity: InstalledIdentity | null;
  /** More than one publisher has a version here and no record settles it. */
  readonly ambiguous: boolean;
}

/**
 * Who owns an id directory before an install writes into it.
 *
 * The record is the authority. An install from before S2.2 has none, so the
 * version manifests answer instead: their publisher is resolved through the same
 * trust store, and a missing publisher resolves to the preinstalled key. If two
 * publishers already share the id, the only safe answer is to refuse unless the
 * caller names the migration.
 */
async function existingInstalledIdentity(
  idRoot: string,
  options: PackTrustOptions,
): Promise<ExistingIdentity> {
  const versions = await versionDirectories(idRoot);
  if (versions.length === 0) return { identity: null, ambiguous: false };

  const record = await readInstalledIdentity(idRoot);
  if (record !== null) return { identity: record, ambiguous: false };

  const found = new Map<string, InstalledIdentity>();
  for (const version of versions) {
    const manifest = await readDirectoryManifest(join(idRoot, version));
    if (manifest === null) continue;
    const trust = await checkPublisherTrust(manifest.publisher, options.publishers, {
      allowMissingPublisher: true,
      firstPartyId: SUITE_PUBLISHER_ID,
    });
    if (!trust.ok) continue;
    found.set(trust.publisher.id, {
      id: trust.publisher.id,
      key: trust.publisher.key,
      fingerprint: trust.publisher.fingerprint,
    });
  }
  if (found.size === 1) return { identity: [...found.values()][0] ?? null, ambiguous: false };
  return { identity: null, ambiguous: found.size > 1 };
}

async function writeInstalledIdentity(idRoot: string, publisher: ResolvedPublisher): Promise<void> {
  const temporary = join(idRoot, `${TEMPORARY_PREFIX}${randomUUID()}-publisher`);
  const record: InstalledIdentity = {
    id: publisher.id,
    key: publisher.key,
    fingerprint: publisher.fingerprint,
  };
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    await rename(temporary, join(idRoot, IDENTITY_NAME));
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new InstalledPackError({
      reason: "io",
      message: "The pack's publisher identity could not be written.",
    });
  }
}

function parseArchiveManifest(bytes: Uint8Array): PackManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new InstalledPackError({
      reason: "invalid",
      message: "The archive's manifest.json is not valid JSON.",
    });
  }

  const parsed = parsePackManifest(raw);
  if (!parsed.ok) {
    throw new InstalledPackError({
      reason: "invalid",
      message: `The archive's manifest.json is not a pack manifest: ${describeIssues(parsed.issues)}`,
    });
  }
  return parsed.value;
}

interface DirectoryVerification {
  readonly ok: true;
  readonly info: InstalledPackInfo;
}

interface DirectoryRefusal {
  readonly ok: false;
  readonly issue: InstalledPackIssue;
}

async function verifyInstalledDirectory(
  directory: string,
  id: string,
  version: string,
  options: PackTrustOptions,
): Promise<DirectoryVerification | DirectoryRefusal> {
  const refuse = (refusal: Refusal): DirectoryRefusal => ({
    ok: false,
    issue: { ...refusal, id, version },
  });

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readFile(join(directory, MANIFEST_NAME));
  } catch (error) {
    return refuse(
      isNotFound(error)
        ? { reason: "unreadable", message: `${id} ${version} has no manifest.json.` }
        : { reason: "io", message: `${id} ${version} has a manifest that could not be read.` },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return refuse({
      reason: "invalid",
      message: `${id} ${version} has an unreadable manifest.json.`,
    });
  }

  const parsed = parsePackManifest(raw);
  if (!parsed.ok) {
    return refuse({
      reason: "invalid",
      message: `${id} ${version} is not a pack manifest: ${describeIssues(parsed.issues)}`,
    });
  }
  const manifest = parsed.value;

  if (manifest.id !== id || manifest.version !== version) {
    return refuse({
      reason: "invalid",
      message: `${id} ${version} holds a manifest for ${manifest.id} ${manifest.version}.`,
    });
  }

  let present: readonly string[];
  try {
    present = await listFiles(directory);
  } catch {
    return refuse({ reason: "io", message: `${id} ${version} could not be listed.` });
  }

  const verification = await verifyManifest(
    manifest,
    () => present,
    async (path) => {
      try {
        return await readFile(join(directory, ...path.split("/")));
      } catch {
        return null;
      }
    },
    options,
    // A pre-S2.1 install has no publisher field. It is accepted only under the
    // preinstalled first-party key; a new archive is never this lenient. A
    // rotation retires the old key rather than deleting it, so a version signed
    // before the rotation still verifies (S2.3). Revocations never apply here.
    { allowMissingPublisher: true, allowRetiredKeys: true },
  );
  if (!verification.ok) return refuse(verification.refusal);

  return {
    ok: true,
    info: installedInfo(manifest, directory, verification.publisher),
  };
}

type ManifestVerification =
  | { readonly ok: true; readonly publisher: ResolvedPublisher }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * The checks shared by an archive and an installed directory.
 *
 * Order matters only for which reason is reported first; all of them run before
 * anything is returned or written. Document bytes are never parsed here.
 *
 * The publisher is resolved first (S2.1): its key, from the manifest and matched
 * against the trust store, is the key the signature must verify against. A pack
 * cannot pick its own trust root by naming an arbitrary key.
 */
async function verifyManifest(
  manifest: PackManifest,
  present: () => readonly string[],
  read: (path: string) => Promise<Uint8Array | null>,
  options: PackTrustOptions,
  trustOptions: {
    readonly allowMissingPublisher?: boolean;
    readonly allowRetiredKeys?: boolean;
    readonly refuseRevoked?: boolean;
  } = {},
): Promise<ManifestVerification> {
  const trust = await checkPublisherTrust(manifest.publisher, options.publishers, {
    ...(trustOptions.allowMissingPublisher === true ? { allowMissingPublisher: true } : {}),
    ...(trustOptions.allowRetiredKeys === true ? { allowRetiredKeys: true } : {}),
    firstPartyId: SUITE_PUBLISHER_ID,
  });
  if (!trust.ok) {
    return {
      ok: false,
      refusal: {
        reason: "publisher",
        message: trust.message,
        fingerprint: trust.fingerprint,
      },
    };
  }

  if (!(await verifyPackSignature(manifest, trust.publisher.key))) {
    return {
      ok: false,
      refusal: {
        reason: "untrusted",
        message: `${manifest.id} ${manifest.version} is not signed by publisher ${trust.publisher.id} (key fingerprint ${trust.publisher.fingerprint}).`,
        fingerprint: trust.publisher.fingerprint,
      },
    };
  }

  // S2.4: a signed advisory blocks a new install. This check belongs to the
  // archive/catalogue path only, never the installed-version scan.
  if (
    trustOptions.refuseRevoked === true &&
    isPackRevoked(options.revocations ?? [], trust.publisher.id, manifest.id)
  ) {
    return {
      ok: false,
      refusal: {
        reason: "revocation",
        message: `${manifest.id} from publisher ${trust.publisher.id} has been revoked by a signed advisory and cannot be installed. An installed copy keeps running; disabling or removing it is your choice.`,
        fingerprint: trust.publisher.fingerprint,
      },
    };
  }

  const fit = packFitsHost(manifest, {
    contractVersion: options.hostContractVersion,
    hostVersion: options.hostVersion,
    ...(options.rings === undefined ? {} : { rings: options.rings }),
  });
  if (!fit.ok) return { ok: false, refusal: { reason: "host", message: fit.message } };

  const unsupported = manifest.capabilities.filter(
    (capability) => !options.hostCapabilities.includes(capability),
  );
  if (unsupported.length > 0) {
    return {
      ok: false,
      refusal: {
        reason: "capability",
        message: `${manifest.id} asks for unimplemented ${unsupported.join(", ")}.`,
      },
    };
  }

  const host: HostDeclaration = {
    ...DESK_HOST,
    capabilities: options.hostCapabilities,
    kind: options.hostKind ?? DESK_HOST.kind,
  };
  const platform = platformFit(manifest, host);
  if (platform.state === "unavailable") {
    return {
      ok: false,
      refusal: {
        reason: "platform",
        message: platform.reason ?? "That pack is not available on this host.",
      },
    };
  }

  const fileSet = checkFileSet(manifest, present());
  if (fileSet !== null) return { ok: false, refusal: fileSet };

  const mismatches = await verifyPackFiles(manifest, read);
  if (mismatches.length > 0) {
    const detail = mismatches
      .slice(0, 3)
      .map((mismatch) => `${mismatch.path} (${mismatch.reason})`)
      .join(", ");
    return {
      ok: false,
      refusal: {
        reason: "files",
        message: `${manifest.id} ${manifest.version} failed: ${detail}.`,
      },
    };
  }

  return { ok: true, publisher: trust.publisher };
}

function checkFileSet(manifest: PackManifest, present: readonly string[]): Refusal | null {
  const expected = new Set(manifest.files.map((file) => file.path));
  if (expected.has(MANIFEST_NAME)) {
    return {
      reason: "invalid",
      message: `${manifest.id} lists manifest.json as a payload file.`,
    };
  }

  const available = new Set(present);
  const extra = [...available].filter((path) => path !== MANIFEST_NAME && !expected.has(path));
  if (extra.length > 0) {
    return {
      reason: "extra-files",
      message: `${manifest.id} ${manifest.version} includes files its manifest does not list: ${summarise(extra)}.`,
    };
  }

  const missing = [...expected].filter((path) => !available.has(path));
  if (missing.length > 0) {
    return {
      reason: "files",
      message: `${manifest.id} ${manifest.version} is missing ${summarise(missing)}.`,
    };
  }

  return null;
}

function installedInfo(
  manifest: PackManifest,
  root: string,
  publisher: ResolvedPublisher,
): InstalledPackInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? null,
    entry: manifest.entry,
    capabilities: [
      ...new Set([...manifest.capabilities, ...(manifest.optionalCapabilities ?? [])]),
    ],
    ring: packRing(manifest),
    ...(packMinimumHost(manifest) === undefined
      ? {}
      : { minHost: packMinimumHost(manifest) as number }),
    documents: manifest.documents ?? [],
    widgets: manifest.widgets ?? [],
    publisher: { id: publisher.id, fingerprint: publisher.fingerprint },
    root,
    source: "installed",
  };
}

/** Relative, slash-separated paths of every entry under `directory`, manifest included. */
async function listFiles(directory: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await listFiles(join(directory, entry.name), path)));
    } else {
      found.push(path);
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}

function summarise(paths: readonly string[]): string {
  const first = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${first} and ${paths.length - 3} more` : first;
}

function describeIssues(
  issues: readonly { readonly path: string; readonly message: string }[],
): string {
  const first = issues[0];
  if (first === undefined) return "it was refused";
  return first.path === "" ? first.message : `${first.path}: ${first.message}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** True when `realPath` is `realRoot` or a child of it, in the style of `@suite/pack-host`. */
function isInside(realPath: string, realRoot: string): boolean {
  const boundary = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  return realPath === realRoot || realPath.startsWith(boundary);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
