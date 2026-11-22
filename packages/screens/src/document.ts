import {
  type SuiteWidgetSize,
  splitWidgetRegistryId,
  suiteWidgetIdSchema,
  suiteWidgetSizeSchema,
} from "@suite/contracts";
import { LoroDoc, type LoroMap } from "loro-crdt";
import {
  parseScreen,
  type Screen,
  type ScreenParse,
  type ScreenRefusal,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  type SuiteScreenWidget,
  screenCorruption,
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
 * - `order` is the ordered list of registry ids. Order is the Screen's own fact, not a
 *   sort of the map.
 * - `widgets` is a map keyed by registry id, each entry a size and optional settings.
 *
 * A registry id this build cannot resolve is an ordinary entry. Nothing here asks a
 * registry whether an id is known, so an unknown widget and its unknown settings survive
 * every mutation and every snapshot.
 */

const HEADER = "screen";
const ORDER = "order";
const WIDGETS = "widgets";
const SETTINGS = "settings";
const MAX_SETTING_LENGTH = 500;

/** Where one instance goes relative to another. */
export type ScreenPlacement = { readonly before: string } | { readonly after: string };

export type ScreenDocumentOpen =
  | { readonly ok: true; readonly document: ScreenDocument }
  | ScreenRefusal;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readScreen(doc: LoroDoc): ScreenParse {
  const raw: unknown = doc.toJSON();
  if (!isRecord(raw)) return screenCorruption("The screen document has no readable state.");

  const header = raw[HEADER];
  const order = raw[ORDER];
  const table = raw[WIDGETS];
  if (!isRecord(header) || !Array.isArray(order) || !isRecord(table)) {
    return screenCorruption("The screen document is missing its header, order or widget table.");
  }

  const widgets: unknown[] = [];
  for (const id of order) {
    if (typeof id !== "string") {
      return screenCorruption("The screen document has a non-text widget id in its order.");
    }
    const entry = table[id];
    if (!isRecord(entry)) {
      return screenCorruption(`The screen document lists ${id} but has no entry for it.`);
    }
    const widget: Record<string, unknown> = { registryId: id, size: entry.size };
    if (SETTINGS in entry) widget.settings = entry[SETTINGS];
    widgets.push(widget);
  }

  return parseScreen({
    format: header.format,
    version: header.version,
    id: header.id,
    name: header.name,
    widgets,
  });
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
    for (const widget of initial.widgets) {
      const entry = table.ensureMergeableMap(widget.registryId);
      entry.set("size", widget.size);
      const settings = widget.settings;
      if (settings !== undefined && Object.keys(settings).length > 0) {
        const values = entry.ensureMergeableMap(SETTINGS);
        for (const [key, value] of Object.entries(settings)) values.set(key, value);
      }
      order.push(widget.registryId);
    }

    doc.commit();
    return new ScreenDocument(doc);
  }

  /** Parse a JSON value and create a document from it, refusing with a sentence. */
  static fromJson(value: unknown): ScreenDocumentOpen {
    const parsed = parseScreen(value);
    if (!parsed.ok) return parsed;
    return { ok: true, document: ScreenDocument.create(parsed.value) };
  }

  /**
   * Open a snapshot.
   *
   * A snapshot that Loro cannot decode, or one whose state is not a Screen, is refused.
   * A snapshot written by a newer Suite is refused by version, not repaired.
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
    return { ok: true, document: new ScreenDocument(doc) };
  }

  /** The current Screen. Throws only when the document was mutated outside this class. */
  state(): Screen {
    const state = readScreen(this.#doc);
    if (!state.ok) throw new Error(state.message);
    return state.value;
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
  add(widget: SuiteScreenWidget, placement?: ScreenPlacement): boolean {
    if (!suiteScreenWidgetSchema.safeParse(widget).success) return false;
    if (this.#table().get(widget.registryId) !== undefined) return false;

    const ids = this.#order();
    const index = placement === undefined ? ids.length : this.#target(ids, placement);
    if (index === null) return false;

    const entry = this.#table().ensureMergeableMap(widget.registryId);
    entry.set("size", widget.size);
    const settings = widget.settings;
    if (settings !== undefined && Object.keys(settings).length > 0) {
      const values = entry.ensureMergeableMap(SETTINGS);
      for (const [key, value] of Object.entries(settings)) values.set(key, value);
    }

    this.#doc.getList(ORDER).insert(index, widget.registryId);
    this.#commit();
    return true;
  }

  /** Remove one instance. The unknown case is not special: any registry id can go. */
  remove(registryId: string): boolean {
    const ids = this.#order();
    const index = ids.indexOf(registryId);
    if (index < 0) return false;

    this.#table().delete(registryId);
    this.#doc.getList(ORDER).delete(index, 1);
    this.#commit();
    return true;
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

  /** Place an instance at one size class. */
  resize(registryId: string, size: SuiteWidgetSize): boolean {
    if (!suiteWidgetSizeSchema.safeParse(size).success) return false;
    const entry = this.#widget(registryId);
    if (entry === undefined) return false;
    entry.set("size", size);
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
    const widget = this.state().widgets.find((entry) => entry.registryId === registryId);
    return widget?.settings ?? {};
  }

  #order(): string[] {
    return this.#doc.getList(ORDER).toArray() as string[];
  }

  #table(): LoroMap {
    return this.#doc.getMap(WIDGETS);
  }

  #widget(registryId: string): LoroMap | undefined {
    if (splitWidgetRegistryId(registryId) === null) return undefined;
    const value: unknown = this.#table().get(registryId);
    if (typeof value !== "object" || value === null) return undefined;
    return "set" in value ? (value as LoroMap) : undefined;
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
