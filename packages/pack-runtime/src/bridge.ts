import type {
  DocumentsService,
  FileFilter,
  FileHandle,
  FilesService,
  ImportedFolder,
} from "./services.js";

/**
 * The part of a pack bridge every app shares.
 *
 * The three pack adapters differ in their document format, their projection and
 * their launch hook. Everything around that is the same: edits coalesce, a
 * boundary flushes, a picker writes an export, a notice explains a refusal, and
 * disposal removes the listeners. This module owns that half once.
 *
 * The app still owns its envelope. Canvas writes a `.canvas` JSON envelope,
 * Planner a `.planner` file and Budget a `.budget` snapshot; the helpers here
 * move bytes through the host's picker and never parse an app document.
 *
 * No host policy lives here. `PackBridgeHost` names the same services a pack
 * already receives, and every call is scoped to the pack's own document store
 * or a person-consented file handle.
 */

const NOTICE_LIMIT = 20;

/** The part of `window.suite.info()` a pack relies on. */
export interface PackHostInfo {
  readonly platform?: string | undefined;
  readonly [key: string]: unknown;
}

/** The lifecycle surface a host may expose. */
export interface PackLifecycle {
  onFlush?(listener: () => void | Promise<void>): () => void;
  onSuspend?(listener: () => void | Promise<void>): () => void;
}

/**
 * The host services every pack adapter uses.
 *
 * `files` is optional so a host without the grant gives a sentence rather than a
 * crash. The document service is required to do anything at all; a method
 * called without it throws the sentence a person sees.
 */
export interface PackBridgeHost {
  readonly documents?: DocumentsService | undefined;
  readonly files?: Partial<FilesService> | undefined;
  readonly info?: (() => Promise<PackHostInfo>) | undefined;
  readonly lifecycle?: PackLifecycle | undefined;
}

/** How a pack saves its current document. Called with the runtime's current value. */
export type PackWriter<Document> = (document: Document) => Promise<void>;

/** The app's public log hook. */
export type PackFail = (context: string, error: unknown) => void;

export interface PackBridgeOptions<Document> {
  /** Console and notice label, e.g. `Suite Canvas`. */
  readonly app: string;
  /** Person-facing object noun, e.g. `canvas`; used in shared sentences. */
  readonly noun: string;
  readonly host: PackBridgeHost;
  /** Install host lifecycle and page boundaries. Defaults to true. */
  readonly boundaries?: boolean | undefined;
  /** Coalesce edits for this long. `0` writes only at an explicit boundary. */
  readonly debounceMs?: number | undefined;
  /** Install the DOM `visibilitychange` and `pagehide` boundaries. */
  readonly pageBoundaries?: boolean | undefined;
  /**
   * Keep a failed write as a value instead of rejecting `flush()`.
   *
   * Canvas reports a failure to the renderer through `flushDocument()`; Planner
   * and Budget let the boundary's rejection reach the caller. The difference is
   * the app's, so it is an option rather than a second scheduler.
   */
  readonly captureFailure?: boolean | undefined;
  /** Leave the document dirty after a failed write so the next boundary retries. */
  readonly retryOnFailure?: boolean | undefined;
  /** Log context for a debounced write that fails. */
  readonly scheduleFailure?: string | undefined;
  readonly write: PackWriter<Document>;
}

export interface PackBridge<Document> {
  notice(message: string): void;
  notices(): readonly string[];
  fail: PackFail;
  documents(): DocumentsService;
  files(): Partial<FilesService> | null;
  current(): Document | null;
  setCurrent(document: Document | null): void;
  /** Mark the current document changed and schedule the debounced write. */
  markDirty(): void;
  /** Write now, draining a write that is already in flight. */
  flush(): Promise<void>;
  /** Wait for a write that is already in flight without scheduling one. */
  settled(): Promise<void>;
  /** The last write failure, or null after a successful write. */
  failure(): string | null;
  recordFailure(error: unknown): void;
  clearFailure(): void;
  addCleanup(cleanup: () => void): void;
  dispose(): void;
}

interface BoundaryTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  readonly visibilityState?: string | undefined;
}

/** A picker refusal, so an adapter can choose between a throw and a notice. */
export class PackFilePickerError extends Error {
  constructor(
    message: string,
    readonly reason: "unavailable" | "failed",
  ) {
    super(message);
    this.name = "PackFilePickerError";
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A name the host's file picker can show.
 *
 * Canvas keeps dots in a `.canvas` name; Planner and Budget strip them from the
 * budget title before appending the extension. The fallback is the app's.
 */
export function safeFileName(
  name: string,
  fallback: string,
  options: { readonly dots?: boolean | undefined } = {},
): string {
  const pattern = options.dots === false ? /[^\w-]+/gu : /[^\w.-]+/gu;
  const cleaned = name.replace(pattern, "-").replace(/^-+|-+$/gu, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

export function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Ask the host for its platform, falling back without turning it into an error. */
export async function hostPlatform(
  info: (() => Promise<PackHostInfo>) | undefined,
  fallback: string,
  fail: PackFail,
): Promise<string> {
  try {
    const value = await info?.();
    if (typeof value?.platform === "string" && value.platform.length > 0) {
      return value.platform;
    }
  } catch (error) {
    fail("could not read the host's platform", error);
  }
  return fallback;
}

/**
 * Open a person-consented file and hand its handle to `use`.
 *
 * The handle is closed even when `use` throws. A cancelled picker answers
 * `null`; a host without the picker or a picker refusal throws a
 * `PackFilePickerError` with a sentence the adapter can show.
 */
export async function withPickedFile<T>(
  files: Partial<FilesService> | null,
  filters: readonly FileFilter[],
  missing: string,
  fail: PackFail,
  use: (handle: FileHandle) => Promise<T>,
): Promise<T | null> {
  const pickOpen = files?.pickOpen;
  if (files === null || typeof pickOpen !== "function") {
    throw new PackFilePickerError(missing, "unavailable");
  }

  let handle: FileHandle | null;
  try {
    handle = await pickOpen.call(files, filters);
  } catch (error) {
    throw new PackFilePickerError(
      `The file picker could not open: ${describeError(error)}`,
      "failed",
    );
  }
  if (handle === null) return null;

  try {
    return await use(handle);
  } finally {
    await handle.close().catch((error: unknown) => fail("could not close the import", error));
  }
}

/** Ask for a destination and hand its handle to `use`, closing it afterwards. */
export async function withSaveFile<T>(
  files: Partial<FilesService> | null,
  suggestedName: string,
  missing: string,
  fail: PackFail,
  use: (handle: FileHandle) => Promise<T>,
): Promise<T | null> {
  const pickSave = files?.pickSave;
  if (files === null || typeof pickSave !== "function") {
    throw new PackFilePickerError(missing, "unavailable");
  }

  let handle: FileHandle | null;
  try {
    handle = await pickSave.call(files, suggestedName);
  } catch (error) {
    throw new PackFilePickerError(
      `The file picker could not open: ${describeError(error)}`,
      "failed",
    );
  }
  if (handle === null) return null;

  try {
    return await use(handle);
  } finally {
    await handle.close().catch((error: unknown) => fail("could not close the export", error));
  }
}

/** Write UTF-8 text, using the app's sentence when the write fails. */
export async function writeTextToHandle(
  handle: FileHandle,
  text: string,
  writeFailure: string,
): Promise<void> {
  try {
    await handle.write(new TextEncoder().encode(text));
  } catch (error) {
    throw new Error(`${writeFailure}: ${describeError(error)}`);
  }
}

/** Copy a person-chosen folder into the pack's own root. */
export async function pickFolder(
  files: Partial<FilesService> | null,
  missing: string,
): Promise<ImportedFolder | null> {
  const importFolder = files?.importFolder;
  if (files === null || typeof importFolder !== "function") throw new Error(missing);
  return importFolder.call(files);
}

export interface PackEmitter<T> {
  add(listener: (value: T) => void): () => void;
  emit(value: T, fail: PackFail, context: string): void;
  clear(): void;
}

/** A tiny listener set whose one failure never stops the other listeners. */
export function createEmitter<T>(): PackEmitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    add(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value, fail, context) {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          fail(context, error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

export function createPackBridge<Document>(
  options: PackBridgeOptions<Document>,
): PackBridge<Document> {
  const { app, host, noun } = options;
  const debounceMs = options.debounceMs ?? 0;
  const captureFailure = options.captureFailure ?? false;
  const retryOnFailure = options.retryOnFailure ?? true;

  let currentDocument: Document | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;
  let saveFailure: string | null = null;
  const noticeLog: string[] = [];
  const cleanups: Array<() => void> = [];

  function notice(message: string): void {
    console.warn(`${app} pack: ${message}`);
    noticeLog.push(message);
    if (noticeLog.length > NOTICE_LIMIT) noticeLog.shift();
  }

  function fail(context: string, error: unknown): void {
    console.error(`${app} pack: ${context}`, error);
  }

  function documents(): DocumentsService {
    if (host.documents === undefined) {
      throw new Error(
        `This host does not provide the documents service, so ${app} cannot open a ${noun}.`,
      );
    }
    return host.documents;
  }

  function files(): Partial<FilesService> | null {
    return host.files ?? null;
  }

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function recordFailure(error: unknown): void {
    saveFailure = describeError(error);
  }

  function clearFailure(): void {
    saveFailure = null;
  }

  function markDirty(): void {
    dirty = true;
    if (debounceMs <= 0) return;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((error: unknown) =>
        fail(options.scheduleFailure ?? `could not save the ${noun}`, error),
      );
    }, debounceMs);
  }

  async function flush(): Promise<void> {
    cancelTimer();
    for (;;) {
      if (writing !== null) {
        try {
          await writing;
        } catch {
          // The failure is recorded below; this caller must not fail twice.
        }
        continue;
      }
      cancelTimer();
      if (!dirty) break;

      const target = currentDocument;
      dirty = false;
      if (target === null) {
        const error = new Error(`No ${noun} is open.`);
        recordFailure(error);
        if (captureFailure) return;
        throw error;
      }

      let attempt: Promise<void>;
      try {
        attempt = options.write(target);
      } catch (error) {
        recordFailure(error);
        if (retryOnFailure) dirty = true;
        if (captureFailure) return;
        throw error;
      }

      writing = attempt.then(
        () => {
          saveFailure = null;
        },
        (error: unknown) => {
          recordFailure(error);
          if (retryOnFailure) dirty = true;
          throw error;
        },
      );

      try {
        await writing;
      } catch (error) {
        if (captureFailure) return;
        throw error;
      } finally {
        writing = null;
      }
    }
  }

  async function settled(): Promise<void> {
    while (writing !== null) await writing;
  }

  async function flushBoundary(context: string): Promise<void> {
    try {
      await flush();
    } catch (error) {
      fail(context, error);
    }
  }

  function addCleanup(cleanup: () => void): void {
    cleanups.push(cleanup);
  }

  function installBoundaries(): void {
    if (options.boundaries === false) return;

    if (options.pageBoundaries === true) {
      const targetDocument = (globalThis as { document?: BoundaryTarget }).document;
      if (targetDocument !== undefined) {
        const onVisibility = (): void => {
          if (targetDocument.visibilityState !== "hidden") return;
          void flushBoundary("flush on hide");
        };
        targetDocument.addEventListener("visibilitychange", onVisibility);
        addCleanup(() => targetDocument.removeEventListener("visibilitychange", onVisibility));
      }

      const targetWindow = (globalThis as { window?: BoundaryTarget }).window;
      if (targetWindow !== undefined) {
        const onPageHide = (): void => {
          void flushBoundary("flush on page hide");
        };
        targetWindow.addEventListener("pagehide", onPageHide);
        addCleanup(() => targetWindow.removeEventListener("pagehide", onPageHide));
      }
    }

    const lifecycle = host.lifecycle;
    if (lifecycle?.onFlush !== undefined) {
      addCleanup(lifecycle.onFlush(() => flushBoundary("flush")));
    }
    if (lifecycle?.onSuspend !== undefined) {
      addCleanup(lifecycle.onSuspend(() => flushBoundary("flush on suspend")));
    }
  }

  installBoundaries();

  return {
    notice,
    notices: () => [...noticeLog],
    fail,
    documents,
    files,
    current: () => currentDocument,
    setCurrent(document) {
      currentDocument = document;
    },
    markDirty,
    flush,
    settled,
    failure: () => saveFailure,
    recordFailure,
    clearFailure,
    addCleanup,
    dispose() {
      cancelTimer();
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          fail("a boundary listener could not be removed", error);
        }
      }
    },
  };
}
