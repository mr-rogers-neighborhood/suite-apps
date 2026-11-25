/**
 * The pack's half of the frame bridge.
 *
 * A domain calls `host.documents.save(...)` exactly as it would in the shell's document; this
 * turns that into a request and awaits the answer. The vocabulary is `ModuleHost`'s on purpose —
 * a pack that had a different shape in each mode would be two integrations, not one.
 *
 * Requests are serialised through one promise chain rather than fired in parallel, because the
 * shell answers in order and a save that overtook the create it depends on would fail in a way
 * that reads like a storage bug.
 */

import {
  FRAME_PROTOCOL,
  type FrameReply,
  type FrameRequest,
  type FrameTheme,
  isFrameControl,
  isFrameReply,
} from "./frame.js";
import type {
  DocumentRecord,
  FileEntry,
  FileFilter,
  FileOutcome,
  FileService,
  ModuleHost,
  NotificationOutcome,
  NotificationPermission,
  PickedFile,
  ThemeTokens,
} from "./host.js";

interface ReplyValue {
  readonly bytes?: string;
  readonly [key: string]: unknown;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked because a file is not a document title: spreading 256 MiB of bytes
  // into one `String.fromCharCode` call overflows the argument limit.
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface FrameHostOptions {
  readonly moduleId: string;
  /** The shell's window. Defaults to `window.parent`, which is why this only works in a frame. */
  readonly parent?: Window;
  /**
   * How long a request may wait for an answer before it is rejected.
   *
   * There was no timeout, and the consequence was worse than it looks: requests are serialised through
   * one chain, so a single unanswered request stalled **every** later one — including the debounced
   * save. A reply is dropped when the frame's window is gone (`serveFrame` returns early), so this is
   * reachable, not theoretical; it was only invisible because a frame usually dies with its realm.
   *
   * Ten seconds is generous on purpose: a cold start loads 3.6 MB of WebAssembly before the first
   * document call, and rejecting a slow boot would be a worse bug than the one this fixes.
   */
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export type FrameHost = ModuleHost & {
  currentTheme(): Promise<ThemeTokens>;
  /**
   * Run `listener` when the shell reaches a durability boundary.
   *
   * The pack owns its document, so the shell cannot write it. It can only ask, on the boundaries a
   * phone gives us — foreground loss, leaving the module, closing the app — and wait for the answer
   * before tearing the frame down. Returning `undefined` from `flush` is a valid "nothing pending".
   */
  onFlush(listener: () => void | Promise<void>): () => void;
  dispose(): void;
};

export function createFrameHost(options: FrameHostOptions): FrameHost {
  const parent = options.parent ?? globalThis.parent;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pending = new Map<
    number,
    { resolve: (reply: FrameReply) => void; reject: (error: Error) => void }
  >();
  const flushListeners = new Set<() => void | Promise<void>>();
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();

  const listener = (event: MessageEvent) => {
    if (isFrameControl(event.data)) {
      const control = event.data;
      // Answered after every handler has settled. A shell that tears the frame down on a timer
      // would otherwise race the write it asked for.
      void (async () => {
        try {
          for (const flush of flushListeners) await flush();
          parent.postMessage(
            { protocol: FRAME_PROTOCOL, id: control.id, ok: true, value: null },
            "*",
          );
        } catch (error) {
          parent.postMessage(
            {
              protocol: FRAME_PROTOCOL,
              id: control.id,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            },
            "*",
          );
        }
      })();
      return;
    }
    if (!isFrameReply(event.data)) return;
    const waiting = pending.get(event.data.id);
    if (!waiting) return;
    pending.delete(event.data.id);
    waiting.resolve(event.data);
  };
  globalThis.addEventListener("message", listener);

  const send = (request: FrameRequest, payload?: string): Promise<ReplyValue> => {
    const run = async (): Promise<ReplyValue> => {
      const id = nextId++;
      const answer = new Promise<FrameReply>((resolve, reject) => {
        // `unref` is not available in a WebView; the timer is cleared on settle instead, which is
        // enough because nothing else keeps a frame's lifetime beyond `dispose`.
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(
            new Error(
              `the shell did not answer ${request.method} within ${timeoutMs} ms; ` +
                "it may have been released while this module was open",
            ),
          );
        }, timeoutMs);
        pending.set(id, {
          resolve: (reply) => {
            clearTimeout(timer);
            resolve(reply);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
      parent.postMessage(
        { protocol: FRAME_PROTOCOL, id, request, ...(payload === undefined ? {} : { payload }) },
        "*",
      );
      const reply = await answer;
      if (!reply.ok) throw new Error(reply.message);
      return (reply.value ?? {}) as ReplyValue;
    };
    // Serialised: one request in flight, in order.
    queue = queue.then(run, run);
    return queue as Promise<ReplyValue>;
  };

  const documents = {
    async list(moduleId?: string) {
      const value = await send(
        moduleId === undefined
          ? { method: "documents.list" }
          : { method: "documents.list", moduleId },
      );
      return (value as unknown as readonly DocumentRecord[]) ?? [];
    },
    async create(input: { name: string }) {
      const value = await send({ method: "documents.create", name: input.name });
      return { ...value, bytes: fromBase64(value.bytes ?? "") } as unknown as DocumentRecord;
    },
    async open(id: string) {
      const value = await send({ method: "documents.open", id });
      if (Object.keys(value).length === 0) return null;
      return { ...value, bytes: fromBase64(value.bytes ?? "") } as unknown as DocumentRecord;
    },
    async save(id: string, input: { title?: string; bytes: Uint8Array }) {
      const value = await send(
        {
          method: "documents.save",
          id,
          ...(input.title === undefined ? {} : { title: input.title }),
        },
        toBase64(input.bytes),
      );
      return value as never;
    },
    async remove(id: string) {
      await send({ method: "documents.remove", id });
    },
  };

  const files: FileService = {
    async list(path?: string) {
      const value = await send(
        path === undefined ? { method: "files.list" } : { method: "files.list", path },
      );
      return (Array.isArray(value) ? value : []) as unknown as readonly FileEntry[];
    },
    async stat(path: string) {
      const value = await send({ method: "files.stat", path });
      const entry = value.entry;
      return entry === null || entry === undefined ? null : (entry as FileEntry);
    },
    async mkdir(path: string) {
      await send({ method: "files.mkdir", path });
    },
    async read(path: string, options) {
      const value = await send(
        options?.maxBytes === undefined
          ? { method: "files.read", path }
          : { method: "files.read", path, maxBytes: options.maxBytes },
      );
      return fromBase64(value.bytes ?? "");
    },
    async write(path: string, bytes: Uint8Array, options) {
      const value = await send(
        {
          method: "files.write",
          path,
          ...(options?.atomic === undefined ? {} : { atomic: options.atomic }),
          ...(options?.expectedMtimeMs === undefined
            ? {}
            : { expectedMtimeMs: options.expectedMtimeMs }),
        },
        toBase64(bytes),
      );
      return value.entry as FileEntry;
    },
    async rename(from: string, to: string) {
      await send({ method: "files.rename", from, to });
    },
    async remove(path: string, options) {
      await send({
        method: "files.remove",
        path,
        ...(options?.recursive === undefined ? {} : { recursive: options.recursive }),
      });
    },
    async backup(path: string) {
      const value = await send({ method: "files.backup", path });
      if (typeof value.path !== "string") throw new Error("the host refused the backup");
      return value.path;
    },
    async lock(path: string) {
      const value = await send({ method: "files.lock", path });
      const token = typeof value.token === "string" ? value.token : "";
      if (token.length === 0) throw new Error("the host refused the lock");
      // The token stays in this closure. A pack gets the `FileLock` shape it
      // expects and cannot replay the token against another frame.
      return {
        path,
        release: async () => {
          await send({ method: "files.unlock", token });
        },
      };
    },
    async pickOpen(filters: readonly FileFilter[]) {
      const value = await send({ method: "files.pickOpen", filters });
      if (typeof value.bytes !== "string") return null;
      return {
        name: typeof value.name === "string" ? value.name : "",
        mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
        bytes: fromBase64(value.bytes),
      } satisfies PickedFile;
    },
    async exportFile(input) {
      const value = await send(
        { method: "files.exportFile", name: input.name, mimeType: input.mimeType },
        toBase64(input.bytes),
      );
      return { ok: true, uri: typeof value.uri === "string" ? value.uri : "" };
    },
    async share(input) {
      const value = await send(
        { method: "files.share", name: input.name, mimeType: input.mimeType },
        toBase64(input.bytes),
      );
      return value as unknown as FileOutcome;
    },
  };

  return {
    moduleId: options.moduleId,
    documents,
    storage: {
      async get(key) {
        const value = await send({ method: "storage.get", key });
        return typeof value === "string" ? value : null;
      },
      async set(key, value) {
        await send({ method: "storage.set", key, value });
      },
      async delete(key) {
        await send({ method: "storage.delete", key });
      },
      async keys() {
        return [];
      },
    },
    navigation: {
      setTitle: () => undefined,
      close: () => undefined,
    },
    recents: {
      remember: (documentId, title) => {
        void send({ method: "recents.remember", documentId, title });
      },
      forget: () => undefined,
    },
    files,
    notifications: {
      async permission() {
        const value = await send({ method: "notifications.permission" });
        return (typeof value === "string" ? value : "unsupported") as NotificationPermission;
      },
      async request() {
        const value = await send({ method: "notifications.request" });
        return (typeof value === "string" ? value : "unsupported") as NotificationPermission;
      },
      async schedule(notification) {
        const value = await send({
          method: "notifications.schedule",
          id: notification.id,
          title: notification.title,
          at: notification.at,
        });
        return value as unknown as NotificationOutcome;
      },
      async cancel(id) {
        await send({ method: "notifications.cancel", id });
      },
      async cancelAll() {
        await send({ method: "notifications.cancelAll" });
      },
    },
    // The painted values live in the shell; `currentTheme()` asks for them. This static copy is
    // what a domain reads after awaiting it, so nothing has to remember to refresh.
    theme: { scheme: "light", density: "comfortable", cssVariables: {} },
    async currentTheme() {
      const value = (await send({ method: "theme" })) as unknown as FrameTheme;
      return { scheme: value.scheme, density: value.density, cssVariables: value.variables };
    },
    onFlush(listener) {
      flushListeners.add(listener);
      return () => {
        flushListeners.delete(listener);
      };
    },
    dispose() {
      globalThis.removeEventListener("message", listener);
      flushListeners.clear();
      // Reject rather than clear: a caller awaiting a request has to learn it will never be
      // answered, or it waits forever on a promise nobody holds any more.
      for (const [, waiting] of pending) {
        waiting.reject(new Error("the shell released this module before answering"));
      }
      pending.clear();
    },
  };
}
