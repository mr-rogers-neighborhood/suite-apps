import { randomUUID } from "node:crypto";
import { isTrustedSender } from "@suite/desktop";
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import type {
  DocumentEntryRunner,
  ScopedDocumentHandle,
  ScopedProjectionHandle,
} from "./documentMigrations.js";
import { packOrigin } from "./packs.js";
import { type PackSender, packSender } from "./senders.js";
import { PACK_PROJECTION } from "./shared.js";

/**
 * The shell's side of a declared projection entry (S6.3).
 *
 * A pack is renderer-only, so the host does not import its code. The host asks
 * the pack's own renderer to run the entry the manifest named, with a handle
 * scoped to the one document the host resolved. The reply is the pack's display
 * rows; the host validates them and never parses the document itself.
 *
 * The call runs in the live renderer, not a hidden one. A fresh renderer per
 * save would be the expensive thing this seam exists to avoid; the pack's save
 * is already debounced, and its projection returns a list rather than a graph.
 */

interface PendingProjection {
  readonly webContentsId: number;
  readonly read: () => Promise<Uint8Array>;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingProjection>();
/** Projection entries each renderer has bound. */
const registered = new Map<number, Set<string>>();

/** How long a pack gets to answer a projection before the host gives up. */
export const PROJECTION_TIMEOUT_MS = 5_000;

function trusted(event: IpcMainInvokeEvent | IpcMainEvent): PackSender | null {
  const sender = packSender(event.sender.id);
  if (sender === undefined) return null;
  if (!isTrustedSender(event.senderFrame?.url, [packOrigin(sender.packId, sender.containerId)])) {
    return null;
  }
  return sender;
}

/** Register the projection channels once, before any pack is loaded. */
export function registerProjectionChannels(): void {
  ipcMain.on(PACK_PROJECTION.register, (event, entry) => {
    if (trusted(event) === null || typeof entry !== "string") return;
    const entries = registered.get(event.sender.id) ?? new Set<string>();
    entries.add(entry);
    registered.set(event.sender.id, entries);
  });

  ipcMain.on(PACK_PROJECTION.unregister, (event, entry) => {
    if (typeof entry !== "string") return;
    registered.get(event.sender.id)?.delete(entry);
  });

  ipcMain.handle(PACK_PROJECTION.read, async (event, requestId) => {
    if (typeof requestId !== "string") throw new Error("invalid projection request");
    const request = pending.get(requestId);
    if (request === undefined || request.webContentsId !== event.sender.id) {
      throw new Error("that projection request is not open");
    }
    return request.read();
  });

  ipcMain.handle(PACK_PROJECTION.done, (event, requestId, value) => {
    if (typeof requestId !== "string") return;
    const request = pending.get(requestId);
    if (request === undefined || request.webContentsId !== event.sender.id) return;
    settle(requestId, request);
    try {
      request.resolve(new TextEncoder().encode(JSON.stringify(value)));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  ipcMain.handle(PACK_PROJECTION.failed, (event, requestId, message) => {
    if (typeof requestId !== "string") return;
    const request = pending.get(requestId);
    if (request === undefined || request.webContentsId !== event.sender.id) return;
    settle(requestId, request);
    request.reject(new Error(typeof message === "string" ? message : "the projection failed"));
  });
}

function settle(requestId: string, request: PendingProjection): void {
  pending.delete(requestId);
  clearTimeout(request.timer);
}

/** Forget a renderer's entries when its view is destroyed. */
export function clearProjectionEntries(webContentsId: number): void {
  registered.delete(webContentsId);
  for (const [requestId, request] of pending) {
    if (request.webContentsId !== webContentsId) continue;
    settle(requestId, request);
    request.reject(new Error("the pack closed before its projection answered"));
  }
}

/**
 * The `DocumentEntryRunner` bound to one pack renderer.
 *
 * `migrate` is deliberately refused: this slice binds projections, which are
 * read-only. A migration still needs an entry that can write, and it arrives
 * with its own seam.
 */
export class RendererProjectionRunner implements DocumentEntryRunner {
  readonly #sender: PackSender;
  readonly #timeoutMs: number;

  constructor(sender: PackSender, timeoutMs = PROJECTION_TIMEOUT_MS) {
    this.#sender = sender;
    this.#timeoutMs = timeoutMs;
  }

  async migrate(_entry: string, _document: ScopedDocumentHandle): Promise<void> {
    throw new Error("this host binds projections, not migrations, in a pack renderer");
  }

  project(entry: string, document: ScopedProjectionHandle): Promise<Uint8Array> {
    const sender = this.#sender;
    if (!registered.get(sender.webContentsId)?.has(entry)) {
      throw new Error(`${sender.packId} has not bound the projection ${entry}`);
    }

    const requestId = randomUUID();
    const webContents: WebContents = sender.webContents;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = pending.get(requestId);
        if (request === undefined) return;
        settle(requestId, request);
        request.reject(new Error(`${sender.packId} did not answer the projection ${entry}`));
      }, this.#timeoutMs);

      pending.set(requestId, {
        webContentsId: sender.webContentsId,
        read: () => document.read(),
        resolve,
        reject,
        timer,
      });

      try {
        webContents.send(PACK_PROJECTION.invoke, {
          requestId,
          entry,
          id: document.id,
          version: document.version,
        });
      } catch (error) {
        const request = pending.get(requestId);
        if (request !== undefined) settle(requestId, request);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
