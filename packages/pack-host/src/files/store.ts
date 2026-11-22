import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FileEntry, FileLock, FileReadOptions, FileWriteOptions } from "@suite/pack-runtime";
import { FileStoreError } from "./errors.js";
import { LockTable } from "./lock.js";
import { assertRelativePath, isInside, normaliseRoot, resolveInside } from "./path.js";

export interface RemoveOptions {
  readonly recursive?: boolean;
}

export interface PackFileStoreOptions {
  readonly maxFileBytes?: number;
  readonly now?: () => Date;
}

const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function failure(code: FileStoreError["code"], message: string): FileStoreError {
  return new FileStoreError(code, message);
}

function generic(error: unknown): FileStoreError {
  const code = codeOf(error);
  if (code === "ENOENT") return failure("not-found", "file not found");
  if (code === "EACCES" || code === "EPERM") return failure("io", "file is not accessible");
  if (code === "ENOSPC") return failure("io", "there is no room left");
  if (code === "ENOTDIR") return failure("not-a-directory", "not a directory");
  if (code === "EISDIR") return failure("not-a-file", "not a file");
  if (code === "ENOTEMPTY") return failure("io", "directory is not empty");
  return failure("io", "file operation failed");
}

/**
 * One pack's scoped files.
 *
 * The store owns the root; every public path is relative and every real path is
 * checked against the root's real path. Symlinks, devices and other non-regular
 * files are refused. Atomic writes, backups and locks are host-owned so a pack
 * does not have to reimplement them.
 */
export class PackFileStore {
  readonly #root: string;
  readonly #realRoot: string;
  readonly #maxFileBytes: number;
  readonly #now: () => Date;
  readonly #locks = new LockTable();

  private constructor(root: string, realRoot: string, options: PackFileStoreOptions) {
    this.#root = root;
    this.#realRoot = realRoot;
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  static async open(root: string, options: PackFileStoreOptions = {}): Promise<PackFileStore> {
    const absolute = normaliseRoot(root);
    await mkdir(absolute, { recursive: true });
    const real = await realpath(absolute);
    return new PackFileStore(absolute, real, options);
  }

  /** The root, for host-side logging. Never send this to a pack. */
  get root(): string {
    return this.#root;
  }

  async list(path = ""): Promise<readonly FileEntry[]> {
    const { candidate, info } = await this.#guardExisting(path, true);
    if (!info.isDirectory()) throw failure("not-a-directory", "not a directory");

    let entries: Dirent[];
    try {
      entries = await readdir(candidate, { withFileTypes: true });
    } catch (error) {
      throw generic(error);
    }

    const found: FileEntry[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const relative = path.length === 0 ? entry.name : `${path}/${entry.name}`;
      try {
        const details = await lstat(join(candidate, entry.name));
        if (details.isSymbolicLink()) continue;
        if (!details.isFile() && !details.isDirectory()) continue;
        found.push(this.#entry(relative, details));
      } catch (error) {
        if (codeOf(error) === "ENOENT") continue;
        throw generic(error);
      }
    }
    return found.sort((left, right) => left.name.localeCompare(right.name));
  }

  async stat(path: string): Promise<FileEntry | null> {
    try {
      const { info } = await this.#guardExisting(path, true);
      return this.#entry(path, info);
    } catch (error) {
      if (error instanceof FileStoreError && error.code === "not-found") return null;
      throw error;
    }
  }

  async mkdir(path: string): Promise<void> {
    assertRelativePath(path);
    const { candidate } = await this.#guardParent(path);
    try {
      await mkdir(candidate, { recursive: true });
      await this.#guardExisting(path, true);
    } catch (error) {
      if (error instanceof FileStoreError) throw error;
      throw generic(error);
    }
  }

  async read(path: string, options: FileReadOptions = {}): Promise<Uint8Array> {
    assertRelativePath(path);
    const { candidate, info } = await this.#guardExisting(path, false);
    if (!info.isFile()) throw failure("not-a-file", "not a file");
    const limit = Math.min(options.maxBytes ?? this.#maxFileBytes, this.#maxFileBytes);
    if (info.size > limit) throw failure("too-large", "file is too large");
    try {
      return new Uint8Array(await readFile(candidate));
    } catch (error) {
      throw generic(error);
    }
  }

  async write(path: string, bytes: Uint8Array, options: FileWriteOptions = {}): Promise<FileEntry> {
    assertRelativePath(path);
    if (!(bytes instanceof Uint8Array)) throw failure("io", "file contents must be bytes");
    if (bytes.byteLength > this.#maxFileBytes) throw failure("too-large", "file is too large");

    const { candidate } = await this.#guardParent(path);
    let existing: Stats | null = null;
    try {
      existing = await lstat(candidate);
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw generic(error);
    }

    if (existing !== null) {
      if (existing.isSymbolicLink()) throw failure("symlink", "path is not a regular file");
      if (!existing.isFile()) throw failure("not-a-file", "not a file");
      const real = await realpath(candidate).catch((error: unknown) => {
        throw generic(error);
      });
      if (!isInside(real, this.#realRoot))
        throw failure("outside-root", "path is outside the pack");
      if (
        options.expectedMtimeMs !== undefined &&
        Math.abs(existing.mtimeMs - options.expectedMtimeMs) > 1
      ) {
        throw failure("conflict", "file changed since it was read");
      }
    } else if (options.expectedMtimeMs !== undefined) {
      throw failure("conflict", "file changed since it was read");
    }

    try {
      await mkdir(dirname(candidate), { recursive: true });
      if (options.atomic === false) {
        await writeFile(candidate, bytes);
      } else {
        const temporary = `${candidate}.tmp-${randomUUID()}`;
        try {
          await writeFile(temporary, bytes);
          await rename(temporary, candidate);
        } catch (error) {
          await rm(temporary, { force: true });
          throw error;
        }
      }
      return this.#entry(path, await lstat(candidate));
    } catch (error) {
      if (error instanceof FileStoreError) throw error;
      throw generic(error);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    assertRelativePath(from);
    assertRelativePath(to);
    const source = await this.#guardExisting(from, false);
    const destination = await this.#guardParent(to);
    if (!source.info.isFile() && !source.info.isDirectory()) {
      throw failure("not-a-file", "not a file");
    }

    try {
      const current = await lstat(destination.candidate);
      if (current.isSymbolicLink()) throw failure("symlink", "path is not a regular file");
    } catch (error) {
      if (codeOf(error) !== "ENOENT") {
        if (error instanceof FileStoreError) throw error;
        throw generic(error);
      }
    }

    try {
      await rename(source.candidate, destination.candidate);
    } catch (error) {
      throw generic(error);
    }
  }

  async remove(path: string, options: RemoveOptions = {}): Promise<void> {
    assertRelativePath(path);
    const { candidate, info } = await this.#guardExisting(path, false);
    try {
      if (info.isDirectory()) {
        if (options.recursive === true) await rm(candidate, { recursive: true, force: false });
        else await rmdir(candidate);
      } else if (info.isFile()) {
        await rm(candidate, { force: false });
      } else {
        throw failure("not-a-file", "not a file");
      }
    } catch (error) {
      if (error instanceof FileStoreError) throw error;
      throw generic(error);
    }
  }

  /** Copy the current bytes to a dated sibling. Returns the backup's relative path. */
  async backup(path: string): Promise<string> {
    assertRelativePath(path);
    const { candidate, info } = await this.#guardExisting(path, false);
    if (!info.isFile()) throw failure("not-a-file", "not a file");

    const stamp = this.#now().toISOString().replace(/[:.]/gu, "-");
    let backupPath = `${path}.${stamp}.bak`;
    let counter = 1;
    while (await this.#existsInside(backupPath)) {
      backupPath = `${path}.${stamp}-${counter}.bak`;
      counter += 1;
    }

    const destination = await this.#guardParent(backupPath);
    try {
      await copyFile(candidate, destination.candidate);
    } catch (error) {
      throw generic(error);
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

  async #existsInside(path: string): Promise<boolean> {
    try {
      await this.#guardExisting(path, false);
      return true;
    } catch (error) {
      if (error instanceof FileStoreError && error.code === "not-found") return false;
      throw error;
    }
  }

  /**
   * Resolve an existing path and prove its real location is inside the root.
   *
   * `realpath` follows every symlink, so an ancestor that points outside is
   * caught before any operation. `lstat` then refuses the final symlink itself.
   */
  async #guardExisting(
    path: string,
    allowRoot: boolean,
  ): Promise<{ readonly candidate: string; readonly info: Stats }> {
    assertRelativePath(path, allowRoot);
    const candidate = resolveInside(this.#root, path);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch (error) {
      if (codeOf(error) === "ENOENT") throw failure("not-found", "file not found");
      throw generic(error);
    }
    if (!isInside(real, this.#realRoot)) throw failure("outside-root", "path is outside the pack");

    const info = await lstat(candidate).catch((error: unknown) => {
      throw generic(error);
    });
    if (info.isSymbolicLink()) throw failure("symlink", "path is not a regular file");
    if (!info.isFile() && !info.isDirectory()) throw failure("not-a-file", "not a file");
    return { candidate, info };
  }

  /**
   * Resolve a destination whose final name may not exist yet.
   *
   * The nearest existing ancestor is checked by `realpath`, so a symlinked
   * parent cannot move the write outside the root. Missing ancestors are created
   * by the caller's `mkdir`, after this check.
   */
  async #guardParent(path: string): Promise<{ readonly candidate: string }> {
    assertRelativePath(path);
    const candidate = resolveInside(this.#root, path);
    let current = dirname(candidate);

    while (true) {
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw failure("symlink", "path is not a regular file");
        if (!info.isDirectory()) throw failure("not-a-directory", "not a directory");
        break;
      } catch (error) {
        if (error instanceof FileStoreError) throw error;
        if (codeOf(error) !== "ENOENT") throw generic(error);
        const next = dirname(current);
        if (next === current) throw failure("io", "could not resolve the pack root");
        current = next;
      }
    }

    const real = await realpath(current).catch((error: unknown) => {
      throw generic(error);
    });
    if (!isInside(real, this.#realRoot)) throw failure("outside-root", "path is outside the pack");
    return { candidate };
  }

  #entry(path: string, info: Stats): FileEntry {
    return {
      path,
      name: basename(path),
      kind: info.isDirectory() ? "directory" : "file",
      size: info.isDirectory() ? 0 : info.size,
      mtimeMs: info.mtimeMs,
    };
  }
}
