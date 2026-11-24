/**
 * Retention for the exports a `--fresh` gate run leaves behind.
 *
 * `scripts/gate.mjs` exports `HEAD` into `.suite-gate/<repo>/<sha>` beside the
 * checkout and installs a full dependency tree there. Each export is about
 * 1.6 GB, and because the directory is scratch space nothing used to delete an
 * older one, so a parallel round of reviews multiplied it. This file keeps the
 * evidence and drops the rest.
 *
 * Only directories named exactly like a commit sha are exports. A tarball, a
 * lockfile, a note, or anything else a person put in the directory is left
 * alone: the helper prunes what the gate created, not the whole directory.
 *
 * The export in use is never a candidate, even if its mtime is older than the
 * others — that is the tree this run proved, and deleting it mid-run would turn
 * a green proof into a missing directory.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * How many exports a passing run keeps: the one it just proved, plus the
 * previous proof. Two is enough to compare this commit's export with the one
 * before it; a third would only cost another 1.6 GB.
 */
export const KEEP_EXPORTS = 2;

/** A short or full git object name, and nothing else. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/iu;

/**
 * Remove every export in `gateDir` except the newest `keep` and the one in use.
 *
 * Returns the paths it removed, in newest-first order, so a caller can report
 * what happened without walking the directory again. A missing `gateDir` is
 * normal on a first run and returns an empty list.
 */
export function pruneGateExports(gateDir, inUse, keep = KEEP_EXPORTS) {
  let entries;
  try {
    entries = readdirSync(gateDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const exports = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !COMMIT_SHA.test(entry.name)) continue;
    try {
      exports.push({
        name: entry.name,
        mtime: statSync(join(gateDir, entry.name)).mtimeMs,
      });
    } catch {
      // The entry vanished between readdir and stat: nothing left to prune.
    }
  }

  exports.sort((left, right) => right.mtime - left.mtime);

  const keepNames = new Set(
    exports.slice(0, Math.max(0, keep)).map((entry) => entry.name),
  );
  if (inUse) keepNames.add(basename(resolve(inUse)));

  const removed = [];
  for (const entry of exports) {
    if (keepNames.has(entry.name)) continue;
    const path = join(gateDir, entry.name);
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
}
