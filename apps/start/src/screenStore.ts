import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SuiteWidgetSize } from "@suite/contracts";
import {
  defaultStartDashboard,
  migrateStartDashboardJson,
  type Screen,
  ScreenDocument,
  START_HOME_SCREEN_ID,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  type SuiteScreenWidget,
} from "@suite/screens";
import type { ScreenMoveDirection } from "./shared.js";

/**
 * Start's Home Screen, on disk.
 *
 * A Screen is the host's own Loro document, so this is the one module that owns its path,
 * its atomic write and its backups. The renderer never learns a path, and no app owns or
 * reads this file.
 *
 * What lives where:
 *
 *   <data>/screens/<id>.loro     one Screen document per Screen
 *   <data>/screens.json          which Screen is Home
 *   <config>/start/dashboard.json  the pre-Screen layout, migrated once
 *
 * The old dashboard is not deleted. Migration copies every entry, including an id this
 * build cannot resolve, writes the Screen, and renames the old file to
 * `dashboard.json.migrated-<date>`. A corrupt, empty or newer dashboard is refused whole:
 * the sentence comes from `@suite/screens`, the old file is untouched, and the default
 * Home is shown with that sentence.
 *
 * A Screen that cannot be read is quarantined under a dated name and the default Home is
 * written in its place, the way the shell handles `spaces.loro`. A bad file is evidence,
 * not something to delete.
 */

export const SCREENS_INDEX_FORMAT = "suite.start.screens";
export const SCREENS_INDEX_VERSION = 1;
export const SCREENS_DIRECTORY = "screens";
export const SCREENS_INDEX_FILENAME = "screens.json";

const SCREEN_EXTENSION = ".loro";
const MAX_SCREEN_BYTES = 8 * 1024 * 1024;
const SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SCREEN_NAME_LIMIT = 120;

export interface ScreensIndex {
  readonly format: typeof SCREENS_INDEX_FORMAT;
  readonly version: number;
  readonly homeId: string;
}

export interface ScreenStoreOptions {
  /** `<data>/screens`: one `.loro` per Screen. */
  readonly directory: string;
  /** `<data>/screens.json`: which Screen is Home. */
  readonly indexFile: string;
  /** `<config>/start/dashboard.json`: the pre-Screen layout, read once. */
  readonly dashboardFile: string;
  /** The clock used for backup names. Injected so a test writes the same name twice. */
  readonly now?: () => Date;
}

export interface ScreenLoad {
  readonly homeId: string;
  /** Why the old layout or the Screen was not honoured, or null on an ordinary launch. */
  readonly note: string | null;
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

interface OpenScreen {
  readonly ok: true;
  readonly document: ScreenDocument;
}

interface UnreadableScreen {
  readonly ok: false;
  readonly message: string;
}

type ScreenOpen = OpenScreen | UnreadableScreen;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the tiny index that names Home. An unreadable index is ignored, not repaired. */
export function parseScreensIndex(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (value.format !== SCREENS_INDEX_FORMAT) return null;
  if (value.version !== SCREENS_INDEX_VERSION) return null;
  if (typeof value.homeId !== "string" || !SCREEN_ID_PATTERN.test(value.homeId)) return null;
  return value.homeId;
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

/** A sibling temporary file, so two writes cannot land on the same name. */
function temporaryName(file: string): string {
  return `${file}.${randomUUID()}.tmp`;
}

export class ScreenStore {
  readonly #options: ScreenStoreOptions;
  #homeId: string = START_HOME_SCREEN_ID;
  #note: string | null = null;

  private constructor(options: ScreenStoreOptions) {
    this.#options = options;
  }

  static at(options: ScreenStoreOptions): ScreenStore {
    return new ScreenStore(options);
  }

  /** The Screen the manager calls Home. Set by `load` and by `setHome`. */
  get homeId(): string {
    return this.#homeId;
  }

  /** The sentence the last load wants shown, or null. */
  get note(): string | null {
    return this.#note;
  }

  /**
   * Open the Home Screen, migrating or creating it on first use.
   *
   * The `.loro` file is the authority once it exists. The dashboard is read only when
   * there is no Home Screen yet, so a half-written or repeated migration cannot happen.
   */
  async load(): Promise<ScreenLoad> {
    await mkdir(this.#options.directory, { recursive: true });
    const homeFile = this.#file(START_HOME_SCREEN_ID);

    if (await exists(homeFile)) {
      const opened = await this.#openFile(homeFile);
      if (!opened.ok) {
        await this.#quarantine(homeFile, opened.message);
        await this.#writeDefault();
        this.#note = opened.message;
      }
      this.#homeId = await this.#chooseHome();
      await this.#rememberHome();
      return { homeId: this.#homeId, note: this.#note };
    }

    const dashboard = await this.#readDashboard();
    if (dashboard !== null) {
      const migration = migrateStartDashboardJson(dashboard);
      if (migration.ok) {
        await this.#save(START_HOME_SCREEN_ID, ScreenDocument.create(migration.screen).export());
        await this.#backupDashboard();
        this.#homeId = await this.#chooseHome();
        await this.#rememberHome();
        return { homeId: this.#homeId, note: this.#note };
      }
      this.#note = migration.message;
    }

    // No Home document and no layout to migrate: keep an existing Screen as Home when
    // there is one, and otherwise write the default composition.
    this.#homeId = await this.#chooseHome();
    if (!(await exists(this.#file(this.#homeId)))) await this.#writeDefault();
    await this.#rememberHome();
    return { homeId: this.#homeId, note: this.#note };
  }

  /** Every Screen file, with the name its document carries. */
  async summaries(): Promise<readonly ScreenSummary[]> {
    const files = await this.#files();
    const summaries: ScreenSummary[] = [];
    for (const file of files) {
      const id = file.slice(0, -SCREEN_EXTENSION.length);
      if (!isScreenId(id)) continue;
      const screen = await this.open(id);
      summaries.push({ id, name: screen?.name ?? id, readable: screen !== null });
    }
    return summaries.sort((left, right) => left.id.localeCompare(right.id));
  }

  /** One Screen, or null when the file is missing or unreadable. */
  async open(id: string): Promise<Screen | null> {
    const opened = await this.#document(id);
    return opened === null ? null : opened.state();
  }

  /** Create an empty Screen and answer its id. A new Screen is a blank slate. */
  async create(name: string): Promise<string> {
    const taken = new Set((await this.summaries()).map((screen) => screen.id));
    const id = screenIdFor(screenName(name), taken);
    const screen: Screen = {
      format: SUITE_SCREEN_FORMAT,
      version: SUITE_SCREEN_VERSION,
      id,
      name: screenName(name),
      widgets: [],
    };
    await this.#writeScreen(screen);
    return id;
  }

  /** Rename a Screen. The header is the name; there is no separate name index. */
  async rename(id: string, name: string): Promise<boolean> {
    const screen = await this.open(id);
    if (screen === null) return false;
    await this.#writeScreen({ ...screen, name: screenName(name) });
    return true;
  }

  /** Copy a Screen's composition under a new id and name. */
  async duplicate(id: string): Promise<string | null> {
    const screen = await this.open(id);
    if (screen === null) return null;
    const taken = new Set((await this.summaries()).map((entry) => entry.id));
    const name = screenName(`${screen.name} copy`);
    const copy: Screen = {
      ...screen,
      id: screenIdFor(name, taken),
      name,
      widgets: screen.widgets.map((widget) => ({ ...widget })),
    };
    await this.#writeScreen(copy);
    return copy.id;
  }

  /**
   * Delete a Screen.
   *
   * The last Screen is kept: a person with an empty Screens set has no surface left to
   * create one on. Deleting Home asks for a replacement first, because Home is a role the
   * set must always have. A refusal names what to do; it changes nothing.
   */
  async remove(id: string, replacementId?: string | null): Promise<ScreenRemoval> {
    const summaries = await this.summaries();
    if (!summaries.some((screen) => screen.id === id)) {
      return {
        ok: false,
        reason: "missing",
        message: "That Screen is no longer here.",
        choices: [],
      };
    }
    if (summaries.length <= 1) {
      return {
        ok: false,
        reason: "last",
        message: `Start kept ${summaries[0]?.name ?? id}. A Screens set needs at least one Screen.`,
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
    return { ok: true, homeId: this.#homeId };
  }

  /** Make one Screen the Home role, and remember it across launches. */
  async setHome(id: string): Promise<boolean> {
    if (!(await exists(this.#file(id)))) return false;
    this.#homeId = id;
    await this.#rememberHome();
    return true;
  }

  async addWidget(screenId: string, widget: SuiteScreenWidget): Promise<boolean> {
    return this.#mutate(screenId, (document) => document.add(widget));
  }

  async removeWidget(screenId: string, registryId: string): Promise<boolean> {
    return this.#mutate(screenId, (document) => document.remove(registryId));
  }

  async moveWidget(
    screenId: string,
    registryId: string,
    direction: ScreenMoveDirection,
  ): Promise<boolean> {
    return this.#mutate(screenId, (document) => {
      const ids = document.state().widgets.map((widget) => widget.registryId);
      const index = ids.indexOf(registryId);
      const target = direction === "earlier" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ids.length) return false;
      const anchor = ids[target];
      if (anchor === undefined) return false;
      return direction === "earlier"
        ? document.move(registryId, { before: anchor })
        : document.move(registryId, { after: anchor });
    });
  }

  async resizeWidget(
    screenId: string,
    registryId: string,
    size: SuiteWidgetSize,
  ): Promise<boolean> {
    return this.#mutate(screenId, (document) => document.resize(registryId, size));
  }

  /** Set one instance setting; an empty value clears it. */
  async setWidgetSetting(
    screenId: string,
    registryId: string,
    fieldId: string,
    value: string,
  ): Promise<boolean> {
    return this.#mutate(screenId, (document) =>
      value.trim().length === 0
        ? document.clearSetting(registryId, fieldId)
        : document.setSetting(registryId, fieldId, value),
    );
  }

  #file(id: string): string {
    return join(this.#options.directory, screenFileName(id));
  }

  async #files(): Promise<readonly string[]> {
    try {
      const names = await readdir(this.#options.directory);
      return names.filter((name) => name.endsWith(SCREEN_EXTENSION)).sort();
    } catch {
      return [];
    }
  }

  async #document(id: string): Promise<ScreenDocument | null> {
    if (!isScreenId(id)) return null;
    const opened = await this.#openFile(this.#file(id));
    return opened.ok ? opened.document : null;
  }

  async #openFile(file: string): Promise<ScreenOpen> {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, message: "That Screen is no longer here." };
      }
      return { ok: false, message: "This Screen could not be read. The file has been left alone." };
    }
    if (details.size > MAX_SCREEN_BYTES) {
      return {
        ok: false,
        message: "This Screen is larger than Start will open, so it has been left alone.",
      };
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(file));
    } catch {
      return { ok: false, message: "This Screen could not be read. The file has been left alone." };
    }
    const opened = ScreenDocument.open(bytes);
    return opened.ok ? opened : { ok: false, message: opened.message };
  }

  async #mutate(screenId: string, change: (document: ScreenDocument) => boolean): Promise<boolean> {
    const document = await this.#document(screenId);
    if (document === null) return false;
    if (!change(document)) return false;
    await this.#save(screenId, document.export());
    return true;
  }

  async #writeScreen(screen: Screen): Promise<void> {
    await this.#save(screen.id, ScreenDocument.create(screen).export());
  }

  async #writeDefault(): Promise<void> {
    const home = defaultStartDashboard();
    await this.#save(START_HOME_SCREEN_ID, ScreenDocument.create(home.screen).export());
    this.#homeId = START_HOME_SCREEN_ID;
  }

  /**
   * Write one Screen atomically, keeping the previous bytes as `<id>.loro.bak`.
   *
   * A temporary file and a rename: a crash leaves either the old Screen or the new one,
   * never a half-written snapshot the next launch must parse.
   */
  async #save(id: string, bytes: Uint8Array): Promise<void> {
    const file = this.#file(id);
    await mkdir(dirname(file), { recursive: true });
    if (await exists(file)) await this.#backup(file, `${file}.bak`);
    const temporary = temporaryName(file);
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  }

  async #backup(file: string, destination: string): Promise<void> {
    const temporary = temporaryName(destination);
    await copyFile(file, temporary);
    await rename(temporary, destination);
  }

  async #quarantine(file: string, reason: string): Promise<void> {
    const backup = await this.#freeName(`${file}.corrupt-${this.#stamp()}`);
    try {
      await rename(file, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    console.warn(`[screens] quarantined ${backup}: ${reason}`);
  }

  async #readDashboard(): Promise<string | null> {
    try {
      return await readFile(this.#options.dashboardFile, "utf8");
    } catch {
      // No dashboard is the ordinary first launch. An unreadable one is treated the
      // same way: the default Home is written and the file is left for its owner.
      return null;
    }
  }

  /** The old layout stays visible beside the new document, under a dated name. */
  async #backupDashboard(): Promise<void> {
    const destination = await this.#freeName(
      `${this.#options.dashboardFile}.migrated-${this.#today()}`,
    );
    await rename(this.#options.dashboardFile, destination);
  }

  async #chooseHome(): Promise<string> {
    const files = await this.#files();
    const index = await this.#readIndex();
    if (index !== null && files.includes(screenFileName(index))) return index;
    if (files.includes(screenFileName(START_HOME_SCREEN_ID))) return START_HOME_SCREEN_ID;
    const first = files[0];
    return first === undefined ? START_HOME_SCREEN_ID : first.slice(0, -SCREEN_EXTENSION.length);
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
      await this.#backup(this.#options.indexFile, `${this.#options.indexFile}.bak`);
    }
    const index: ScreensIndex = {
      format: SCREENS_INDEX_FORMAT,
      version: SCREENS_INDEX_VERSION,
      homeId: this.#homeId,
    };
    const temporary = temporaryName(this.#options.indexFile);
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`);
    await rename(temporary, this.#options.indexFile);
  }

  async #freeName(base: string): Promise<string> {
    if (!(await exists(base))) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!(await exists(candidate))) return candidate;
    }
  }

  #clock(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #today(): string {
    return this.#clock().toISOString().slice(0, 10);
  }

  #stamp(): string {
    return this.#clock().toISOString().replace(/[:.]/gu, "-");
  }
}
