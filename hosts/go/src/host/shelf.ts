import type { CatalogueEntry } from "./catalogue.js";

/**
 * Home's shadow shelf and its installed section.
 *
 * A shadow is an app the verified index offers but this phone has not installed.
 * The split is generic: it asks `installedVersion`, never an id, and keeps the
 * index's order (`order`) rather than inventing a host-owned one. That is what
 * lets a publisher put an app first without the shell naming the app.
 */
export interface Shelf {
  /** Not installed, in the index's order. */
  readonly shadows: readonly CatalogueEntry[];
  /** Installed, in the index's order. */
  readonly installed: readonly CatalogueEntry[];
}

export function shelfFrom(entries: readonly CatalogueEntry[]): Shelf {
  const ordered = [...entries].sort((left, right) => left.order - right.order);
  return {
    shadows: ordered.filter((entry) => entry.installedVersion === null),
    installed: ordered.filter((entry) => entry.installedVersion !== null),
  };
}

/**
 * The row's visible action, keeping "not available on this phone" ahead of the
 * install verbs: a disabled Install would imply the pack could run.
 */
export type ShelfAction = "install" | "update" | "reinstall" | "installed" | "unavailable";

export function shelfAction(entry: CatalogueEntry): ShelfAction {
  if (entry.platform.state === "unavailable") return "unavailable";
  if (entry.action === "current") return "installed";
  return entry.action;
}

/** One line for a shadow card: what it does, or that it asks for nothing. */
export function shelfSummary(entry: CatalogueEntry): string {
  if (entry.description !== null && entry.description.length > 0) return entry.description;
  if (entry.capabilities.length === 0) return "Asks for nothing.";
  return `Uses ${entry.capabilities.join(", ")}.`;
}
