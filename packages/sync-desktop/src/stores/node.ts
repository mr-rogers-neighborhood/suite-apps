import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SyncStoreFiles } from "./port.js";

/**
 * The Node implementation of the store port, rooted at an app's data directory.
 *
 * A write goes through a temporary sibling and is renamed over the target, with mode 0600:
 * half a group is not a group, and a private key is not shared with the account's other
 * users. This is the path both Electron hosts already used, kept byte-for-byte in layout.
 */
export function createNodeStoreFiles(dataDir: string): SyncStoreFiles {
  const absolute = (path: string): string => join(dataDir, path);

  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(absolute(path)));
      } catch {
        return null;
      }
    },

    async write(path, bytes) {
      const target = absolute(path);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
    },

    async remove(path) {
      await rm(absolute(path), { force: true });
    },
  };
}
