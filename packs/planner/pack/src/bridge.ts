import type {
  DocumentsService,
  FileHandle,
  FilesService,
  PackLaunchContext,
  ProjectionsService,
} from "@suite/pack-runtime";
import {
  decodeWorkspaceFile,
  type ExportResult,
  encodeWorkspaceFile,
  type ImportResult,
  type PlannerBridge,
  WorkspaceDocument,
  type WorkspaceInfo,
} from "@suite/planner-core";
import { projectReminders, REMINDER_PACK_ID, REMINDER_PROJECTION } from "./projection";

/**
 * Planner's bridge, built out of the host's `window.suite` services.
 *
 * This is the half of the pack that knows Planner. It lives in Planner's own source because the
 * host installs a signed bundle and learns nothing: no field of a `.planner` ever reaches the
 * shell's code.
 *
 * The awkward part is ownership. On the desktop, main holds the document, applies the renderer's
 * updates and writes the file. A pack has no main, so this object is that owner: it holds a
 * `WorkspaceDocument`, applies each update, and writes a *snapshot* at the boundaries ADR-0005
 * names — never per keystroke, and never an update written out as if it were a whole document. The
 * host owns the envelope, the atomic write and the backup; this pack must not keep a second
 * backup scheme, because two can disagree.
 *
 * It goes through `WorkspaceDocument` rather than `loro-crdt` on purpose: this repository keeps
 * every touch of Loro inside `packages/planner-core/src/loro`, and `scripts/check-shape.mjs` fails the gate
 * if something else imports it. The wrapper is not a restriction here — the schema-initialising
 * `create()`, the peer-id handling in `fromSnapshot`, and the commit-before-export in `snapshot()`
 * are all things a pack would otherwise have to re-derive and get wrong.
 */

/** The host document id. The id is the file name inside the host's pack-root, never a path. */
const DOCUMENT_ID = "planner";
/** What the app calls the file in its own UI. A pack never sees an absolute path. */
const DOCUMENT_NAME = "Planner.planner";
/** How long edits are coalesced before a write. The same debounce the desktop store uses. */
const FLUSH_DEBOUNCE_MS = 300;

const PLANNER_FILTERS = [{ name: "Suite Planner", extensions: ["planner"] }] as const;

/** The part of `window.suite.info()` this pack relies on. */
interface SuiteInfo {
  readonly platform?: string | undefined;
  readonly [key: string]: unknown;
}

/** The lifecycle surface a host may expose; the shell does not yet. */
interface PackLifecycle {
  onFlush?(listener: () => void | Promise<void>): () => void;
  onSuspend?(listener: () => void | Promise<void>): () => void;
}

/**
 * The host services this prelude uses.
 *
 * `files` is optional so a host without the grant gives a sentence instead of a crash. The document
 * service is required to do anything at all; a method called without it throws the sentence a
 * person sees in the app's error modal.
 */
export interface PlannerPackHost {
  readonly packId?: string | undefined;
  readonly documents?: DocumentsService | undefined;
  readonly files?: Partial<FilesService> | undefined;
  readonly info?: (() => Promise<SuiteInfo>) | undefined;
  readonly lifecycle?: PackLifecycle | undefined;
  readonly launch?: (() => Promise<PackLaunchContext>) | undefined;
  /** A link the host routes to this tab while it is already open. */
  readonly onDeepLink?: ((listener: (url: string) => void) => () => void) | undefined;
  /** The declared-projection seam. The host calls the entry the manifest names. */
  readonly projections?: ProjectionsService | undefined;
}

export interface PlannerPackOptions {
  readonly host: PlannerPackHost;
  /** Injected by tests; production uses the wall clock. */
  readonly now?: (() => Date) | undefined;
  /** Tests turn this off when they drive `flush()` themselves. */
  readonly boundaries?: boolean | undefined;
}

export interface PlannerPack {
  readonly bridge: PlannerBridge;
  /** Write the open document's snapshot when it has unsaved updates. */
  flush(): Promise<void>;
  /** The host document id, for a device assertion. Never a path. */
  documentId(): string | null;
  dispose(): void;
}

interface OpenDocument {
  readonly id: string;
  doc: WorkspaceDocument;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeName(name: string): string {
  return name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "planner";
}

function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function documentFromSnapshot(bytes: Uint8Array): WorkspaceDocument {
  return WorkspaceDocument.fromSnapshot(bytes);
}

export function createPlannerPack(options: PlannerPackOptions): PlannerPack {
  const { host } = options;
  const clock = options.now ?? (() => new Date());
  const withBoundaries = options.boundaries !== false;

  let current: OpenDocument | null = null;
  /** True when this session started with no document; the renderer shows its launcher then. */
  let created = false;
  /** True once the pack has a document in hand, whether it read one or the app adopted one. */
  let hasDocument = false;
  /** True when the open document has updates the file has not seen. */
  let dirty = false;
  /** The write in flight, so two boundaries cannot save out of order. */
  let saving: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let opening: Promise<void> | null = null;
  const replacements = new Set<(snapshot: Uint8Array) => void>();
  const cleanups: Array<() => void> = [];
  const packId = host.packId ?? REMINDER_PACK_ID;

  // The manifest names `reminders`. The pack binds that entry; the host supplies
  // a read-only handle for the document it already resolved. A projection that
  // runs on save must not schedule, poll or show anything itself.
  if (host.projections !== undefined) {
    cleanups.push(
      host.projections.register(REMINDER_PROJECTION, async (projected) => {
        const bytes = await projected.read();
        return projectReminders(bytes, { packId, now: clock() });
      }),
    );
  }

  function fail(context: string, error: unknown): void {
    console.error(`Suite Planner pack: ${context}`, error);
  }

  function documents(): DocumentsService {
    if (host.documents === undefined) {
      throw new Error(
        "This host does not provide the documents service, so Suite Planner cannot open a workspace.",
      );
    }
    return host.documents;
  }

  function files(): Partial<FilesService> | null {
    return host.files ?? null;
  }

  function cancelTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((error: unknown) => {
        fail("could not save the workspace", error);
      });
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * A document id that is free in this pack's own root.
   *
   * The first run is normally `planner`. A host can hand back an empty record that a previous
   * create wrote, so the loop only runs when a name is already in use.
   */
  async function freshDocumentId(service: DocumentsService): Promise<string> {
    const existing = new Set((await service.list()).map((summary) => summary.id));
    if (!existing.has(DOCUMENT_ID)) return DOCUMENT_ID;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${DOCUMENT_ID}-${suffix}`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  /**
   * Find the workspace this pack owns, or make an empty one.
   *
   * Empty bytes are the host's way of saying "this record exists but the app has not written it
   * yet", so that is the first-run answer, not a document. A non-empty payload that the document
   * layer refuses is terminal: a newer schema or a corrupt snapshot must be reported, never
   * replaced by a fresh empty workspace.
   */
  async function open(): Promise<void> {
    const service = documents();
    const summaries = await service.list();
    let emptyId: string | null = null;
    let refusal: unknown = null;

    for (const summary of summaries) {
      const record = await service.open(summary.id);
      if (record === null) continue;
      if (record.bytes.byteLength === 0) {
        emptyId ??= record.id;
        continue;
      }
      try {
        const doc = documentFromSnapshot(record.bytes);
        current = { id: record.id, doc };
        created = false;
        hasDocument = true;
        return;
      } catch (error) {
        // Keep the sentence: if nothing readable is left, this is what the person must see.
        refusal ??= error;
      }
    }

    if (refusal !== null) throw refusal;

    if (emptyId !== null) {
      current = { id: emptyId, doc: WorkspaceDocument.create() };
      created = true;
      return;
    }

    const id = await freshDocumentId(service);
    await service.create(id);
    current = { id, doc: WorkspaceDocument.create() };
    created = true;
  }

  function ensure(): Promise<void> {
    opening ??= open();
    return opening;
  }

  async function flush(): Promise<void> {
    cancelTimer();
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
      if (current === target) dirty = true;
      throw error;
    }

    saving = documents()
      .save(target.id, bytes)
      .then(
        () => undefined,
        (error: unknown) => {
          if (current === target) dirty = true;
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

  const onHidden = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void flush().catch((error) => fail("flush on hide", error));
    }
  };

  const onPageHide = () => {
    void flush().catch((error) => fail("flush on page hide", error));
  };

  function installBoundaries(): void {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onHidden);
      cleanups.push(() => document.removeEventListener("visibilitychange", onHidden));
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", onPageHide);
      cleanups.push(() => window.removeEventListener("pagehide", onPageHide));
    }
    const lifecycle = host.lifecycle;
    if (lifecycle?.onFlush !== undefined) cleanups.push(lifecycle.onFlush(() => flush()));
    if (lifecycle?.onSuspend !== undefined) cleanups.push(lifecycle.onSuspend(() => flush()));
  }

  if (withBoundaries) installBoundaries();

  function emitReplaced(snapshot: Uint8Array): void {
    for (const listener of [...replacements]) {
      try {
        listener(snapshot);
      } catch (error) {
        fail("a workspace-replaced listener failed", error);
      }
    }
  }

  async function exportWorkspace(): Promise<ExportResult> {
    await ensure();
    const target = current;
    if (target === null) throw new Error("No workspace is open.");
    await flush();

    const service = files();
    const pickSave = service?.pickSave;
    if (service === null || typeof pickSave !== "function") {
      throw new Error("This host has no file picker, so the workspace could not be exported.");
    }

    let handle: FileHandle | null;
    try {
      handle = await pickSave.call(service, `${safeName(target.id)}-${dateStamp(clock())}.planner`);
    } catch (error) {
      throw new Error(`The file picker could not open: ${describeError(error)}`);
    }
    if (handle === null) return { canceled: true };

    try {
      const text = encodeWorkspaceFile(target.doc, clock());
      await handle.write(new TextEncoder().encode(text));
      return { canceled: false, path: handle.info.name };
    } catch (error) {
      throw new Error(`The workspace could not be written: ${describeError(error)}`);
    } finally {
      await handle.close().catch((error: unknown) => fail("could not close the export", error));
    }
  }

  async function importWorkspace(): Promise<ImportResult> {
    const service = files();
    const pickOpen = service?.pickOpen;
    if (service === null || typeof pickOpen !== "function") {
      throw new Error("This host has no file picker, so a workspace could not be imported.");
    }

    let handle: FileHandle | null;
    try {
      handle = await pickOpen.call(service, PLANNER_FILTERS);
    } catch (error) {
      throw new Error(`The file picker could not open: ${describeError(error)}`);
    }
    if (handle === null) return { canceled: true };

    try {
      const bytes = await handle.read();
      const decoded = decodeWorkspaceFile(new TextDecoder().decode(bytes));
      if (decoded.isErr()) throw decoded.error;

      let next: WorkspaceDocument;
      try {
        next = WorkspaceDocument.fromSnapshot(decoded.value);
      } catch (error) {
        throw new Error(`That workspace could not be opened: ${describeError(error)}`);
      }
      const validation = next.validate();
      if (validation.isErr()) {
        throw new Error("That workspace file failed validation.");
      }

      await ensure();
      const target = current;
      if (target === null) throw new Error("No workspace is open.");
      await flush();

      target.doc = next;
      hasDocument = true;
      dirty = true;
      await flush();
      emitReplaced(next.snapshot());
      return { canceled: false };
    } finally {
      await handle.close().catch((error: unknown) => fail("could not close the import", error));
    }
  }

  const bridge: PlannerBridge = {
    async loadSnapshot() {
      await ensure();
      if (!hasDocument || current === null) return null;
      // A snapshot, not an update: the app's `fromSnapshot` needs the schema, and updates after
      // creation do not carry it.
      return current.doc.snapshot();
    },

    async adopt(snapshot: Uint8Array) {
      await ensure();
      if (current === null) return;
      // The renderer invented this document after receiving `null`; keep it before the person can
      // edit it. Everything afterwards arrives as a local update. `created` stays true for the
      // session: it is what the renderer's launcher asked, not whether the file now has bytes.
      current.doc.applyUpdate(snapshot);
      hasDocument = true;
      dirty = true;
      await flush();
    },

    async commit(update: Uint8Array) {
      await ensure();
      if (current === null) return;
      current.doc.applyUpdate(update);
      dirty = true;
      schedule();
    },

    // Nothing replaces the document until an import arrives; sync is a later phase.
    onWorkspaceReplaced(listener) {
      replacements.add(listener);
      return () => {
        replacements.delete(listener);
      };
    },

    // The OS shows a notification, so there is no in-app event to deliver.
    onReminder() {
      return () => undefined;
    },

    // A reminder click on an already-open tab arrives here, not in `launch()`.
    onDeepLink(listener) {
      return host.onDeepLink?.(listener) ?? (() => undefined);
    },

    onCommand() {
      return () => undefined;
    },

    async info(): Promise<WorkspaceInfo> {
      await ensure();
      const schemaVersion = current?.doc.getMeta().schemaVersion ?? 0;
      return { path: DOCUMENT_NAME, schemaVersion };
    },

    async platform(): Promise<string> {
      try {
        const info = await host.info?.();
        if (typeof info?.platform === "string" && info.platform.length > 0) return info.platform;
      } catch (error) {
        fail("could not read the host's platform", error);
      }
      return "suite-desk";
    },

    exportWorkspace,
    importWorkspace,

    async wasCreated() {
      return created;
    },
  };

  return {
    bridge,
    flush,
    documentId: () => current?.id ?? null,
    dispose: () => {
      cancelTimer();
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          fail("a boundary listener could not be removed", error);
        }
      }
      replacements.clear();
    },
  };
}
