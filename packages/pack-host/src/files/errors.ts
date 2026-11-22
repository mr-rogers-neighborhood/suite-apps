/**
 * Filesystem failures a pack may see.
 *
 * Messages are deliberately generic. Node's own errors carry absolute paths; the
 * host logs those and hands the pack a code it can act on.
 */
export type FileStoreErrorCode =
  | "invalid-path"
  | "outside-root"
  | "symlink"
  | "not-found"
  | "not-a-file"
  | "not-a-directory"
  | "too-large"
  | "conflict"
  | "locked"
  | "exists"
  | "io";

export class FileStoreError extends Error {
  readonly code: FileStoreErrorCode;

  constructor(code: FileStoreErrorCode, message: string) {
    super(message);
    this.name = "FileStoreError";
    this.code = code;
  }
}
