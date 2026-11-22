import type { FileLock } from "@suite/pack-runtime";
import { FileStoreError } from "./errors.js";

/**
 * One writer per path, in this host process.
 *
 * The shell is single-instance, so an in-memory table is the whole lock. A lock
 * is released explicitly or when the owning view is destroyed. A stale lock
 * cannot outlive the process; a document lock is not a cross-process file lock.
 */
export class LockTable {
  readonly #held = new Map<string, string>();

  acquire(path: string, owner = "pack"): FileLock {
    if (this.#held.has(path)) {
      throw new FileStoreError("locked", "file is locked");
    }
    this.#held.set(path, owner);

    let released = false;
    return {
      path,
      release: async () => {
        if (released) return;
        released = true;
        if (this.#held.get(path) === owner) this.#held.delete(path);
      },
    };
  }

  releaseAll(owner: string): void {
    for (const [path, holder] of this.#held) {
      if (holder === owner) this.#held.delete(path);
    }
  }

  isLocked(path: string): boolean {
    return this.#held.has(path);
  }

  get size(): number {
    return this.#held.size;
  }
}
