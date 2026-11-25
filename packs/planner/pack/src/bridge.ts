import type { PackLaunchContext, ProjectionsService } from "@suite/pack-runtime";
import {
  type PackBridgeHost,
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
 * The debounce, the boundary listeners, the picker and the notice list live in
 * `@suite/pack-runtime`; this file supplies Planner's document layer, its export/import codec and
 * its projection.
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

/**
 * The host services this prelude uses.
 *
 * `files` is optional so a host without the grant gives a sentence instead of a crash. The document
 * service is required to do anything at all; a method called without it throws the sentence a
 * person sees in the app's error modal.
 */
export interface PlannerPackHost extends PackBridgeHost {
  readonly packId?: string | undefined;
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

function safeName(name: string): string {
  return safeFileName(name, "planner", { dots: false });
}

function documentFromSnapshot(bytes: Uint8Array): WorkspaceDocument {
  return WorkspaceDocument.fromSnapshot(bytes);
}

export function createPlannerPack(options: PlannerPackOptions): PlannerPack {
  const { host } = options;
  const clock = options.now ?? (() => new Date());
  const withBoundaries = options.boundaries !== false;

  const runtime = createPackBridge<OpenDocument>({
    app: "Suite Planner",
    noun: "workspace",
    host,
    boundaries: withBoundaries,
    pageBoundaries: true,
    debounceMs: FLUSH_DEBOUNCE_MS,
    captureFailure: false,
    retryOnFailure: true,
    scheduleFailure: "could not save the workspace",
    write: writeWorkspace,
  });

  /** True when this session started with no document; the renderer shows its launcher then. */
  let created = false;
  /** True once the pack has a document in hand, whether it read one or the app adopted one. */
  let hasDocument = false;
  const replacements = createEmitter<Uint8Array>();
  const packId = host.packId ?? REMINDER_PACK_ID;

  // The manifest names `reminders`. The pack binds that entry; the host supplies
  // a read-only handle for the document it already resolved. A projection that
  // runs on save must not schedule, poll or show anything itself.
  if (host.projections !== undefined) {
    runtime.addCleanup(
      host.projections.register(REMINDER_PROJECTION, async (projected) => {
        const bytes = await projected.read();
        return projectReminders(bytes, { packId, now: clock() });
      }),
    );
  }

  async function writeWorkspace(target: OpenDocument): Promise<void> {
    await runtime.documents().save(target.id, target.doc.snapshot());
  }

  /**
   * A document id that is free in this pack's own root.
   *
   * The first run is normally `planner`. A host can hand back an empty record that a previous
   * create wrote, so the loop only runs when a name is already in use.
   */
  async function freshDocumentId(): Promise<string> {
    const existing = new Set((await runtime.documents().list()).map((summary) => summary.id));
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
    const service = runtime.documents();
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
        runtime.setCurrent({ id: record.id, doc });
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
      runtime.setCurrent({ id: emptyId, doc: WorkspaceDocument.create() });
      created = true;
      return;
    }

    const id = await freshDocumentId();
    await service.create(id);
    runtime.setCurrent({ id, doc: WorkspaceDocument.create() });
    created = true;
  }

  let opening: Promise<void> | null = null;

  function ensure(): Promise<void> {
    opening ??= open();
    return opening;
  }

  async function flush(): Promise<void> {
    await runtime.flush();
  }

  function emitReplaced(snapshot: Uint8Array): void {
    replacements.emit(snapshot, runtime.fail, "a workspace-replaced listener failed");
  }

  async function exportWorkspace(): Promise<ExportResult> {
    await ensure();
    const target = runtime.current();
    if (target === null) throw new Error("No workspace is open.");
    await flush();

    const path = await withSaveFile(
      runtime.files(),
      `${safeName(target.id)}-${dateStamp(clock())}.planner`,
      "This host has no file picker, so the workspace could not be exported.",
      runtime.fail,
      async (handle) => {
        const text = encodeWorkspaceFile(target.doc, clock());
        await writeTextToHandle(handle, text, "The workspace could not be written");
        return handle.info.name;
      },
    );
    return path === null ? { canceled: true } : { canceled: false, path };
  }

  async function importWorkspace(): Promise<ImportResult> {
    const decoded = await withPickedFile(
      runtime.files(),
      PLANNER_FILTERS,
      "This host has no file picker, so a workspace could not be imported.",
      runtime.fail,
      async (handle) => {
        const bytes = await handle.read();
        const file = decodeWorkspaceFile(new TextDecoder().decode(bytes));
        if (file.isErr()) throw file.error;

        let next: WorkspaceDocument;
        try {
          next = WorkspaceDocument.fromSnapshot(file.value);
        } catch (error) {
          throw new Error(`That workspace could not be opened: ${describeError(error)}`);
        }
        const validation = next.validate();
        if (validation.isErr()) {
          throw new Error("That workspace file failed validation.");
        }
        return next;
      },
    );
    if (decoded === null) return { canceled: true };

    await ensure();
    const target = runtime.current();
    if (target === null) throw new Error("No workspace is open.");
    await flush();

    target.doc = decoded;
    hasDocument = true;
    runtime.markDirty();
    await flush();
    emitReplaced(decoded.snapshot());
    return { canceled: false };
  }

  const bridge: PlannerBridge = {
    async loadSnapshot() {
      await ensure();
      const target = runtime.current();
      if (!hasDocument || target === null) return null;
      // A snapshot, not an update: the app's `fromSnapshot` needs the schema, and updates after
      // creation do not carry it.
      return target.doc.snapshot();
    },

    async adopt(snapshot: Uint8Array) {
      await ensure();
      const target = runtime.current();
      if (target === null) return;
      // The renderer invented this document after receiving `null`; keep it before the person can
      // edit it. Everything afterwards arrives as a local update. `created` stays true for the
      // session: it is what the renderer's launcher asked, not whether the file now has bytes.
      target.doc.applyUpdate(snapshot);
      hasDocument = true;
      runtime.markDirty();
      await flush();
    },

    async commit(update: Uint8Array) {
      await ensure();
      const target = runtime.current();
      if (target === null) return;
      target.doc.applyUpdate(update);
      runtime.markDirty();
    },

    // Nothing replaces the document until an import arrives; sync is a later phase.
    onWorkspaceReplaced(listener) {
      return replacements.add(listener);
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
      const schemaVersion = runtime.current()?.doc.getMeta().schemaVersion ?? 0;
      return { path: DOCUMENT_NAME, schemaVersion };
    },

    async platform(): Promise<string> {
      return hostPlatform(host.info, "suite-desk", runtime.fail);
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
    documentId: () => runtime.current()?.id ?? null,
    dispose: () => {
      runtime.dispose();
      replacements.clear();
    },
  };
}
