import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SuiteWidgetSize } from "@suite/contracts";
import {
  type Screen,
  ScreenDocument,
  type ScreenPlacement,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  type SuiteScreenWidget,
} from "@suite/screens";
import { defaultHomeScreen, HOME_SCREEN_ID } from "./home.js";

/**
 * The host's Screen document.
 *
 * A Screen is the shell's own composition: which widgets are placed, at what size and
 * with which instance settings. It is not a pack document and it never holds app data.
 * `@suite/screens` owns the shape, the Loro containers and every mutation; this module
 * owns the one thing that package cannot: the path, the atomic write and the backup.
 *
 * The store starts from Home when the file is missing. A file that cannot be read is
 * renamed aside rather than deleted, so the person keeps the only copy, and a fresh
 * Home is what the next start shows.
 */

/** Four megabytes is generous for 64 placements and small enough to bound startup reads. */
const MAX_SCREEN_BYTES = 4 * 1024 * 1024;

export type WidgetDirection = "earlier" | "later";

export class ScreenStore {
  readonly #path: string;
  readonly #document: ScreenDocument;
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(path: string, document: ScreenDocument) {
    this.#path = path;
    this.#document = document;
  }

  /**
   * Open the Screen at `path`, creating `fallback` when it does not exist.
   *
   * The file is not written on open. Like the space document, startup stays independent
   * of a writable data directory; the first real change creates the file. Home is the
   * default fallback; a named Screen passes its own empty composition so a missing or
   * unreadable file does not silently become Home.
   */
  static async open(path: string, fallback: Screen = defaultHomeScreen()): Promise<ScreenStore> {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new ScreenStore(path, documentFor(fallback));
      }
      await quarantine(path, "it could not be read", error);
      return new ScreenStore(path, documentFor(fallback));
    }

    if (details.size > MAX_SCREEN_BYTES) {
      await quarantine(path, "it is larger than the screen limit");
      return new ScreenStore(path, documentFor(fallback));
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (error) {
      await quarantine(path, "it could not be read", error);
      return new ScreenStore(path, documentFor(fallback));
    }

    const opened = ScreenDocument.open(bytes);
    if (!opened.ok) {
      // The refusal is a complete sentence already: a corrupt snapshot and a newer
      // version read differently, and neither is repaired by guessing.
      await quarantine(path, opened.message);
      return new ScreenStore(path, documentFor(fallback));
    }
    return new ScreenStore(path, opened.document);
  }

  /**
   * Write a new Screen and return its store.
   *
   * A Screen created by the manager is on disk from the start: unlike Home, it has no
   * default composition to show if the file is missing, so the empty composition is
   * written before the tab opens.
   */
  static async create(path: string, screen: Screen): Promise<ScreenStore> {
    const document = ScreenDocument.create(screen);
    await writeSnapshot(path, document.export());
    return new ScreenStore(path, document);
  }

  /** The current Screen. */
  state(): Screen {
    return this.#document.state();
  }

  async add(widget: SuiteScreenWidget): Promise<boolean> {
    return this.#mutate(this.#document.add(widget));
  }

  async remove(registryId: string): Promise<boolean> {
    return this.#mutate(this.#document.remove(registryId));
  }

  async move(registryId: string, placement: ScreenPlacement): Promise<boolean> {
    return this.#mutate(this.#document.move(registryId, placement));
  }

  /**
   * Move one placement one step earlier or later.
   *
   * This is the edit-mode keyboard action; the document's own `move` takes an anchor,
   * so the neighbour is computed here where the current order is known.
   */
  async moveBy(registryId: string, direction: WidgetDirection): Promise<boolean> {
    const ids = this.state().widgets.map((widget) => widget.registryId);
    const index = ids.indexOf(registryId);
    if (index < 0) return false;
    const anchor = direction === "earlier" ? ids[index - 1] : ids[index + 1];
    if (anchor === undefined) return false;
    return this.move(registryId, direction === "earlier" ? { before: anchor } : { after: anchor });
  }

  async resize(registryId: string, size: SuiteWidgetSize): Promise<boolean> {
    return this.#mutate(this.#document.resize(registryId, size));
  }

  async setSetting(registryId: string, fieldId: string, value: string): Promise<boolean> {
    return this.#mutate(this.#document.setSetting(registryId, fieldId, value));
  }

  async clearSetting(registryId: string, fieldId: string): Promise<boolean> {
    return this.#mutate(this.#document.clearSetting(registryId, fieldId));
  }

  async flush(): Promise<void> {
    await this.#save();
  }

  async #mutate(changed: boolean): Promise<boolean> {
    if (!changed) return false;
    await this.#save();
    return true;
  }

  #save(): Promise<void> {
    const snapshot = this.#document.export();
    const next = this.#writeChain.then(() => writeSnapshot(this.#path, snapshot));
    // A failed write must not poison every later write. The caller still sees the
    // failure through `next`.
    this.#writeChain = next.catch(() => undefined);
    return next;
  }
}

async function writeSnapshot(path: string, snapshot: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Keep the previous good snapshot beside the document. A failed write then
  // leaves both the last good file and its backup in place.
  await copyFile(path, `${path}.bak`).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, snapshot);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function documentFor(screen: Screen): ScreenDocument {
  const created = ScreenDocument.fromJson(screen);
  if (!created.ok) throw new Error(created.message);
  return created.document;
}

async function quarantine(path: string, reason: string, error?: unknown): Promise<void> {
  const backup = `${path}.corrupt-${Date.now()}`;
  try {
    await rename(path, backup);
  } catch (renameError) {
    // The file vanished between the read attempt and the quarantine; there is
    // nothing left to preserve, and a fresh Home is the correct answer.
    if ((renameError as NodeJS.ErrnoException).code === "ENOENT") return;
    throw renameError;
  }
  console.warn(`[shell] screen document quarantined at ${backup}: ${reason}`, error);
}

/**
 * The set of Screens on this device.
 *
 * A Screen is one `suite.screen` document; Home is a role in the set, not a special
 * file name. `screens.json` names which Screen Home is, so changing Home does not copy
 * a document. The old shell had one Screen; the manager Start carried is now here.
 *
 * Every document still goes through `ScreenStore`, which owns the path, the atomic
 * write and the backups. This module only decides which files exist, which one is
 * Home, and what a removal means.
 */

export const SCREENS_INDEX_FORMAT = "suite.shell.screens";
export const SCREENS_INDEX_VERSION = 1;
export const SCREENS_INDEX_FILENAME = "screens.json";

const SCREEN_EXTENSION = ".loro";
const SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SCREEN_NAME_LIMIT = 120;

export interface ScreensIndex {
  readonly format: typeof SCREENS_INDEX_FORMAT;
  readonly version: number;
  readonly homeId: string;
}

export interface ScreenSummary {
  readonly id: string;
  readonly name: string;
  readonly readable: boolean;
}

export type ScreenRemoval =
  | { readonly ok: true; readonly homeId: string }
  | {
      readonly ok: false;
      readonly reason: "missing" | "last" | "replacement";
      readonly message: string;
      readonly choices: readonly ScreenSummary[];
    };

export interface ScreenSetOptions {
  /** `<dataRoot>/screens`: one `.loro` per Screen. */
  readonly directory: string;
  /** `<dataRoot>/screens.json`: which Screen is Home. */
  readonly indexFile: string;
}

/** Parse the tiny index that names Home. An unreadable index is ignored, not repaired. */
export function parseScreensIndex(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (entry.format !== SCREENS_INDEX_FORMAT) return null;
  if (entry.version !== SCREENS_INDEX_VERSION) return null;
  if (typeof entry.homeId !== "string" || !isScreenId(entry.homeId)) return null;
  return entry.homeId;
}

export function isScreenId(value: string): boolean {
  return SCREEN_ID_PATTERN.test(value);
}

/** The file name a Screen id uses. The id is the fact; the path is derived here only. */
export function screenFileName(id: string): string {
  return `${id}${SCREEN_EXTENSION}`;
}

/** Trim and bound a name a person typed. A blank name is not a name. */
export function screenName(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ").slice(0, SCREEN_NAME_LIMIT);
  return trimmed.length > 0 ? trimmed : "Untitled Screen";
}

/** A lower kebab-case id from a name, made unique against the ids already on disk. */
export function screenIdFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48) || "screen";
  const start = /^[a-z0-9]/u.test(base) ? base : `s-${base}`;
  if (!taken.has(start)) return start;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${start}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class ScreenSet {
  readonly #options: ScreenSetOptions;
  readonly #stores = new Map<string, ScreenStore>();
  #homeId: string = HOME_SCREEN_ID;
  #summaries: readonly ScreenSummary[] = [];

  private constructor(options: ScreenSetOptions) {
    this.#options = options;
  }

  static async open(options: ScreenSetOptions): Promise<ScreenSet> {
    const set = new ScreenSet(options);
    await set.#load();
    return set;
  }

  /** The Screen a launch opens. */
  get homeId(): string {
    return this.#homeId;
  }

  /** Every Screen, Home included even before its first write. */
  summaries(): readonly ScreenSummary[] {
    return this.#summaries;
  }

  /** The in-memory Screen for one id, or null when it is not in this set. */
  screen(id: string): Screen | null {
    return this.#stores.get(id)?.state() ?? null;
  }

  /** The store for one id, or null when it is not in this set. */
  store(id: string): ScreenStore | null {
    return this.#stores.get(id) ?? null;
  }

  /** Create an empty Screen and answer its id. A new Screen is a blank slate. */
  async create(name: string): Promise<string> {
    const taken = new Set(this.#stores.keys());
    const label = screenName(name);
    const id = screenIdFor(label, taken);
    const screen: Screen = {
      format: SUITE_SCREEN_FORMAT,
      version: SUITE_SCREEN_VERSION,
      id,
      name: label,
      widgets: [],
    };
    const store = await ScreenStore.create(this.#file(id), screen);
    this.#stores.set(id, store);
    this.#refreshSummaries();
    return id;
  }

  /** Rename a Screen. The header is the name; there is no separate name index. */
  async rename(id: string, name: string): Promise<boolean> {
    const store = this.#stores.get(id);
    if (store === undefined) return false;
    const screen = store.state();
    const renamed = ScreenDocument.create({ ...screen, name: screenName(name) });
    await writeSnapshot(this.#file(id), renamed.export());
    this.#stores.set(
      id,
      await ScreenStore.open(this.#file(id), { ...screen, id, name: screenName(name) }),
    );
    this.#refreshSummaries();
    return true;
  }

  /** Copy a Screen's composition under a new id and name. */
  async duplicate(id: string): Promise<string | null> {
    const screen = this.screen(id);
    if (screen === null) return null;
    const taken = new Set(this.#stores.keys());
    const name = screenName(`${screen.name} copy`);
    const copy: Screen = {
      ...screen,
      id: screenIdFor(name, taken),
      name,
      widgets: screen.widgets.map((widget) => ({
        ...widget,
        ...(widget.settings === undefined ? {} : { settings: { ...widget.settings } }),
      })),
    };
    const store = await ScreenStore.create(this.#file(copy.id), copy);
    this.#stores.set(copy.id, store);
    this.#refreshSummaries();
    return copy.id;
  }

  /**
   * Delete a Screen.
   *
   * The last Screen is kept: a person with an empty Screens set has no surface left to
   * create one on. Deleting Home asks for a replacement first, because Home is a role
   * the set must always have. A refusal names what to do; it changes nothing.
   */
  async remove(id: string, replacementId?: string | null): Promise<ScreenRemoval> {
    if (!this.#stores.has(id)) {
      return {
        ok: false,
        reason: "missing",
        message: "That Screen is no longer here.",
        choices: [],
      };
    }
    const summaries = this.#summaries;
    if (summaries.length <= 1) {
      return {
        ok: false,
        reason: "last",
        message: `The host kept ${summaries[0]?.name ?? id}. A Screens set needs at least one Screen.`,
        choices: [],
      };
    }
    if (id === this.#homeId) {
      const replacement = summaries.find(
        (screen) => screen.id === replacementId && screen.id !== id,
      );
      if (replacement === undefined) {
        return {
          ok: false,
          reason: "replacement",
          message:
            "Home can only be deleted once another Screen becomes Home. Choose a replacement first.",
          choices: summaries.filter((screen) => screen.id !== id),
        };
      }
      await this.setHome(replacement.id);
    }

    await rm(this.#file(id), { force: true });
    this.#stores.delete(id);
    this.#refreshSummaries();
    return { ok: true, homeId: this.#homeId };
  }

  /** Make one Screen the Home role, and remember it across launches. */
  async setHome(id: string): Promise<boolean> {
    if (!this.#stores.has(id)) return false;
    this.#homeId = id;
    await this.#rememberHome();
    this.#refreshSummaries();
    return true;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#stores.values()].map((store) => store.flush()));
  }

  #file(id: string): string {
    return join(this.#options.directory, screenFileName(id));
  }

  async #load(): Promise<void> {
    await mkdir(this.#options.directory, { recursive: true }).catch(() => undefined);
    const files = await this.#files();

    for (const file of files) {
      const id = file.slice(0, -SCREEN_EXTENSION.length);
      if (!isScreenId(id)) continue;
      const fallback: Screen = {
        format: SUITE_SCREEN_FORMAT,
        version: SUITE_SCREEN_VERSION,
        id,
        name: id,
        widgets: [],
      };
      this.#stores.set(id, await ScreenStore.open(this.#file(id), fallback));
    }

    const index = await this.#readIndex();
    if (index !== null && this.#stores.has(index)) {
      this.#homeId = index;
    } else if (this.#stores.has(HOME_SCREEN_ID)) {
      this.#homeId = HOME_SCREEN_ID;
    } else if (files.length > 0) {
      const first = files[0]?.slice(0, -SCREEN_EXTENSION.length);
      if (first !== undefined && isScreenId(first)) this.#homeId = first;
    }

    // Home is always a Screen the chrome can open, even on a fresh data root where
    // the default composition has not been written yet. It is written on the first
    // edit, the same rule the single-Screen store used.
    if (!this.#stores.has(this.#homeId)) {
      this.#stores.set(this.#homeId, await ScreenStore.open(this.#file(this.#homeId)));
    }
    this.#refreshSummaries();
  }

  async #files(): Promise<readonly string[]> {
    try {
      const names = await readdir(this.#options.directory);
      return names.filter((name) => name.endsWith(SCREEN_EXTENSION)).sort();
    } catch {
      return [];
    }
  }

  #refreshSummaries(): void {
    this.#summaries = [...this.#stores.entries()]
      .map(([id, store]) => ({ id, name: store.state().name, readable: true }))
      .sort((left, right) => {
        if (left.id === this.#homeId) return -1;
        if (right.id === this.#homeId) return 1;
        return left.name.localeCompare(right.name);
      });
  }

  async #readIndex(): Promise<string | null> {
    try {
      return parseScreensIndex(JSON.parse(await readFile(this.#options.indexFile, "utf8")));
    } catch {
      return null;
    }
  }

  /** Write the Home choice, but only when it changed, so a launch is not a write. */
  async #rememberHome(): Promise<void> {
    if ((await this.#readIndex()) === this.#homeId) return;
    await mkdir(dirname(this.#options.indexFile), { recursive: true });
    if (await exists(this.#options.indexFile)) {
      await copyFile(this.#options.indexFile, `${this.#options.indexFile}.bak`).catch(
        (error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        },
      );
    }
    const index: ScreensIndex = {
      format: SCREENS_INDEX_FORMAT,
      version: SCREENS_INDEX_VERSION,
      homeId: this.#homeId,
    };
    const temporary = `${this.#options.indexFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`);
    await rename(temporary, this.#options.indexFile);
  }
}
