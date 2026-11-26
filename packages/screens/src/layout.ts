import type { SuiteWidgetSize } from "@suite/contracts";
import { isScreenRow, type Screen, type ScreenEntry } from "./screen.js";

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

/** The wide layout is a two-column grid; a row spans it by its size class. */
export const SCREEN_LAYOUT_COLUMNS = 2;

export interface ScreenLayoutViewport {
  readonly width: number;
}

export interface ScreenWidgetLayout {
  readonly kind: "widget";
  readonly index: number;
  readonly registryId: string;
  readonly size: SuiteWidgetSize;
  /** Grid columns out of `SCREEN_LAYOUT_COLUMNS`; always 1 on a narrow window. */
  readonly span: 1 | 2;
}

export interface ScreenRowItemLayout {
  readonly registryId: string;
  readonly weight: number;
  /** The item's share of the row on a wide window, as a percentage. */
  readonly basis: string;
}

export interface ScreenRowPlacement {
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
  readonly columns: 1 | 2;
  readonly narrow: boolean;
  readonly entries: readonly ScreenEntryLayout[];
}

function spanFor(size: SuiteWidgetSize, narrow: boolean): 1 | 2 {
  if (narrow || size === "1x1") return 1;
  return 2;
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
  const entries = screen.widgets.map((entry, index): ScreenEntryLayout => {
    if (isScreenRow(entry)) {
      return {
        kind: "row",
        index,
        size: entry.size,
        mode: rowMode(entry, narrow),
        items: rowItems(entry),
      };
    }
    return {
      kind: "widget",
      index,
      registryId: entry.registryId,
      size: entry.size,
      span: spanFor(entry.size, narrow),
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
        ...(item.settings === undefined ? {} : { settings: item.settings }),
      });
    }
  }
  return entries;
}
