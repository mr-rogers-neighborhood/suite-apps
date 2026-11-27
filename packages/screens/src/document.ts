import {
  type SuiteWidgetSize,
  splitWidgetRegistryId,
  suiteWidgetIdSchema,
  suiteWidgetSizeSchema,
} from "@suite/contracts";
import { LoroDoc, type LoroMap } from "loro-crdt";
import { migrateScreen } from "./migration.js";
import {
  isScreenRow,
  findFreePlacement,
  parseScreen,
  type Screen,
  type ScreenEntry,
  type ScreenParse,
  type ScreenRefusal,
  SCREEN_GRID_COLUMNS,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  type SuiteScreenRow,
  type SuiteScreenWidget,
  screenCorruption,
  sizeCells,
  suiteScreenRowSchema,
  suiteScreenWidgetSchema,
} from "./screen.js";

/**
 * The Loro half of a Screen.
 *
 * The host owns the file: it reads the bytes, calls `ScreenDocument.open`, and writes
 * `export()` through its own atomic writer. This module never touches a path, a clock or
 * the filesystem, which is what lets the desktop host and a test share it.
 *
 * The document is three containers:
 *
 * - `screen` is the header map: format, version, id and name.
 * - `order` is the ordered list of entry keys. Order is the Screen's own fact, not a
 *   sort of the map.
 * - `widgets` is a map keyed by entry key. A flat widget uses its registry id; a row
 *   uses an internal `#row-` key so its child registry ids remain the ids in the
 *   Screen. A row's items are a nested array; a row never contains another row.
 *
 * A registry id this build cannot resolve is an ordinary entry. Nothing here asks a
 * registry whether an id is known, so an unknown widget and its unknown settings survive
 * every mutation and every snapshot.
 */

const HEADER = "screen";
const ORDER = "order";
const WIDGETS = "widgets";
const SETTINGS = "settings";
const ROW_PREFIX = "#row-";
const MAX_SETTING_LENGTH = 500;

/** Where one instance goes relative to another. */
export type ScreenPlacement = { readonly before: string } | { readonly after: string };

/** A new flat widget: the host may omit where it goes, and the document finds a cell. */
export type NewScreenWidget = Omit<SuiteScreenWidget, "x" | "y"> & {
  readonly x?: number;
  readonly y?: number;
};

/** A new row: the same free-cell rule as a flat widget. */
export type NewScreenRow = Omit<SuiteScreenRow, "x" | "y"> & {
  readonly x?: number;
  readonly y?: number;
};

export type ScreenDocumentOpen =
  | {
      readonly ok: true;
      readonly document: ScreenDocument;
      /** The version the snapshot arrived with. */
      readonly fromVersion: number;
    }
  | ScreenRefusal;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScreenRefusal(value: unknown): value is ScreenRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false
  );
}

type ScreenRead =
  | { readonly ok: true; readonly screen: Screen; readonly fromVersion: number }
  | ScreenRefusal;

function readEntry(key: string, entry: unknown): ScreenEntry | ScreenRefusal {
  if (!isRecord(entry)) {
    return screenCorruption(`The screen document lists ${key} but has no entry for it.`);
  }

  if (entry.kind !== undefined && entry.kind !== "row") {
    return screenCorruption(`The screen document has an unknown entry kind at ${key}.`);
  }

  if (entry.kind === "row") {
    const items = Array.isArray(entry.items)
      ? entry.items.map((item) => {
          if (!isRecord(item)) return item;
          const widget: Record<string, unknown> = {
            registryId: item.registryId,
            weight: item.weight,
          };
          if (SETTINGS in item) widget.settings = item.settings;
          return widget;
        })
      : entry.items;
    return {
      kind: "row",
      size: entry.size,
      x: entry.x,
      y: entry.y,
      layout: entry.layout ?? "row",
      items,
    } as unknown as SuiteScreenRow;
  }

  const widget: Record<string, unknown> = {
    registryId: key,
    size: entry.size,
    x: entry.x,
    y: entry.y,
  };
  if (SETTINGS in entry) widget.settings = entry[SETTINGS];
  return widget as unknown as SuiteScreenWidget;
}

function readScreen(doc: LoroDoc): ScreenRead {
  const raw: unknown = doc.toJSON();
  if (!isRecord(raw)) return screenCorruption("The screen document has no readable state.");

  const header = raw[HEADER];
  const order = raw[ORDER];
  const table = raw[WIDGETS];
  if (!isRecord(header) || !Array.isArray(order) || !isRecord(table)) {
    return screenCorruption("The screen document is missing its header, order or widget table.");
  }

  const widgets: ScreenEntry[] = [];
  for (const key of order) {
    if (typeof key !== "string") {
      return screenCorruption("The screen document has a non-text entry in its order.");
    }
    const entry = readEntry(key, table[key]);
    if (isScreenRefusal(entry)) return entry;
    widgets.push(entry);
  }

  const migrated = migrateScreen({
    format: header.format,
    version: header.version,
    id: header.id,
    name: header.name,
    widgets,
  });
  if (!migrated.ok) return migrated;

  const parsed: ScreenParse = parseScreen(migrated.value);
  if (!parsed.ok) return parsed;
  return { ok: true, screen: parsed.value, fromVersion: migrated.fromVersion };
}

function writeWidget(table: LoroMap, widget: SuiteScreenWidget): void {
  const entry = table.ensureMergeableMap(widget.registryId);
  entry.set("size", widget.size);
  entry.set("x", widget.x);
  entry.set("y", widget.y);
  const settings = widget.settings;
  if (settings !== undefined && Object.keys(settings).length > 0) {
    const values = entry.ensureMergeableMap(SETTINGS);
    for (const [key, value] of Object.entries(settings)) values.set(key, value);
  }
}

function writeRow(table: LoroMap, key: string, row: SuiteScreenRow): void {
  const entry = table.ensureMergeableMap(key);
  entry.set("kind", "row");
  entry.set("size", row.size);
  entry.set("x", row.x);
  entry.set("y", row.y);
  entry.set("layout", row.layout);
  entry.set(
    "items",
    row.items.map((item) => ({
      registryId: item.registryId,
      weight: item.weight,
      ...(item.settings === undefined ? {} : { settings: item.settings }),
    })),
  );
}

export class ScreenDocument {
  readonly #doc: LoroDoc;

  private constructor(doc: LoroDoc) {
    this.#doc = doc;
  }

  /** Create a document from an already parsed Screen. */
  static create(initial: Screen): ScreenDocument {
    const doc = new LoroDoc();
    const header = doc.getMap(HEADER);
    header.set("format", initial.format);
    header.set("version", initial.version);
    header.set("id", initial.id);
    header.set("name", initial.name);

    const order = doc.getList(ORDER);
    const table = doc.getMap(WIDGETS);
    let rowNumber = 0;

    initial.widgets.forEach((entry) => {
      if (isScreenRow(entry)) {
        rowNumber += 1;
        const key = `${ROW_PREFIX}${rowNumber}`;
        writeRow(table, key, entry);
        order.push(key);
        return;
      }
      writeWidget(table, entry);
      order.push(entry.registryId);
    });

    doc.commit();
    return new ScreenDocument(doc);
  }

  /** Parse a JSON value and create a document from it, refusing with a sentence. */
  static fromJson(value: unknown): ScreenDocumentOpen {
    const migrated = migrateScreen(value);
    if (!migrated.ok) return migrated;

    const parsed = parseScreen(migrated.value);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      document: ScreenDocument.create(parsed.value),
      fromVersion: migrated.fromVersion,
    };
  }

  /**
   * Open a snapshot.
   *
   * A snapshot that Loro cannot decode, or one whose state is not a Screen, is refused.
   * A snapshot written by a newer Suite is refused by version, not repaired. An older
   * snapshot is migrated by the same chain the portable importer uses; because a step
   * may change the logical shape, the document is rebuilt from the migrated Screen.
   */
  static open(snapshot: Uint8Array): ScreenDocumentOpen {
    let doc: LoroDoc;
    try {
      doc = LoroDoc.fromSnapshot(snapshot);
    } catch {
      return screenCorruption(
        "This screen could not be opened because the snapshot is not readable. The file has been left alone.",
      );
    }

    const state = readScreen(doc);
    if (!state.ok) return state;
    if (state.fromVersion !== state.screen.version) {
      return {
        ok: true,
        document: ScreenDocument.create(state.screen),
        fromVersion: state.fromVersion,
      };
    }
    return { ok: true, document: new ScreenDocument(doc), fromVersion: state.fromVersion };
  }

  /** The current Screen. Throws only when the document was mutated outside this class. */
  state(): Screen {
    const state = readScreen(this.#doc);
    if (!state.ok) throw new Error(state.message);
    return state.screen;
  }

  /** The bytes the host writes. The host owns the atomic write and the backup. */
  export(): Uint8Array {
    this.#doc.commit();
    return this.#doc.export({ mode: "snapshot" });
  }

  /**
   * Add one instance. A duplicate registry id is refused: the Screen shape has one
   * placement per widget.
   */
  add(widget: NewScreenWidget, placement?: ScreenPlacement): boolean {
    const placed = { ...widget, ...this.#freePlacement(widget) };
    if (!suiteScreenWidgetSchema.safeParse(placed).success) return false;
    if (this.#hasRegistryId(placed.registryId)) return false;

    const ids = this.#order();
    const index = placement === undefined ? ids.length : this.#target(ids, placement);
    if (index === null) return false;

    writeWidget(this.#table(), placed);
    this.#doc.getList(ORDER).insert(index, placed.registryId);
    this.#commit();
    return true;
  }

  /**
   * Add a row of widgets. Its children occupy the same registry-id namespace as the
   * flat placements, so one Screen still places each widget at most once.
   */
  addRow(row: NewScreenRow, placement?: ScreenPlacement): boolean {
    const placed = { ...row, ...this.#freePlacement(row) };
    if (!suiteScreenRowSchema.safeParse(placed).success) return false;
    if (placed.items.some((item) => this.#hasRegistryId(item.registryId))) return false;

    const ids = this.#order();
    const index = placement === undefined ? ids.length : this.#target(ids, placement);
    if (index === null) return false;

    const key = this.#nextRowKey();
    writeRow(this.#table(), key, placed);
    this.#doc.getList(ORDER).insert(index, key);
    this.#commit();
    return true;
  }

  /** Remove one instance. A row child is removed from its row; a row keeps 2–8 items. */
  remove(registryId: string): boolean {
    const ids = this.#order();
    const index = ids.indexOf(registryId);
    if (index >= 0) {
      this.#table().delete(registryId);
      this.#doc.getList(ORDER).delete(index, 1);
      this.#commit();
      return true;
    }

    const table = this.#table();
    for (const key of ids) {
      const value: unknown = table.get(key);
      if (typeof value !== "object" || value === null) continue;
      const entry = value as LoroMap;
      if (entry.get("kind") !== "row") continue;
      const items = entry.get("items");
      if (!Array.isArray(items)) continue;
      const position = items.findIndex(
        (item) => isRecord(item) && item.registryId === registryId,
      );
      if (position < 0) continue;
      if (items.length <= 2) return false;
      entry.set(
        "items",
        items.filter((_, itemIndex) => itemIndex !== position),
      );
      this.#commit();
      return true;
    }
    return false;
  }

  /** Move one instance before or after another. An unknown anchor is a no-op. */
  move(registryId: string, placement: ScreenPlacement): boolean {
    const ids = this.#order();
    const from = ids.indexOf(registryId);
    if (from < 0) return false;

    const without = [...ids.slice(0, from), ...ids.slice(from + 1)];
    const target = this.#target(without, placement);
    if (target === null) return false;

    const order = this.#doc.getList(ORDER);
    order.delete(from, 1);
    order.insert(target, registryId);
    this.#commit();
    return true;
  }

  /**
   * Move one flat instance one entry earlier or later.
   *
   * The neighbour is an order entry, not a registry id, so a row next to a widget is
   * a valid step and the widget never jumps over it by accident.
   */
  moveBy(registryId: string, direction: "earlier" | "later"): boolean {
    const ids = this.#order();
    const from = ids.indexOf(registryId);
    if (from < 0) return false;

    const to = direction === "earlier" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return false;
    const fromId = ids[from];
    const toId = ids[to];
    if (fromId === undefined || toId === undefined) return false;

    // The grid, not the order list, is what the person sees. Swapping the two
    // placements' cells is what makes "earlier" and "later" still move the tile.
    const table = this.#table();
    const first = table.get(fromId) as LoroMap | undefined;
    const second = table.get(toId) as LoroMap | undefined;
    if (first !== undefined && second !== undefined) {
      const ax = first.get("x");
      const ay = first.get("y");
      const bx = second.get("x");
      const by = second.get("y");
      const aSize = first.get("size");
      const bSize = second.get("size");
      // Swap cells only when each tile still fits where the other sat. A full-width
      // tile cannot take a quarter-column cell, and a swap that would not fit is a
      // refused move rather than an invalid document.
      const fits = (size: unknown, x: unknown): boolean =>
        typeof size === "string" &&
        typeof x === "number" &&
        x + sizeCells(size as SuiteWidgetSize).w <= SCREEN_GRID_COLUMNS;
      if (
        typeof ax === "number" &&
        typeof ay === "number" &&
        typeof bx === "number" &&
        typeof by === "number" &&
        fits(aSize, bx) &&
        fits(bSize, ax)
      ) {
        first.set("x", bx);
        first.set("y", by);
        second.set("x", ax);
        second.set("y", ay);
      }
    }

    const order = this.#doc.getList(ORDER);
    order.delete(from, 1);
    order.insert(to, registryId);
    this.#commit();
    return true;
  }

  /** Place an instance at one size class. A row child's width is its weight. */
  resize(registryId: string, size: SuiteWidgetSize): boolean {
    if (!suiteWidgetSizeSchema.safeParse(size).success) return false;
    const entry = this.#widget(registryId);
    if (entry === undefined) return false;
    entry.set("size", size);
    const x = entry.get("x");
    if (typeof x === "number") {
      const maxX = SCREEN_GRID_COLUMNS - sizeCells(size).w;
      if (x > maxX) entry.set("x", maxX);
    }
    this.#commit();
    return true;
  }

  /** Move an instance to a cell on the four-cell grid. */
  place(registryId: string, x: number, y: number): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return false;
    const entry = this.#widget(registryId);
    if (entry === undefined) return false;
    const size = entry.get("size");
    if (typeof size !== "string") return false;
    if (x + sizeCells(size as SuiteWidgetSize).w > SCREEN_GRID_COLUMNS) return false;
    entry.set("x", x);
    entry.set("y", y);
    this.#commit();
    return true;
  }

  /** Set one instance setting. The descriptor's validation belongs to the registry. */
  setSetting(registryId: string, fieldId: string, value: string): boolean {
    if (!suiteWidgetIdSchema.safeParse(fieldId).success) return false;
    if (value.length > MAX_SETTING_LENGTH) return false;
    const entry = this.#widget(registryId);
    if (entry === undefined) return false;

    entry.ensureMergeableMap(SETTINGS).set(fieldId, value);
    this.#commit();
    return true;
  }

  /** Clear one instance setting; clears the settings map when it was the last one. */
  clearSetting(registryId: string, fieldId: string): boolean {
    if (!suiteWidgetIdSchema.safeParse(fieldId).success) return false;
    const entry = this.#widget(registryId);
    if (entry === undefined) return false;
    if (entry.get(SETTINGS) === undefined) return false;

    let settings: LoroMap;
    try {
      settings = entry.ensureMergeableMap(SETTINGS);
    } catch {
      return false;
    }
    if (settings.get(fieldId) === undefined) return false;

    settings.delete(fieldId);
    if (settings.size === 0) entry.delete(SETTINGS);
    this.#commit();
    return true;
  }

  /** The instance settings as stored, including keys no installed descriptor declares. */
  settings(registryId: string): Readonly<Record<string, string>> {
    for (const entry of this.state().widgets) {
      if (isScreenRow(entry)) {
        const item = entry.items.find((candidate) => candidate.registryId === registryId);
        if (item !== undefined) return item.settings ?? {};
        continue;
      }
      if (entry.registryId === registryId) return entry.settings ?? {};
    }
    return {};
  }

  #hasRegistryId(registryId: string): boolean {
    return this.state().widgets.some((entry) =>
      isScreenRow(entry)
        ? entry.items.some((item) => item.registryId === registryId)
        : entry.registryId === registryId,
    );
  }

  #order(): string[] {
    return this.#doc.getList(ORDER).toArray() as string[];
  }

  #table(): LoroMap {
    return this.#doc.getMap(WIDGETS);
  }

  #nextRowKey(): string {
    const table = this.#table();
    for (let number = 1; ; number += 1) {
      const key = `${ROW_PREFIX}${number}`;
      if (table.get(key) === undefined) return key;
    }
  }

  #widget(registryId: string): LoroMap | undefined {
    if (splitWidgetRegistryId(registryId) === null) return undefined;
    const value: unknown = this.#table().get(registryId);
    if (typeof value !== "object" || value === null) return undefined;
    return "set" in value ? (value as LoroMap) : undefined;
  }

  /** A new placement's cell: the caller's, or the first free one. */
  #freePlacement(entry: {
    readonly size: SuiteWidgetSize;
    readonly x?: number;
    readonly y?: number;
  }): { readonly x: number; readonly y: number } {
    if (entry.x !== undefined && entry.y !== undefined) {
      return { x: entry.x, y: entry.y };
    }
    return findFreePlacement(
      this.state().widgets.map((placed) => ({
        x: placed.x,
        y: placed.y,
        size: placed.size,
      })),
      entry.size,
    );
  }

  #target(ids: readonly string[], placement: ScreenPlacement): number | null {
    const anchor = "before" in placement ? placement.before : placement.after;
    const index = ids.indexOf(anchor);
    if (index < 0) return null;
    return "before" in placement ? index : index + 1;
  }

  #commit(): void {
    this.#doc.commit();
  }
}

/** Create a document from an already parsed Screen. */
export function createScreenDocument(initial: Screen): ScreenDocument {
  return ScreenDocument.create(initial);
}

/** The newest format this build writes. Used by migration and tests. */
export const SCREEN_FORMAT = SUITE_SCREEN_FORMAT;
export const SCREEN_VERSION = SUITE_SCREEN_VERSION;
