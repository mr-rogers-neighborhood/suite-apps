/** Compare dotted versions for the chooser; an unreadable segment sorts low. */
export function compareVersions(left, right) {
  const a = String(left).split(/[.+-]/u);
  const b = String(right).split(/[.+-]/u);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const one = Number.parseInt(a[index] ?? "0", 10);
    const two = Number.parseInt(b[index] ?? "0", 10);
    const first = Number.isFinite(one) ? one : 0;
    const second = Number.isFinite(two) ? two : 0;
    if (first !== second) return first < second ? -1 : 1;
  }
  return 0;
}

/**
 * Reduce catalogue entries to at most one entry per uninstalled pack id,
 * keeping the highest version according to `compareVersions`.
 */
export function highestCatalogueEntries(catalogue, installedIds) {
  const byId = new Map();
  for (const entry of catalogue ?? []) {
    if (installedIds.has(entry.id)) continue;
    const kept = byId.get(entry.id);
    if (kept === undefined || compareVersions(entry.version, kept.version) > 0) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

/**
 * Find the highest-version trusted catalogue entry for `pack.id` that is
 * strictly newer than `pack.version`, or `undefined` if none exists.
 */
export function highestTrustedUpdate(catalogue, pack) {
  let best;
  for (const entry of catalogue ?? []) {
    if (entry.id !== pack.id || !entry.trusted || entry.platform?.state === "unavailable") continue;
    if (best === undefined || compareVersions(entry.version, best.version) > 0) {
      best = entry;
    }
  }
  if (best === undefined) return undefined;
  return compareVersions(best.version, pack.version) > 0 ? best : undefined;
}
