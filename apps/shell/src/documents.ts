import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { isSafeContainerId } from "./container.js";
import { isSafePackId } from "./packs.js";
import type { DocumentRecord, DocumentSummary } from "./shared.js";

/**
 * The documents a pack owns, stored as bytes the shell never parses.
 *
 * The pack names a document; the host resolves it under
 * `<container>/<pack>` and nowhere else. There is no path in the API, so a pack
 * cannot ask for another pack's file, and a name with a slash or a `..` is
 * refused before it reaches the filesystem. This is the capability the
 * blast-radius answer depends on.
 *
 * Errors are deliberately generic. A Node filesystem error carries an absolute
 * path, and the bridge would hand that path to a pack; the original error is
 * logged in the main process instead.
 */
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,199}$/u;

export function isSafeDocumentId(value: string): boolean {
  return DOCUMENT_ID.test(value) && value !== "." && value !== "..";
}

function fsCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function logged(action: string, error: unknown): Error {
  console.warn(`[shell] ${action}`, error);
  return new Error(action);
}

export class DocumentStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #packRoot(containerId: string, packId: string): string {
    if (!isSafeContainerId(containerId)) throw new Error("invalid container id");
    if (!isSafePackId(packId)) throw new Error("invalid pack id");
    return join(this.#root, containerId, packId);
  }

  #path(containerId: string, packId: string, id: string): string {
    if (!isSafeDocumentId(id)) throw new Error("invalid document name");
    const directory = this.#packRoot(containerId, packId);
    const file = join(directory, id);
    const boundary = directory.endsWith(sep) ? directory : `${directory}${sep}`;
    if (!file.startsWith(boundary)) throw new Error("document is outside the pack");
    return file;
  }

  async list(containerId: string, packId: string): Promise<readonly DocumentSummary[]> {
    const directory = this.#packRoot(containerId, packId);
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (fsCode(error) === "ENOENT") return [];
      throw logged("documents could not be listed", error);
    }

    const found: DocumentSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isSafeDocumentId(entry.name)) continue;
      try {
        const details = await lstat(join(directory, entry.name));
        if (!details.isFile()) continue;
        found.push({
          id: entry.name,
          name: entry.name,
          size: details.size,
          updatedAt: details.mtimeMs,
        });
      } catch (error) {
        // A file that vanished between readdir and lstat is simply not listed.
        if (fsCode(error) === "ENOENT") continue;
        throw logged("documents could not be listed", error);
      }
    }
    return found.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async create(containerId: string, packId: string, name: string): Promise<DocumentSummary> {
    const file = this.#path(containerId, packId, name);
    try {
      await mkdir(dirname(file), { recursive: true });
      // `wx` refuses an existing file, so create cannot silently truncate a note
      // the pack already had.
      await writeFile(file, new Uint8Array(), { flag: "wx" });
      return await this.#summary(file, name);
    } catch (error) {
      if (fsCode(error) === "EEXIST") throw new Error("document already exists");
      throw logged("document could not be created", error);
    }
  }

  async open(containerId: string, packId: string, id: string): Promise<DocumentRecord | null> {
    const file = this.#path(containerId, packId, id);
    try {
      const details = await lstat(file);
      if (!details.isFile()) throw new Error("document is not a regular file");
      const bytes = await readFile(file);
      return {
        id,
        name: id,
        size: details.size,
        updatedAt: details.mtimeMs,
        bytes: new Uint8Array(bytes),
      };
    } catch (error) {
      if (fsCode(error) === "ENOENT") return null;
      if (error instanceof Error && error.message === "document is not a regular file") throw error;
      throw logged("document could not be opened", error);
    }
  }

  async save(
    containerId: string,
    packId: string,
    id: string,
    bytes: Uint8Array,
  ): Promise<DocumentSummary> {
    if (!(bytes instanceof Uint8Array)) throw new Error("a document is bytes");
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("document is too large");

    const file = this.#path(containerId, packId, id);
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      const existing = await lstat(file).catch((error: unknown) => {
        if (fsCode(error) === "ENOENT") return null;
        throw error;
      });
      if (existing !== null && !existing.isFile()) {
        throw new Error("document is not a regular file");
      }

      await mkdir(dirname(file), { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, file);
      return await this.#summary(file, id);
    } catch (error) {
      await rm(temporary, { force: true });
      if (error instanceof Error && error.message === "document is not a regular file") throw error;
      throw logged("document could not be saved", error);
    }
  }

  async remove(containerId: string, packId: string, id: string): Promise<void> {
    try {
      await rm(this.#path(containerId, packId, id), { force: true });
    } catch (error) {
      throw logged("document could not be removed", error);
    }
  }

  async #summary(file: string, name: string): Promise<DocumentSummary> {
    const details = await lstat(file);
    if (!details.isFile()) throw new Error("document is not a regular file");
    return { id: name, name, size: details.size, updatedAt: details.mtimeMs };
  }
}
