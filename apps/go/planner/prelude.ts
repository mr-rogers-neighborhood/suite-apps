import { createFrameHost } from "@suite/go";
import { LoroDoc } from "loro-crdt";

/**
 * Planner's bridge prelude, as a pack.
 *
 * Planner's renderer is a plain Vite app that talks to the machine through one global,
 * `window.suitePlanner`. This file is the adapter that installs it inside an isolated pack: the
 * frame host supplies the container's `documents` and `recents` services over `postMessage`, and
 * this prelude turns them into the snapshot-in / updates-out bridge Planner already knows.
 *
 * The document belongs to this prelude, not to the shell. The container cannot write — or read — a
 * `.planner`, so the pack keeps the `LoroDoc`, applies every update the renderer commits, and
 * writes a *snapshot* at the durability boundaries. Writing each update as the file would corrupt
 * it; writing on every keystroke is the amplification those boundaries exist to avoid.
 */

const MODULE_ID = "planner";
const DOCUMENT_NAME = "Planner.planner";
const DOCUMENT_TITLE = "Planner";

interface ReminderEvent {
  readonly taskId: string;
  readonly title: string;
  readonly remindAt: string;
}

type AppCommand = "capture" | "today" | "inbox";

interface WorkspaceInfo {
  readonly path: string;
  readonly schemaVersion: number;
}

interface ExportResult {
  readonly canceled: boolean;
  readonly path?: string;
}

interface ImportResult {
  readonly canceled: boolean;
}

/**
 * The shape `apps/planner` expects on `window.suitePlanner`.
 *
 * Declared structurally rather than imported from Planner's package: a pack build must not depend
 * on the sibling checkout, and the container must not learn a domain. The four optional members are
 * the ones that make a container-hosted renderer possible — see `docs/reference/bridges.md`.
 */
interface PlannerBridge {
  loadSnapshot(): Promise<Uint8Array | null>;
  adopt?(snapshot: Uint8Array): Promise<void>;
  wasCreated?(): Promise<boolean>;
  commit(update: Uint8Array): Promise<void>;
  onWorkspaceReplaced(listener: (snapshot: Uint8Array) => void): () => void;
  onReminder(listener: (reminder: ReminderEvent) => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  exportWorkspace(): Promise<ExportResult>;
  importWorkspace(): Promise<ImportResult>;
  info(): Promise<WorkspaceInfo>;
  platform(): Promise<string>;
}

const host = createFrameHost({ moduleId: MODULE_ID });

let documentId: string | null = null;
let documentName = DOCUMENT_NAME;
/** The pack's copy of the document. Null until Planner has created or handed one over. */
let loro: LoroDoc | null = null;
/** True when local updates have arrived that the file has not seen. */
let dirty = false;
/** The write in flight, so two boundaries cannot export and save out of order. */
let saving: Promise<void> | null = null;
const replacements = new Set<(snapshot: Uint8Array) => void>();

function fail(context: string, error: unknown): void {
  console.error(`Suite Planner pack: ${context}`, error);
}

/**
 * The document to open, or nothing yet.
 *
 * `list()` is the container's own query and returns summaries newest-first. The pack takes the
 * newest `.planner`; when there is none it asks the container for a record and gets back the empty
 * payload `DocumentStore.create()` writes. That emptiness is the only honest "no document", and it
 * becomes `null` below. A raw `new LoroDoc()` is never handed over: it has no schema, and
 * `WorkspaceDocument.fromSnapshot` throws on it.
 */
async function ensureDocument(): Promise<string> {
  if (documentId !== null) return documentId;

  const existing = await host.documents.list(MODULE_ID);
  const first = existing[0];
  if (first !== undefined) {
    documentId = first.id;
    documentName = first.name;
    return first.id;
  }

  const created = await host.documents.create({ moduleId: MODULE_ID, name: DOCUMENT_NAME });
  documentId = created.id;
  documentName = created.name;
  return created.id;
}

async function loadSnapshot(): Promise<Uint8Array | null> {
  const id = await ensureDocument();
  let record = await host.documents.open(id);

  if (record === null) {
    // The record disappeared between the list and the open. Start over rather than booting the
    // renderer against an id that no longer exists.
    documentId = null;
    record = await host.documents.open(await ensureDocument());
  }

  if (record === null) throw new Error("the container could not create the Planner document");
  if (record.bytes.byteLength === 0) return null;

  loro = LoroDoc.fromSnapshot(record.bytes);
  return record.bytes;
}

/**
 * Write a snapshot, not an update.
 *
 * `export({ mode: "snapshot" })` is what `WorkspaceSnapshot`/`fromSnapshot` expect on the next
 * launch. An update written as the whole file imports as an empty document — measured at 98 bytes
 * with `meta === {}` — which is the failure this ordering avoids.
 */
async function persist(): Promise<void> {
  if (!dirty || loro === null || documentId === null) return;
  if (saving !== null) {
    await saving;
    if (!dirty) return;
  }

  const id = documentId;
  const bytes = loro.export({ mode: "snapshot" });
  dirty = false;

  saving = (async () => {
    await host.documents.save(id, { bytes, title: DOCUMENT_TITLE });
    host.recents.remember(id, DOCUMENT_TITLE);
  })();

  try {
    await saving;
  } catch (error) {
    // The edit is still in memory; the next boundary tries again rather than pretending it landed.
    dirty = true;
    throw error;
  } finally {
    saving = null;
  }
}

const bridge: PlannerBridge = {
  loadSnapshot,

  async adopt(snapshot) {
    // The renderer made this document after receiving `null`; keep it as the file before the
    // person can edit it. Everything afterwards is a local update.
    loro = LoroDoc.fromSnapshot(snapshot);
    documentName = documentName || DOCUMENT_NAME;
    const id = await ensureDocument();
    await host.documents.save(id, { bytes: snapshot, title: DOCUMENT_TITLE });
    host.recents.remember(id, DOCUMENT_TITLE);
    dirty = false;
  },

  async commit(update) {
    if (loro === null) {
      throw new Error("Planner committed before the pack had a document");
    }
    loro.import(update);
    dirty = true;
  },

  onWorkspaceReplaced(listener) {
    replacements.add(listener);
    return () => {
      replacements.delete(listener);
    };
  },

  // A phone has no reminder channel yet (issue #26). An unsubscriber that does nothing is honest;
  // inventing a notification would be worse than the UI saying reminders are desktop-only.
  onReminder: () => () => undefined,
  onCommand: () => () => undefined,

  // A pack has no file picker in this host yet. Cancelling is the contract's own word for it.
  exportWorkspace: async () => ({ canceled: true }),
  importWorkspace: async () => ({ canceled: true }),

  info: async () => ({ path: documentName, schemaVersion: 0 }),
  platform: async () => "android",
};

Object.assign(globalThis, { suitePlanner: bridge });

// The boundaries a phone gives us. `visibilitychange` is the one Android is guaranteed to deliver
// before backgrounding; `pagehide` covers a page being discarded. Leaving and closing are driven by
// the shell's control message, which `onFlush` below turns into the same write.
host.onFlush(() => persist());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void persist().catch((e) => fail("flush", e));
});
globalThis.addEventListener("pagehide", () => {
  void persist().catch((e) => fail("flush", e));
});

/**
 * A device assertion handle, in the same spirit as the shell's `__suiteGoDev`.
 *
 * It reports the document id and the snapshot's bytes, not its contents: `pnpm android:eval` can
 * prove the file exists and grew across a relaunch without the prelude learning Planner's schema.
 */
Object.assign(globalThis, {
  __suitePlannerPack: {
    documentId: () => documentId,
    name: () => documentName,
    snapshotBytes: () => (loro === null ? 0 : loro.export({ mode: "snapshot" }).byteLength),
    flush: () => persist(),
  },
});
