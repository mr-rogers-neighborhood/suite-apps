import { join, resolve, sep } from "node:path";
import { FileStoreError } from "./errors.js";

/**
 * A path inside one pack's root.
 *
 * Relative, slash-separated, no `.` or `..`, no backslash, no control
 * characters, no leading slash. `""` names the root itself and is accepted only
 * by the operations that can mean it.
 */
const MAX_PATH_LENGTH = 1024;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function isSafeRelativePath(value: string, allowRoot = false): boolean {
  if (value.length === 0) return allowRoot;
  if (value.length > MAX_PATH_LENGTH) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (CONTROL_CHARACTER.test(value)) return false;
  return value
    .split("/")
    .every(
      (segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\"),
    );
}

export function assertRelativePath(value: string, allowRoot = false): void {
  if (!isSafeRelativePath(value, allowRoot)) {
    throw new FileStoreError("invalid-path", "invalid path");
  }
}

/** Lexically resolve a relative path under a root. Never follows a symlink. */
export function resolveInside(root: string, relative: string): string {
  assertRelativePath(relative, true);
  const candidate = relative.length === 0 ? root : join(root, ...relative.split("/"));
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(boundary)) {
    throw new FileStoreError("outside-root", "path is outside the pack");
  }
  return candidate;
}

export function isInside(realPath: string, realRoot: string): boolean {
  const boundary = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  return realPath === realRoot || realPath.startsWith(boundary);
}

/** The absolute root, normalised, for the caller's own use (never sent to a pack). */
export function normaliseRoot(root: string): string {
  return resolve(root);
}
