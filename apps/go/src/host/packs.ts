import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  bytesToBase64,
  checkNetworkPolicy,
  comparePackVersions,
  type PackCapability,
  type PackManifest,
  packAllows,
  packDocumentSealsNetwork,
  packFitsHost,
  parsePackManifest,
  sha256Hex,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/go";
import { SUITE_PACK_PUBLIC_KEY } from "@suite/pack/pinned-key";
import { GO_HOST, platformFit } from "@suite/pack/platforms";
import {
  buildPackArchive,
  PackArchiveError,
  type PackArchiveLimits,
  readPackArchive,
} from "@suite/pack-host/archive";

/**
 * Installed domain packs.
 *
 * Three things this deliberately does not do: parse a domain's data, import a pack's code
 * to ask what it is, or keep a pack that failed verification. The first two are the container
 * learning a domain; the third is the whole point of the signature.
 *
 * Storage layout is `packs/<id>/<version>/`, so two versions can exist at once and an
 * upgrade can fall back to the one that worked.
 */

/** Where packs live, relative to the app's data directory. */
const ROOT = "packs";

const MIB = 1024 * 1024;

/**
 * The compressed archive size this host accepts.
 *
 * The shared reader owns the per-entry, total and entry-count limits; this is the one cap the
 * caller sets, because it is the size a person chose to download. A pack larger than this is
 * refused before a single entry is decompressed.
 */
export const MAX_ARCHIVE_BYTES = 64 * MIB;

/**
 * The key that signs packs, re-exported from the shared trust root.
 *
 * `@suite/pack` pins `SUITE_PACK_PUBLIC_KEY` at `packages/pack/src/pinnedKey.ts`, and the desktop
 * host reads the same constant. Keeping one copy is the point: two pins would let the phone and the
 * desktop accept different packs while both calling themselves Suite. An empty value refuses every
 * pack, which is the correct default for a build with no key: an unverified pack is never better
 * than no pack.
 *
 * The private half is a release secret and lives outside this repository, at
 * `~/.config/suite/keys/pack-key` (or wherever `SUITE_KEYS_DIR` points). `pnpm planner:pack`
 * reads it from `$SUITE_PACK_KEY` or that file. `pnpm keys status` prints its fingerprint and
 * says whether the key on this machine is the key this constant trusts — the check that matters,
 * because a pack signed by anything else is refused on the device as `untrusted`.
 *
 * Rotation is one change: `pnpm keys generate pack`, put the public half in the shared pin, rebuild
 * every pack. [Keys](../../../../docs/how-to/keys.md) states the procedure and what a fingerprint
 * proves.
 */
export const PACK_PUBLIC_KEY = SUITE_PACK_PUBLIC_KEY;

/**
 * What this build implements. Bumped when the host services a pack may call change.
 *
 * 2 added `notifications`: a pack may ask for a reminder to be delivered by the phone's own alarm
 * clock. 3 added `files`: the pack-scoped store and the platform picker and share sheet. A pack
 * that declares 3 needs a host that has it; a pack that declares 1 or 2 still installs.
 */
export const HOST_CONTRACT_VERSION = 3;
export const HOST_VERSION = 1;

/**
 * The pack capabilities this host actually serves.
 *
 * Go's frame bridge answers `documents`, `storage`, `recents`, `notifications` and `files`;
 * `network` is the pack's own declared egress, which the host permits and holds to a sealed CSP.
 * `files` is the pack's own scoped store plus the platform picker and share sheet. The store is
 * built from the frame's manifest, never from a request, so two packs cannot reach one root.
 *
 * S4.8 says a host refuses a pack naming a capability it does not implement, rather than
 * installing it and letting the first call fail. The desktop's list is its own
 * (`HOST_CAPABILITIES` in `apps/shell/src/packs.ts`) because the two hosts serve different
 * surfaces; they agree on the manifests and on the refusal, not on this set.
 */
export const GO_HOST_CAPABILITIES = GO_HOST.capabilities;

export interface InstalledPack {
  readonly manifest: PackManifest;
  /** Where the pack's entry lives, as a URL the WebView can import. */
  readonly entryUrl: string;
  readonly installedAt: number;
  readonly bytes: number;
}

export type InstallFailureReason =
  | "unreadable"
  | "invalid"
  | "unsigned"
  | "untrusted"
  | "files"
  | "digest"
  | "host"
  | "capability"
  | "platform"
  | "policy"
  | "failed";

export type InstallOutcome =
  | { readonly ok: true; readonly pack: InstalledPack }
  | {
      readonly ok: false;
      readonly reason: InstallFailureReason;
      readonly message: string;
    };

/**
 * The catalogue entry an archive is being installed for.
 *
 * S12.7: the bytes installed must be the bytes the index displayed. The digest is checked before
 * the archive is read at all, so a changed archive costs no decompression; the id and version are
 * checked after the manifest parses, so a readable archive cannot silently become another app.
 */
export interface ExpectedPack {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
  readonly size?: number;
}

export interface PackInstallOptions {
  /** Replace the same version directory. The catalogue names this for a reinstall. */
  readonly replace?: boolean;
  /** The verified index entry this archive must match. */
  readonly expected?: ExpectedPack;
}

/**
 * The URL a pack file is served from.
 *
 * Capacitor proxies `/_capacitor_file_/` to the real filesystem from its own origin, so a
 * pack's relative imports, `.wasm` and fonts resolve exactly as they would from `dist/`.
 * Verified on a device: an `import()` of this shape runs, and a `WebAssembly.instantiate`
 * of a relative `.wasm` inside it succeeds.
 */
export function packFileUrl(absoluteDir: string, relativePath: string): string {
  // Normalised here rather than at every call site: `getUri` hands back `file:///data/...`,
  // and naively prefixing that produced `/_capacitor_file_//data/...`, which resolves on
  // this WebView but is not a URL worth relying on.
  const dir = absoluteDir.replace(/^file:\/\//u, "").replace(/\/+$/u, "");
  const relative = relativePath.replace(/^\/+/u, "");
  const rooted = dir.startsWith("/") ? dir : `/${dir}`;
  return `https://localhost/_capacitor_file_${rooted}/${relative}`;
}

interface ManifestEnvelope {
  readonly manifest: PackManifest;
  /** Payload files from the archive, excluding `manifest.json`. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** One candidate the loader refused, so a caller can say why rather than only that it vanished. */
export interface PackIssue {
  readonly id: string | null;
  readonly version: string | null;
  readonly reason: Extract<InstallOutcome, { readonly ok: false }>["reason"];
  readonly message: string;
}

function refusal(
  reason: PackIssue["reason"],
  message: string,
  id: string | null = null,
  version: string | null = null,
): PackIssue {
  return { id, version, reason, message };
}

/**
 * The capability the host does not serve, or null.
 *
 * Named one by one rather than "unsupported pack": the person needs to know whether the app is
 * built for a newer host or asks for something this phone does not do (S4.8).
 */
function unsupportedCapability(
  manifest: Pick<PackManifest, "id" | "name" | "capabilities">,
  served: readonly PackCapability[],
): string | null {
  const missing = manifest.capabilities.filter((capability) => !served.includes(capability));
  if (missing.length === 0) return null;
  return `${manifest.name} asks for ${missing.join(", ")}, which Suite Go does not serve.`;
}

/**
 * Read a pack archive through the shared contract.
 *
 * `readPackArchive` is the same reader the desktop host uses: it streams the zip, checks each
 * entry's declared size before decompressing and the bytes produced after, and refuses unsafe
 * paths, duplicates, symlinks and non-regular entries, too many files, and an archive without a
 * root `manifest.json`. This function owns only the manifest parse; the archive owns the zip.
 */
async function readEnvelope(
  bytes: Uint8Array,
  limits: PackArchiveLimits,
): Promise<
  | { readonly ok: true; readonly envelope: ManifestEnvelope }
  | { readonly ok: false; readonly issue: PackIssue }
> {
  let archive: Awaited<ReturnType<typeof readPackArchive>>;
  try {
    archive = await readPackArchive(bytes, limits);
  } catch (error) {
    return {
      ok: false,
      issue: refusal(
        "invalid",
        error instanceof PackArchiveError
          ? error.message
          : "That file is not a pack archive this build can read.",
      ),
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(archive.manifestBytes));
  } catch {
    return {
      ok: false,
      issue: refusal("invalid", "That pack's manifest.json is not valid JSON."),
    };
  }

  const parsed = parsePackManifest(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      issue: refusal(
        "invalid",
        "That file is not a Suite pack, or its manifest is not one this build reads.",
      ),
    };
  }

  return { ok: true, envelope: { manifest: parsed.value, files: archive.files } };
}

/**
 * Bytes through the filesystem plugin, base64 on both sides.
 *
 * `writeFile` rejects a plain string as invalid input — it wants base64 or a Blob — and a plain
 * write would have "worked" only by accident on a platform that accepted it. Writing and reading
 * the same way means the manifest on disk round-trips regardless.
 */
async function readFileBytes(path: string): Promise<Uint8Array> {
  const file = await Filesystem.readFile({ path, directory: Directory.Data });
  const base64 = typeof file.data === "string" ? file.data : "";
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function readTextFile(path: string): Promise<string> {
  return new TextDecoder().decode(await readFileBytes(path));
}

async function writeTextFile(path: string, text: string): Promise<void> {
  await Filesystem.writeFile({
    path,
    data: bytesToBase64(new TextEncoder().encode(text)),
    directory: Directory.Data,
    recursive: true,
  });
}

async function ensureDir(path: string): Promise<void> {
  await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true }).catch(
    () => undefined,
  );
}

/** Whether a file or directory exists. A missing path is `false`, never an error. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

interface InstalledListing {
  /** Relative slash-separated paths, `manifest.json` included. */
  readonly files: readonly string[];
  /** Entries that are neither a regular file nor a directory. */
  readonly nonRegular: readonly string[];
}

/**
 * Every entry under an installed pack directory.
 *
 * The plugin's `readdir` reports each entry's type. A symlink or a device node is refused rather
 * than read: a pack's files are bytes it declared, and a link is a path outside the pack wearing
 * one of those names. `manifest.json` is listed too so the caller can exempt it from the file set.
 */
async function listInstalledFiles(directory: string, prefix = ""): Promise<InstalledListing> {
  const listing = await Filesystem.readdir({ path: directory, directory: Directory.Data });
  const files: string[] = [];
  const nonRegular: string[] = [];

  for (const entry of listing.files) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const type: string = entry.type;
    if (type === "directory") {
      const nested = await listInstalledFiles(`${directory}/${entry.name}`, path);
      files.push(...nested.files);
      nonRegular.push(...nested.nonRegular);
    } else if (type === "file") {
      files.push(path);
    } else {
      nonRegular.push(path);
    }
  }

  return { files, nonRegular };
}

export interface PackStore {
  /**
   * What is on disk.
   *
   * Read from storage rather than remembered, because a store that only knew what it installed
   * this session would lose every pack on a restart — and "installed" has to survive the app
   * being killed, which is the normal way it ends.
   */
  discover(): Promise<readonly InstalledPack[]>;
  /** Why the most recent `discover` refused a candidate. Empty when nothing was refused. */
  issues(): Promise<readonly PackIssue[]>;
  list(): Promise<readonly InstalledPack[]>;
  install(bytes: Uint8Array, options?: PackInstallOptions): Promise<InstallOutcome>;
  uninstall(id: string): Promise<void>;
  /** The directory a pack is installed in, for a launch URL. Kept for `uninstall` and tests. */
  directoryOf(id: string): Promise<string>;
}

/**
 * Does the installed pack still honour the network rule?
 *
 * Reads the entry document from disk, which is the only file the policy lives in. A pack whose entry
 * cannot be read is treated as not honouring it: the alternative is offering a pack whose declaration
 * cannot be checked, which is the state this rule exists to end.
 */
async function packHonoursNetworkPolicy(dir: string, manifest: PackManifest): Promise<boolean> {
  if (packAllows(manifest, "network")) return true;
  try {
    const html = await readTextFile(`${dir}/${manifest.entry}`);
    return packDocumentSealsNetwork(html);
  } catch {
    return false;
  }
}

export function createPackStore(
  options: {
    readonly publicKey?: string;
    readonly contractVersion?: number;
    readonly hostVersion?: number;
    /** The pack capabilities this host serves. Production is `GO_HOST_CAPABILITIES`. */
    readonly capabilities?: readonly PackCapability[];
    /** Test seams for the archive caps. Production uses `MAX_ARCHIVE_BYTES` and the reader defaults. */
    readonly archiveLimits?: PackArchiveLimits;
  } = {},
): PackStore {
  const publicKey = options.publicKey ?? PACK_PUBLIC_KEY;
  const servedCapabilities = options.capabilities ?? GO_HOST_CAPABILITIES;
  const host = {
    contractVersion: options.contractVersion ?? HOST_CONTRACT_VERSION,
    hostVersion: options.hostVersion ?? HOST_VERSION,
  };
  const platformHost = { ...GO_HOST, capabilities: servedCapabilities };
  const archiveLimits: PackArchiveLimits = {
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    ...options.archiveLimits,
  };

  const installed: Map<string, InstalledPack> = new Map();
  let issues: readonly PackIssue[] = [];

  const absoluteDir = async (id: string): Promise<string> => {
    // `Filesystem.getUri` is the only supported way to learn the real path, and the
    // `_capacitor_file_` proxy needs a real path rather than a directory-relative one.
    const uri = await Filesystem.getUri({
      path: `${ROOT}/${id}`,
      directory: Directory.Data,
    });
    return uri.uri;
  };

  /**
   * Read and re-verify one installed version from disk.
   *
   * The manifest is not evidence by itself: it was verified at install, but the bytes on disk can
   * change afterwards. Every listed file is hashed again here, and the directory's own file set is
   * compared with the manifest, so a tampered or padded pack is refused on launch instead of run.
   */
  const verifyInstalled = async (
    id: string,
    version: string,
  ): Promise<
    | { readonly ok: true; readonly manifest: PackManifest }
    | { readonly ok: false; readonly issue: PackIssue }
  > => {
    const dir = `${ROOT}/${id}/${version}`;
    const refuse = (reason: PackIssue["reason"], message: string) => ({
      ok: false as const,
      issue: refusal(reason, message, id, version),
    });

    let raw: unknown;
    try {
      raw = JSON.parse(await readTextFile(`${dir}/manifest.json`));
    } catch {
      return refuse("unreadable", `${id} ${version} has no readable manifest.json.`);
    }

    const parsed = parsePackManifest(raw);
    if (!parsed.ok) {
      return refuse("invalid", `${id} ${version} is not a pack manifest this build reads.`);
    }
    const manifest = parsed.value;
    if (manifest.id !== id || manifest.version !== version) {
      return refuse(
        "invalid",
        `${id} ${version} holds a manifest for ${manifest.id} ${manifest.version}.`,
      );
    }

    if (!(await verifyPackSignature(manifest, publicKey))) {
      return refuse("untrusted", `${id} ${version} is not signed by this host's pack key.`);
    }

    const capability = unsupportedCapability(manifest, servedCapabilities);
    if (capability !== null) {
      return refuse("capability", `${id} ${version}: ${capability}`);
    }

    // S4.8: a pack that does not name this phone's kind, or needs a capability it
    // lacks, is refused when it is read rather than when its first call fails.
    const platform = platformFit(manifest, platformHost);
    if (platform.state === "unavailable") {
      return refuse("platform", `${id} ${version}: ${platform.reason}`);
    }

    let listing: InstalledListing;
    try {
      listing = await listInstalledFiles(dir);
    } catch {
      return refuse("unreadable", `${id} ${version} could not be listed.`);
    }

    if (listing.nonRegular.length > 0) {
      return refuse(
        "files",
        `${id} ${version} contains a link or a non-regular file: ${listing.nonRegular[0] ?? "an entry"}.`,
      );
    }

    const listed = new Set(manifest.files.map((file) => file.path));
    if (listed.has("manifest.json")) {
      return refuse("invalid", `${id} ${version} lists manifest.json as a payload file.`);
    }

    const extra = listing.files.filter((path) => path !== "manifest.json" && !listed.has(path));
    if (extra.length > 0) {
      return refuse("files", `${id} ${version} includes unlisted files: ${extra.join(", ")}.`);
    }

    const mismatches = await verifyPackFiles(manifest, async (path) => {
      try {
        return await readFileBytes(`${dir}/${path}`);
      } catch {
        return null;
      }
    });
    if (mismatches.length > 0) {
      const first = mismatches[0];
      return refuse(
        "files",
        `${id} ${version} failed verification: ${first?.path ?? "a file"} (${
          first?.reason ?? "mismatch"
        }).`,
      );
    }

    // Checked here as well as at install, because a pack installed before this rule existed would
    // otherwise be offered forever: the rule has to apply to what is on disk, not only to what
    // arrives next.
    if (!(await packHonoursNetworkPolicy(dir, manifest))) {
      return refuse("policy", `${id} ${version} does not honour the network rule.`);
    }

    return { ok: true, manifest };
  };

  return {
    async discover() {
      const found: InstalledPack[] = [];
      const refused: PackIssue[] = [];
      installed.clear();
      issues = [];

      let ids: readonly string[] = [];
      try {
        const listing = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
        ids = listing.files
          .filter((entry) => (entry.type as string) === "directory")
          .map((entry) => entry.name);
      } catch {
        return found;
      }

      for (const id of ids) {
        let versions: readonly string[] = [];
        try {
          const listing = await Filesystem.readdir({
            path: `${ROOT}/${id}`,
            directory: Directory.Data,
          });
          versions = listing.files
            .filter((entry) => (entry.type as string) === "directory")
            // A crash can leave a temporary sibling of a version directory behind. It is not a
            // version, and treating it as one would offer a half-written pack.
            .filter((entry) => !entry.name.startsWith(".tmp-"))
            .map((entry) => entry.name);
        } catch {
          continue;
        }

        // The newest version that still verifies, by semver rather than by directory name:
        // string order puts 1.9.0 above 1.10.0. The desktop host makes the same choice from the
        // same layout, so the phone and the desktop agree on the active version. A stray
        // non-version directory is still visited (and refused by its manifest) rather than
        // crashing the scan.
        const ordered = [...versions]
          .sort((left, right) => {
            try {
              return comparePackVersions(left, right);
            } catch {
              return left < right ? -1 : left > right ? 1 : 0;
            }
          })
          .reverse();
        for (const version of ordered) {
          const verified = await verifyInstalled(id, version);
          if (!verified.ok) {
            refused.push(verified.issue);
            continue;
          }

          const baseDir = await absoluteDir(`${id}/${version}`);
          const pack: InstalledPack = {
            manifest: verified.manifest,
            entryUrl: packFileUrl(baseDir, verified.manifest.entry),
            installedAt: 0,
            bytes: verified.manifest.files.reduce((total, file) => total + file.bytes, 0),
          };
          found.push(pack);
          installed.set(id, pack);
          break;
        }
      }

      issues = refused;
      return found;
    },

    async issues() {
      return issues;
    },

    async list() {
      return [...installed.values()];
    },

    async directoryOf(id) {
      return absoluteDir(id);
    },

    async install(bytes, installOptions = {}) {
      if (publicKey.length === 0) {
        return {
          ok: false,
          reason: "untrusted",
          message: "This build has no pack signing key, so it cannot trust any pack yet.",
        };
      }

      // S12.7: the catalogue index displayed a digest and size. Check them before the archive is
      // read at all, so an archive the catalogue did not name is refused without decompression.
      const expected = installOptions.expected;
      if (expected !== undefined) {
        if (expected.size !== undefined && bytes.byteLength !== expected.size) {
          return {
            ok: false,
            reason: "digest",
            message: `That archive is ${bytes.byteLength} bytes; the catalogue lists ${expected.size}.`,
          };
        }
        if ((await sha256Hex(bytes)) !== expected.sha256) {
          return {
            ok: false,
            reason: "digest",
            message:
              "That archive does not match the digest the catalogue displayed; it was refused before it was opened.",
          };
        }
      }

      const read = await readEnvelope(bytes, archiveLimits);
      if (!read.ok) {
        return { ok: false, reason: read.issue.reason, message: read.issue.message };
      }

      const { manifest, files } = read.envelope;

      if (
        expected !== undefined &&
        (manifest.id !== expected.id || manifest.version !== expected.version)
      ) {
        return {
          ok: false,
          reason: "invalid",
          message: `That archive is ${manifest.id} ${manifest.version}; the catalogue lists ${expected.id} ${expected.version}.`,
        };
      }

      if (!(await verifyPackSignature(manifest, publicKey))) {
        return {
          ok: false,
          reason: "unsigned",
          message: "That pack's signature does not match. It may be damaged or not from Suite.",
        };
      }

      const capability = unsupportedCapability(manifest, servedCapabilities);
      if (capability !== null) {
        return { ok: false, reason: "capability", message: capability };
      }

      const platform = platformFit(manifest, platformHost);
      if (platform.state === "unavailable") {
        return {
          ok: false,
          reason: "platform",
          message: platform.reason ?? "That pack is not available on this phone.",
        };
      }

      const listed = new Set(manifest.files.map((file) => file.path));
      if (listed.has("manifest.json")) {
        return {
          ok: false,
          reason: "invalid",
          message: "That pack lists manifest.json as a payload file.",
        };
      }

      const extra = [...files.keys()].filter((path) => !listed.has(path));
      if (extra.length > 0) {
        return {
          ok: false,
          reason: "files",
          message: `That pack includes files its manifest does not list: ${extra.join(", ")}.`,
        };
      }

      // Only files the manifest names are candidates, so an extra entry can neither be written nor
      // influence the policy check. A missing one is caught by `verifyPackFiles` below.
      const payload: Record<string, Uint8Array> = Object.create(null);
      for (const file of manifest.files) {
        const content = files.get(file.path);
        if (content !== undefined) payload[file.path] = content;
      }

      const mismatches = await verifyPackFiles(manifest, async (path) => payload[path] ?? null);
      if (mismatches.length > 0) {
        const first = mismatches[0];
        return {
          ok: false,
          reason: "files",
          message: `That pack is damaged: ${first?.path ?? "a file"} does not match its manifest.`,
        };
      }

      // The files are verified, so what this reads is what would be installed. A pack that does not
      // declare the network has to prove it cannot reach it; see `checkNetworkPolicy`.
      const policy = checkNetworkPolicy(manifest, payload);
      if (!policy.ok) return { ok: false, reason: "policy", message: policy.message };

      const fit = packFitsHost(manifest, host);
      if (!fit.ok) return { ok: false, reason: "host", message: fit.message };

      const idRoot = `${ROOT}/${manifest.id}`;
      const target = `${idRoot}/${manifest.version}`;
      const temporary = `${idRoot}/.tmp-${crypto.randomUUID()}`;

      // The same version is a reinstall, and only a reinstall may replace it. An update is a new
      // version directory beside the old one, which is what lets yesterday's version keep working.
      if ((await pathExists(target)) && installOptions.replace !== true) {
        return {
          ok: false,
          reason: "failed",
          message: `${manifest.id} ${manifest.version} is already installed; it was not replaced.`,
        };
      }

      try {
        // Write into a temporary sibling first: a launch that scans mid-install must never see a
        // half-written version, and a crash leaves a `.tmp-` directory discovery ignores.
        await ensureDir(temporary);
        // The manifest is written too, not just the payload. Discovery reads it to decide what
        // is installed, and an install that left it behind would vanish on the next launch.
        await writeTextFile(`${temporary}/manifest.json`, JSON.stringify(manifest));
        for (const file of manifest.files) {
          const content = payload[file.path];
          if (content === undefined) continue;
          await Filesystem.writeFile({
            path: `${temporary}/${file.path}`,
            data: bytesToBase64(content),
            directory: Directory.Data,
            recursive: true,
          });
        }

        // Re-checked after the write: a concurrent install may have created the target while this
        // one was extracting. The refusal is the same one the first check made.
        if (await pathExists(target)) {
          if (installOptions.replace !== true) {
            await Filesystem.rmdir({
              path: temporary,
              directory: Directory.Data,
              recursive: true,
            }).catch(() => undefined);
            return {
              ok: false,
              reason: "failed",
              message: `${manifest.id} ${manifest.version} is already installed; it was not replaced.`,
            };
          }
          // A reinstall: move the old version aside, put the verified one in place, and restore the
          // old one if the swap fails. The previous version is intact at every point.
          const backup = `${idRoot}/.tmp-${crypto.randomUUID()}-previous`;
          await Filesystem.rename({
            from: target,
            to: backup,
            directory: Directory.Data,
          });
          try {
            await Filesystem.rename({
              from: temporary,
              to: target,
              directory: Directory.Data,
            });
          } catch (error) {
            await Filesystem.rename({
              from: backup,
              to: target,
              directory: Directory.Data,
            }).catch(() => undefined);
            throw error;
          }
          await Filesystem.rmdir({
            path: backup,
            directory: Directory.Data,
            recursive: true,
          }).catch(() => undefined);
        } else {
          await Filesystem.rename({
            from: temporary,
            to: target,
            directory: Directory.Data,
          });
        }

        const baseDir = await absoluteDir(`${manifest.id}/${manifest.version}`);
        const pack: InstalledPack = {
          manifest,
          entryUrl: packFileUrl(baseDir, manifest.entry),
          installedAt: Date.now(),
          bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
        };
        installed.set(manifest.id, pack);
        return { ok: true, pack };
      } catch (error) {
        await Filesystem.rmdir({
          path: temporary,
          directory: Directory.Data,
          recursive: true,
        }).catch(() => undefined);
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async uninstall(id) {
      installed.delete(id);
      // Remove the whole pack directory, every version of it, so the space actually returns.
      await Filesystem.rmdir({
        path: `${ROOT}/${id}`,
        directory: Directory.Data,
        recursive: true,
      }).catch(() => undefined);
    },
  };
}

/**
 * Build a pack file. Used by tests, never by the app at runtime.
 *
 * The writer is the shared one, so the test fixture and the loader cannot drift: the same
 * `PackManifest` type, the same canonical bytes, one implementation of the format.
 */
export const packArchive = buildPackArchive;

/** Hash a set of files the way `files[]` in a manifest expects. */
export async function manifestFiles(
  files: Readonly<Record<string, Uint8Array>>,
): Promise<PackManifest["files"]> {
  const out: PackManifest["files"][number][] = [];
  for (const path of Object.keys(files).sort()) {
    const content = files[path];
    if (!content) continue;
    out.push({ path, sha256: await sha256Hex(content), bytes: content.byteLength });
  }
  return out;
}
