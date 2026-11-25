import type { DocumentSummary } from "@suite/pack-runtime";
import {
  type PackBridgeHost,
  PackFilePickerError,
  createEmitter,
  createPackBridge,
  dateStamp,
  describeError,
  hostPlatform,
  safeFileName,
  withPickedFile,
  withSaveFile,
  writeTextToHandle,
} from "@suite/pack-runtime";
import {
  type BudgetBridge,
  BudgetDocument,
  type BudgetInfo,
  type CreateBudgetInput,
  createId,
  decodeBudgetFile,
  decodeRecords,
  type ExportFormat,
  encodeBudgetFile,
  encodeRecords,
  type FileResult,
  type ImportBudgetResult,
  type ImportReadResult,
  type LibraryEntry,
  type OpenBudgetInfo,
  transactionsToCsv,
  transactionsToQif,
} from "@suite/budget-core";

/**
 * Budget's bridge, as a pack.
 *
 * The renderer is the same Vite app the Electron build ships. It talks to the
 * machine only through `window.suiteBudget`; this file installs that object over
 * the container's `window.suite`. The pack owns the `BudgetDocument` and writes
 * a *snapshot* at a durability boundary, because the container carries bytes it
 * cannot parse and must never be handed a raw or empty `LoroDoc`.
 *
 * The save boundary, the picker, the notice list and disposal live in
 * `@suite/pack-runtime`; this file supplies Budget's library, its file codec and
 * its snapshot policy.
 *
 * Nothing here is desktop-only: no Node, no Electron, no absolute path. The
 * document id is the pack's file name and the only identity a caller may pass;
 * `LibraryEntry.path` is a display value with the same value, never a path.
 */

/** The pack may list this many budgets. One file read per budget is the cost. */
const MAX_LISTED_BUDGETS = 100;
/** The import guard the desktop's `import:read` applies. */
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const BUDGET_FILTERS = [
  { name: "Suite Budget", extensions: ["budget"] },
  { name: "Suite Budget records", extensions: ["json"] },
] as const;

const SOURCE_FILTERS = [
  { name: "Transactions", extensions: ["csv", "qif"] },
  { name: "Suite Budget records", extensions: ["json"] },
] as const;

/**
 * The host services this prelude uses.
 *
 * `files` is optional so an older host, or a failed capability grant, produces a
 * sentence rather than a crash. The document service is required to do anything
 * at all; calling a budget method without it throws the sentence a person sees
 * in the app's error modal.
 */
export type BudgetPackHost = PackBridgeHost;

export interface BudgetPackOptions {
  readonly host: BudgetPackHost;
  /** Injected by tests; production uses the wall clock. */
  readonly now?: (() => Date) | undefined;
  /** Tests turn this off when they drive `flush()` themselves. */
  readonly boundaries?: boolean | undefined;
}

export interface BudgetPack {
  readonly bridge: BudgetBridge;
  /** Write the open document's snapshot when it has unsaved updates. */
  flush(): Promise<void>;
  /** Wait for a boundary write that is already in flight. */
  settled(): Promise<void>;
  /** Sentences already shown to the person, newest last. */
  notices(): readonly string[];
  documentId(): string | null;
  dispose(): void;
}

interface OpenDocument {
  readonly id: string;
  readonly doc: BudgetDocument;
}

function safeName(name: string): string {
  return safeFileName(name, "budget", { dots: false });
}

function documentIdOf(doc: BudgetDocument): string {
  return `${doc.getMeta().budgetId}.budget`;
}

function entryFor(id: string, doc: BudgetDocument, lastOpenedAt: string): LibraryEntry {
  const meta = doc.getMeta();
  const settings = doc.getSettings();
  return {
    id,
    name: meta.name,
    // Display only. A pack never hands the renderer a filesystem path.
    path: id,
    currency: settings.currency,
    createdAt: meta.createdAt,
    lastOpenedAt,
  };
}

function summaryOpenedAt(summary: DocumentSummary | null, fallback: Date): string {
  return summary === null ? fallback.toISOString() : new Date(summary.updatedAt).toISOString();
}

export function createBudgetPack(options: BudgetPackOptions): BudgetPack {
  const { host } = options;
  const clock = options.now ?? (() => new Date());
  const withBoundaries = options.boundaries !== false;

  const runtime = createPackBridge<OpenDocument>({
    app: "Suite Budget",
    noun: "budget",
    host,
    boundaries: withBoundaries,
    pageBoundaries: true,
    debounceMs: 0,
    captureFailure: false,
    retryOnFailure: true,
    write: writeBudget,
  });

  const replacements = createEmitter<Uint8Array>();
  const opened = createEmitter<OpenBudgetInfo>();

  async function writeBudget(target: OpenDocument): Promise<void> {
    await runtime.documents().save(target.id, target.doc.snapshot());
  }

  function cancelledFile(message: string): FileResult {
    runtime.notice(message);
    return { canceled: true };
  }

  function requireCurrent(): OpenDocument {
    const open = runtime.current();
    if (open === null) throw new Error("No budget is open.");
    return open;
  }

  async function loadDocument(id: string): Promise<BudgetDocument> {
    const record = await runtime.documents().open(id);
    if (record === null) throw new Error("That budget is no longer in the library.");
    if (record.bytes.byteLength === 0) {
      throw new Error("That budget has no saved document yet.");
    }
    const doc = BudgetDocument.fromSnapshot(record.bytes);
    const validation = doc.validate();
    if (validation.isErr()) {
      throw new Error("That budget could not be read: the document failed validation.");
    }
    return doc;
  }

  function openInfo(id: string, doc: BudgetDocument, lastOpenedAt: string): OpenBudgetInfo {
    return { entry: entryFor(id, doc, lastOpenedAt), snapshot: doc.snapshot() };
  }

  async function writeNewDocument(id: string, bytes: Uint8Array): Promise<DocumentSummary> {
    const service = runtime.documents();
    let created = false;
    try {
      await service.create(id);
      created = true;
      return await service.save(id, bytes);
    } catch (error) {
      if (created) await service.remove(id).catch(() => undefined);
      throw error;
    }
  }

  /** Replace the open document, writing the old one first. */
  async function adopt(id: string, doc: BudgetDocument): Promise<void> {
    await runtime.flush();
    runtime.setCurrent({ id, doc });
    runtime.clearFailure();
  }

  async function flush(): Promise<void> {
    await runtime.flush();
  }

  /**
   * Every budget the pack holds, newest first.
   *
   * The host's summary carries no budget-specific fields, so each document is
   * read to recover its name, currency and creation time. That is bounded to
   * `MAX_LISTED_BUDGETS`; a library beyond it lists the most recently updated
   * hundred, and the rest stay openable by id through `openBudget`.
   */
  async function listBudgets(): Promise<LibraryEntry[]> {
    const service = runtime.documents();
    const summaries = await service.list();
    const entries: LibraryEntry[] = [];

    for (const summary of summaries.slice(0, MAX_LISTED_BUDGETS)) {
      try {
        const record = await service.open(summary.id);
        if (record === null || record.bytes.byteLength === 0) continue;
        const doc = BudgetDocument.fromSnapshot(record.bytes);
        if (doc.validate().isErr()) {
          runtime.notice(`${summary.name} could not be read and was left out of the library.`);
          continue;
        }
        entries.push(entryFor(summary.id, doc, summaryOpenedAt(summary, clock())));
      } catch (error) {
        // One unreadable document must not blank the launcher for the others.
        runtime.fail(`could not read ${summary.name} while listing`, error);
        runtime.notice(`${summary.name} could not be read and was left out of the library.`);
      }
    }

    return entries.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  }

  async function createBudget(input: CreateBudgetInput): Promise<OpenBudgetInfo> {
    const now = clock();
    const doc = BudgetDocument.create({
      name: input.name,
      currency: input.currency,
      currencyScale: input.currencyScale,
      firstDayOfWeek: input.firstDayOfWeek,
      now,
    });
    doc.applyStarterTemplate(input.template, now);
    if (input.startingAccount !== undefined) {
      doc.createAccount(
        {
          name: input.startingAccount.name,
          type: input.startingAccount.type,
          onBudget: input.startingAccount.onBudget,
          startingBalanceMinor: input.startingAccount.startingBalanceMinor,
          startingDate: dateStamp(now),
        },
        now,
      );
    }

    const id = documentIdOf(doc);
    const summary = await writeNewDocument(id, doc.snapshot());
    try {
      await adopt(id, doc);
    } catch (error) {
      // The previous document could not be flushed, so this one never became
      // open; remove the file rather than leave a budget nothing points at.
      await runtime
        .documents()
        .remove(id)
        .catch(() => undefined);
      throw error;
    }
    return openInfo(id, doc, summaryOpenedAt(summary, now));
  }

  async function openBudget(id: string): Promise<OpenBudgetInfo> {
    const open = runtime.current();
    if (open !== null && open.id === id) {
      return openInfo(id, open.doc, clock().toISOString());
    }

    const doc = await loadDocument(id);
    await adopt(id, doc);

    // Opening is the one moment the library's recency should move. A failed
    // touch reports through `info().saveError` and does not stop the open.
    let summary: DocumentSummary | null = null;
    try {
      summary = await runtime.documents().save(id, doc.snapshot());
      runtime.clearFailure();
    } catch (error) {
      runtime.recordFailure(error);
      runtime.fail("could not record the open budget's timestamp", error);
    }
    return openInfo(id, doc, summaryOpenedAt(summary, clock()));
  }

  async function closeBudget(): Promise<void> {
    const open = runtime.current();
    if (open === null) return;
    await runtime.flush();
    runtime.setCurrent(null);
  }

  async function removeBudget(id: string): Promise<void> {
    const open = runtime.current();
    if (open !== null && open.id === id) {
      throw new Error("Close the budget before removing it.");
    }
    await runtime.documents().remove(id);
  }

  async function renameBudget(id: string, name: string): Promise<LibraryEntry> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("A budget needs a name.");

    const open = runtime.current();
    if (open !== null && open.id === id) {
      open.doc.rename(trimmed);
      runtime.markDirty();
      await runtime.flush();
      return entryFor(id, open.doc, clock().toISOString());
    }

    const doc = await loadDocument(id);
    doc.rename(trimmed);
    const summary = await runtime.documents().save(id, doc.snapshot());
    return entryFor(id, doc, summaryOpenedAt(summary, clock()));
  }

  async function revealBudget(id: string): Promise<void> {
    // The host has no reveal, and a pack cannot name a path anyway. This is a
    // notice, never an exception: the launcher's menu item stays harmless.
    runtime.notice(`${id} lives in this pack's document store; this host cannot show it in a folder.`);
  }

  async function exportBudget(): Promise<FileResult> {
    const open = requireCurrent();
    await flush();
    const text = encodeBudgetFile(open.doc, clock());

    try {
      const path = await withSaveFile(
        runtime.files(),
        `${safeName(open.doc.getMeta().name)}-${dateStamp(clock())}.budget`,
        "This host has no file picker, so the budget could not be exported.",
        runtime.fail,
        async (handle) => {
          await writeTextToHandle(handle, text, "The budget could not be written");
          return handle.info.name;
        },
      );
      return path === null ? { canceled: true } : { canceled: false, path };
    } catch (error) {
      return cancelledFile(describeError(error));
    }
  }

  async function exportRecords(format: ExportFormat): Promise<FileResult> {
    const open = requireCurrent();
    await flush();

    const snapshot = open.doc.getSnapshot();
    const text =
      format === "json"
        ? encodeRecords(snapshot)
        : format === "csv"
          ? transactionsToCsv(snapshot)
          : transactionsToQif(snapshot);

    try {
      const path = await withSaveFile(
        runtime.files(),
        `${safeName(open.doc.getMeta().name)}-transactions.${format}`,
        "This host has no file picker, so records could not be exported.",
        runtime.fail,
        async (handle) => {
          await writeTextToHandle(handle, text, "The records could not be written");
          return handle.info.name;
        },
      );
      return path === null ? { canceled: true } : { canceled: false, path };
    } catch (error) {
      return cancelledFile(describeError(error));
    }
  }

  function documentFromImport(raw: string, now: Date): BudgetDocument {
    const budget = decodeBudgetFile(raw);
    if (budget.isOk()) {
      const doc = BudgetDocument.fromSnapshot(budget.value);
      const validation = doc.validate();
      if (validation.isErr()) {
        throw new Error("That budget file failed validation.");
      }
      return doc;
    }

    if (budget.error.code === "unsupported-version" || budget.error.code === "unsupported-schema") {
      throw new Error(budget.error.message);
    }

    const records = decodeRecords(raw);
    if (records.isOk()) {
      const doc = BudgetDocument.fromRecords(records.value, now);
      const validation = doc.validate();
      if (validation.isErr()) throw new Error("That records file failed validation.");
      return doc;
    }

    throw new Error(
      `That file is not a Suite Budget file (${budget.error.code}; ${records.error.code}).`,
    );
  }

  async function freshDocumentId(doc: BudgetDocument): Promise<string> {
    const existing = new Set((await runtime.documents().list()).map((summary) => summary.id));
    const preferred = documentIdOf(doc);
    if (!existing.has(preferred)) return preferred;

    // The document keeps its own id; the file gets a new one so an import never
    // replaces a budget that is already in the library.
    for (;;) {
      const candidate = `${createId("budget")}.budget`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  function emitReplaced(snapshot: Uint8Array): void {
    replacements.emit(snapshot, runtime.fail, "a budget-replaced listener failed");
  }

  function emitOpened(info: OpenBudgetInfo): void {
    opened.emit(info, runtime.fail, "a budget-opened listener failed");
  }

  type ImportPick = { readonly kind: "too-large" } | { readonly kind: "opened"; readonly info: OpenBudgetInfo };

  async function importBudget(): Promise<ImportBudgetResult> {
    try {
      const picked = await withPickedFile<ImportPick>(
        runtime.files(),
        BUDGET_FILTERS,
        "This host has no file picker, so a budget could not be imported.",
        runtime.fail,
        async (handle) => {
          const bytes = await handle.read();
          if (bytes.byteLength > MAX_IMPORT_BYTES) {
            runtime.notice("That file is larger than 100 MB, so it was not imported.");
            return { kind: "too-large" };
          }

          const now = clock();
          const doc = documentFromImport(new TextDecoder().decode(bytes), now);
          const id = await freshDocumentId(doc);
          const summary = await writeNewDocument(id, doc.snapshot());
          try {
            await adopt(id, doc);
          } catch (error) {
            await runtime
              .documents()
              .remove(id)
              .catch(() => undefined);
            throw error;
          }

          return { kind: "opened", info: openInfo(id, doc, summaryOpenedAt(summary, now)) };
        },
      );
      if (picked === null || picked.kind === "too-large") return { canceled: true };

      emitReplaced(picked.info.snapshot);
      emitOpened(picked.info);
      return { canceled: false, opened: picked.info };
    } catch (error) {
      // The renderer shows this sentence in its error modal; a picker that
      // simply failed above stays a cancellation with a notice instead.
      if (error instanceof PackFilePickerError) {
        runtime.notice(error.message);
        return { canceled: true };
      }
      throw error instanceof Error
        ? error
        : new Error(`The budget could not be imported: ${describeError(error)}`);
    }
  }

  type SourceRead =
    | { readonly kind: "too-large" }
    | { readonly kind: "read"; readonly name: string; readonly text: string };

  async function readImportSource(): Promise<ImportReadResult> {
    try {
      const source = await withPickedFile<SourceRead>(
        runtime.files(),
        SOURCE_FILTERS,
        "This host has no file picker, so a file could not be chosen.",
        runtime.fail,
        async (handle) => {
          if (handle.info.size > MAX_IMPORT_BYTES) {
            runtime.notice("That file is larger than 100 MB, so it was not read.");
            return { kind: "too-large" };
          }
          const bytes = await handle.read();
          return {
            kind: "read",
            name: handle.info.name,
            text: new TextDecoder().decode(bytes),
          };
        },
      );
      if (source === null || source.kind === "too-large") return { canceled: true };
      return { canceled: false, name: source.name, text: source.text };
    } catch (error) {
      // The import wizard has no error boundary around this call, so a failed
      // read is a notice and a cancellation rather than an unhandled rejection.
      if (error instanceof PackFilePickerError) {
        runtime.notice(error.message);
      } else {
        runtime.notice(`That file could not be read: ${describeError(error)}`);
      }
      return { canceled: true };
    }
  }

  const bridge: BudgetBridge = {
    listBudgets,
    createBudget,
    openBudget,
    closeBudget,
    removeBudget,
    revealBudget,
    renameBudget,
    importBudget,
    openBudgetFile: importBudget,
    readImportSource,
    loadSnapshot: async () => requireCurrent().doc.snapshot(),
    commit: async (update) => {
      const open = requireCurrent();
      open.doc.applyUpdate(update);
      runtime.markDirty();
    },
    info: async (): Promise<BudgetInfo> => {
      const open = requireCurrent();
      const meta = open.doc.getMeta();
      const settings = open.doc.getSettings();
      return {
        id: open.id,
        name: meta.name,
        path: open.id,
        schemaVersion: meta.schemaVersion,
        currency: settings.currency,
        currencyScale: settings.currencyScale,
        saveError: runtime.failure(),
      };
    },
    exportBudget,
    exportRecords,
    onBudgetReplaced(listener) {
      return replacements.add(listener);
    },
    onBudgetOpened(listener) {
      return opened.add(listener);
    },
    // No contributions exist yet; the surface stays so the renderer's one
    // subscription does not need a branch.
    onCommand: () => () => undefined,
    platform: async () => hostPlatform(host.info, "unknown", runtime.fail),
  };

  return {
    bridge,
    flush,
    settled: runtime.settled,
    notices: runtime.notices,
    documentId: () => runtime.current()?.id ?? null,
    dispose: () => {
      runtime.dispose();
      replacements.clear();
      opened.clear();
    },
  };
}
