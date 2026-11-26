import { randomUUID } from "node:crypto";
import type { CommandProviderRequest } from "@suite/contracts/commands";
import { isTrustedSender } from "@suite/desktop";
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { packOrigin } from "./packs.js";
import { type PackSender, packSender } from "./senders.js";
import { PACK_COMMAND } from "./shared.js";

/**
 * The host's half of the scoped command channel (#226).
 *
 * A pack is renderer-only, so the host never imports a provider. It asks the
 * pack's own renderer to run the entry its manifest declared, over a channel
 * that carries no document bytes, path or handle. Only structured JSON crosses:
 * `{commandId, scope, arguments}` or a scopes call, and a reply of display
 * metadata plus an optional `suite://` link.
 *
 * This is deliberately a sibling of the document/file bridge rather than a mode
 * on it. A pack may ask for `commands` without `documents`, and the host can
 * prove no document call is reachable from this path.
 */

interface PendingCommand {
  readonly webContentsId: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingCommand>();
/** Provider entries each renderer has bound. */
const registered = new Map<number, Set<string>>();

/** How long a pack gets to answer a provider call before the host gives up. */
export const COMMAND_TIMEOUT_MS = 5_000;

function trusted(event: IpcMainInvokeEvent | IpcMainEvent): PackSender | null {
  const sender = packSender(event.sender.id);
  if (sender === undefined) return null;
  if (!isTrustedSender(event.senderFrame?.url, [packOrigin(sender.packId, sender.containerId)])) {
    return null;
  }
  return sender;
}

/** Register the command channels once, before any pack is loaded. */
export function registerCommandChannels(): void {
  ipcMain.on(PACK_COMMAND.register, (event, entry) => {
    if (trusted(event) === null || typeof entry !== "string") return;
    const entries = registered.get(event.sender.id) ?? new Set<string>();
    entries.add(entry);
    registered.set(event.sender.id, entries);
  });

  ipcMain.on(PACK_COMMAND.unregister, (event, entry) => {
    if (typeof entry !== "string") return;
    registered.get(event.sender.id)?.delete(entry);
  });

  ipcMain.handle(PACK_COMMAND.done, (event, requestId, value) => {
    if (typeof requestId !== "string") return;
    const request = pending.get(requestId);
    if (request === undefined || request.webContentsId !== event.sender.id) return;
    settle(requestId, request);
    request.resolve(value);
  });

  ipcMain.handle(PACK_COMMAND.failed, (event, requestId, message) => {
    if (typeof requestId !== "string") return;
    const request = pending.get(requestId);
    if (request === undefined || request.webContentsId !== event.sender.id) return;
    settle(requestId, request);
    request.reject(
      new Error(typeof message === "string" ? message : "the provider did not answer"),
    );
  });
}

function settle(requestId: string, request: PendingCommand): void {
  pending.delete(requestId);
  clearTimeout(request.timer);
}

/** Forget a renderer's provider entries when its view is destroyed. */
export function clearCommandEntries(webContentsId: number): void {
  registered.delete(webContentsId);
  for (const [requestId, request] of pending) {
    if (request.webContentsId !== webContentsId) continue;
    settle(requestId, request);
    request.reject(new Error("the pack closed before its provider answered"));
  }
}

/** Entries a renderer has bound, for a clearer refusal and for tests. */
export function commandEntriesFor(webContentsId: number): readonly string[] {
  return [...(registered.get(webContentsId) ?? [])];
}

export interface CommandRequestEnvelope {
  readonly requestId: string;
  readonly entry: string;
  readonly request: CommandProviderRequest;
}

/**
 * Send one provider request to a live pack renderer.
 *
 * The caller has already proved the capability, consent and declaration. This
 * function only proves the entry is bound and closes the request when the pack
 * answers or the timeout expires.
 */
export function invokeProvider(
  sender: PackSender,
  entry: string,
  request: CommandProviderRequest,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<unknown> {
  if (!registered.get(sender.webContentsId)?.has(entry)) {
    throw new Error(`${sender.packId} has not bound the provider entry ${entry}`);
  }

  const requestId = randomUUID();
  const webContents: WebContents = sender.webContents;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      const row = pending.get(requestId);
      if (row === undefined) return;
      settle(requestId, row);
      row.reject(new Error(`${sender.packId} did not answer the provider entry ${entry}`));
    }, timeoutMs);

    pending.set(requestId, { webContentsId: sender.webContentsId, resolve, reject, timer });

    try {
      webContents.send(PACK_COMMAND.invoke, {
        requestId,
        entry,
        request,
      } satisfies CommandRequestEnvelope);
    } catch (error) {
      const row = pending.get(requestId);
      if (row !== undefined) settle(requestId, row);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
