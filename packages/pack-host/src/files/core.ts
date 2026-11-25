/**
 * The pack-file rules a host can use without a filesystem.
 *
 * `PackFileStore` is Node-backed: it imports `node:fs/promises` and cannot be
 * bundled into a WebView. This entry carries the parts that are pure — the path
 * rule, the error vocabulary, the lock table and the byte cap — so another host
 * (Suite Go's Capacitor store) enforces the same refusals without copying them.
 * Nothing reachable from here imports a Node built-in.
 */
export { FileStoreError, type FileStoreErrorCode } from "./errors.js";
export { PACK_FILE_MAX_BYTES } from "./limits.js";
export { LockTable } from "./lock.js";
export { assertRelativePath, isSafeRelativePath, joinUnderRoot } from "./rules.js";
