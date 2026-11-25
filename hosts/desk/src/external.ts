import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isSafePackPath } from "@suite/pack";
import { PACK_FILE_MAX_BYTES } from "@suite/pack-host";
import type { FileEntry, FileFilter, ImportedFolder } from "@suite/pack-runtime";
import { type FilesScope, type FilesSender, filesScope, type PackFilesService } from "./files.js";
import type { IssuedFileHandle } from "./shared.js";

/**
 * The user-consented external file surface.
 *
 * A person picks a file or a destination in a host-owned platform dialog. The
 * absolute path never leaves the main process: the pack gets an opaque token and
 * a name-only snapshot, and every later read, write, close or import spends that
 * token. The token is scoped to the sender's `(container, pack, tab)`; a token
 * from another pack or tab, or a token after its view went away, is refused.
 *
 * This module imports no Electron API. The host supplies the dialog and a
 * `PackFilesService` for `importFile`, so the token rules and filter validation
 * are testable without a window.
 *
 * Errors are generic on purpose. A Node filesystem error carries an absolute
 * path in its message, and that message would cross the bridge; the original is
 * logged here and the pack receives a sentence that names no file.
 */

/** The two platform dialogs. The host keeps the returned absolute paths. */
export interface ExternalDialog {
  /** `null` means the person cancelled. */
  pickOpen(filters: readonly FileFilter[]): Promise<string | null>;
  /** `null` means the person cancelled. */
  pickSave(suggestedName: string): Promise<string | null>;
  /** A directory the host may copy. `null` means the person cancelled. */
  pickFolder(): Promise<string | null>;
}

interface HeldHandle {
  readonly path: string;
  readonly containerId: string;
  readonly packId: string;
  readonly owner: string;
}

const FILTER_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/u;
const EXTENSION = /^[a-z0-9]{1,16}$/u;
const SUGGESTED_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,199}$/u;
const MAX_FILTERS = 8;
const MAX_EXTENSIONS = 32;
const IMPORT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u;
const MIB = 1024 * 1024;

/**
 * A folder import is bounded exactly as the pack archive reader is (S3.2): a
 * fixed entry count, a per-file size and a total size, all checked before any
 * byte is written. The numbers follow `packages/pack-host/src/archive.ts`.
 */
export const FOLDER_IMPORT_LIMITS = Object.freeze({
  maxEntries: 2048,
  maxFileBytes: 64 * MIB,
  maxTotalBytes: 128 * MIB,
});

export interface FolderImportLimits {
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

const NO_FILTERS: readonly FileFilter[] = Object.freeze([]);

function fsCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Log the original in main; hand the pack a sentence with no path in it. */
function logged(message: string, error: unknown): Error {
  console.warn(`[desk] ${message}`, error);
  return new Error(message);
}

/**
 * Validate the renderer's filters as data.
 *
 * A filter is a display name and bare lower-case extensions. A name may not
 * carry a path separator, a glob metacharacter, a control character or a drive
 * colon, so a filter can never name a path or a pattern. The cleaned copy is
 * what reaches the dialog; the renderer's objects are never forwarded.
 */
export function fileFilters(value: unknown): readonly FileFilter[] {
  if (value === undefined || value === null) return NO_FILTERS;
  if (!Array.isArray(value) || value.length > MAX_FILTERS) {
    throw new Error("invalid file filters");
  }

  const filters: FileFilter[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error("invalid file filters");
    }
    const { name, extensions } = candidate as { name?: unknown; extensions?: unknown };
    if (typeof name !== "string" || !FILTER_NAME.test(name)) {
      throw new Error("invalid file filter name");
    }
    if (
      !Array.isArray(extensions) ||
      extensions.length === 0 ||
      extensions.length > MAX_EXTENSIONS
    ) {
      throw new Error("invalid file filter extensions");
    }

    const clean: string[] = [];
    for (const extension of extensions) {
      if (typeof extension !== "string" || !EXTENSION.test(extension)) {
        throw new Error("invalid file filter extension");
      }
      clean.push(extension);
    }
    filters.push({ name, extensions: clean });
  }
  return filters;
}

/** A suggested save name is a file name, not a path. */
export function isSafeSuggestedName(value: unknown): value is string {
  return typeof value === "string" && SUGGESTED_NAME.test(value);
}

function requireSuggestedName(value: unknown): string {
  if (!isSafeSuggestedName(value)) throw new Error("invalid file name");
  return value;
}

function sameScope(held: HeldHandle, scope: FilesScope): boolean {
  return (
    held.containerId === scope.containerId &&
    held.packId === scope.packId &&
    held.owner === scope.owner
  );
}

export class ExternalFilesService {
  readonly #dialog: ExternalDialog;
  readonly #files: PackFilesService;
  readonly #maxBytes: number;
  readonly #folderLimits: FolderImportLimits;
  readonly #handles = new Map<string, HeldHandle>();

  constructor(
    dialog: ExternalDialog,
    files: PackFilesService,
    options: {
      readonly maxBytes?: number;
      readonly folderLimits?: Partial<FolderImportLimits>;
    } = {},
  ) {
    this.#dialog = dialog;
    this.#files = files;
    this.#maxBytes = options.maxBytes ?? PACK_FILE_MAX_BYTES;
    this.#folderLimits = { ...FOLDER_IMPORT_LIMITS, ...options.folderLimits };
  }

  async pickOpen(sender: FilesSender, filters: unknown): Promise<IssuedFileHandle | null> {
    const scope = requireScope(sender);
    const validated = fileFilters(filters);

    let chosen: string | null;
    try {
      chosen = await this.#dialog.pickOpen(validated);
    } catch (error) {
      throw logged("the file picker could not be opened", error);
    }
    if (chosen === null) return null;

    const target = await this.#inspect(chosen, "the file could not be opened");
    if (target === null) throw new Error("the file could not be opened");
    if (target.isSymbolicLink() || !target.isFile()) {
      throw new Error("the chosen file is not a regular file");
    }
    if (target.size > this.#maxBytes) throw new Error("the file is too large");

    return this.#issue(scope, chosen, target.size, target.mtimeMs);
  }

  async pickSave(sender: FilesSender, suggestedName: unknown): Promise<IssuedFileHandle | null> {
    const scope = requireScope(sender);
    const name = requireSuggestedName(suggestedName);

    let chosen: string | null;
    try {
      chosen = await this.#dialog.pickSave(name);
    } catch (error) {
      throw logged("the save dialog could not be opened", error);
    }
    if (chosen === null) return null;

    // Picking a destination must not touch it. An existing file is inspected
    // only so the handle's snapshot is honest; nothing is created or truncated.
    const target = await this.#inspect(chosen, "the destination could not be opened");
    if (target !== null && (target.isSymbolicLink() || !target.isFile())) {
      throw new Error("the chosen destination is not a regular file");
    }
    return this.#issue(scope, chosen, target?.size ?? 0, target?.mtimeMs ?? 0);
  }

  async read(sender: FilesSender, token: unknown): Promise<Uint8Array> {
    const scope = requireScope(sender);
    const held = this.#owned(scope, token);
    return this.#readHeld(held);
  }

  async write(sender: FilesSender, token: unknown, bytes: unknown): Promise<void> {
    const scope = requireScope(sender);
    const held = this.#owned(scope, token);
    if (!(bytes instanceof Uint8Array)) throw new Error("file contents must be bytes");
    if (bytes.byteLength > this.#maxBytes) throw new Error("the file is too large");

    // Refuse to replace a directory or a symlink, and leave a missing
    // destination to be created by the rename below.
    await this.#destination(held.path);

    /*
     * The write is atomic: a temporary sibling in the chosen file's own
     * directory, then one rename over the destination. A failure before the
     * rename leaves the previous destination bytes untouched and removes the
     * temporary file. A success replaces the file rather than truncating it in
     * place, so a concurrent reader never sees a half-written file.
     */
    const temporary = join(dirname(held.path), `.${basename(held.path)}.suite-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, held.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw logged("the file could not be written", error);
    }
  }

  /**
   * Drop a handle. Closing a token this scope does not own is a no-op, so a
   * guessed token cannot close another tab's file, and closing twice is safe.
   */
  async close(sender: FilesSender, token: unknown): Promise<void> {
    const scope = requireScope(sender);
    if (typeof token !== "string") return;
    const held = this.#handles.get(token);
    if (held === undefined || !sameScope(held, scope)) return;
    this.#handles.delete(token);
  }

  async importFile(sender: FilesSender, token: unknown, name?: unknown): Promise<FileEntry> {
    const scope = requireScope(sender);
    const held = this.#owned(scope, token);
    if (name !== undefined && typeof name !== "string") throw new Error("invalid file name");

    const bytes = await this.#readHeld(held);
    const destination = name ?? basename(held.path);
    try {
      return await this.#files.write(scope, destination, bytes);
    } catch (error) {
      throw logged("the file could not be imported", error);
    }
  }

  /**
   * Copy a person-chosen folder into the pack's own root.
   *
   * The person picks in a host dialog; the host walks the folder with its own
   * rules (safe relative names, regular files only, no symlinks) and checks the
   * bounds before it writes anything. The pack receives a relative directory and
   * the files it holds, never the source path.
   */
  async importFolder(sender: FilesSender, destination?: unknown): Promise<ImportedFolder | null> {
    const scope = requireScope(sender);
    const requested = this.#importDestination(destination);

    let chosen: string | null;
    try {
      chosen = await this.#dialog.pickFolder();
    } catch (error) {
      throw logged("the folder picker could not be opened", error);
    }
    if (chosen === null) return null;

    const collected = await collectFolder(chosen, this.#folderLimits);
    const target = requested ?? (await this.#freeDestination(scope, chosen));
    if (requested !== null && (await this.#files.stat(scope, requested)) !== null) {
      throw new Error("that folder already exists in this pack");
    }

    try {
      await this.#files.mkdir(scope, target);
      const entries: FileEntry[] = [];
      for (const file of collected) {
        const path = `${target}/${file.path}`;
        if (!isSafePackPath(path))
          throw new Error("the folder contains a name that is not a safe path");
        entries.push(await this.#files.write(scope, path, file.bytes));
      }
      return { path: target, entries };
    } catch (error) {
      await this.#files.remove(scope, target, { recursive: true }).catch(() => undefined);
      throw logged("the folder could not be imported", error);
    }
  }

  #importDestination(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length === 0 || !isSafePackPath(value)) {
      throw new Error("invalid folder destination");
    }
    return value;
  }

  /** A destination no existing entry holds. The person importing twice gets two copies. */
  async #freeDestination(scope: FilesScope, folder: string): Promise<string> {
    const base = importBaseName(folder);
    for (let counter = 1; counter <= 1000; counter += 1) {
      const candidate = counter === 1 ? `imports/${base}` : `imports/${base}-${counter}`;
      if ((await this.#files.stat(scope, candidate)) === null) return candidate;
    }
    throw new Error("the folder could not be given a free name");
  }

  /** Called when a view is destroyed, crashes or navigates away. */
  releaseOwner(owner: string): void {
    for (const [token, held] of this.#handles) {
      if (held.owner === owner) this.#handles.delete(token);
    }
  }

  #issue(scope: FilesScope, path: string, size: number, mtimeMs: number): IssuedFileHandle {
    const token = randomUUID();
    this.#handles.set(token, {
      path,
      containerId: scope.containerId,
      packId: scope.packId,
      owner: scope.owner,
    });
    return { token, info: { name: basename(path), size, mtimeMs } };
  }

  #owned(scope: FilesScope, token: unknown): HeldHandle {
    if (typeof token !== "string") throw new Error("the file handle is not available");
    const held = this.#handles.get(token);
    if (held === undefined || !sameScope(held, scope)) {
      throw new Error("the file handle is not available");
    }
    return held;
  }

  async #readHeld(held: HeldHandle): Promise<Uint8Array> {
    const target = await this.#inspect(held.path, "the file could not be read");
    if (target === null) throw new Error("the file could not be read");
    if (target.isSymbolicLink() || !target.isFile()) {
      throw new Error("the file is not a regular file");
    }
    if (target.size > this.#maxBytes) throw new Error("the file is too large");

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(held.path));
    } catch (error) {
      throw logged("the file could not be read", error);
    }
    // The size may have grown between the check and the read.
    if (bytes.byteLength > this.#maxBytes) throw new Error("the file is too large");
    return bytes;
  }

  async #destination(path: string): Promise<Stats | null> {
    const target = await this.#inspect(path, "the destination could not be opened");
    if (target !== null && (target.isSymbolicLink() || !target.isFile())) {
      throw new Error("the chosen destination is not a regular file");
    }
    return target;
  }

  async #inspect(path: string, message: string): Promise<Stats | null> {
    try {
      return await lstat(path);
    } catch (error) {
      if (fsCode(error) === "ENOENT") return null;
      throw logged(message, error);
    }
  }
}

interface CollectedFile {
  /** Relative to the chosen folder, slash-separated. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

function importBaseName(folder: string): string {
  const cleaned = basename(folder)
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
  const base = cleaned.slice(0, 64);
  return IMPORT_SEGMENT.test(base) ? base : "folder";
}

/**
 * Walk a chosen folder without trusting it.
 *
 * A folder is untrusted input just as an archive is: it can hold a symlink, a
 * device node, a name that walks up, or more bytes than the host will copy. All
 * of it is checked while walking and before a single byte is written.
 */
async function collectFolder(
  root: string,
  limits: FolderImportLimits,
): Promise<readonly CollectedFile[]> {
  const files: CollectedFile[] = [];
  let entries = 0;
  let total = 0;
  const pending: Array<{ readonly absolute: string; readonly relative: string }> = [
    { absolute: root, relative: "" },
  ];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;

    let children: Dirent[];
    try {
      children = await readdir(current.absolute, { withFileTypes: true });
    } catch (error) {
      throw logged("the folder could not be read", error);
    }

    for (const child of children) {
      entries += 1;
      if (entries > limits.maxEntries) {
        throw new Error("the folder has more files than this host accepts");
      }

      const path = current.relative.length === 0 ? child.name : `${current.relative}/${child.name}`;
      if (!isSafePackPath(path)) {
        throw new Error("the folder contains a name that is not a safe path");
      }
      if (child.isSymbolicLink()) throw new Error("the folder contains a symbolic link");

      const absolute = join(current.absolute, child.name);
      if (child.isDirectory()) {
        pending.push({ absolute, relative: path });
        continue;
      }
      if (!child.isFile()) throw new Error("the folder contains something that is not a file");

      const details = await lstat(absolute).catch((error: unknown) => {
        throw logged("a file in the folder could not be read", error);
      });
      if (details.isSymbolicLink()) throw new Error("the folder contains a symbolic link");
      if (!details.isFile()) throw new Error("the folder contains something that is not a file");
      if (details.size > limits.maxFileBytes) {
        throw new Error("a file in the folder is larger than this host accepts");
      }
      total += details.size;
      if (total > limits.maxTotalBytes) {
        throw new Error("the folder is larger than this host accepts");
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(absolute));
      } catch (error) {
        throw logged("a file in the folder could not be read", error);
      }
      // The file may have grown between the check and the read.
      if (bytes.byteLength > limits.maxFileBytes) {
        throw new Error("a file in the folder is larger than this host accepts");
      }
      files.push({ path, bytes });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * The one capability gate for the external surface.
 *
 * A pack without `files` never reaches a dialog or a handle: this is the same
 * check the scoped file store uses, so there is one answer, not two.
 */
function requireScope(sender: FilesSender): FilesScope {
  const scope = filesScope(sender);
  if (scope === null) throw new Error("the files capability is not enabled for this pack");
  return scope;
}
