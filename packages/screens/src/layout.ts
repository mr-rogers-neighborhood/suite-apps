import type { SuiteWidgetSize } from "@suite/contracts";
import {
  isScreenRow,
  SCREEN_GRID_COLUMNS,
  type Screen,
  type ScreenEntry,
  sizeCells,
} from "./screen.js";

/**
 * The Screen's responsive composition, without a DOM.
 *
 * A host draws the same document on a wide window and a phone. The document owns the
 * order, the size class and each row's weights; this module turns those facts into a
 * layout a renderer can follow. It never reads a registry or pack code.
 *
 * The phone rule is deliberate: a row never squeezes two widgets into half width.
 * Below `SCREEN_LAYOUT_NARROW_WIDTH` every row becomes one horizontal, snapping line;
 * a row of two keeps readable cards and the person scrolls or pages between them.
 */

/** The width below which the host uses one column and scrolls rows. */
export const SCREEN_LAYOUT_NARROW_WIDTH = 760;

/** The wide layout is the document's four-cell grid; a row spans it by its size. */
export const SCREEN_LAYOUT_COLUMNS = SCREEN_GRID_COLUMNS;

export interface ScreenLayoutViewport {
  readonly width: number;
}

/** Where one entry sits, in grid cells, before the phone fallback. */
export interface ScreenPlacementCells {
  readonly x: number;
  readonly y: number;
  /** Cells wide on a wide window; always 1 on a narrow window. */
  readonly w: number;
  /** Cells tall on a wide window; always 1 on a narrow window. */
  readonly h: number;
}

export interface ScreenWidgetLayout extends ScreenPlacementCells {
  readonly kind: "widget";
  readonly index: number;
  readonly registryId: string;
  readonly size: SuiteWidgetSize;
  /** `w`, kept as the name older renderers read. */
  readonly span: number;
}

export interface ScreenRowItemLayout {
  readonly registryId: string;
  readonly weight: number;
  /** The item's share of the row on a wide window, as a percentage. */
  readonly basis: string;
}

export interface ScreenRowPlacement extends ScreenPlacementCells {
  readonly kind: "row";
  readonly index: number;
  readonly size: SuiteWidgetSize;
  /**
   * `wrap` shares the width by weight; `scroll` is one horizontal line. A narrow
   * window turns a `wrap` row into `scroll` rather than a squeeze.
   */
  readonly mode: "wrap" | "scroll";
  readonly items: readonly ScreenRowItemLayout[];
}

export type ScreenEntryLayout = ScreenWidgetLayout | ScreenRowPlacement;

export interface ScreenLayout {
  readonly columns: 1 | typeof SCREEN_GRID_COLUMNS;
  readonly narrow: boolean;
  readonly entries: readonly ScreenEntryLayout[];
}

function rowMode(entry: ScreenEntry, narrow: boolean): "wrap" | "scroll" {
  if (!isScreenRow(entry)) return "wrap";
  if (entry.layout === "carousel") return "scroll";
  return narrow ? "scroll" : "wrap";
}

function rowItems(entry: ScreenEntry): readonly ScreenRowItemLayout[] {
  if (!isScreenRow(entry)) return [];
  const total = entry.items.reduce((sum, item) => sum + item.weight, 0);
  return entry.items.map((item) => ({
    registryId: item.registryId,
    weight: item.weight,
    basis: `${((item.weight / total) * 100).toFixed(4)}%`,
  }));
}

/** Lay out one Screen for a window width. Pure: it never mutates the document. */
export function screenLayout(screen: Screen, viewport: ScreenLayoutViewport): ScreenLayout {
  const narrow = viewport.width < SCREEN_LAYOUT_NARROW_WIDTH;
  const columns = narrow ? 1 : SCREEN_LAYOUT_COLUMNS;
  // Visual order on a wide window is the grid, not the document array: an entry may
  // have been moved to an earlier row. `index` keeps its document identity.
  const ordered = screen.widgets
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.y - b.entry.y || a.entry.x - b.entry.x || a.index - b.index);
  const entries = ordered.map(({ entry, index }): ScreenEntryLayout => {
    const cells = sizeCells(entry.size);
    const placement = {
      x: narrow ? 0 : entry.x,
      y: narrow ? 0 : entry.y,
      w: narrow ? 1 : cells.w,
      h: narrow ? 1 : cells.h,
    };
    if (isScreenRow(entry)) {
      return {
        ...placement,
        kind: "row",
        index,
        size: entry.size,
        mode: rowMode(entry, narrow),
        items: rowItems(entry),
      };
    }
    return {
      ...placement,
      kind: "widget",
      index,
      registryId: entry.registryId,
      size: entry.size,
      span: placement.w,
    };
  });

  return { columns, narrow, entries };
}

/**
 * A host that cannot draw a row still shows every placement, stacked, with a note.
 *
 * This is the fallback the contract promises: nothing disappears because one build
 * lacks the row primitive. The children keep their order and settings.
 */
export function flattenScreenEntries(screen: Screen): readonly ScreenEntry[] {
  const entries: ScreenEntry[] = [];
  for (const entry of screen.widgets) {
    if (!isScreenRow(entry)) {
      entries.push(entry);
      continue;
    }
    for (const item of entry.items) {
      entries.push({
        registryId: item.registryId,
        size: entry.size,
        x: entry.x,
        y: entry.y,
        ...(item.settings === undefined ? {} : { settings: item.settings }),
      });
    }
  }
  return entries;
}
