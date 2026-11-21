import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type BudgetDocument,
  type BudgetInfo,
  type BudgetSnapshot,
  type ExportFormat,
  encodeBudgetFile,
  type LibraryEntry,
} from "@suite/budget-core";
import { MainDocumentStore } from "@suite/document-runtime/node";
import type { AppPaths } from "./budgetLocation";
import { backupCurrent, exportRecordsText } from "./library";

/**
 * Owns the authoritative document while a budget is open. Renderer edits arrive as CRDT
 * updates and are written to disk on a debounce through `@suite/document-runtime`; Budget keeps
 * its own file format, library path and previous/daily backups.
 */
export class BudgetStore extends MainDocumentStore<BudgetDocument, BudgetSnapshot> {
  #entry: LibraryEntry;

  private constructor(paths: AppPaths, entry: LibraryEntry, doc: BudgetDocument) {
    super({
      doc,
      path: entry.path,
      serialize: encodeBudgetFile,
      prepareDirectory: async (path) => {
        await mkdir(dirname(path), { recursive: true });
      },
      backup: () => backupCurrent(paths, entry.id, entry.path),
      // Budget copies the previous file and its daily backup before it writes the temp file.
      backupOrder: "before-temp",
      logWriteError: (error) => {
        console.error(
          "Suite Budget: could not write the budget",
          error instanceof Error ? error.message : String(error),
        );
      },
    });
    this.#entry = entry;
  }

  static fromDocument(paths: AppPaths, entry: LibraryEntry, doc: BudgetDocument): BudgetStore {
    return new BudgetStore(paths, entry, doc);
  }

  get entry(): LibraryEntry {
    return this.#entry;
  }

  get saveError(): string | null {
    return this.lastError;
  }

  info(): BudgetInfo {
    const settings = this.document.getSettings();
    return {
      id: this.#entry.id,
      name: this.document.getMeta().name,
      path: this.#entry.path,
      schemaVersion: this.document.getMeta().schemaVersion,
      currency: settings.currency,
      currencyScale: settings.currencyScale,
    };
  }

  async exportRecords(format: ExportFormat, target: string): Promise<void> {
    const contents = await exportRecordsText(this.getSnapshot(), format);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }

  async rename(name: string): Promise<LibraryEntry> {
    this.document.rename(name);
    this.#entry = { ...this.#entry, name };
    this.scheduleSave();
    return this.#entry;
  }
}
