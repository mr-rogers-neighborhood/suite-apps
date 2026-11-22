import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  bytesToBase64,
  checkNetworkPolicy,
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
 * clock. A pack that declares 2 needs a host that has it; a pack that declares 1 still installs.
 */
export const HOST_CONTRACT_VERSION = 2;
export const HOST_VERSION = 1;

export interface InstalledPack {
  readonly manifest: PackManifest;
  /** Where the pack's entry lives, as a URL the WebView can import. */
  readonly entryUrl: string;
  readonly installedAt: number;
  readonly bytes: number;
}

export type InstallOutcome =
  | { readonly ok: true; readonly pack: InstalledPack }
  | {
      readonly ok: false;
      readonly reason:
        | "unreadable"
        | "invalid"
        | "unsigned"
        | "untrusted"
        | "files"
        | "host"
        | "policy"
        | "failed";
      readonly message: string;
    };

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
  install(bytes: Uint8Array): Promise<InstallOutcome>;
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
    /** Test seams for the archive caps. Production uses `MAX_ARCHIVE_BYTES` and the reader defaults. */
    readonly archiveLimits?: PackArchiveLimits;
  } = {},
): PackStore {
  const publicKey = options.publicKey ?? PACK_PUBLIC_KEY;
  const host = {
    contractVersion: options.contractVersion ?? HOST_CONTRACT_VERSION,
    hostVersion: options.hostVersion ?? HOST_VERSION,
  };
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
            .map((entry) => entry.name);
        } catch {
          continue;
        }

        // The newest version that still verifies. A directory left behind by a half-finished
        // install is skipped rather than offered as a module that will fail to open.
        for (const version of [...versions].sort().reverse()) {
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

    async install(bytes) {
      if (publicKey.length === 0) {
        return {
          ok: false,
          reason: "untrusted",
          message: "This build has no pack signing key, so it cannot trust any pack yet.",
        };
      }

      const read = await readEnvelope(bytes, archiveLimits);
      if (!read.ok) {
        return { ok: false, reason: read.issue.reason, message: read.issue.message };
      }

      const { manifest, files } = read.envelope;

      if (!(await verifyPackSignature(manifest, publicKey))) {
        return {
          ok: false,
          reason: "unsigned",
          message: "That pack's signature does not match. It may be damaged or not from Suite.",
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

      try {
        const dir = `${ROOT}/${manifest.id}/${manifest.version}`;
        await ensureDir(dir);
        // The manifest is written too, not just the payload. Discovery reads it to decide what
        // is installed, and an install that left it behind would vanish on the next launch.
        await writeTextFile(`${dir}/manifest.json`, JSON.stringify(manifest));
        for (const file of manifest.files) {
          const content = payload[file.path];
          if (content === undefined) continue;
          await Filesystem.writeFile({
            path: `${dir}/${file.path}`,
            data: bytesToBase64(content),
            directory: Directory.Data,
            recursive: true,
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
