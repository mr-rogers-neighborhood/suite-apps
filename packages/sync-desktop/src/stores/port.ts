/**
 * The bytes a sync store keeps, behind one small port.
 *
 * The Electron hosts write these files with `node:fs`; a pack writes them through its own
 * `files` root, which the host writes atomically. The store formats — group, cursor, pending
 * join, relay pin, contacts — stay in one place either way. A path here is relative to the
 * root the caller supplies and never leaves it.
 */
export interface SyncStoreFiles {
  /** The file's bytes, or null when it does not exist. A damaged file is the caller's to judge. */
  read(path: string): Promise<Uint8Array | null>;
  /** Replace the file. The implementation owns atomicity and parent directories. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Remove the file if it exists. */
  remove(path: string): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeStoreText(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeStoreText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** The relative paths every desktop app already uses, rooted at its own data directory. */
export const SYNC_STORE_ROOT = "sync";
