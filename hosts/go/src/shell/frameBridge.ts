import type {
  DocumentSummary,
  FileService,
  FrameAnswer,
  FrameRequest,
  FrameTheme,
  ModuleHost,
  PackCapability,
  PackManifest,
} from "@suite/go";
import { FRAME_PROTOCOL, isFrameEnvelope } from "@suite/go";
import { FileStoreError } from "@suite/pack-host/files/core";

/**
 * The shell's half of the frame bridge.
 *
 * One listener, one switch on `request.method`, one reply per envelope. Every branch answers
 * with the same `ModuleHost` call the shell's in-document modules use, so a domain gets the same
 * behaviour in either mode — and a method the shell has not implemented answers an honest
 * failure rather than `undefined`.
 *
 * The file branches do not call `host.files`. They use the `files` service the frame was opened
 * with, which is built from the frame's own manifest: the sender is the frame, and its identity
 * is the pack the shell mounted. No request on this wire carries a root.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // A file can be far larger than a document title. Spreading the whole buffer
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

/**
 * Which capability each request needs.
 *
 * `ready` and `theme` are absent on purpose: a pack that cannot ask what it is or how it should
 * look cannot render, and neither answer reveals anything (ADR-0001).
 */
const REQUIRED_CAPABILITY: Readonly<Record<FrameRequest["method"], PackCapability | null>> = {
  ready: null,
  theme: null,
  "documents.list": "documents",
  "documents.create": "documents",
  "documents.open": "documents",
  "documents.save": "documents",
  "documents.remove": "documents",
  "storage.get": "storage",
  "storage.set": "storage",
  "storage.delete": "storage",
  "recents.remember": "recents",
  "notifications.permission": "notifications",
  "notifications.request": "notifications",
  "notifications.schedule": "notifications",
  "notifications.cancel": "notifications",
  "notifications.cancelAll": "notifications",
  "files.list": "files",
  "files.stat": "files",
  "files.mkdir": "files",
  "files.read": "files",
  "files.write": "files",
  "files.rename": "files",
  "files.remove": "files",
  "files.backup": "files",
  "files.lock": "files",
  "files.unlock": "files",
  "files.pickOpen": "files",
  "files.exportFile": "files",
  "files.share": "files",
};

export interface FrameBridgeOptions {
  readonly host: ModuleHost;
  /** The installed pack, for its declared capabilities and its name in a refusal. */
  readonly manifest: () => PackManifest | null;
  /**
   * The store the sender may use.
   *
   * Built once for the mounted pack, from the manifest. The bridge never derives it from a
   * request: a pack naming another pack's id in a message is still answered by this store.
   */
  readonly files: FileService;
  readonly theme: () => FrameTheme;
  /** Where replies go. The iframe's `contentWindow`. */
  readonly target: () => Window | null;
}

export interface FrameServer {
  /** Answer one request. Split from the transport so a test can drive the bridge directly. */
  answer(request: FrameRequest, payload?: string): Promise<FrameAnswer>;
  /** Release every lock this frame took. Called when the frame is destroyed. */
  dispose(): void;
}

/** The request handler, without the `postMessage` transport. */
export function createFrameServer(options: FrameBridgeOptions): FrameServer {
  /** Token to lock. A pack never sees the lock object, only the outcome. */
  const locks = new Map<string, Awaited<ReturnType<FileService["lock"]>>>();
  const files = options.files;

  const answer = async (
    request: FrameRequest,
    payload: string | undefined,
  ): Promise<FrameAnswer> => {
    const { host } = options;

    // Deny by default, checked per request rather than at install: the request is where the data
    // would actually move, and a check at install protects nobody.
    const manifest = options.manifest();
    const required = REQUIRED_CAPABILITY[request.method];
    if (required !== null) {
      if (manifest === null) {
        return { ok: false, message: "this frame has no installed pack identity" };
      }
      if (!manifest.capabilities.includes(required)) {
        return {
          ok: false,
          message: `${manifest.name} ${manifest.version} asked for "${required}" but does not declare it.`,
        };
      }
    }

    try {
      switch (request.method) {
        case "ready":
          return { ok: true, value: { moduleId: host.moduleId } };

        case "theme":
          return { ok: true, value: options.theme() };

        case "documents.list": {
          // The request may narrow to one module. A pack cannot invent another domain's id into
          // anything dangerous — it still only receives summaries — but honouring the argument is
          // what makes "list my documents" mean that, instead of "list everything".
          const list: readonly DocumentSummary[] = await host.documents.list(request.moduleId);
          return { ok: true, value: list };
        }

        case "documents.create": {
          const created = await host.documents.create({
            moduleId: host.moduleId,
            name: request.name,
          });
          return {
            ok: true,
            value: { ...created, bytes: toBase64(created.bytes) },
          };
        }

        case "documents.open": {
          const opened = await host.documents.open(request.id);
          if (!opened) return { ok: true, value: null };
          return { ok: true, value: { ...opened, bytes: toBase64(opened.bytes) } };
        }

        case "documents.save": {
          if (payload === undefined) {
            return { ok: false, message: "documents.save needs a payload" };
          }
          const saved = await host.documents.save(request.id, {
            bytes: fromBase64(payload),
            ...(request.title === undefined ? {} : { title: request.title }),
          });
          return { ok: true, value: saved };
        }

        case "documents.remove":
          await host.documents.remove(request.id);
          return { ok: true, value: null };

        case "storage.get":
          return { ok: true, value: await host.storage.get(request.key) };

        case "storage.set":
          await host.storage.set(request.key, request.value);
          return { ok: true, value: null };

        case "storage.delete":
          await host.storage.delete(request.key);
          return { ok: true, value: null };

        case "recents.remember":
          host.recents.remember(request.documentId, request.title);
          return { ok: true, value: null };

        case "notifications.permission":
          return { ok: true, value: await host.notifications.permission() };

        case "notifications.request":
          return { ok: true, value: await host.notifications.request() };

        case "notifications.schedule":
          return {
            ok: true,
            value: await host.notifications.schedule({
              id: request.id,
              title: request.title,
              at: request.at,
            }),
          };

        case "notifications.cancel":
          await host.notifications.cancel(request.id);
          return { ok: true, value: null };

        case "notifications.cancelAll":
          await host.notifications.cancelAll();
          return { ok: true, value: null };

        case "files.list":
          return {
            ok: true,
            value: await files.list(request.path ?? ""),
          };

        case "files.stat":
          return { ok: true, value: { entry: await files.stat(request.path) } };

        case "files.mkdir":
          await files.mkdir(request.path);
          return { ok: true, value: null };

        case "files.read": {
          const bytes = await files.read(
            request.path,
            request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes },
          );
          return { ok: true, value: { bytes: toBase64(bytes) } };
        }

        case "files.write": {
          if (payload === undefined) {
            return { ok: false, message: "files.write needs a payload" };
          }
          const entry = await files.write(request.path, fromBase64(payload), {
            ...(request.atomic === undefined ? {} : { atomic: request.atomic }),
            ...(request.expectedMtimeMs === undefined
              ? {}
              : { expectedMtimeMs: request.expectedMtimeMs }),
          });
          return { ok: true, value: { entry } };
        }

        case "files.rename":
          await files.rename(request.from, request.to);
          return { ok: true, value: null };

        case "files.remove":
          await files.remove(
            request.path,
            request.recursive === undefined ? {} : { recursive: request.recursive },
          );
          return { ok: true, value: null };

        case "files.backup":
          return { ok: true, value: { path: await files.backup(request.path) } };

        case "files.lock": {
          const lock = await files.lock(request.path);
          const token = crypto.randomUUID();
          locks.set(token, lock);
          return { ok: true, value: { token, path: lock.path } };
        }

        case "files.unlock": {
          const lock = locks.get(request.token);
          // An unknown token is ignored rather than reported: a guessed token must
          // not become a way to learn whether another frame holds a lock.
          if (lock === undefined) return { ok: true, value: null };
          locks.delete(request.token);
          await lock.release();
          return { ok: true, value: null };
        }

        case "files.pickOpen": {
          const picked = await files.pickOpen(request.filters);
          if (picked === null) return { ok: true, value: {} };
          return {
            ok: true,
            value: {
              name: picked.name,
              mimeType: picked.mimeType,
              bytes: toBase64(picked.bytes),
            },
          };
        }

        case "files.exportFile": {
          if (payload === undefined) {
            return { ok: false, message: "files.exportFile needs a payload" };
          }
          return {
            ok: true,
            value: await files.exportFile({
              name: request.name,
              mimeType: request.mimeType,
              bytes: fromBase64(payload),
            }),
          };
        }

        case "files.share": {
          if (payload === undefined) {
            return { ok: false, message: "files.share needs a payload" };
          }
          return {
            ok: true,
            value: await files.share({
              name: request.name,
              mimeType: request.mimeType,
              bytes: fromBase64(payload),
            }),
          };
        }

        default: {
          // A pack built against a newer protocol asks something this shell does not know.
          // Saying so beats answering `undefined` and letting the domain fail later.
          const unreachable: never = request;
          return { ok: false, message: `unknown method ${JSON.stringify(unreachable)}` };
        }
      }
    } catch (error) {
      // A file refusal carries the code a pack can branch on, with the generic
      // sentence the store wrote. No absolute path or host detail is included.
      if (error instanceof FileStoreError) {
        return { ok: false, message: `${error.message} (${error.code})` };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    answer: (request, payload) => answer(request, payload),
    dispose() {
      for (const [, lock] of locks) void lock.release().catch(() => undefined);
      locks.clear();
    },
  };
}

export function serveFrame(options: FrameBridgeOptions): () => void {
  const server = createFrameServer(options);
  const handle = async (event: MessageEvent): Promise<void> => {
    if (!isFrameEnvelope(event.data)) return;
    const window = options.target();
    // A page receives messages from anything that holds a reference to it. Only
    // the frame this bridge was opened for may be answered, so another frame
    // cannot borrow this pack's store by posting here.
    if (window === null || event.source !== window) return;
    const envelope = event.data;
    const reply = await server.answer(envelope.request, envelope.payload);
    window.postMessage({ ...reply, protocol: FRAME_PROTOCOL, id: envelope.id }, "*");
  };

  const listener = (event: MessageEvent) => {
    // Answers are asynchronous on purpose: a domain that awaits a save should not block its
    // own render, and the shell may be reading IndexedDB.
    void handle(event);
  };

  globalThis.addEventListener("message", listener);
  return () => {
    globalThis.removeEventListener("message", listener);
    server.dispose();
  };
}
