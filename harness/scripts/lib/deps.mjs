import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A shared dependency has to be one version across the suite.
 *
 * `loro-crdt` is the one that matters: a document written by one release is read by the other, and
 * the two halves of the suite are released on different afternoons. A drift here does not fail a
 * build, it shows up as a document that will not open on the other machine — so the check belongs
 * where a person already looks before running anything, not in a footnote of a design document.
 *
 * Only declared specifiers are read. What is installed is a lockfile question; what a repository
 * *asks* for is the thing that drifts.
 */

/** Folders that are never a package a person edits. */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  "reports",
  "coverage",
  "release",
  ".git",
  ".turbo",
  ".worktrees",
  ".dev",
]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/** Every `package.json` under `dir`, without descending into build output or a checkout copy. */
export function packageManifestPaths(dir, depth = 3) {
  if (depth < 0) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED.has(entry.name)) continue;
      found.push(...packageManifestPaths(path, depth - 1));
      continue;
    }
    if (entry.name === "package.json") found.push(path);
  }
  return found.sort();
}

/**
 * Every declared specifier for `name` under `dir`.
 *
 * A manifest that cannot be read is skipped rather than thrown: this feeds a diagnostic, and a
 * diagnostic that crashes on the thing it is diagnosing is worse than one row short.
 */
export function readDependencySpecs(dir, name, depth = 3) {
  const found = [];
  for (const path of packageManifestPaths(dir, depth)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    for (const field of DEPENDENCY_FIELDS) {
      const spec = manifest?.[field]?.[name];
      if (typeof spec === "string") found.push({ file: path, field, spec });
    }
  }
  return found;
}

/**
 * Do these declarations agree?
 *
 * One distinct specifier is agreement; zero is "nobody asks for it", which is not a failure.
 */
export function versionDrift(entries) {
  const specs = [...new Set(entries.map((entry) => entry.spec))].sort();
  return { ok: specs.length <= 1, specs, entries };
}

/** Cheap existence probe so a caller can avoid a walk it does not need. */
export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
