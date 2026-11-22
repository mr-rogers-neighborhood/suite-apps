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
  isSafePackId,
  isSafePackPath,
  type PackManifest,
  packFitsHost,
  parsePackManifest,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";
import type { PackInfo } from "./packs.js";
import type { PackCapability } from "./shared.js";

/**
 * Installed packs.
 *
 * A pack is a signed manifest plus the files it lists. The archive reader owns
 * the zip format (traversal, duplicates and decompression limits); this module
 * owns the trust decision and the on-disk layout: `<root>/<id>/<version>/`, with
 * the manifest and every listed file inside that version directory.
 *
 * Nothing here imports Electron or talks to a window. The shell's integration
 * layer decides where `root` is and which pinned key to trust.
 */

const MIB = 1024 * 1024;
/** The compressed archive size this host accepts. The reader enforces its own entry limits too. */
export const MAX_ARCHIVE_BYTES = 64 * MIB;
const MANIFEST_NAME = "manifest.json";
const TEMPORARY_PREFIX = ".tmp-";

/** The host policy a pack is checked against. A generated key is enough for tests. */
export interface PackTrustOptions {
  readonly publicKey: string;
  readonly hostContractVersion: number;
  readonly hostVersion: number;
  readonly hostCapabilities: readonly PackCapability[];
}

/** A pack installed under the host's pack root. `root` is its version directory. */
export interface InstalledPackInfo extends PackInfo {
  readonly source: "installed";
}

/** One candidate that was refused. `id` and `version` are null when the path never yielded them. */
export interface InstalledPackIssue {
  readonly id: string | null;
  readonly version: string | null;
  readonly reason:
    | "unreadable"
    | "invalid"
    | "untrusted"
    | "files"
    | "host"
    | "capability"
    | "extra-files"
    | "io";
  readonly message: string;
}

export interface InstalledPackScan {
  readonly packs: readonly InstalledPackInfo[];
  readonly issues: readonly InstalledPackIssue[];
}

/** A refusal before it is given an id and version. */
interface Refusal {
  readonly reason: InstalledPackIssue["reason"];
  readonly message: string;
}

/** An installation that never reached its target directory. */
export class InstalledPackError extends Error {
  readonly reason: InstalledPackIssue["reason"];
  readonly id: string | null;
  readonly version: string | null;

  constructor(refusal: Refusal, id: string | null = null, version: string | null = null) {
    super(refusal.message);
    this.name = "InstalledPackError";
    this.reason = refusal.reason;
    this.id = id;
    this.version = version;
  }
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
  if (!(await pathExists(root))) return { packs: [], issues: [] };

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
    };
  }

  const issues: InstalledPackIssue[] = [];
  const packs: InstalledPackInfo[] = [];

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
      if (verified.ok) valid.push(verified.info);
      else issues.push(verified.issue);
    }

    const best = highestVersion(valid);
    if (best !== null) packs.push(best);
  }

  packs.sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  return { packs, issues };
}

/**
 * Verify an archive and install it at `<root>/<id>/<version>/`.
 *
 * The files are written to a temporary sibling first and renamed into place, so
 * a scan never sees a half-written version. An existing version is refused
 * rather than overwritten.
 */
export async function installPackArchive(
  bytes: Uint8Array,
  root: string,
  options: PackTrustOptions,
): Promise<InstalledPackInfo> {
  let manifestBytes: Uint8Array;
  let archiveFiles: ReadonlyMap<string, Uint8Array>;
  try {
    const archive = await readPackArchive(bytes, { maxArchiveBytes: MAX_ARCHIVE_BYTES });
    manifestBytes = archive.manifestBytes;
    archiveFiles = archive.files;
  } catch (error) {
    throw new InstalledPackError({
      reason: "unreadable",
      message: error instanceof Error ? error.message : "The pack archive could not be read.",
    });
  }

  const manifest = parseArchiveManifest(manifestBytes);

  // The manifest schema already refuses a slash in `version`, but the guard
  // stays as the last check before a path is joined; a schema change must not
  // turn this into a traversal.
  if (!isSafePackId(manifest.id) || !isSafePackPath(`${manifest.id}/${manifest.version}`)) {
    throw new InstalledPackError(
      { reason: "invalid", message: "The manifest names an id or version that is not safe." },
      manifest.id,
      manifest.version,
    );
  }

  const refusal = await verifyManifest(
    manifest,
    () => [...archiveFiles.keys()],
    async (path) => archiveFiles.get(path) ?? null,
    options,
  );
  if (refusal !== null) {
    throw new InstalledPackError(refusal, manifest.id, manifest.version);
  }

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

  // A symlinked version directory is refused for the same reason: the rename
  // would replace the link, and a later install could write through it.
  const targetEntry = await inspect(target);
  if (targetEntry?.isSymbolicLink() === true) {
    throw refuseIo(`${manifest.id} ${manifest.version} is a symbolic link; it was not followed.`);
  }
  if (targetEntry !== null) {
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
    if (targetNow !== null) {
      throw refuseIo(
        `${manifest.id} ${manifest.version} is already installed; it was not overwritten.`,
      );
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof InstalledPackError) throw error;
    throw new InstalledPackError(
      { reason: "io", message: "The pack could not be written to its install root." },
      manifest.id,
      manifest.version,
    );
  }

  return installedInfo(manifest, target);
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

  const refusal = await verifyManifest(
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
  );
  if (refusal !== null) return refuse(refusal);

  return { ok: true, info: installedInfo(manifest, directory) };
}

/**
 * The checks shared by an archive and an installed directory.
 *
 * Order matters only for which reason is reported first; all of them run before
 * anything is returned or written. Document bytes are never parsed here.
 */
async function verifyManifest(
  manifest: PackManifest,
  present: () => readonly string[],
  read: (path: string) => Promise<Uint8Array | null>,
  options: PackTrustOptions,
): Promise<Refusal | null> {
  if (!(await verifyPackSignature(manifest, options.publicKey))) {
    return {
      reason: "untrusted",
      message: `${manifest.id} ${manifest.version} is not signed by this host's pack key.`,
    };
  }

  const fit = packFitsHost(manifest, {
    contractVersion: options.hostContractVersion,
    hostVersion: options.hostVersion,
  });
  if (!fit.ok) return { reason: "host", message: fit.message };

  const unsupported = manifest.capabilities.filter(
    (capability) => !options.hostCapabilities.includes(capability),
  );
  if (unsupported.length > 0) {
    return {
      reason: "capability",
      message: `${manifest.id} asks for unimplemented ${unsupported.join(", ")}.`,
    };
  }

  const fileSet = checkFileSet(manifest, present());
  if (fileSet !== null) return fileSet;

  const mismatches = await verifyPackFiles(manifest, read);
  if (mismatches.length > 0) {
    const detail = mismatches
      .slice(0, 3)
      .map((mismatch) => `${mismatch.path} (${mismatch.reason})`)
      .join(", ");
    return { reason: "files", message: `${manifest.id} ${manifest.version} failed: ${detail}.` };
  }

  return null;
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

function installedInfo(manifest: PackManifest, root: string): InstalledPackInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? null,
    entry: manifest.entry,
    capabilities: manifest.capabilities,
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
