import type { FilesService } from "@suite/pack-runtime";
import {
  decodeStoreText,
  encodeStoreText,
  type SyncStoreFiles,
} from "@suite/sync-desktop/relay";

export { decodeStoreText, encodeStoreText };
export type { SyncStoreFiles };

/**
 * The pack's sync files, in its own `files` root.
 *
 * The host's file service is already a scoped filesystem: relative paths, host-owned atomic
 * writes, no path that leaves the pack. A relay pin, a group, a cursor, the pending join and
 * contacts are exactly the kind of small file it holds, so the shared stores write them there
 * instead of in `localStorage` — which the host clears, cannot be backed up, and is not where a
 * key belongs.
 *
 * A missing file is null. Everything else is a real failure and travels up: a store that
 * silently treated an I/O error as "nothing saved" would make a lost group look like a new one.
 */
export function packStoreFiles(files: FilesService): SyncStoreFiles {
  return {
    async read(path) {
      try {
        return await files.read(path);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async write(path, bytes) {
      // The host's default is an atomic temporary-and-rename, which is what the Node port
      // does too. Stating it keeps the guarantee if a host ever changes its default.
      await files.write(path, bytes, { atomic: true });
    },

    async remove(path) {
      try {
        await files.remove(path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /not.?found|ENOENT/iu.test(error.message);
}
