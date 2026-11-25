import {
  buildWorkspaceFile,
  type ParsedWorkspaceFile,
  tryReadWorkspaceFile,
  type WorkspaceDocument,
  type WorkspaceFileAttachmentInputs,
  type WorkspaceFileManifest,
} from "@suite/graph";
import type {
  DocumentsService,
  FileHandle,
  FilesService,
  ImportedFolder,
  RecentDocument,
  RecentsService,
} from "@suite/pack-runtime";
import type {
  BridgeAttachment,
  BridgeCreateRequest,
  BridgeCreateResult,
  BridgeDocumentInfo,
  BridgeFailure,
  BridgeRecentFile,
  BridgeSaveRequest,
  DesktopBridge,
} from "../../../../legacy/canvas/src/host/bridge";

/**
 * Canvas's bridge, built out of the host's `window.suite` services.
 *
 * Canvas already has a host seam: `window.suiteDesktop` is what makes the renderer a desktop app,
 * and `LoroDesktopPersistence` writes through it. A pack is another host, not another app mode, so
 * this module implements that same seam over the host document store. The renderer, the schema and
 * the editor are untouched; only the place the bytes live changes.
 *
 * The host's document envelope carries the pack's payload unchanged. Canvas's payload is the whole
 * `.canvas` envelope — snapshot, manifest and embedded images — because that is the file a person
 * exports and re-imports. The host never parses it, and the pack never sees a path.
 *
 * What this pack cannot do is the interesting part. It cannot choose a folder, watch one, reveal a
 * document in one, or open a file where it lies by itself: the host offers a picker, a scoped
 * document store, a copy into the pack's own root, a reveal action and a change notice, and the pack
 * uses exactly those. None of them hands the pack a path, and the pack never polls a directory. The
 * host-gap list this conversion named is closed in the same change that adds those services.
 */

/** The host document id that was open, in this pack's own session storage. Not document truth. */
const DOCUMENT_KEY = "suite.canvas.pack.document";
/** The same bound Budget and Planner use when a launcher lists a pack's documents. */
const MAX_LISTED_DOCUMENTS = 100;
/** How long edits are coalesced before a write. The desktop shell uses 400 ms for the same reason. */
const FLUSH_DEBOUNCE_MS = 250;
const NOTICE_LIMIT = 20;

const CANVAS_FILTERS = [{ name: "Suite Canvas", extensions: ["canvas", "suite", "json"] }] as const;

/** The part of `window.suite.info()` this pack relies on. */
interface SuiteInfo {
  readonly platform?: string | undefined;
  readonly [key: string]: unknown;
}

/** The lifecycle surface a host may expose. */
interface PackLifecycle {
  onFlush?(listener: () => void | Promise<void>): () => void;
  onSuspend?(listener: () => void | Promise<void>): () => void;
}

/**
 * The host services this pack uses.
 *
 * `files` is optional so a host without the grant gives a sentence rather than a crash. The
 * document service is required to do anything at all; a method called without it throws the
 * sentence a person sees.
 */
export interface CanvasPackHost {
  readonly documents?: DocumentsService | undefined;
  readonly recents?: RecentsService | undefined;
  readonly files?: Partial<FilesService> | undefined;
  readonly info?: (() => Promise<SuiteInfo>) | undefined;
  readonly lifecycle?: PackLifecycle | undefined;
}

export interface CanvasPackOptions {
  readonly host: CanvasPackHost;
  /** Tests turn this off when they drive `flush()` themselves. */
  readonly boundaries?: boolean | undefined;
  /**
   * What to do after a document becomes current.
   *
   * A pack has no second window to move. The renderer reads its session once at import time, so
   * the page reloads and boots on the document this bridge stored. Tests inject a recorder.
   */
  readonly reload?: (() => void) | undefined;
  /**
   * Where imported image bytes go, so the cards draw them again.
   *
   * Canvas keeps pasted images in this session's IndexedDB; the pack supplies the renderer's own
   * store in `prelude.ts` and a recorder in tests. The pack never reads the bytes back itself.
   */
  readonly storeAttachment?:
    | ((id: string, bytes: Uint8Array, mime: string) => Promise<void>)
    | undefined;
}

export interface CanvasPack {
  readonly bridge: DesktopBridge;
  /** Write the open document's envelope when it has unsaved updates. */
  flush(): Promise<void>;
  /** The host document id, for a device assertion. Never a path. */
  documentId(): string | null;
  /** Show the open canvas where the host keeps it. False when it is gone. */
  reveal(): Promise<boolean>;
  /** Copy a person-chosen folder into this pack's own root, through the host. */
  importFolder(): Promise<ImportedFolder | null>;
  /** Document ids the host reported as changed, newest last. Ids, never paths. */
  libraryChanges(): readonly string[];
  /** Sentences already shown to the person, newest last. */
  notices(): readonly string[];
  dispose(): void;
}

interface OpenDocument {
  readonly id: string;
  readonly workspaceId: string;
  readonly info: BridgeDocumentInfo;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return cleaned.length > 0 ? cleaned : "workspace.canvas";
}

function newDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `canvas-${Date.now().toString(36)}`;
}

function counts(workspace: WorkspaceDocument): WorkspaceFileManifest {
  return {
    boards: workspace.listBoards().length,
    cards: workspace.listCards().length,
    types: workspace.listTypes().length,
    tags: workspace.listTags().length,
  };
}

function toAttachmentInputs(
  attachments: readonly BridgeAttachment[],
): WorkspaceFileAttachmentInputs {
  return Object.fromEntries(
    attachments.map((entry) => [
      entry.id,
      {
        mime: entry.mime,
        name: entry.name,
        width: entry.width,
        height: entry.height,
        bytes: entry.bytes,
      },
    ]),
  );
}

function fromParsedAttachments(parsed: ParsedWorkspaceFile): WorkspaceFileAttachmentInputs {
  return Object.fromEntries(
    parsed.attachments.map((entry) => [
      entry.id,
      {
        mime: entry.mime,
        name: entry.name,
        width: entry.width,
        height: entry.height,
        bytes: entry.bytes,
      },
    ]),
  );
}

function parseEnvelope(bytes: Uint8Array): ParsedWorkspaceFile {
  if (bytes.byteLength === 0) throw new Error("That canvas has no saved document yet.");
  const parsed = tryReadWorkspaceFile(new TextDecoder().decode(bytes));
  if (parsed.isErr()) throw new Error(parsed.error.message);
  return parsed.value;
}

function displayName(parsed: ParsedWorkspaceFile, fallback: string): string {
  try {
    const name = parsed.workspace.workspaceName().trim();
    return name.length > 0 ? name : fallback;
  } catch {
    return fallback;
  }
}

/** The last document id this pack opened, kept as UI state rather than document truth. */
function rememberedDocument(): string | null {
  try {
    return globalThis.localStorage?.getItem(DOCUMENT_KEY) ?? null;
  } catch {
    return null;
  }
}

function rememberDocument(id: string | null): void {
  try {
    if (id === null) globalThis.localStorage?.removeItem(DOCUMENT_KEY);
    else globalThis.localStorage?.setItem(DOCUMENT_KEY, id);
  } catch {
    // A full or disabled session storage must not stop a document opening.
  }
}

/**
 * The display name of a document this pack has opened, kept as UI state.
 *
 * A recent list built by the host carries the document id and nothing else, because the host
 * records an open without reading the file. Canvas already knows the workspace's name when it
 * adopts a document, so it remembers that name here and never has to open every recent document
 * just to paint the launcher.
 */
const TITLES_KEY = "suite.canvas.pack.titles";
const MAX_REMEMBERED_TITLES = 200;

function rememberedTitles(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(TITLES_KEY);
    if (raw === null || raw === undefined) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const titles: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) titles[id] = value;
    }
    return titles;
  } catch {
    return {};
  }
}

function rememberTitle(id: string, name: string): void {
  if (name.length === 0 || name === id) return;
  try {
    const titles = rememberedTitles();
    if (titles[id] === name) return;
    delete titles[id];
    titles[id] = name;
    const ids = Object.keys(titles);
    for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_REMEMBERED_TITLES))) {
      delete titles[stale];
    }
    globalThis.localStorage?.setItem(TITLES_KEY, JSON.stringify(titles));
  } catch {
    // A full or disabled session storage must not stop a document opening.
  }
}

function titleFor(id: string): string {
  return rememberedTitles()[id] ?? id;
}

export function createCanvasPack(options: CanvasPackOptions): CanvasPack {
  const { host } = options;
  const withBoundaries = options.boundaries !== false;
  const reload = options.reload ?? (() => globalThis.location?.reload());

  let current: OpenDocument | null = null;
  let currentSnapshot: Uint8Array | null = null;
  /** The images the last envelope carried, so a document-only save keeps them. */
  let previousAttachments: WorkspaceFileAttachmentInputs = {};
  let pendingSave: BridgeSaveRequest | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let saveFailure: string | null = null;
  const noticeLog: string[] = [];
  const changeLog: string[] = [];
  const cleanups: Array<() => void> = [];

  function notice(message: string): void {
    console.warn(`Suite Canvas pack: ${message}`);
    noticeLog.push(message);
    if (noticeLog.length > NOTICE_LIMIT) noticeLog.shift();
  }

  function fail(context: string, error: unknown): void {
    console.error(`Suite Canvas pack: ${context}`, error);
  }

  function documents(): DocumentsService {
    if (host.documents === undefined) {
      throw new Error(
        "This host does not provide the documents service, so Suite Canvas cannot open a canvas.",
      );
    }
    return host.documents;
  }

  function files(): Partial<FilesService> | null {
    return host.files ?? null;
  }

  function infoFor(id: string, workspaceId: string, name: string): BridgeDocumentInfo {
    return {
      workspaceId,
      // Display only. A pack never hands the renderer a filesystem path, and nothing builds one.
      path: id,
      name,
      migratedFrom: null,
      recoveredFrom: null,
    };
  }

  function adopt(id: string, parsed: ParsedWorkspaceFile, snapshot: Uint8Array): void {
    const workspaceId = parsed.file.workspaceId;
    const name = displayName(parsed, id);
    current = {
      id,
      workspaceId,
      info: infoFor(id, workspaceId, name),
    };
    currentSnapshot = snapshot;
    previousAttachments = fromParsedAttachments(parsed);
    rememberDocument(id);
    rememberTitle(id, name);
  }

  function recordChanges(documentIds: readonly string[]): void {
    for (const id of documentIds) {
      if (!changeLog.includes(id)) changeLog.push(id);
    }
  }

  /** What the host noticed while this pack was closed. Ids only, and never a poll. */
  async function pendingChanges(): Promise<readonly string[]> {
    const service = host.documents;
    const pending = service?.pendingChanges;
    if (service === undefined || pending === undefined) return [];
    try {
      return await pending.call(service);
    } catch (error) {
      fail("could not read the documents that changed", error);
      return [];
    }
  }

  async function summaryOf(id: string): Promise<boolean> {
    const summaries = await documents().list();
    return summaries.some((summary) => summary.id === id);
  }

  async function ensureDocument(id: string): Promise<void> {
    if (await summaryOf(id)) return;
    await documents().create(id);
  }

  async function writeDocument(id: string, bytes: Uint8Array): Promise<void> {
    const existed = await summaryOf(id);
    if (!existed) await documents().create(id);
    try {
      await documents().save(id, bytes);
    } catch (error) {
      // A document created blank for this write must not be left as a trap for the next open.
      if (!existed)
        await documents()
          .remove(id)
          .catch(() => undefined);
      throw error;
    }
  }

  /**
   * The document to open: the last one this pack opened, else the newest the host lists.
   *
   * There is no shell to hand a document over, so "open" means "resume". A remembered id that the
   * store no longer holds falls through to the newest rather than failing an open.
   */
  async function resolveDocumentId(): Promise<string | null> {
    const summaries = await documents().list();
    if (summaries.length === 0) return null;
    const remembered = rememberedDocument();
    if (remembered !== null && summaries.some((summary) => summary.id === remembered)) {
      return remembered;
    }
    const newest = [...summaries].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return newest?.id ?? null;
  }

  async function loadDocument(): Promise<{
    info: BridgeDocumentInfo;
    snapshot: Uint8Array;
  } | null> {
    if (current !== null && currentSnapshot !== null) {
      return { info: current.info, snapshot: currentSnapshot };
    }

    // Ask before opening: the host records an open as seen, so the pending list
    // has to be read first or a change made while the pack was closed is lost.
    const pending = await pendingChanges();
    const id = await resolveDocumentId();
    if (id === null) return null;
    const record = await documents().open(id);
    // A document the host made and never filled is not an open document; the launcher is the
    // honest surface for it, and nothing has been lost.
    if (record === null || record.bytes.byteLength === 0) return null;
    const parsed = parseEnvelope(record.bytes);
    const snapshot = new Uint8Array(parsed.workspace.exportSnapshot());
    adopt(id, parsed, snapshot);
    recordChanges(pending);
    if (pending.includes(id)) {
      // The open above already read the file as it is now, so the newer document is what is open.
      notice("This canvas changed on disk while Canvas was closed; the newer file is open.");
    }
    return { info: current?.info ?? infoFor(id, parsed.file.workspaceId, id), snapshot };
  }

  function scheduleSave(request: BridgeSaveRequest): void {
    pendingSave = request;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushPending();
    }, FLUSH_DEBOUNCE_MS);
  }

  function flushPending(): Promise<void> {
    const request = pendingSave;
    if (request === null) return writing;
    pendingSave = null;
    writing = writing
      .then(async () => {
        const target = current;
        if (target === null) throw new Error("No canvas is open.");
        const attachments =
          request.attachments === undefined
            ? previousAttachments
            : toAttachmentInputs(request.attachments);
        const envelope = buildWorkspaceFile({
          workspaceId: target.workspaceId,
          snapshot: request.snapshot,
          manifest: request.manifest,
          attachments,
        });
        await documents().save(target.id, new TextEncoder().encode(JSON.stringify(envelope)));
        previousAttachments = attachments;
        saveFailure = null;
      })
      .catch((error: unknown) => {
        saveFailure = describeError(error);
        notice(`The canvas could not be saved: ${saveFailure}`);
      });
    return writing;
  }

  async function flushDocument(): Promise<{ ok: true } | BridgeFailure> {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // A save may arrive while a write is in flight; its timer is cleared by the next pass.
    for (;;) {
      if (pendingSave !== null) {
        if (saveTimer !== null) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        await flushPending();
        continue;
      }
      await writing;
      if (pendingSave === null && saveTimer === null) break;
    }
    return saveFailure === null
      ? { ok: true }
      : { ok: false, code: "write-failed", message: saveFailure };
  }

  async function saveDocument(request: BridgeSaveRequest): Promise<void> {
    if (current === null || current.workspaceId !== request.workspaceId) {
      const id = request.workspaceId;
      await ensureDocument(id);
      current = {
        id,
        workspaceId: request.workspaceId,
        info: infoFor(id, request.workspaceId, request.title ?? id),
      };
      currentSnapshot = request.snapshot;
      previousAttachments = {};
      rememberDocument(id);
      if (request.title !== undefined) rememberTitle(id, request.title.trim());
    }

    if (request.title !== undefined && request.title.trim().length > 0 && current !== null) {
      current = { ...current, info: { ...current.info, name: request.title.trim() } };
      rememberTitle(current.id, request.title.trim());
    }
    if (request.attachments !== undefined) {
      previousAttachments = toAttachmentInputs(request.attachments);
    }
    currentSnapshot = request.snapshot;
    scheduleSave(request);
  }

  async function createDocument(seed: BridgeCreateRequest): Promise<BridgeCreateResult> {
    try {
      // A new document replaces whatever this page had open, so the old one is written first.
      await flushDocument();
      const id = seed.workspaceId;
      const parsedAttachments = toAttachmentInputs(seed.attachments ?? []);
      const envelope = buildWorkspaceFile({
        workspaceId: id,
        snapshot: seed.snapshot,
        manifest: seed.manifest,
        attachments: parsedAttachments,
      });
      await writeDocument(id, new TextEncoder().encode(JSON.stringify(envelope)));
      current = {
        id,
        workspaceId: id,
        info: infoFor(id, id, seed.title),
      };
      currentSnapshot = seed.snapshot;
      previousAttachments = parsedAttachments;
      rememberDocument(id);
      rememberTitle(id, seed.title);
      reload();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: `The canvas could not be created: ${describeError(error)}`,
      };
    }
  }

  /** Copy a picked `.canvas` into the pack's document store under a fresh workspace id. */
  async function importEnvelope(bytes: Uint8Array, pickedName: string): Promise<void> {
    const parsed = parseEnvelope(bytes);
    const id = newDocumentId();

    if (options.storeAttachment !== undefined) {
      for (const attachment of parsed.attachments) {
        try {
          await options.storeAttachment(attachment.id, attachment.bytes, attachment.mime);
        } catch (error) {
          // One image that cannot be cached must not cost the document.
          fail(`could not restore ${attachment.id} from ${pickedName}`, error);
          notice("One image could not be restored; the rest of the canvas imported.");
        }
      }
    } else if (parsed.attachments.length > 0) {
      notice("This host cannot store images, so imported images will show a placeholder.");
    }

    const snapshot = new Uint8Array(parsed.workspace.exportSnapshot());
    const envelope = buildWorkspaceFile({
      workspaceId: id,
      snapshot,
      manifest: counts(parsed.workspace),
      attachments: fromParsedAttachments(parsed),
    });
    await writeDocument(id, new TextEncoder().encode(JSON.stringify(envelope)));
    current = {
      id,
      workspaceId: id,
      info: infoFor(id, id, displayName(parsed, pickedName)),
    };
    currentSnapshot = snapshot;
    previousAttachments = fromParsedAttachments(parsed);
    rememberDocument(id);
    rememberTitle(id, displayName(parsed, pickedName));
    reload();
  }

  async function openFileDialog(): Promise<void> {
    // Leave the open canvas durable before the page moves to the imported one.
    await flushDocument();
    const service = files();
    const pickOpen = service?.pickOpen;
    if (service === null || typeof pickOpen !== "function") {
      throw new Error("This host has no file picker, so a canvas could not be imported.");
    }

    const handle = await pickOpen.call(service, CANVAS_FILTERS);
    if (handle === null) return;
    const pickedName = handle.info.name;
    let bytes: Uint8Array;
    try {
      bytes = await handle.read();
    } finally {
      await handle.close().catch(() => undefined);
    }
    await importEnvelope(bytes, pickedName);
  }

  async function openDocument(path: string): Promise<void> {
    await flushDocument();
    if (!(await summaryOf(path))) {
      throw new Error("That canvas is no longer in this pack's document store.");
    }
    rememberDocument(path);
    reload();
  }

  async function recentFiles(): Promise<readonly BridgeRecentFile[]> {
    const recents = host.recents;
    if (recents !== undefined) {
      let rows: readonly RecentDocument[];
      try {
        rows = await recents.list();
      } catch (error) {
        notice(`Recent files are unavailable: ${describeError(error)}`);
        return [];
      }
      const entries: BridgeRecentFile[] = [];
      for (const row of rows) {
        // Another pack's row carries no document id: this pack cannot open it, and painting it
        // here would claim a document this pack does not own (S11.1).
        if (row.documentId === null) continue;
        entries.push({
          path: row.documentId,
          // The host records an open without reading the document, so the display name is the
          // one this pack remembered when it adopted the workspace.
          name: titleFor(row.documentId),
          folder: "Suite Canvas",
          openedAt: row.openedAt,
        });
        if (entries.length >= MAX_LISTED_DOCUMENTS) break;
      }
      return entries;
    }
    return storeRecents();
  }

  /** The old listing, for a host that has no recent-file service of its own. */
  async function storeRecents(): Promise<readonly BridgeRecentFile[]> {
    const summaries = await documents().list();
    const entries: BridgeRecentFile[] = [];
    for (const summary of summaries
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_LISTED_DOCUMENTS)) {
      let name = summary.id;
      try {
        const record = await documents().open(summary.id);
        if (record !== null && record.bytes.byteLength > 0) {
          name = displayName(parseEnvelope(record.bytes), summary.id);
        }
      } catch (error) {
        // One unreadable document must not blank the launcher for the others.
        fail(`could not read ${summary.id} while listing`, error);
      }
      entries.push({
        path: summary.id,
        name,
        folder: "Suite Canvas",
        openedAt: summary.updatedAt,
      });
    }
    return entries;
  }

  /** Show the open canvas where the host keeps it. The pack never learns the path. */
  async function revealDocument(): Promise<boolean> {
    if (current === null) throw new Error("No canvas is open.");
    const service = documents();
    const reveal = service.reveal;
    if (reveal === undefined) throw new Error("This host cannot show a document's folder.");
    const summary = await reveal.call(service, current.id);
    if (summary === null) {
      notice("That canvas is no longer in this pack's document store.");
      return false;
    }
    return true;
  }

  /** Copy a person-chosen folder into this pack's own root through the host's picker. */
  async function importFolder(): Promise<ImportedFolder | null> {
    const service = files();
    const importFolderFromHost = service?.importFolder;
    if (service === null || importFolderFromHost === undefined) {
      throw new Error("This host cannot import a folder.");
    }
    return importFolderFromHost.call(service);
  }

  async function saveTextFile(
    name: string,
    text: string,
  ): Promise<{ saved: boolean; name?: string }> {
    const service = files();
    const pickSave = service?.pickSave;
    if (service === null || typeof pickSave !== "function") {
      throw new Error("This host has no file picker, so the canvas could not be exported.");
    }

    const handle: FileHandle | null = await pickSave.call(service, safeFileName(name));
    if (handle === null) return { saved: false };
    try {
      await handle.write(new TextEncoder().encode(text));
      return { saved: true, name: handle.info.name };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  const bridge: DesktopBridge = {
    host: "desktop",
    // The renderer shows this nowhere; it is the marker `desktopBridge()` requires.
    version: "0.0.0",
    platform: "unknown",
    loadDocument,
    saveDocument,
    flushDocument,
    documentInfo: async () => {
      const opened = await loadDocument();
      return opened?.info ?? null;
    },
    appInfo: async () => {
      let platform = "unknown";
      try {
        const info = await host.info?.();
        if (typeof info?.platform === "string" && info.platform.length > 0)
          platform = info.platform;
      } catch (error) {
        fail("could not read the host's platform", error);
      }
      return { host: "desktop", version: "0.0.0", platform };
    },
    createDocument,
    openFileDialog,
    openDocument,
    recentFiles,
    forgetRecent: async (path) => {
      const recents = host.recents;
      if (recents === undefined) {
        // A host with no recents service has no row to remove; the document is not the row.
        notice(`${path} stays in this pack's document store; this host has no recent-file list.`);
        return;
      }
      try {
        // The row goes; the document stays. That is what a person asked for.
        await recents.forget(path);
      } catch (error) {
        notice(`The recent entry could not be removed: ${describeError(error)}`);
      }
    },
    saveTextFile,
  };

  function installBoundaries(): void {
    const lifecycle = host.lifecycle;
    if (lifecycle?.onFlush !== undefined) {
      cleanups.push(
        lifecycle.onFlush(async () => {
          await flushDocument();
        }),
      );
    }
    if (lifecycle?.onSuspend !== undefined) {
      cleanups.push(
        lifecycle.onSuspend(async () => {
          await flushDocument();
        }),
      );
    }
    const documentsService = host.documents;
    const onChanged = documentsService?.onChanged;
    if (documentsService !== undefined && onChanged !== undefined) {
      cleanups.push(
        onChanged.call(documentsService, (documentIds) => {
          recordChanges(documentIds);
          if (current !== null && documentIds.includes(current.id)) {
            notice("This canvas changed on disk. Reopen it to load the newer file.");
          }
        }),
      );
    }
  }

  if (withBoundaries) installBoundaries();

  return {
    bridge,
    flush: async () => {
      await flushDocument();
    },
    documentId: () => current?.id ?? null,
    reveal: revealDocument,
    importFolder,
    libraryChanges: () => [...changeLog],
    notices: () => [...noticeLog],
    dispose: () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          fail("a lifecycle listener could not be removed", error);
        }
      }
    },
  };
}
