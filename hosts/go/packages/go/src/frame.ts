/**
 * The wire between the shell and a pack that renders in its own document.
 *
 * An `isolated` pack runs in an iframe: its own document, its own CSS scope, its own React.
 * It cannot call `ModuleHost` directly — the shell's objects are in another realm — so the same
 * surface goes over `postMessage`, one request at a time.
 *
 * The shape is deliberately the *same* `ModuleHost` vocabulary. A domain calls
 * `host.documents.save(...)` in either mode and does not know which one it is in; that is what
 * keeps a pack portable between them and what stops the contract from growing a second dialect.
 */
import type { ColorScheme, DocumentSummary, FileFilter, ThemeDensity } from "./host.js";

export const FRAME_PROTOCOL = "suite.frame.v1";

/**
 * The largest document payload the frame bridge will carry in one message.
 *
 * A snapshot is moved as bytes now, not as a string, and a bound is what keeps
 * one pack from asking the shell to allocate an unbounded buffer. 64 MiB is
 * generous for a phone document and small enough that a refusal is cheap.
 */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/** What a pack may ask the shell for. One name per `ModuleHost` operation it needs. */
export type FrameRequest =
  | { readonly method: "ready" }
  | { readonly method: "theme" }
  /**
   * `moduleId` narrows the answer to one domain's documents.
   *
   * It has to travel, because a pack cannot ask the shell's `DocumentStore` directly and the shell
   * must not guess: a pack that asked for its own documents and received every domain's would be
   * one `list()[0]` away from opening somebody else's file. Omitted means the recents query, which
   * is the same thing it means inside the shell.
   */
  | { readonly method: "documents.list"; readonly moduleId?: string }
  | { readonly method: "documents.create"; readonly name: string }
  | { readonly method: "documents.open"; readonly id: string }
  /**
   * The document bytes travel in `FrameEnvelope.bytes` as a `Uint8Array`, not in
   * a base64 `payload` (#149). `payload` is still how non-document file bytes
   * cross the bridge; a document must not become a string on the way.
   */
  | { readonly method: "documents.save"; readonly id: string; readonly title?: string }
  | { readonly method: "documents.remove"; readonly id: string }
  /** The public half of the pack's derived identity (S4.7). */
  | { readonly method: "identity.pack" }
  /**
   * Sign the pack's own data. `purpose` is checked by the host before Ed25519:
   * a relay frame, a role record or a membership change is refused.
   */
  | { readonly method: "identity.sign"; readonly purpose: string }
  | { readonly method: "storage.get"; readonly key: string }
  | { readonly method: "storage.set"; readonly key: string; readonly value: string }
  | { readonly method: "storage.delete"; readonly key: string }
  | { readonly method: "recents.remember"; readonly documentId: string; readonly title: string }
  | { readonly method: "notifications.permission" }
  | { readonly method: "notifications.request" }
  | {
      readonly method: "notifications.schedule";
      readonly id: string;
      readonly title: string;
      readonly at: number;
    }
  | { readonly method: "notifications.cancel"; readonly id: string }
  | { readonly method: "notifications.cancelAll" }
  /**
   * The pack's own files.
   *
   * Every path is relative, slash-separated and names a location inside the
   * pack's own root. Nothing on this wire carries a root: the host resolves the
   * sender's frame to a pack identity and picks the store. An absolute path or a
   * climb is refused by the shared path rule before the filesystem is touched.
   */
  | { readonly method: "files.list"; readonly path?: string }
  | { readonly method: "files.stat"; readonly path: string }
  | { readonly method: "files.mkdir"; readonly path: string }
  | { readonly method: "files.read"; readonly path: string; readonly maxBytes?: number }
  /** `payload` carries the bytes as base64. */
  | {
      readonly method: "files.write";
      readonly path: string;
      readonly atomic?: boolean;
      readonly expectedMtimeMs?: number;
    }
  | { readonly method: "files.rename"; readonly from: string; readonly to: string }
  | { readonly method: "files.remove"; readonly path: string; readonly recursive?: boolean }
  | { readonly method: "files.backup"; readonly path: string }
  /**
   * A host-issued lock token. The pack never sees the token; the frame client
   * turns it into a `FileLock` whose `release` sends `files.unlock`.
   */
  | { readonly method: "files.lock"; readonly path: string }
  | { readonly method: "files.unlock"; readonly token: string }
  /**
   * The person-consented surface. The pack asks; the platform picker and share
   * sheet answer. No path crosses either way.
   */
  | { readonly method: "files.pickOpen"; readonly filters: readonly FileFilter[] }
  /** `payload` carries the bytes as base64. */
  | { readonly method: "files.exportFile"; readonly name: string; readonly mimeType: string }
  /** `payload` carries the bytes as base64. */
  | { readonly method: "files.share"; readonly name: string; readonly mimeType: string };

export interface FrameEnvelope {
  readonly protocol: typeof FRAME_PROTOCOL;
  readonly id: number;
  readonly request: FrameRequest;
  /** File bytes, still base64: a file format decision, not a document path. */
  readonly payload?: string;
  /**
   * Document and identity bytes, structured-cloned as a `Uint8Array`.
   *
   * Bounded by `MAX_FRAME_BYTES` on both sides. A pack built before #149 sends
   * `payload` for `documents.save`; the shell refuses it with a sentence rather
   * than mis-parsing a string as bytes.
   */
  readonly bytes?: Uint8Array;
}

/**
 * The answer body, before the envelope is attached.
 *
 * Declared separately because `Omit` over a discriminated union collapses to the keys both
 * branches share — which silently drops `value` and `message` and leaves every reply branch
 * unassignable.
 */
export type FrameAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

export type FrameReply = FrameAnswer & {
  readonly protocol: typeof FRAME_PROTOCOL;
  readonly id: number;
};

/**
 * A control message the shell sends *into* a pack.
 *
 * `flush` is the only one, and it is deliberately not part of `FrameRequest`: that union is what a
 * pack may ask the shell for, and a pack asking the shell to save its own document is not a
 * capability the contract grants. The shell owns the lifecycle boundary (leaving, backgrounding,
 * closing), so it is the side that says "write what you have now".
 *
 * `id` is negative for controls. The pack's own requests count up from 1, so a reply to a control
 * cannot be mistaken for a reply to a request when both are in flight.
 */
export interface FrameControl {
  readonly protocol: typeof FRAME_PROTOCOL;
  readonly id: number;
  readonly control: "flush";
}

export function isFrameControl(value: unknown): value is FrameControl {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.protocol === FRAME_PROTOCOL &&
    typeof candidate.id === "number" &&
    candidate.control === "flush"
  );
}

export interface FrameTheme {
  readonly scheme: ColorScheme;
  readonly density: ThemeDensity;
  readonly variables: Readonly<Record<string, string>>;
}

/** What `documents.list` and `documents.open` answer with. `bytes` is the document itself. */
export interface FrameDocument extends DocumentSummary {
  readonly bytes?: Uint8Array;
}

/** Whether an envelope's byte payload is the shape and size the bridge accepts. */
export function isWithinFrameBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength <= MAX_FRAME_BYTES;
}

/**
 * Is this message from the frame protocol at all?
 *
 * Checked before anything else touches a message: a page receives messages from anything that
 * holds a reference to it, and reading `request.method` off a stranger is how a typo becomes a
 * crash in a domain's mount.
 */
export function isFrameEnvelope(value: unknown): value is FrameEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.protocol !== FRAME_PROTOCOL) return false;
  if (typeof candidate.id !== "number") return false;
  if (typeof candidate.request !== "object" || candidate.request === null) return false;
  const request = candidate.request as Record<string, unknown>;
  return typeof request.method === "string";
}

export function isFrameReply(value: unknown): value is FrameReply {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.protocol === FRAME_PROTOCOL &&
    typeof candidate.id === "number" &&
    typeof candidate.ok === "boolean"
  );
}
