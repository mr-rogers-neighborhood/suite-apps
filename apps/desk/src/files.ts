import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isSafePublisherId } from "@suite/pack/trust";
import { FileStoreError, PackFileStore, type RemoveOptions } from "@suite/pack-host";
import type { FileEntry, FileReadOptions, FileWriteOptions } from "@suite/pack-runtime";
import { isSafeContainerId } from "./container.js";
import { FIRST_PARTY_PUBLISHER_ID, packStorageKey } from "./packIdentity.js";
import { isSafePackId, packAllows } from "./packs.js";
import type { PackCapability } from "./shared.js";

/**
 * A pack's scoped files, keyed by the sender the host already resolved.
 *
 * One `PackFileStore` exists per `(container, publisher, pack)`, opened lazily on
 * first use under the host-owned `<dataRoot>/files/<container>/<segment>` root.
 * The store is not part of the pack's code root, so reinstalling a pack never
 * touches the person's data, and a different publisher under the same id gets a
 * different segment and therefore inherits nothing (S2.2).
 *
 * Nothing here imports Electron. The main process supplies a sender; this module
 * decides whether that sender declared `files`, maps it to a store, and owns the
 * lock tokens. The lock owner is the tab id, so destroying a view can release
 * everything that view held.
 */
export interface FilesSender {
  readonly containerId: string;
  readonly packId: string;
  readonly tabId: string;
  readonly pack: {
    readonly capabilities: readonly PackCapability[];
    readonly publisher?: { readonly id: string } | null;
  };
}

export interface FilesScope {
  readonly containerId: string;
  readonly publisherId: string;
  readonly packId: string;
  readonly owner: string;
}

/**
 * The scope a sender may use, or `null` when it declared no `files`.
 *
 * This is the one place the capability gate lives, so a channel that forgets to
 * check still cannot reach a store. A development pack has no publisher and
 * keeps the first-party segment.
 */
export function filesScope(sender: FilesSender): FilesScope | null {
  if (!isSafeContainerId(sender.containerId) || !isSafePackId(sender.packId)) return null;
  if (sender.tabId.length === 0) return null;
  if (!packAllows(sender.pack, "files")) return null;
  const publisherId = sender.pack.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID;
  if (!isSafePublisherId(publisherId)) return null;
  return {
    containerId: sender.containerId,
    publisherId,
    packId: sender.packId,
    owner: sender.tabId,
  };
}

/** What `lock` returns to the main process. The preload turns it into a `FileLock`. */
export interface IssuedFileLock {
  readonly token: string;
  readonly path: string;
}

/**
 * Whether a navigation replaces the page that held a tab's locks.
 *
 * A main-frame, non-same-document navigation discards the old document, and with
 * it the live page that held the tokens: a reload and a same-origin link both
 * qualify. A hash change or `pushState` keeps the page and its locks, and a
 * subframe never owns them.
 */
export function navigationReleasesLocks(isMainFrame: boolean, isSameDocument: boolean): boolean {
  return isMainFrame && !isSameDocument;
}

interface HeldLock {
  readonly key: string;
  readonly owner: string;
  readonly release: () => Promise<void>;
}

function scopeKey(scope: FilesScope): string {
  if (!isSafeContainerId(scope.containerId) || !isSafePackId(scope.packId)) {
    throw new FileStoreError("invalid-path", "invalid file scope");
  }
  if (!isSafePublisherId(scope.publisherId)) {
    throw new FileStoreError("invalid-path", "invalid file scope");
  }
  return `${scope.containerId}:${scope.publisherId}:${scope.packId}`;
}

export class PackFilesService {
  readonly #root: string;
  readonly #stores = new Map<string, Promise<PackFileStore>>();
  readonly #locks = new Map<string, HeldLock>();

  constructor(root: string) {
    this.#root = root;
  }

  async list(scope: FilesScope, path = ""): Promise<readonly FileEntry[]> {
    return (await this.#store(scope)).list(path);
  }

  async stat(scope: FilesScope, path: string): Promise<FileEntry | null> {
    return (await this.#store(scope)).stat(path);
  }

  async mkdir(scope: FilesScope, path: string): Promise<void> {
    await (await this.#store(scope)).mkdir(path);
  }

  async read(scope: FilesScope, path: string, options?: FileReadOptions): Promise<Uint8Array> {
    return (await this.#store(scope)).read(path, options);
  }

  async write(
    scope: FilesScope,
    path: string,
    bytes: Uint8Array,
    options?: FileWriteOptions,
  ): Promise<FileEntry> {
    return (await this.#store(scope)).write(path, bytes, options);
  }

  async rename(scope: FilesScope, from: string, to: string): Promise<void> {
    await (await this.#store(scope)).rename(from, to);
  }

  async remove(scope: FilesScope, path: string, options?: RemoveOptions): Promise<void> {
    await (await this.#store(scope)).remove(path, options);
  }

  async backup(scope: FilesScope, path: string): Promise<string> {
    return (await this.#store(scope)).backup(path);
  }

  async lock(scope: FilesScope, path: string): Promise<IssuedFileLock> {
    const key = scopeKey(scope);
    const store = await this.#store(scope);
    const lock = store.lock(path, scope.owner);
    const token = randomUUID();
    this.#locks.set(token, { key, owner: scope.owner, release: lock.release });
    return { token, path };
  }

  /**
   * Release a token, but only for the tab that took it.
   *
   * An unknown token, or one held by another tab or pack, is ignored. That keeps
   * a guessed token from becoming a way to drop another view's writer.
   */
  async unlock(scope: FilesScope, token: string): Promise<void> {
    const held = this.#locks.get(token);
    if (held === undefined) return;
    if (held.owner !== scope.owner || held.key !== scopeKey(scope)) return;
    this.#locks.delete(token);
    await held.release();
  }

  /** Called when a view is destroyed. The tab id is the lock owner. */
  releaseOwner(owner: string): void {
    for (const [token, held] of this.#locks) {
      if (held.owner !== owner) continue;
      this.#locks.delete(token);
      void held.release().catch(() => undefined);
    }
    for (const opening of this.#stores.values()) {
      void opening.then((store) => store.releaseAll(owner)).catch(() => undefined);
    }
  }

  #store(scope: FilesScope): Promise<PackFileStore> {
    const key = scopeKey(scope);
    const existing = this.#stores.get(key);
    if (existing !== undefined) return existing;

    const opening = PackFileStore.open(
      join(this.#root, scope.containerId, packStorageKey(scope.publisherId, scope.packId)),
    );
    this.#stores.set(key, opening);
    void opening.catch(() => {
      this.#stores.delete(key);
    });
    return opening;
  }
}
