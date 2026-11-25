import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LoroDoc } from "loro-crdt";
import { z } from "zod";

/**
 * The host's own document.
 *
 * This is the one document the host may parse: the host's space document. It holds what the
 * host is showing, not what any pack means. App documents stay with their packs.
 *
 * The shape is deliberately container-ready. A tab carries a `spaceId`, and the
 * document carries a default space today, so adding containers and saved spaces
 * is a UI change rather than a data migration. Collaboration and sync are not
 * here yet; the decision record owns that order.
 */
/**
 * The tab schema is forward-compatible with the screen model.
 *
 * Version 1 wrote a pack tab with no `kind`. `kind` is optional here so those
 * tabs keep reading; a missing kind is a pack tab. A screen tab has a
 * `screenId` and no pack fields. The document is never rewritten on read.
 */
const tabSchema = z.object({
  kind: z.enum(["pack", "screen"]).optional(),
  packId: z.string().optional(),
  screenId: z.string().optional(),
  title: z.string(),
  entry: z.string().optional(),
  spaceId: z.string().optional(),
});

const spacesSchema = z.object({
  shell: z.object({
    version: z.number().int(),
    activeTabId: z.string().nullable().optional(),
  }),
  spaces: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
  tabs: z.record(z.string(), tabSchema),
  "tab-order": z.array(z.string()),
});

export interface PackSpaceTab {
  readonly kind: "pack";
  readonly id: string;
  readonly packId: string;
  readonly title: string;
  readonly entry: string;
}

export interface ScreenSpaceTab {
  readonly kind: "screen";
  readonly id: string;
  readonly screenId: string;
  readonly title: string;
}

export type SpaceTab = PackSpaceTab | ScreenSpaceTab;

export interface SpaceState {
  readonly tabs: readonly SpaceTab[];
  readonly activeTabId: string | null;
}

export interface OpenPackTabInput {
  readonly kind?: "pack";
  readonly packId: string;
  readonly title: string;
  readonly entry: string;
}

export interface OpenScreenTabInput {
  readonly kind: "screen";
  readonly screenId: string;
  readonly title: string;
}

export type OpenTabInput = OpenPackTabInput | OpenScreenTabInput;

/** Open a screen tab unless one for this screen already exists. */
export interface EnsureScreenTabInput {
  readonly screenId: string;
  readonly title: string;
  /** Put a new tab first, so Home precedes any restored pack tab. */
  readonly first?: boolean;
}

const DEFAULT_SPACE = "default";

/** Version 1 wrote pack tabs without `kind`; version 2 writes the discriminated shape. */
export const SPACE_VERSION = 2;

/**
 * The space document holds tab metadata, not document content. Eight megabytes is
 * generous for a few thousand tabs and small enough that a hostile file cannot
 * make startup allocate an unbounded buffer before validation.
 */
const MAX_SPACES_BYTES = 8 * 1024 * 1024;

export class SpaceStore {
  readonly #path: string;
  #doc: LoroDoc;
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(path: string, doc: LoroDoc) {
    this.#path = path;
    this.#doc = doc;
  }

  static async open(path: string): Promise<SpaceStore> {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new SpaceStore(path, freshDocument());
      }
      await quarantine(path, "it could not be read", error);
      return new SpaceStore(path, freshDocument());
    }

    if (details.size > MAX_SPACES_BYTES) {
      await quarantine(path, "it is larger than the space limit");
      return new SpaceStore(path, freshDocument());
    }

    try {
      return new SpaceStore(path, LoroDoc.fromSnapshot(new Uint8Array(await readFile(path))));
    } catch (error) {
      // A space document that cannot be read must not delete the only copy. Keep the
      // bytes under a dated name, start a fresh document, and let the person
      // recover the old one by hand.
      await quarantine(path, "it could not be read", error);
      return new SpaceStore(path, freshDocument());
    }
  }

  state(): SpaceState {
    const parsed = spacesSchema.safeParse(this.#doc.toJSON());
    if (!parsed.success) {
      console.warn("[shell] space document does not match its schema", parsed.error.issues);
      return { tabs: [], activeTabId: null };
    }

    const tabs: SpaceTab[] = [];
    for (const id of parsed.data["tab-order"]) {
      const tab = parsed.data.tabs[id];
      if (tab === undefined) continue;
      const read = readTab(id, tab);
      if (read !== null) tabs.push(read);
    }

    const requested = parsed.data.shell.activeTabId ?? null;
    const activeTabId =
      requested !== null && tabs.some((tab) => tab.id === requested) ? requested : null;
    return { tabs, activeTabId };
  }

  async openTab(input: OpenTabInput): Promise<SpaceTab> {
    const id = randomUUID();
    const tabs = this.#doc.getMap("tabs");
    const tab = tabs.ensureMergeableMap(id);
    tab.set("title", input.title);
    tab.set("spaceId", DEFAULT_SPACE);

    let opened: SpaceTab;
    if (input.kind === "screen") {
      tab.set("kind", "screen");
      tab.set("screenId", input.screenId);
      opened = { kind: "screen", id, screenId: input.screenId, title: input.title };
    } else {
      tab.set("kind", "pack");
      tab.set("packId", input.packId);
      tab.set("entry", input.entry);
      opened = {
        kind: "pack",
        id,
        packId: input.packId,
        title: input.title,
        entry: input.entry,
      };
    }

    this.#doc.getList("tab-order").push(id);
    this.#doc.getMap("shell").set("activeTabId", id);
    await this.#commitAndSave();
    return opened;
  }

  /**
   * Open the one screen tab for `screenId`, or return the tab that already shows it.
   *
   * Home is created once per space document. `first` inserts it before any restored
   * pack tab. It becomes active only when the document had no tabs at all: that is the
   * first run, and a restored session keeps whatever it was showing.
   */
  async ensureScreenTab(
    input: EnsureScreenTabInput,
  ): Promise<{ readonly tab: ScreenSpaceTab; readonly opened: boolean }> {
    const before = this.state();
    const existing = before.tabs.find(
      (tab): tab is ScreenSpaceTab => tab.kind === "screen" && tab.screenId === input.screenId,
    );
    if (existing !== undefined) return { tab: existing, opened: false };

    const id = randomUUID();
    const tab = this.#doc.getMap("tabs").ensureMergeableMap(id);
    tab.set("kind", "screen");
    tab.set("screenId", input.screenId);
    tab.set("title", input.title);
    tab.set("spaceId", DEFAULT_SPACE);

    const order = this.#doc.getList("tab-order");
    if (input.first === true) order.insert(0, id);
    else order.push(id);
    if (before.tabs.length === 0) this.#doc.getMap("shell").set("activeTabId", id);

    await this.#commitAndSave();
    return {
      tab: { kind: "screen", id, screenId: input.screenId, title: input.title },
      opened: true,
    };
  }

  async activateTab(id: string | null): Promise<void> {
    const current = this.state();
    const exists = id !== null && current.tabs.some((tab) => tab.id === id);
    const next = exists ? id : null;
    // Restoring or re-clicking the active tab is not a change. Skipping the
    // write keeps startup independent of a writable data directory.
    if (current.activeTabId === next) return;
    this.#doc.getMap("shell").set("activeTabId", next);
    await this.#commitAndSave();
  }

  async closeTab(id: string): Promise<string | null> {
    const before = this.state();
    const index = before.tabs.findIndex((tab) => tab.id === id);
    const wasActive = before.activeTabId === id;

    this.#doc.getMap("tabs").delete(id);
    const order = this.#doc.getList("tab-order");
    const position = order.toArray().indexOf(id);
    if (position >= 0) order.delete(position, 1);

    if (wasActive) {
      const next = before.tabs[index + 1] ?? before.tabs[index - 1] ?? null;
      this.#doc.getMap("shell").set("activeTabId", next?.id ?? null);
    }

    await this.#commitAndSave();
    return this.state().activeTabId;
  }

  async setTitle(id: string, title: string): Promise<void> {
    if (!this.state().tabs.some((tab) => tab.id === id)) return;
    const trimmed = title.trim().slice(0, 120);
    if (trimmed.length === 0) return;
    this.#doc.getMap("tabs").ensureMergeableMap(id).set("title", trimmed);
    await this.#commitAndSave();
  }

  async flush(): Promise<void> {
    await this.#save();
  }

  async #commitAndSave(): Promise<void> {
    // Any write moves the document to the current shape. Existing tabs are left
    // exactly as they are; only the version marker is updated.
    this.#doc.getMap("shell").set("version", SPACE_VERSION);
    this.#doc.commit();
    await this.#save();
  }

  #save(): Promise<void> {
    const snapshot = this.#doc.export({ mode: "snapshot" });
    const next = this.#writeChain.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.tmp-${randomUUID()}`;
      try {
        await writeFile(temporary, snapshot);
        await rename(temporary, this.#path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    });
    // A failed write must not poison every later write. The caller still sees
    // the failure through `next`.
    this.#writeChain = next.catch(() => undefined);
    return next;
  }
}

type StoredTab = z.infer<typeof tabSchema>;

/** Read one stored tab, treating a missing `kind` as the version-1 pack tab. */
function readTab(id: string, tab: StoredTab): SpaceTab | null {
  const kind = tab.kind ?? "pack";
  if (kind === "screen") {
    if (tab.screenId === undefined) return null;
    return { kind: "screen", id, screenId: tab.screenId, title: tab.title };
  }
  if (tab.packId === undefined || tab.entry === undefined) return null;
  return { kind: "pack", id, packId: tab.packId, title: tab.title, entry: tab.entry };
}

async function quarantine(path: string, reason: string, error?: unknown): Promise<void> {
  const backup = `${path}.corrupt-${Date.now()}`;
  try {
    await rename(path, backup);
  } catch (renameError) {
    // The file vanished between the read attempt and the quarantine; there is
    // nothing left to preserve, and a fresh space document is the correct answer.
    if ((renameError as NodeJS.ErrnoException).code === "ENOENT") return;
    throw renameError;
  }
  console.warn(`[shell] space document quarantined at ${backup}: ${reason}`, error);
}

function freshDocument(): LoroDoc {
  const doc = new LoroDoc();
  initialize(doc);
  return doc;
}

function initialize(doc: LoroDoc): void {
  const shell = doc.getMap("shell");
  shell.set("version", SPACE_VERSION);
  shell.set("activeTabId", null);

  const space = doc.getMap("spaces").ensureMergeableMap(DEFAULT_SPACE);
  space.set("name", "Default");
  space.set("color", "#7c9cff");
  // Materialize the two tab containers so a first read is the empty state, not a
  // schema warning about a map that has not been created yet.
  doc.getMap("tabs");
  doc.getList("tab-order");
  doc.commit();
}
