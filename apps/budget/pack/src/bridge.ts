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
import type {
  DocumentSummary,
  DocumentsService,
  FileFilter,
  FileHandle,
  FilesService,
} from "@suite/pack-runtime";

/**
 * Budget's bridge, as a pack.
 *
 * The renderer is the same Vite app the Electron build ships. It talks to the
 * machine only through `window.suiteBudget`; this file installs that object over
 * the container's `window.suite`. The pack owns the `BudgetDocument` and writes
 * a *snapshot* at a durability boundary, because the container carries bytes it
 * cannot parse and must never be handed a raw or empty `LoroDoc`.
 *
 * Nothing here is desktop-only: no Node, no Electron, no absolute path. The
 * document id is the pack's file name and the only identity a caller may pass;
 * `LibraryEntry.path` is a display value with the same value, never a path.
 */

/** The pack may list this many budgets. One file read per budget is the cost. */
const MAX_LISTED_BUDGETS = 100;
/** The import guard the desktop's `import:read` applies. */
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const NOTICE_LIMIT = 20;

const BUDGET_FILTERS: readonly FileFilter[] = [
  { name: "Suite Budget", extensions: ["budget"] },
  { name: "Suite Budget records", extensions: ["json"] },
];

const SOURCE_FILTERS: readonly FileFilter[] = [
  { name: "Transactions", extensions: ["csv", "qif"] },
  { name: "Suite Budget records", extensions: ["json"] },
];

/** The part of `window.suite.info()` this pack relies on. */
interface SuiteInfo {
  readonly platform?: string | undefined;
  readonly [key: string]: unknown;
}

/** The lifecycle surface a desktop host may expose; older hosts do not. */
interface PackLifecycle {
  onFlush?(listener: () => void | Promise<void>): () => void;
  onSuspend?(listener: () => void | Promise<void>): () => void;
}

/**
 * The host services this prelude uses.
 *
 * `files` is optional so an older host, or a failed capability grant, produces a
 * sentence rather than a crash. The document service is required to do anything
 * at all; calling a budget method without it throws the sentence a person sees
 * in the app's error modal.
 */
export interface BudgetPackHost {
  readonly documents?: DocumentsService | undefined;
  readonly files?: Partial<FilesService> | undefined;
  readonly info?: (() => Promise<SuiteInfo>) | undefined;
  readonly lifecycle?: PackLifecycle | undefined;
}

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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeName(name: string): string {
  return name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "budget";
}

function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
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

  let current: OpenDocument | null = null;
  /** True when the open document has updates the file has not seen. */
  let dirty = false;
  /** The write in flight, so two boundaries cannot save out of order. */
  let saving: Promise<void> | null = null;
  let saveError: string | null = null;
  const noticeLog: string[] = [];
  const replacements = new Set<(snapshot: Uint8Array) => void>();
  const opened = new Set<(info: OpenBudgetInfo) => void>();
  const cleanups: Array<() => void> = [];

  function notice(message: string): void {
    console.warn(`Suite Budget pack: ${message}`);
    noticeLog.push(message);
    if (noticeLog.length > NOTICE_LIMIT) noticeLog.shift();
  }

  function fail(context: string, error: unknown): void {
    console.error(`Suite Budget pack: ${context}`, error);
  }

  function documents(): DocumentsService {
    if (host.documents === undefined) {
      throw new Error(
        "This host does not provide the documents service, so Suite Budget cannot open a budget.",
      );
    }
    return host.documents;
  }

  function files(): Partial<FilesService> | null {
    if (host.files === undefined) return null;
    return host.files;
  }

  function cancelledFile(message: string): FileResult {
    notice(message);
    return { canceled: true };
  }

  function requireCurrent(): OpenDocument {
    if (current === null) throw new Error("No budget is open.");
    return current;
  }

  async function loadDocument(id: string): Promise<BudgetDocument> {
    const record = await documents().open(id);
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
    const service = documents();
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
    await flush();
    current = { id, doc };
    dirty = false;
    saveError = null;
  }

  /**
   * Write the open document's snapshot at a boundary.
   *
   * A snapshot, not the renderer's update: `BudgetDocument.fromSnapshot` expects
   * a snapshot on the next launch, and an update written as the whole file
   * imports as an empty document. Updates arriving while the write is in flight
   * are written by the follow-up pass rather than left for the next boundary.
   */
  async function flush(): Promise<void> {
    const target = current;
    if (target === null || !dirty) return;

    if (saving !== null) {
      await saving;
      if (current === target && dirty) await flush();
      return;
    }

    dirty = false;
    let bytes: Uint8Array;
    try {
      bytes = target.doc.snapshot();
    } catch (error) {
      if (current === target) {
        dirty = true;
        saveError = describe(error);
      }
      throw error;
    }

    saving = documents()
      .save(target.id, bytes)
      .then(
        () => {
          saveError = null;
        },
        (error: unknown) => {
          if (current === target) {
            dirty = true;
            saveError = describe(error);
          }
          throw error;
        },
      );

    try {
      await saving;
    } finally {
      saving = null;
    }

    if (current === target && dirty) await flush();
  }

  async function settled(): Promise<void> {
    while (saving !== null) await saving;
  }

  async function closeCurrent(): Promise<void> {
    if (current === null) return;
    await flush();
    current = null;
    dirty = false;
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
    const service = documents();
    const summaries = await service.list();
    const entries: LibraryEntry[] = [];

    for (const summary of summaries.slice(0, MAX_LISTED_BUDGETS)) {
      try {
        const record = await service.open(summary.id);
        if (record === null || record.bytes.byteLength === 0) continue;
        const doc = BudgetDocument.fromSnapshot(record.bytes);
        if (doc.validate().isErr()) {
          notice(`${summary.name} could not be read and was left out of the library.`);
          continue;
        }
        entries.push(entryFor(summary.id, doc, summaryOpenedAt(summary, clock())));
      } catch (error) {
        // One unreadable document must not blank the launcher for the others.
        fail(`could not read ${summary.name} while listing`, error);
        notice(`${summary.name} could not be read and was left out of the library.`);
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
      await documents()
        .remove(id)
        .catch(() => undefined);
      throw error;
    }
    return openInfo(id, doc, summaryOpenedAt(summary, now));
  }

  async function openBudget(id: string): Promise<OpenBudgetInfo> {
    if (current !== null && current.id === id) {
      return openInfo(id, current.doc, clock().toISOString());
    }

    const doc = await loadDocument(id);
    await adopt(id, doc);

    // Opening is the one moment the library's recency should move. A failed
    // touch reports through `info().saveError` and does not stop the open.
    let summary: DocumentSummary | null = null;
    try {
      summary = await documents().save(id, doc.snapshot());
      saveError = null;
    } catch (error) {
      saveError = describe(error);
      fail("could not record the open budget's timestamp", error);
    }
    return openInfo(id, doc, summaryOpenedAt(summary, clock()));
  }

  async function closeBudget(): Promise<void> {
    await closeCurrent();
  }

  async function removeBudget(id: string): Promise<void> {
    if (current !== null && current.id === id) {
      throw new Error("Close the budget before removing it.");
    }
    await documents().remove(id);
  }

  async function renameBudget(id: string, name: string): Promise<LibraryEntry> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("A budget needs a name.");

    if (current !== null && current.id === id) {
      current.doc.rename(trimmed);
      dirty = true;
      await flush();
      return entryFor(id, current.doc, clock().toISOString());
    }

    const doc = await loadDocument(id);
    doc.rename(trimmed);
    const summary = await documents().save(id, doc.snapshot());
    return entryFor(id, doc, summaryOpenedAt(summary, clock()));
  }

  async function revealBudget(id: string): Promise<void> {
    // The host has no reveal, and a pack cannot name a path anyway. This is a
    // notice, never an exception: the launcher's menu item stays harmless.
    notice(`${id} lives in this pack's document store; this host cannot show it in a folder.`);
  }

  async function exportBudget(): Promise<FileResult> {
    const open = requireCurrent();
    await flush();

    const service = files();
    const pickSave = service?.pickSave;
    if (service === null || typeof pickSave !== "function") {
      return cancelledFile("This host has no file picker, so the budget could not be exported.");
    }

    let handle: FileHandle | null;
    try {
      handle = await pickSave.call(
        service,
        `${safeName(open.doc.getMeta().name)}-${dateStamp(clock())}.budget`,
      );
    } catch (error) {
      return cancelledFile(`The file picker could not open: ${describe(error)}`);
    }
    if (handle === null) return { canceled: true };

    const text = encodeBudgetFile(open.doc, clock());
    try {
      await handle.write(new TextEncoder().encode(text));
      return { canceled: false, path: handle.info.name };
    } catch (error) {
      return cancelledFile(`The budget could not be written: ${describe(error)}`);
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async function exportRecords(format: ExportFormat): Promise<FileResult> {
    const open = requireCurrent();
    await flush();

    const service = files();
    const pickSave = service?.pickSave;
    if (service === null || typeof pickSave !== "function") {
      return cancelledFile("This host has no file picker, so records could not be exported.");
    }

    const snapshot = open.doc.getSnapshot();
    const text =
      format === "json"
        ? encodeRecords(snapshot)
        : format === "csv"
          ? transactionsToCsv(snapshot)
          : transactionsToQif(snapshot);

    let handle: FileHandle | null;
    try {
      handle = await pickSave.call(
        service,
        `${safeName(open.doc.getMeta().name)}-transactions.${format}`,
      );
    } catch (error) {
      return cancelledFile(`The file picker could not open: ${describe(error)}`);
    }
    if (handle === null) return { canceled: true };

    try {
      await handle.write(new TextEncoder().encode(text));
      return { canceled: false, path: handle.info.name };
    } catch (error) {
      return cancelledFile(`The records could not be written: ${describe(error)}`);
    } finally {
      await handle.close().catch(() => undefined);
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
    const existing = new Set((await documents().list()).map((summary) => summary.id));
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
    for (const listener of [...replacements]) {
      try {
        listener(snapshot);
      } catch (error) {
        fail("a budget-replaced listener failed", error);
      }
    }
  }

  function emitOpened(info: OpenBudgetInfo): void {
    for (const listener of [...opened]) {
      try {
        listener(info);
      } catch (error) {
        fail("a budget-opened listener failed", error);
      }
    }
  }

  async function importBudget(): Promise<ImportBudgetResult> {
    const service = files();
    const pickOpen = service?.pickOpen;
    if (service === null || typeof pickOpen !== "function") {
      notice("This host has no file picker, so a budget could not be imported.");
      return { canceled: true };
    }

    let handle: FileHandle | null;
    try {
      handle = await pickOpen.call(service, BUDGET_FILTERS);
    } catch (error) {
      notice(`The file picker could not open: ${describe(error)}`);
      return { canceled: true };
    }
    if (handle === null) return { canceled: true };

    try {
      const bytes = await handle.read();
      if (bytes.byteLength > MAX_IMPORT_BYTES) {
        notice("That file is larger than 100 MB, so it was not imported.");
        return { canceled: true };
      }

      const now = clock();
      const doc = documentFromImport(new TextDecoder().decode(bytes), now);
      const id = await freshDocumentId(doc);
      const summary = await writeNewDocument(id, doc.snapshot());
      try {
        await adopt(id, doc);
      } catch (error) {
        await documents()
          .remove(id)
          .catch(() => undefined);
        throw error;
      }

      const info = openInfo(id, doc, summaryOpenedAt(summary, now));
      emitReplaced(info.snapshot);
      emitOpened(info);
      return { canceled: false, opened: info };
    } catch (error) {
      // The renderer shows this sentence in its error modal; a picker that
      // simply failed above stays a cancellation with a notice instead.
      throw error instanceof Error
        ? error
        : new Error(`The budget could not be imported: ${describe(error)}`);
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async function readImportSource(): Promise<ImportReadResult> {
    const service = files();
    const pickOpen = service?.pickOpen;
    if (service === null || typeof pickOpen !== "function") {
      notice("This host has no file picker, so a file could not be chosen.");
      return { canceled: true };
    }

    let handle: FileHandle | null;
    try {
      handle = await pickOpen.call(service, SOURCE_FILTERS);
    } catch (error) {
      notice(`The file picker could not open: ${describe(error)}`);
      return { canceled: true };
    }
    if (handle === null) return { canceled: true };

    try {
      if (handle.info.size > MAX_IMPORT_BYTES) {
        notice("That file is larger than 100 MB, so it was not read.");
        return { canceled: true };
      }
      const bytes = await handle.read();
      return {
        canceled: false,
        name: handle.info.name,
        text: new TextDecoder().decode(bytes),
      };
    } catch (error) {
      // The import wizard has no error boundary around this call, so a failed
      // read is a notice and a cancellation rather than an unhandled rejection.
      notice(`That file could not be read: ${describe(error)}`);
      return { canceled: true };
    } finally {
      await handle.close().catch(() => undefined);
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
      dirty = true;
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
        saveError,
      };
    },
    exportBudget,
    exportRecords,
    onBudgetReplaced(listener) {
      replacements.add(listener);
      return () => {
        replacements.delete(listener);
      };
    },
    onBudgetOpened(listener) {
      opened.add(listener);
      return () => {
        opened.delete(listener);
      };
    },
    // No contributions exist yet; the surface stays so the renderer's one
    // subscription does not need a branch.
    onCommand: () => () => undefined,
    platform: async () => {
      try {
        const info = await host.info?.();
        if (typeof info?.platform === "string" && info.platform.length > 0) return info.platform;
      } catch (error) {
        fail("could not read the host's platform", error);
      }
      return "unknown";
    },
  };

  function installBoundaries(): void {
    const targetDocument = (globalThis as { document?: Document }).document;
    if (targetDocument !== undefined) {
      const onVisibility = (): void => {
        if (targetDocument.visibilityState !== "hidden") return;
        void flush().catch((error) => fail("flush on hide", error));
      };
      targetDocument.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => targetDocument.removeEventListener("visibilitychange", onVisibility));
    }

    const targetWindow = (globalThis as { window?: Window }).window;
    if (targetWindow !== undefined) {
      const onPageHide = (): void => {
        void flush().catch((error) => fail("flush on page hide", error));
      };
      targetWindow.addEventListener("pagehide", onPageHide);
      cleanups.push(() => targetWindow.removeEventListener("pagehide", onPageHide));
    }

    const lifecycle = host.lifecycle;
    if (lifecycle?.onFlush !== undefined) {
      cleanups.push(lifecycle.onFlush(() => flush()));
    }
    if (lifecycle?.onSuspend !== undefined) {
      cleanups.push(lifecycle.onSuspend(() => flush()));
    }
  }

  if (withBoundaries) installBoundaries();

  return {
    bridge,
    flush,
    settled,
    notices: () => [...noticeLog],
    documentId: () => current?.id ?? null,
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          fail("a boundary listener could not be removed", error);
        }
      }
      replacements.clear();
      opened.clear();
    },
  };
}
