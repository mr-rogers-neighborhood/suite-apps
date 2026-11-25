import { FileStoreError } from "./errors.js";

/**
 * The path rule every host enforces before it touches a filesystem.
 *
 * Deliberately free of `node:path` so a host that is not Node — the Android
 * WebView, a test double — can import this file and refuse the same paths a
 * desktop does. A path is relative, slash-separated, and names segments a
 * filesystem resolves without a symlink, a device or a climb:
 *
 * - no absolute prefix (`/`, `\`, a drive letter);
 * - no `.` or `..` segment, so lexical resolution cannot leave the root;
 * - no backslash, because on Windows it is a separator and here it is not;
 * - no control character, which some platforms truncate at.
 *
 * `""` names the root itself and is accepted only where an operation means it.
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

/**
 * Join a validated relative path under a host-owned prefix.
 *
 * The slash form is the one every host can use: a Node root uses the platform
 * separator itself, while Capacitor's Filesystem paths are always `/`. The join
 * never resolves `..` because `assertRelativePath` already refused one; it is
 * concatenation, not a path resolver.
 */
export function joinUnderRoot(root: string, value: string, allowRoot = false): string {
  assertRelativePath(value, allowRoot);
  if (value.length === 0) return root;
  const trimmed = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${trimmed}/${value}`;
}
