import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  bytesToBase64,
  type FileEntry,
  type FileLock,
  type FileReadOptions,
  type FileService,
  type FileWriteOptions,
  type RemoveOptions,
} from "@suite/go";
import { isSafePackId, isSafePublisherId, SUITE_PUBLISHER_ID } from "@suite/pack";
import {
  assertRelativePath,
  FileStoreError,
  isSafeRelativePath,
  joinUnderRoot,
  LockTable,
  PACK_FILE_MAX_BYTES,
} from "@suite/pack-host/files/core";
import { createFileService } from "./files.js";

/**
 * A pack's own files, on a phone.
 *
 * The mechanics are the desktop's: one root per `(publisher, pack)` under the
 * host's data directory, relative slash-separated paths only, host-owned atomic
 * writes, backups and locks, and the same byte cap. What is different is the
 * filesystem. `PackFileStore` in `@suite/pack-host/files` is Node-backed and
 * cannot be bundled into a WebView, so this store enforces the shared rules
 * (`@suite/pack-host/files/core`) over Capacitor's Filesystem plugin.
 *
 * Two guarantees need a sentence each:
 *
 * - **The root is the boundary.** `Directory.Data` is the app's private data
 *   directory, reached only through Capacitor's plugin, and the path rule
 *   refuses `..`, an absolute prefix and a backslash before a path is joined.
 *   There is no `realpath` to ask, and no API here creates a symlink; an entry
 *   the platform does not report as a file or a directory is refused rather
 *   than followed.
 * - **No request carries a root.** A store is created for one pack identity by
 *   the host, and every path a pack sends is resolved inside it. A second pack
 *   gets a second store; naming its path from the first store is `not-found`.
 */

/** What the store needs from a filesystem, so a test can supply one. */
export interface PackFileBackend {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly { readonly name: string; readonly type: string }[]>;
  stat(
    path: string,
  ): Promise<{ readonly type: string; readonly size: number; readonly mtimeMs: number } | null>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeDirectory(path: string, recursive: boolean): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | undefined;
  if (typeof candidate?.code === "string" && /NOT_FOUND|ENOENT/i.test(candidate.code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not exist|not found|no such|ENOENT/i.test(message);
}

function fallback(error: unknown): FileStoreError {
  if (error instanceof FileStoreError) return error;
  if (isNotFound(error)) return new FileStoreError("not-found", "file not found");
  return new FileStoreError("io", "file operation failed");
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The plugin's `Directory.Data` implementation, in the shape the store uses. */
export function createCapacitorBackend(): PackFileBackend {
  const directory = Directory.Data;
  return {
    async read(path) {
      const file = await Filesystem.readFile({ path, directory });
      if (typeof file.data !== "string") throw new FileStoreError("io", "file operation failed");
      return decode(file.data);
    },
    async write(path, bytes) {
      await Filesystem.writeFile({ path, data: bytesToBase64(bytes), directory });
    },
    async mkdir(path) {
      try {
        await Filesystem.mkdir({ path, directory, recursive: true });
      } catch (error) {
        // Recursive creation is idempotent, but some platforms still report an
        // existing directory as an error. Re-stat so a *file* at the path is not
        // hidden by that tolerance.
        const info = await Filesystem.stat({ path, directory }).catch(() => null);
        if (info !== null && String(info.type) !== "directory") {
          throw new FileStoreError("not-a-directory", "not a directory");
        }
        if (info === null) throw error;
      }
    },
    async readdir(path) {
      const listing = await Filesystem.readdir({ path, directory });
      return listing.files.map((entry) => ({ name: entry.name, type: String(entry.type) }));
    },
    async stat(path) {
      try {
        const info = await Filesystem.stat({ path, directory });
        return { type: String(info.type), size: info.size ?? 0, mtimeMs: info.mtime ?? 0 };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async rename(from, to) {
      await Filesystem.rename({ from, to, directory });
    },
    async copy(from, to) {
      await Filesystem.copy({ from, to, directory });
    },
    async removeFile(path) {
      await Filesystem.deleteFile({ path, directory });
    },
    async removeDirectory(path, recursive) {
      await Filesystem.rmdir({ path, directory, recursive });
    },
  };
}

/** The relative directory one pack's files live in, under `Directory.Data`. */
export function packFilesRoot(scope: PackFilesScope): string {
  return `pack-files/${packFilesSegment(scope)}`;
}

/**
 * One storage segment per `(publisher, pack)`, the same rule the desktop uses.
 *
 * The first-party publisher keeps the bare pack id; another publisher is
 * `<publisher>~<pack-id>`. Both ids are lower-case kebab-case, so `~` cannot
 * occur in either and two pairs cannot collide.
 */
export function packFilesSegment(scope: PackFilesScope): string {
  if (!isSafePackId(scope.packId)) {
    throw new FileStoreError("invalid-path", "invalid file scope");
  }
  const publisher = scope.publisherId ?? SUITE_PUBLISHER_ID;
  if (!isSafePublisherId(publisher)) {
    throw new FileStoreError("invalid-path", "invalid file scope");
  }
  return publisher === SUITE_PUBLISHER_ID ? scope.packId : `${publisher}~${scope.packId}`;
}

export interface PackFilesScope {
  readonly packId: string;
  readonly publisherId?: string;
}

export interface GoPackFileStoreOptions {
  readonly backend?: PackFileBackend;
  readonly maxFileBytes?: number;
  readonly now?: () => Date;
}

/** The pack-scoped store. Mirrors `PackFileStore`, over an injected backend. */
export class GoPackFileStore {
  readonly #backend: PackFileBackend;
  readonly #root: string;
  readonly #maxFileBytes: number;
  readonly #now: () => Date;
  readonly #locks = new LockTable();

  private constructor(root: string, options: GoPackFileStoreOptions) {
    this.#root = root;
    this.#backend = options.backend ?? createCapacitorBackend();
    this.#maxFileBytes = options.maxFileBytes ?? PACK_FILE_MAX_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  /** Open a root, creating it if it does not exist. The root is host-owned. */
  static async open(root: string, options: GoPackFileStoreOptions = {}): Promise<GoPackFileStore> {
    if (!isSafeRoot(root)) throw new FileStoreError("invalid-path", "invalid file scope");
    const store = new GoPackFileStore(root, options);
    try {
      await store.#backend.mkdir(root);
      const info = await store.#statOrNull(root);
      if (info === null || info.type !== "directory") {
        throw new FileStoreError("not-a-directory", "not a directory");
      }
    } catch (error) {
      throw fallback(error);
    }
    return store;
  }

  get root(): string {
    return this.#root;
  }

  async list(path = ""): Promise<readonly FileEntry[]> {
    const found = await this.#guardExisting(path, true);
    if (found.info.type !== "directory")
      throw new FileStoreError("not-a-directory", "not a directory");

    let entries: readonly { readonly name: string; readonly type: string }[];
    try {
      entries = await this.#backend.readdir(found.full);
    } catch (error) {
      throw fallback(error);
    }

    const listed: FileEntry[] = [];
    for (const entry of entries) {
      if (entry.type !== "file" && entry.type !== "directory") continue;
      const relative = path.length === 0 ? entry.name : `${path}/${entry.name}`;
      const child = `${found.full}/${entry.name}`;
      try {
        const info = await this.#backend.stat(child);
        if (info === null) continue;
        if (info.type !== "file" && info.type !== "directory") continue;
        listed.push(entryOf(relative, info));
      } catch (error) {
        if (error instanceof FileStoreError) continue;
        if (isNotFound(error)) continue;
        throw fallback(error);
      }
    }
    return listed.sort((left, right) => left.name.localeCompare(right.name));
  }

  async stat(path: string): Promise<FileEntry | null> {
    try {
      const found = await this.#guardExisting(path, true);
      return entryOf(path, found.info);
    } catch (error) {
      if (error instanceof FileStoreError && error.code === "not-found") return null;
      throw error;
    }
  }

  async mkdir(path: string): Promise<void> {
    const target = await this.#guardParent(path);
    try {
      const existing = await this.#statOrNull(target.full);
      if (existing !== null) {
        this.#refuseNonRegular(existing);
        // A directory is already what the caller asked for; a file or anything
        // else is not, and saying "done" would turn the next read into a lie.
        if (existing.type !== "directory") {
          throw new FileStoreError("not-a-directory", "not a directory");
        }
        return;
      }
      await this.#backend.mkdir(target.full);
      await this.#guardExisting(path, true);
    } catch (error) {
      throw fallback(error);
    }
  }

  async read(path: string, options: FileReadOptions = {}): Promise<Uint8Array> {
    const found = await this.#guardExisting(path, false);
    if (found.info.type !== "file") throw new FileStoreError("not-a-file", "not a file");
    const limit = Math.min(options.maxBytes ?? this.#maxFileBytes, this.#maxFileBytes);
    if (found.info.size > limit) throw new FileStoreError("too-large", "file is too large");
    try {
      return await this.#backend.read(found.full);
    } catch (error) {
      throw fallback(error);
    }
  }

  async write(path: string, bytes: Uint8Array, options: FileWriteOptions = {}): Promise<FileEntry> {
    if (!(bytes instanceof Uint8Array)) {
      throw new FileStoreError("io", "file contents must be bytes");
    }
    if (bytes.byteLength > this.#maxFileBytes) {
      throw new FileStoreError("too-large", "file is too large");
    }

    const target = await this.#guardParent(path);
    let existing = await this.#statOrNull(target.full);
    if (existing !== null) {
      this.#refuseNonRegular(existing);
      if (existing.type !== "file") throw new FileStoreError("not-a-file", "not a file");
      if (
        options.expectedMtimeMs !== undefined &&
        Math.abs(existing.mtimeMs - options.expectedMtimeMs) > 1
      ) {
        throw new FileStoreError("conflict", "file changed since it was read");
      }
    } else if (options.expectedMtimeMs !== undefined) {
      throw new FileStoreError("conflict", "file changed since it was read");
    }

    try {
      await this.#backend.mkdir(joinUnderRoot(this.#root, dirname(path), true));
      if (options.atomic === false) {
        await this.#backend.write(target.full, bytes);
      } else {
        const temporary = `${target.full}.tmp-${crypto.randomUUID()}`;
        try {
          await this.#backend.write(temporary, bytes);
          await this.#backend.rename(temporary, target.full);
        } catch (error) {
          await this.#backend.removeFile(temporary).catch(() => undefined);
          throw error;
        }
      }
      existing = await this.#statOrNull(target.full);
      if (existing === null) throw new FileStoreError("io", "file operation failed");
      return entryOf(path, existing);
    } catch (error) {
      throw fallback(error);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const source = await this.#guardExisting(from, false);
    const destination = await this.#guardParent(to);

    const current = await this.#statOrNull(destination.full);
    if (current !== null) this.#refuseNonRegular(current);

    try {
      await this.#backend.rename(source.full, destination.full);
    } catch (error) {
      throw fallback(error);
    }
  }

  async remove(path: string, options: RemoveOptions = {}): Promise<void> {
    const found = await this.#guardExisting(path, false);
    try {
      if (found.info.type === "directory") {
        if (options.recursive !== true) {
          const children = await this.#backend.readdir(found.full);
          if (children.length > 0) throw new FileStoreError("io", "directory is not empty");
        }
        await this.#backend.removeDirectory(found.full, options.recursive === true);
      } else {
        await this.#backend.removeFile(found.full);
      }
    } catch (error) {
      throw fallback(error);
    }
  }

  /** Copy the current bytes to a dated sibling. Returns the backup's relative path. */
  async backup(path: string): Promise<string> {
    const found = await this.#guardExisting(path, false);
    if (found.info.type !== "file") throw new FileStoreError("not-a-file", "not a file");

    const stamp = this.#now().toISOString().replace(/[:.]/gu, "-");
    let backupPath = `${path}.${stamp}.bak`;
    let counter = 1;
    while (await this.#exists(backupPath)) {
      backupPath = `${path}.${stamp}-${counter}.bak`;
      counter += 1;
    }

    const destination = await this.#guardParent(backupPath);
    try {
      await this.#backend.copy(found.full, destination.full);
    } catch (error) {
      throw fallback(error);
    }
    return backupPath;
  }

  lock(path: string, owner = "pack"): FileLock {
    assertRelativePath(path);
    return this.#locks.acquire(path, owner);
  }

  releaseAll(owner: string): void {
    this.#locks.releaseAll(owner);
  }

  async #exists(path: string): Promise<boolean> {
    const target = await this.#guardParent(path);
    return (await this.#statOrNull(target.full)) !== null;
  }

  async #guardExisting(
    path: string,
    allowRoot: boolean,
  ): Promise<{
    readonly full: string;
    readonly info: { type: string; size: number; mtimeMs: number };
  }> {
    assertRelativePath(path, allowRoot);
    const full = joinUnderRoot(this.#root, path, allowRoot);
    await this.#guardAncestors(path);
    const info = await this.#statOrNull(full);
    if (info === null) throw new FileStoreError("not-found", "file not found");
    this.#refuseNonRegular(info);
    return { full, info };
  }

  /**
   * Resolve a destination whose final name may not exist yet.
   *
   * Every existing ancestor must be a directory, so a file cannot stand in for
   * one. Missing ancestors are created by the caller after this check.
   */
  async #guardParent(path: string): Promise<{ readonly full: string }> {
    assertRelativePath(path);
    const full = joinUnderRoot(this.#root, path);
    await this.#guardAncestors(path);
    return { full };
  }

  /**
   * Refuse an ancestor that is not a real directory.
   *
   * The final name is checked separately by the caller; this is the walk above it,
   * so a link or a device standing in for a parent is refused the same way whether
   * the path exists or is about to be created.
   */
  async #guardAncestors(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    for (let depth = parts.length; depth >= 0; depth -= 1) {
      const ancestor = parts.slice(0, depth).join("/");
      const info = await this.#statOrNull(joinUnderRoot(this.#root, ancestor, true));
      if (info === null) continue;
      this.#refuseNonRegular(info);
      if (info.type !== "directory") {
        throw new FileStoreError("not-a-directory", "not a directory");
      }
    }
  }

  async #statOrNull(full: string): Promise<{ type: string; size: number; mtimeMs: number } | null> {
    try {
      return await this.#backend.stat(full);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw fallback(error);
    }
  }

  #refuseNonRegular(info: { readonly type: string }): void {
    if (info.type === "file") return;
    if (info.type === "directory") return;
    // The plugin reports `file` or `directory`; anything else is a link or a
    // device the platform should not have inside the app's data directory.
    throw new FileStoreError("symlink", "path is not a regular file");
  }
}

function entryOf(
  path: string,
  info: { readonly size: number; readonly mtimeMs: number; readonly type: string },
): FileEntry {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    kind: info.type === "directory" ? "directory" : "file",
    size: info.type === "directory" ? 0 : info.size,
    mtimeMs: info.mtimeMs,
  };
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function isSafeRoot(root: string): boolean {
  // The same rule a pack path gets, plus "not empty": the root is host-built, but
  // a control character or a climb must not reach the filesystem either.
  return root.length > 0 && isSafeRelativePath(root);
}

/**
 * One store per pack identity, for the life of the process.
 *
 * A frame is torn down and mounted again while the app stays open; a store that
 * was recreated each time would drop a lock the previous view held. The cache is
 * keyed by the storage segment, so two packs can never share one.
 */
const stores = new Map<string, Promise<GoPackFileStore>>();

function storeFor(scope: PackFilesScope): Promise<GoPackFileStore> {
  const segment = packFilesSegment(scope);
  const existing = stores.get(segment);
  if (existing !== undefined) return existing;
  const opening = GoPackFileStore.open(packFilesRoot(scope));
  stores.set(segment, opening);
  void opening.catch(() => {
    stores.delete(segment);
  });
  return opening;
}

/**
 * Compose the scoped store with the person's picker and share sheet.
 *
 * The store is a promise because opening the root touches the platform, while
 * `ModuleHost` is a synchronous object. Each verb awaits it, so the first call
 * pays the open and every later one reuses it.
 */
function serviceAround(store: Promise<GoPackFileStore>): FileService {
  const person = createFileService();
  return {
    list: async (path) => (await store).list(path),
    stat: async (path) => (await store).stat(path),
    mkdir: async (path) => (await store).mkdir(path),
    read: async (path, options) => (await store).read(path, options),
    write: async (path, bytes, options) => (await store).write(path, bytes, options),
    rename: async (from, to) => (await store).rename(from, to),
    remove: async (path, options) => (await store).remove(path, options),
    backup: async (path) => (await store).backup(path),
    lock: async (path) => (await store).lock(path),
    pickOpen: (filters) => person.pickOpen(filters),
    exportFile: (input) => person.exportFile(input),
    share: (input) => person.share(input),
  };
}

/** What a pack sees, for the pack's own identity. Cached by storage segment. */
export function createPackFiles(scope: PackFilesScope): FileService {
  return serviceAround(storeFor(scope));
}

/** A service over a caller-supplied backend. Used by tests; never by the app. */
export function createPackFilesWith(
  scope: PackFilesScope,
  options: GoPackFileStoreOptions,
): FileService {
  return serviceAround(GoPackFileStore.open(packFilesRoot(scope), options));
}

/** Release every lock a pack held. Called when its frame is destroyed. */
export async function releasePackFileLocks(scope: PackFilesScope): Promise<void> {
  // Only a store that was opened can hold a lock; opening one here would create
  // a directory for a pack that never wrote a byte.
  const existing = stores.get(packFilesSegment(scope));
  if (existing === undefined) return;
  const store = await existing.catch(() => null);
  store?.releaseAll("pack");
}

/** The store identity a manifest names. A pack never supplies this itself. */
export function packFilesScopeOf(manifest: {
  readonly id: string;
  readonly publisher?: { readonly id?: string } | null;
}): PackFilesScope {
  const publisherId = manifest.publisher?.id;
  return publisherId === undefined ? { packId: manifest.id } : { packId: manifest.id, publisherId };
}
