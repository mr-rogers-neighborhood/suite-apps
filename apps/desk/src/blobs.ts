import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PackBlob, PackBlobClass } from "@suite/pack";
import { isSafeContainerId } from "./container.js";
import { FIRST_PARTY_PUBLISHER_ID, packStorageKey } from "./packIdentity.js";
import { isSafePackId } from "./packs.js";

/**
 * A pack's blobs, classified so backup and export can tell an asset from a
 * cache without asking the pack (S6.7).
 *
 * There are three stores, one per class: `asset` is exported and backed up,
 * `derived` is backed up but not exported by default, and `cache` is
 * disposable. A manifest names a store and declares its class; the class is the
 * physical store, so a pack that names the same class twice still shares one
 * content-addressed directory. Every path is scoped to the sender's
 * `(container, publisher, pack)` and named by the SHA-256 of the bytes:
 *
 *   <data root>/blobs/<container>/<pack>/<class>/<sha256>          first party
 *   <data root>/blobs/<container>/<publisher>~<pack>/<class>/<sha256>  another publisher
 *
 * The first-party publisher keeps the pre-S2.1 segment, so existing blobs are not
 * moved; another publisher under the same pack id starts empty (S2.2).
 *
 * The store is not part of the pack's code root, so reinstalling a pack never
 * touches the person's blobs. A read recomputes the hash and refuses a file that
 * does not match, so a damaged copy is never handed to the pack as if it were
 * the blob. `cache` can be cleared wholesale; clearing it touches no asset or
 * derived blob. The host cannot prove that a cache blob is regenerable, so
 * "never the only copy" stays the pack's promise, checked by this store only in
 * that it never places an asset or derived blob in the cache store.
 *
 * Errors name no path. A Node filesystem error carries an absolute path, and
 * that message would cross the bridge; the original is logged in the main
 * process instead.
 */

/** The three classes, in the order a person would back them up. */
export const BLOB_CLASSES: readonly PackBlobClass[] = ["asset", "derived", "cache"];

const SHA256 = /^[a-f0-9]{64}$/u;
const STORE = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const TEMPORARY_INFIX = ".tmp-";

/** Where a pack's blobs sit. The caller supplies the container and pack it already resolved. */
export interface BlobScope {
  readonly containerId: string;
  readonly packId: string;
  /** Defaults to the first-party publisher, which keeps the pre-S2.1 segment. */
  readonly publisherId?: string;
}

/** A stored blob's identity. `bytes` is the length of the content, not of a file on disk. */
export interface BlobEntry {
  readonly store: string;
  readonly class: PackBlobClass;
  readonly sha256: string;
  readonly bytes: number;
}

/** A stored blob and its content bytes. */
export interface BlobContents extends BlobEntry {
  readonly data: Uint8Array;
}

export type BlobErrorKind = "invalid" | "undeclared" | "corrupt" | "failed";

/** A refusal that names no path, so it is safe to hand to a pack. */
export class BlobError extends Error {
  readonly kind: BlobErrorKind;

  constructor(kind: BlobErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobError";
    this.kind = kind;
  }
}

function fsCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function logged(action: string, error: unknown): Error {
  console.warn(`[shell] ${action}`, error);
  return new BlobError("failed", action, { cause: error });
}

export class BlobStores {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #packRoot(scope: BlobScope): string {
    if (!isSafeContainerId(scope.containerId)) {
      throw new BlobError("invalid", "invalid container id");
    }
    if (!isSafePackId(scope.packId)) throw new BlobError("invalid", "invalid pack id");
    const publisherId = scope.publisherId ?? FIRST_PARTY_PUBLISHER_ID;
    try {
      return join(this.#root, scope.containerId, packStorageKey(publisherId, scope.packId));
    } catch {
      throw new BlobError("invalid", "invalid publisher id");
    }
  }

  /**
   * The one declaration for a store name, or a refusal.
   *
   * A pack must declare the store before it writes to it, and the declaration's
   * class decides which of the three physical stores holds the bytes.
   */
  #declaration(declarations: readonly PackBlob[], store: string): PackBlob {
    if (!STORE.test(store)) throw new BlobError("invalid", "invalid blob store name");
    const matches = declarations.filter((declaration) => declaration.store === store);
    if (matches.length === 0) {
      throw new BlobError("undeclared", `This pack does not declare a blob store named ${store}.`);
    }
    if (matches.length > 1) {
      throw new BlobError(
        "invalid",
        `This pack declares the blob store ${store} more than once, so the host cannot choose its class.`,
      );
    }
    const declaration = matches[0];
    if (declaration === undefined || !BLOB_CLASSES.includes(declaration.class)) {
      throw new BlobError("invalid", `The blob store ${store} declares no known class.`);
    }
    return declaration;
  }

  #file(scope: BlobScope, declaration: PackBlob, sha256: string): string {
    if (!SHA256.test(sha256)) throw new BlobError("invalid", "invalid blob address");
    return join(this.#packRoot(scope), declaration.class, sha256);
  }

  /** Store bytes under their own SHA-256. Writing the same bytes twice is one blob. */
  async put(
    scope: BlobScope,
    declarations: readonly PackBlob[],
    store: string,
    bytes: Uint8Array,
  ): Promise<BlobEntry> {
    if (!(bytes instanceof Uint8Array)) throw new BlobError("invalid", "a blob is bytes");
    const declaration = this.#declaration(declarations, store);
    const sha256 = checksum(bytes);
    const file = this.#file(scope, declaration, sha256);
    try {
      await mkdir(join(this.#packRoot(scope), declaration.class), { recursive: true });
      await this.#writeAtomically(file, bytes);
    } catch (error) {
      if (error instanceof BlobError) throw error;
      throw logged("the blob could not be stored", error);
    }
    return { store, class: declaration.class, sha256, bytes: bytes.byteLength };
  }

  /**
   * Read a blob, or `null` when it is not there.
   *
   * The bytes are hashed again on the way out. A file that no longer matches its
   * address is refused rather than returned, so a damaged cache or a partial
   * copy cannot masquerade as the content the pack stored.
   */
  async get(
    scope: BlobScope,
    declarations: readonly PackBlob[],
    store: string,
    sha256: string,
  ): Promise<BlobContents | null> {
    const declaration = this.#declaration(declarations, store);
    const file = this.#file(scope, declaration, sha256);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(file));
    } catch (error) {
      if (fsCode(error) === "ENOENT") return null;
      throw logged("the blob could not be read", error);
    }
    if (checksum(bytes) !== sha256) {
      throw new BlobError("corrupt", "This blob does not match its address, so it was not read.");
    }
    return {
      store,
      class: declaration.class,
      sha256,
      bytes: bytes.byteLength,
      data: bytes,
    };
  }

  /** Every blob in one declared store, sorted by address. */
  async list(
    scope: BlobScope,
    declarations: readonly PackBlob[],
    store: string,
  ): Promise<readonly BlobEntry[]> {
    const declaration = this.#declaration(declarations, store);
    const directory = join(this.#packRoot(scope), declaration.class);
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (fsCode(error) === "ENOENT") return [];
      throw logged("blobs could not be listed", error);
    }

    const found: BlobEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !SHA256.test(entry.name)) continue;
      try {
        const details = await lstat(join(directory, entry.name));
        if (!details.isFile()) continue;
        found.push({
          store,
          class: declaration.class,
          sha256: entry.name,
          bytes: details.size,
        });
      } catch (error) {
        if (fsCode(error) === "ENOENT") continue;
        throw logged("blobs could not be listed", error);
      }
    }
    return found.sort((left, right) => left.sha256.localeCompare(right.sha256));
  }

  /**
   * Drop the whole `cache` store for a pack and report how many blobs went.
   *
   * Clearing cache is always safe by declaration: no asset or derived blob is
   * stored under this class, so losing it loses nothing the person made.
   */
  async clearCache(scope: BlobScope, declarations: readonly PackBlob[]): Promise<number> {
    // Validate every declaration before removing anything, so a bad declaration
    // cannot leave a half-cleared store.
    for (const declaration of declarations) {
      if (!BLOB_CLASSES.includes(declaration.class)) {
        throw new BlobError(
          "invalid",
          `The blob store ${declaration.store} declares no known class.`,
        );
      }
    }
    const directory = join(this.#packRoot(scope), "cache");
    let count = 0;
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      count = entries.filter((entry) => entry.isFile() && SHA256.test(entry.name)).length;
    } catch (error) {
      if (fsCode(error) !== "ENOENT") throw logged("the cache could not be cleared", error);
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      throw logged("the cache could not be cleared", error);
    }
    return count;
  }

  /** Temporary file, flush, rename. The same durability rule as a document write. */
  async #writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
    const temporary = `${file}${TEMPORARY_INFIX}${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporary, "w");
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, file);
    } catch (error) {
      if (handle !== null) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
