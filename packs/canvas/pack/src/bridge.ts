import {
  buildWorkspaceFile,
  type ParsedWorkspaceFile,
  tryReadWorkspaceFile,
  type WorkspaceDocument,
  type WorkspaceFileAttachmentInputs,
  type WorkspaceFileManifest,
} from "@suite/graph";
import type {
  ImportedFolder,
  RecentDocument,
  RecentsService,
} from "@suite/pack-runtime";
import {
  type PackBridgeHost,
  createPackBridge,
  describeError,
  hostPlatform,
  pickFolder,
  safeFileName,
  withPickedFile,
  withSaveFile,
  writeTextToHandle,
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
} from "../../src/host/bridge";

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
 * Everything that is not Canvas's schema lives in `@suite/pack-runtime`: the save debounce, the
 * boundary flush, the picker and notice sentences, and the disposal list. This file is the adapter
 * that owns the `.canvas` envelope, the attachment store and the recent-title memory.
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

const CANVAS_FILTERS = [{ name: "Suite Canvas", extensions: ["canvas", "suite", "json"] }] as const;

/** The host services this pack uses. */
export interface CanvasPackHost extends PackBridgeHost {
  readonly recents?: RecentsService | undefined;
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

function safeWorkspaceName(name: string): string {
  return safeFileName(name, "workspace.canvas");
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

  const runtime = createPackBridge<OpenDocument>({
    app: "Suite Canvas",
    noun: "canvas",
    host,
    boundaries: withBoundaries,
    pageBoundaries: false,
    debounceMs: FLUSH_DEBOUNCE_MS,
    captureFailure: true,
    retryOnFailure: false,
    write: writePending,
  });

  let currentSnapshot: Uint8Array | null = null;
  /** The images the last envelope carried, so a document-only save keeps them. */
  let previousAttachments: WorkspaceFileAttachmentInputs = {};
  let pendingSave: BridgeSaveRequest | null = null;
  const changeLog: string[] = [];

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
    runtime.setCurrent({
      id,
      workspaceId,
      info: infoFor(id, workspaceId, name),
    });
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
      runtime.fail("could not read the documents that changed", error);
      return [];
    }
  }

  async function summaryOf(id: string): Promise<boolean> {
    const summaries = await runtime.documents().list();
    return summaries.some((summary) => summary.id === id);
  }

  async function ensureDocument(id: string): Promise<void> {
    if (await summaryOf(id)) return;
    await runtime.documents().create(id);
  }

  async function writeDocument(id: string, bytes: Uint8Array): Promise<void> {
    const existed = await summaryOf(id);
    if (!existed) await runtime.documents().create(id);
    try {
      await runtime.documents().save(id, bytes);
    } catch (error) {
      // A document created blank for this write must not be left as a trap for the next open.
      if (!existed)
        await runtime
          .documents()
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
    const summaries = await runtime.documents().list();
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
    const open = runtime.current();
    if (open !== null && currentSnapshot !== null) {
      return { info: open.info, snapshot: currentSnapshot };
    }

    // Ask before opening: the host records an open as seen, so the pending list
    // has to be read first or a change made while the pack was closed is lost.
    const pending = await pendingChanges();
    const id = await resolveDocumentId();
    if (id === null) return null;
    const record = await runtime.documents().open(id);
    // A document the host made and never filled is not an open document; the launcher is the
    // honest surface for it, and nothing has been lost.
    if (record === null || record.bytes.byteLength === 0) return null;
    const parsed = parseEnvelope(record.bytes);
    const snapshot = new Uint8Array(parsed.workspace.exportSnapshot());
    adopt(id, parsed, snapshot);
    recordChanges(pending);
    if (pending.includes(id)) {
      // The open above already read the file as it is now, so the newer document is what is open.
      runtime.notice(
        "This canvas changed on disk while Canvas was closed; the newer file is open.",
      );
    }
    return {
      info: runtime.current()?.info ?? infoFor(id, parsed.file.workspaceId, id),
      snapshot,
    };
  }

  async function writePending(target: OpenDocument): Promise<void> {
    const request = pendingSave;
    if (request === null) return;
    pendingSave = null;
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
    await runtime.documents().save(target.id, new TextEncoder().encode(JSON.stringify(envelope)));
    previousAttachments = attachments;
  }

  async function flushDocument(): Promise<{ ok: true } | BridgeFailure> {
    await runtime.flush();
    const failure = runtime.failure();
    return failure === null
      ? { ok: true }
      : { ok: false, code: "write-failed", message: failure };
  }

  async function saveDocument(request: BridgeSaveRequest): Promise<void> {
    let target = runtime.current();
    if (target === null || target.workspaceId !== request.workspaceId) {
      const id = request.workspaceId;
      await ensureDocument(id);
      target = {
        id,
        workspaceId: request.workspaceId,
        info: infoFor(id, request.workspaceId, request.title ?? id),
      };
      runtime.setCurrent(target);
      currentSnapshot = request.snapshot;
      previousAttachments = {};
      rememberDocument(id);
      if (request.title !== undefined) rememberTitle(id, request.title.trim());
    }

    if (request.title !== undefined && request.title.trim().length > 0 && target !== null) {
      target = { ...target, info: { ...target.info, name: request.title.trim() } };
      runtime.setCurrent(target);
      rememberTitle(target.id, request.title.trim());
    }
    if (request.attachments !== undefined) {
      previousAttachments = toAttachmentInputs(request.attachments);
    }
    currentSnapshot = request.snapshot;
    pendingSave = request;
    runtime.markDirty();
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
      runtime.setCurrent({
        id,
        workspaceId: id,
        info: infoFor(id, id, seed.title),
      });
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
          runtime.fail(`could not restore ${attachment.id} from ${pickedName}`, error);
          runtime.notice("One image could not be restored; the rest of the canvas imported.");
        }
      }
    } else if (parsed.attachments.length > 0) {
      runtime.notice("This host cannot store images, so imported images will show a placeholder.");
    }

    const snapshot = new Uint8Array(parsed.workspace.exportSnapshot());
    const envelope = buildWorkspaceFile({
      workspaceId: id,
      snapshot,
      manifest: counts(parsed.workspace),
      attachments: fromParsedAttachments(parsed),
    });
    await writeDocument(id, new TextEncoder().encode(JSON.stringify(envelope)));
    runtime.setCurrent({
      id,
      workspaceId: id,
      info: infoFor(id, id, displayName(parsed, pickedName)),
    });
    currentSnapshot = snapshot;
    previousAttachments = fromParsedAttachments(parsed);
    rememberDocument(id);
    rememberTitle(id, displayName(parsed, pickedName));
    reload();
  }

  async function openFileDialog(): Promise<void> {
    // Leave the open canvas durable before the page moves to the imported one.
    await flushDocument();
    const picked = await withPickedFile(
      runtime.files(),
      CANVAS_FILTERS,
      "This host has no file picker, so a canvas could not be imported.",
      runtime.fail,
      async (handle) => ({ name: handle.info.name, bytes: await handle.read() }),
    );
    if (picked === null) return;
    await importEnvelope(picked.bytes, picked.name);
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
        runtime.notice(`Recent files are unavailable: ${describeError(error)}`);
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
    const summaries = await runtime.documents().list();
    const entries: BridgeRecentFile[] = [];
    for (const summary of summaries
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_LISTED_DOCUMENTS)) {
      let name = summary.id;
      try {
        const record = await runtime.documents().open(summary.id);
        if (record !== null && record.bytes.byteLength > 0) {
          name = displayName(parseEnvelope(record.bytes), summary.id);
        }
      } catch (error) {
        // One unreadable document must not blank the launcher for the others.
        runtime.fail(`could not read ${summary.id} while listing`, error);
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
    const open = runtime.current();
    if (open === null) throw new Error("No canvas is open.");
    const service = runtime.documents();
    const reveal = service.reveal;
    if (reveal === undefined) throw new Error("This host cannot show a document's folder.");
    const summary = await reveal.call(service, open.id);
    if (summary === null) {
      runtime.notice("That canvas is no longer in this pack's document store.");
      return false;
    }
    return true;
  }

  /** Copy a person-chosen folder into this pack's own root through the host's picker. */
  async function importFolder(): Promise<ImportedFolder | null> {
    return pickFolder(runtime.files(), "This host cannot import a folder.");
  }

  async function saveTextFile(
    name: string,
    text: string,
  ): Promise<{ saved: boolean; name?: string }> {
    const path = await withSaveFile(
      runtime.files(),
      safeWorkspaceName(name),
      "This host has no file picker, so the canvas could not be exported.",
      runtime.fail,
      async (handle) => {
        await writeTextToHandle(handle, text, "The canvas could not be written");
        return handle.info.name;
      },
    );
    return path === null ? { saved: false } : { saved: true, name: path };
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
      const platform = await hostPlatform(host.info, "unknown", runtime.fail);
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
        runtime.notice(
          `${path} stays in this pack's document store; this host has no recent-file list.`,
        );
        return;
      }
      try {
        // The row goes; the document stays. That is what a person asked for.
        await recents.forget(path);
      } catch (error) {
        runtime.notice(`The recent entry could not be removed: ${describeError(error)}`);
      }
    },
    saveTextFile,
  };

  // The change watch is Canvas's own: it records ids and names the canvas in the sentence. The
  // flush boundaries themselves are the runtime's.
  if (withBoundaries) {
    const documentsService = host.documents;
    const onChanged = documentsService?.onChanged;
    if (documentsService !== undefined && onChanged !== undefined) {
      runtime.addCleanup(
        onChanged.call(documentsService, (documentIds) => {
          recordChanges(documentIds);
          const open = runtime.current();
          if (open !== null && documentIds.includes(open.id)) {
            runtime.notice("This canvas changed on disk. Reopen it to load the newer file.");
          }
        }),
      );
    }
  }

  return {
    bridge,
    flush: async () => {
      await flushDocument();
    },
    documentId: () => runtime.current()?.id ?? null,
    reveal: revealDocument,
    importFolder,
    libraryChanges: () => [...changeLog],
    notices: runtime.notices,
    dispose: runtime.dispose,
  };
}
