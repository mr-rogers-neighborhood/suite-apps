import { join, resolve, sep } from "node:path";
import { FileStoreError } from "./errors.js";
import { assertRelativePath } from "./rules.js";

export { assertRelativePath, isSafeRelativePath } from "./rules.js";

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
