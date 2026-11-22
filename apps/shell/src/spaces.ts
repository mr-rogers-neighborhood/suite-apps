import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LoroDoc } from "loro-crdt";
import { z } from "zod";

/**
 * The shell's own document.
 *
 * This is the one document the host may parse: the shell's space document. It holds what the
 * shell is showing, not what any pack means. App documents stay with their packs.
 *
 * The shape is deliberately container-ready. A tab carries a `spaceId`, and the
 * document carries a default space today, so adding containers and saved spaces
 * is a UI change rather than a data migration. Collaboration and sync are not
 * here yet; the decision record owns that order.
 */
const tabSchema = z.object({
  packId: z.string(),
  title: z.string(),
  entry: z.string(),
  spaceId: z.string(),
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

export interface SpaceTab {
  readonly id: string;
  readonly packId: string;
  readonly title: string;
  readonly entry: string;
}

export interface SpaceState {
  readonly tabs: readonly SpaceTab[];
  readonly activeTabId: string | null;
}

export interface OpenTabInput {
  readonly packId: string;
  readonly title: string;
  readonly entry: string;
}

const DEFAULT_SPACE = "default";

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
      tabs.push({ id, packId: tab.packId, title: tab.title, entry: tab.entry });
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
    tab.set("packId", input.packId);
    tab.set("title", input.title);
    tab.set("entry", input.entry);
    tab.set("spaceId", DEFAULT_SPACE);

    this.#doc.getList("tab-order").push(id);
    this.#doc.getMap("shell").set("activeTabId", id);
    await this.#commitAndSave();
    return { id, packId: input.packId, title: input.title, entry: input.entry };
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
  shell.set("version", 1);
  shell.set("activeTabId", null);

  const space = doc.getMap("spaces").ensureMergeableMap(DEFAULT_SPACE);
  space.set("name", "Default");
  space.set("color", "#7c9cff");
  doc.commit();
}
