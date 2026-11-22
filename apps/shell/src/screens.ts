import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SuiteWidgetSize } from "@suite/contracts";
import {
  type Screen,
  ScreenDocument,
  type ScreenPlacement,
  type SuiteScreenWidget,
} from "@suite/screens";
import { defaultHomeScreen } from "./home.js";

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
   * Open the Screen at `path`, creating Home when it does not exist.
   *
   * The file is not written on open. Like the space document, startup stays independent
   * of a writable data directory; the first real change creates the file.
   */
  static async open(path: string): Promise<ScreenStore> {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new ScreenStore(path, freshDocument());
      }
      await quarantine(path, "it could not be read", error);
      return new ScreenStore(path, freshDocument());
    }

    if (details.size > MAX_SCREEN_BYTES) {
      await quarantine(path, "it is larger than the screen limit");
      return new ScreenStore(path, freshDocument());
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (error) {
      await quarantine(path, "it could not be read", error);
      return new ScreenStore(path, freshDocument());
    }

    const opened = ScreenDocument.open(bytes);
    if (!opened.ok) {
      // The refusal is a complete sentence already: a corrupt snapshot and a newer
      // version read differently, and neither is repaired by guessing.
      await quarantine(path, opened.message);
      return new ScreenStore(path, freshDocument());
    }
    return new ScreenStore(path, opened.document);
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
    const next = this.#writeChain.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      // Keep the previous good snapshot beside the document. A failed write then
      // leaves both the last good file and its backup in place.
      await copyFile(this.#path, `${this.#path}.bak`).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      const temporary = `${this.#path}.tmp-${randomUUID()}`;
      try {
        await writeFile(temporary, snapshot);
        await rename(temporary, this.#path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    });
    // A failed write must not poison every later write. The caller still sees the
    // failure through `next`.
    this.#writeChain = next.catch(() => undefined);
    return next;
  }
}

function freshDocument(): ScreenDocument {
  const created = ScreenDocument.fromJson(defaultHomeScreen());
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
