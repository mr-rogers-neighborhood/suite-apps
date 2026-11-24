import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { isSafeContainerId } from "./container.js";
import { isSafePackId } from "./packs.js";
import type { DocumentRecord, DocumentSummary } from "./shared.js";

/**
 * The documents a pack owns, stored inside a host envelope.
 *
 * The pack names a document; the host resolves it under
 * `<container>/<pack>` and nowhere else. There is no path in the API, so a pack
 * cannot ask for another pack's file, and a name with a slash or a `..` is
 * refused before it reaches the filesystem. This is the capability the
 * blast-radius answer depends on.
 *
 * The envelope is the host's, not the pack's (S6.1). It is a fixed prefix
 * (magic and envelope version), a canonical JSON header and the pack's payload
 * bytes, untouched. The header names the publisher, pack, document, schema,
 * payload length and payload checksum. Reading the header never needs the
 * payload, and the host never parses the payload itself.
 *
 * The host also owns the durability rules (S6.2): one write at a time per
 * document, a temporary file that is flushed and renamed, a previous copy
 * beside the file, crash recovery for an interrupted write and a quarantine for
 * an envelope that does not verify. A file from before the envelope is refused
 * and left alone; migrating it belongs to the pack schema work (S6.3).
 *
 * Errors are deliberately generic. A Node filesystem error carries an absolute
 * path, and the bridge would hand that path to a pack; the original error is
 * logged in the main process instead. A refusal is the one error whose sentence
 * travels to the caller, and its export hint is relative to the data root.
 */
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,199}$/u;

export function isSafeDocumentId(value: string): boolean {
  return DOCUMENT_ID.test(value) && value !== "." && value !== "..";
}

/** Eight ASCII bytes. A file without them was not written by this host. */
export const DOCUMENT_MAGIC = "SUITEDOC";

/** The envelope version this build writes and accepts. A greater one is refused. */
export const DOCUMENT_ENVELOPE_VERSION = 1;

/**
 * The publisher recorded in a header this host writes.
 *
 * The shell is the only envelope writer today. A pack-level publisher arrives
 * with the manifest `documents` declaration (S6.3), and this default then gives
 * way to the declared one.
 */
export const HOST_PUBLISHER = "suite";

/** The newest schema version a document may carry unless a caller says otherwise. */
export const DOCUMENT_SCHEMA_VERSION = 1;

const MAGIC_BYTES = new TextEncoder().encode(DOCUMENT_MAGIC);
/** magic (8) + envelope version (2) + header length (4). */
const PREFIX_BYTES = MAGIC_BYTES.byteLength + 2 + 4;
const MAX_HEADER_BYTES = 8 * 1024;
const CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const BACKUP_SUFFIX = ".bak";
const CORRUPT_INFIX = ".corrupt-";
const TEMPORARY_INFIX = ".tmp-";
const HEADER_KEYS = [
  "documentId",
  "packId",
  "payloadChecksum",
  "payloadLength",
  "publisher",
  "schemaVersion",
].join(",");

/** The header the host reads, without the fixed prefix it already validated. */
export interface DocumentEnvelopeHeader {
  readonly publisher: string;
  readonly packId: string;
  readonly documentId: string;
  readonly schemaVersion: number;
  readonly payloadLength: number;
  /** `sha256:<hex>` over the payload bytes, exactly as they sit in the file. */
  readonly payloadChecksum: string;
}

/** Everything the host contributes to a new envelope. Length and checksum follow the bytes. */
export interface DocumentEnvelopeParts {
  readonly publisher: string;
  readonly packId: string;
  readonly documentId: string;
  readonly schemaVersion: number;
  readonly payload: Uint8Array;
}

export type DocumentRefusalKind =
  | "corrupt"
  | "newer-envelope"
  | "newer-schema"
  | "pre-envelope"
  | "too-large";

/**
 * A document the host will not hand over, and why.
 *
 * `exportPath` is relative to the host's data root: it names where the person's
 * file is so it can be copied out, and it never leaks an absolute path to a
 * pack. `message` is a complete sentence naming the versions, because the pack
 * shows it as-is.
 */
export class DocumentRefusal extends Error {
  readonly kind: DocumentRefusalKind;
  readonly exportPath: string;

  constructor(kind: DocumentRefusalKind, message: string, exportPath: string) {
    super(message);
    this.name = "DocumentRefusal";
    this.kind = kind;
    this.exportPath = exportPath;
  }
}

export interface DocumentOpenOptions {
  /** The newest schema version the caller understands. Defaults to `DOCUMENT_SCHEMA_VERSION`. */
  readonly schemaVersion?: number;
}

export interface DocumentSaveOptions {
  /** The schema version the caller writes. An existing document keeps its own. */
  readonly schemaVersion?: number;
}

function fsCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function logged(action: string, error: unknown): Error {
  console.warn(`[shell] ${action}`, error);
  return new Error(action);
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * The one encoding of an envelope header.
 *
 * The JSON is canonical by construction: the keys are written in one fixed
 * order with no whitespace, so the same header is the same bytes everywhere and
 * the payload checksum is checked against the bytes as stored.
 */
export function encodeDocumentEnvelope(parts: DocumentEnvelopeParts): Uint8Array {
  const header: DocumentEnvelopeHeader = {
    publisher: parts.publisher,
    packId: parts.packId,
    documentId: parts.documentId,
    schemaVersion: parts.schemaVersion,
    payloadLength: parts.payload.byteLength,
    payloadChecksum: checksum(parts.payload),
  };
  const body = new TextEncoder().encode(
    JSON.stringify({
      documentId: header.documentId,
      packId: header.packId,
      payloadChecksum: header.payloadChecksum,
      payloadLength: header.payloadLength,
      publisher: header.publisher,
      schemaVersion: header.schemaVersion,
    }),
  );
  const envelope = new Uint8Array(PREFIX_BYTES + body.byteLength + parts.payload.byteLength);
  envelope.set(MAGIC_BYTES, 0);
  const view = new DataView(envelope.buffer);
  view.setUint16(MAGIC_BYTES.byteLength, DOCUMENT_ENVELOPE_VERSION);
  view.setUint32(MAGIC_BYTES.byteLength + 2, body.byteLength);
  envelope.set(body, PREFIX_BYTES);
  envelope.set(parts.payload, PREFIX_BYTES + body.byteLength);
  return envelope;
}

type HeaderRead =
  | { readonly kind: "missing" }
  | { readonly kind: "pre-envelope" }
  | { readonly kind: "newer"; readonly envelopeVersion: number }
  | { readonly kind: "corrupt"; readonly reason: string }
  | {
      readonly kind: "ok";
      readonly header: DocumentEnvelopeHeader;
      readonly payloadOffset: number;
    };

function isHeader(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHeaderBody(body: Uint8Array): DocumentEnvelopeHeader | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
  if (!isHeader(parsed)) return null;
  const record = parsed;
  // The header is the host's own shape. A field this host does not know is a
  // reason to refuse, not a reason to ignore: a newer envelope bumps the
  // version rather than smuggling a field into this one.
  if (Object.keys(record).sort().join(",") !== HEADER_KEYS) return null;
  const { publisher, packId, documentId, schemaVersion, payloadLength, payloadChecksum } = record;
  if (typeof publisher !== "string" || publisher.length === 0 || publisher.length > 64) return null;
  if (typeof packId !== "string" || !isSafePackId(packId)) return null;
  if (typeof documentId !== "string" || !isSafeDocumentId(documentId)) return null;
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion)) return null;
  if (schemaVersion < 1 || schemaVersion > 1_000_000) return null;
  if (typeof payloadLength !== "number" || !Number.isSafeInteger(payloadLength)) return null;
  if (payloadLength < 0) return null;
  if (typeof payloadChecksum !== "string" || !CHECKSUM.test(payloadChecksum)) return null;
  return {
    publisher,
    packId,
    documentId,
    schemaVersion,
    payloadLength,
    payloadChecksum,
  };
}

async function readFully(
  handle: Awaited<ReturnType<typeof open>>,
  target: Uint8Array,
  position: number,
): Promise<number> {
  let offset = 0;
  while (offset < target.byteLength) {
    const { bytesRead } = await handle.read(
      target,
      offset,
      target.byteLength - offset,
      position + offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset;
}

export class DocumentStore {
  readonly #root: string;
  readonly #publisher: string;
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #recovering = new Map<string, Promise<void>>();

  constructor(root: string, publisher: string = HOST_PUBLISHER) {
    this.#root = root;
    this.#publisher = publisher;
  }

  #packRoot(containerId: string, packId: string): string {
    if (!isSafeContainerId(containerId)) throw new Error("invalid container id");
    if (!isSafePackId(packId)) throw new Error("invalid pack id");
    return join(this.#root, containerId, packId);
  }

  #path(containerId: string, packId: string, id: string): string {
    if (!isSafeDocumentId(id)) throw new Error("invalid document name");
    const directory = this.#packRoot(containerId, packId);
    const file = join(directory, id);
    const boundary = directory.endsWith(sep) ? directory : `${directory}${sep}`;
    if (!file.startsWith(boundary)) throw new Error("document is outside the pack");
    return file;
  }

  /** Where a person can find the file, relative to the host data root. Never absolute. */
  #exportPath(containerId: string, packId: string, name: string): string {
    return ["documents", containerId, packId, name].join("/");
  }

  async list(containerId: string, packId: string): Promise<readonly DocumentSummary[]> {
    const directory = this.#packRoot(containerId, packId);
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (fsCode(error) === "ENOENT") return [];
      throw logged("documents could not be listed", error);
    }

    const found: DocumentSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isSafeDocumentId(entry.name)) continue;
      // Host bookkeeping — a previous copy, a quarantined file, an unfinished
      // write — is not a document a pack may open.
      if (this.#isHostFile(entry.name)) continue;
      const file = join(directory, entry.name);
      try {
        const details = await lstat(file);
        if (!details.isFile()) continue;
        // Listing reads the header only. An unreadable header still lists the
        // file at its on-disk size so the person can see what is there.
        const read = await this.#readHeader(file);
        const size =
          read.kind === "ok"
            ? read.header.payloadLength
            : read.kind === "missing"
              ? 0
              : details.size;
        found.push({
          id: entry.name,
          name: entry.name,
          size,
          updatedAt: details.mtimeMs,
        });
      } catch (error) {
        // A file that vanished between readdir and lstat is simply not listed.
        if (fsCode(error) === "ENOENT") continue;
        throw logged("documents could not be listed", error);
      }
    }
    return found.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  /**
   * The envelope header, read without the payload.
   *
   * This is the host's header view: `list` uses it, and a caller that only needs
   * the schema does not pay for the payload. A missing document is `null`; a
   * file that is not an envelope is refused, not guessed at.
   */
  async header(
    containerId: string,
    packId: string,
    id: string,
  ): Promise<DocumentEnvelopeHeader | null> {
    const file = this.#path(containerId, packId, id);
    const details = await lstat(file).catch((error: unknown) => {
      if (fsCode(error) === "ENOENT") return null;
      throw error;
    });
    if (details === null) return null;
    if (!details.isFile()) throw new Error("document is not a regular file");
    const read = await this.#headerFor(file, packId, id);
    if (read.kind === "missing") return null;
    if (read.kind === "ok") return read.header;
    return this.#refuse(read, containerId, packId, id, file);
  }

  async create(containerId: string, packId: string, name: string): Promise<DocumentSummary> {
    const file = this.#path(containerId, packId, name);
    try {
      await mkdir(dirname(file), { recursive: true });
      await this.#withLock(file, async () => {
        // A crash can leave the previous copy beside a missing document. Restore
        // it before the exclusive create so the old document is never replaced
        // by a blank one.
        await this.#recover(file);
        const envelope = encodeDocumentEnvelope({
          publisher: this.#publisher,
          packId,
          documentId: name,
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          payload: new Uint8Array(),
        });
        // `wx` refuses an existing file, so create cannot silently truncate a
        // note the pack already had.
        const handle = await open(file, "wx");
        try {
          await handle.writeFile(envelope);
          await handle.sync();
        } finally {
          await handle.close();
        }
      });
      return await this.#summary(file, name, 0);
    } catch (error) {
      if (error instanceof DocumentRefusal) throw error;
      if (fsCode(error) === "EEXIST") throw new Error("document already exists");
      throw logged("document could not be created", error);
    }
  }

  async open(
    containerId: string,
    packId: string,
    id: string,
    options: DocumentOpenOptions = {},
  ): Promise<DocumentRecord | null> {
    const file = this.#path(containerId, packId, id);
    try {
      await this.#recover(file);
      // A symlink is refused before anything is read from it: the pack may not
      // point the host at another file.
      const details = await lstat(file).catch((error: unknown) => {
        if (fsCode(error) === "ENOENT") return null;
        throw error;
      });
      if (details === null) return null;
      if (!details.isFile()) throw new Error("document is not a regular file");

      const read = await this.#headerFor(file, packId, id);
      if (read.kind === "missing") return null;
      if (read.kind !== "ok") return this.#refuse(read, containerId, packId, id, file);
      this.#assertSchema(read.header, options, containerId, packId, id);

      if (read.header.payloadLength > MAX_DOCUMENT_BYTES) {
        throw this.#tooLarge(containerId, packId, id);
      }
      const whole = await readFile(file);
      const payload = whole.subarray(read.payloadOffset);
      if (payload.byteLength !== read.header.payloadLength) {
        return this.#quarantineAndRefuse(file, containerId, packId, id, "it is truncated");
      }
      if (checksum(payload) !== read.header.payloadChecksum) {
        return this.#quarantineAndRefuse(
          file,
          containerId,
          packId,
          id,
          "its checksum does not match",
        );
      }
      return {
        id,
        name: id,
        size: payload.byteLength,
        updatedAt: details.mtimeMs,
        // Detach the payload from Node's read buffer: the pack owns these bytes,
        // and they are exactly the bytes the writer put in, not a re-encoding.
        bytes: new Uint8Array(payload),
      };
    } catch (error) {
      if (error instanceof DocumentRefusal) throw error;
      if (error instanceof Error && error.message === "document is not a regular file") throw error;
      throw logged("document could not be opened", error);
    }
  }

  async save(
    containerId: string,
    packId: string,
    id: string,
    bytes: Uint8Array,
    options: DocumentSaveOptions = {},
  ): Promise<DocumentSummary> {
    if (!(bytes instanceof Uint8Array)) throw new Error("a document is bytes");
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("document is too large");

    const file = this.#path(containerId, packId, id);
    try {
      return await this.#withLock(file, async () => {
        const existing = await lstat(file).catch((error: unknown) => {
          if (fsCode(error) === "ENOENT") return null;
          throw error;
        });
        if (existing !== null && !existing.isFile()) {
          throw new Error("document is not a regular file");
        }

        let schemaVersion = options.schemaVersion ?? DOCUMENT_SCHEMA_VERSION;
        let publisher = this.#publisher;
        if (existing !== null) {
          // A save never overwrites a file this build cannot read. The pack sees
          // the refusal; the person's file is left where it is.
          const read = await this.#headerFor(file, packId, id);
          if (read.kind !== "ok") {
            return this.#refuse(read, containerId, packId, id, file);
          }
          // The header can read while the payload under it cannot: a checksum
          // failure is the same refusal and still leaves the file alone.
          const current = await readFile(file);
          const currentPayload = current.subarray(read.payloadOffset);
          if (checksum(currentPayload) !== read.header.payloadChecksum) {
            throw this.#unreadable(containerId, packId, id, "its checksum does not match");
          }
          schemaVersion = options.schemaVersion ?? read.header.schemaVersion;
          publisher = read.header.publisher;
        }

        await mkdir(dirname(file), { recursive: true });
        await this.#keepPrevious(file);
        await this.#writeAtomically(
          file,
          encodeDocumentEnvelope({
            publisher,
            packId,
            documentId: id,
            schemaVersion,
            payload: bytes,
          }),
        );
        return await this.#summary(file, id, bytes.byteLength);
      });
    } catch (error) {
      if (error instanceof DocumentRefusal) throw error;
      if (error instanceof Error && error.message === "document is not a regular file") throw error;
      throw logged("document could not be saved", error);
    }
  }

  /**
   * Rewrite the header and keep the payload byte for byte (S6.9).
   *
   * The payload is never decoded, re-encoded or defaulted; it is copied from the
   * file into the new envelope exactly as it was. This is the seam a declared
   * migration or projection writes through (S6.3), and it is why a field the
   * pack added survives a host-side rewrite.
   */
  async rewrite(
    containerId: string,
    packId: string,
    id: string,
    options: DocumentSaveOptions = {},
  ): Promise<DocumentSummary> {
    const file = this.#path(containerId, packId, id);
    try {
      return await this.#withLock(file, async () => {
        const read = await this.#headerFor(file, packId, id);
        if (read.kind === "missing") throw new Error("document does not exist");
        if (read.kind !== "ok") return this.#refuse(read, containerId, packId, id, file);
        const whole = await readFile(file);
        const payload = new Uint8Array(whole.subarray(read.payloadOffset));
        if (checksum(payload) !== read.header.payloadChecksum) {
          return this.#quarantineAndRefuse(
            file,
            containerId,
            packId,
            id,
            "its checksum does not match",
          );
        }
        await this.#keepPrevious(file);
        await this.#writeAtomically(
          file,
          encodeDocumentEnvelope({
            publisher: read.header.publisher,
            packId,
            documentId: id,
            schemaVersion: options.schemaVersion ?? read.header.schemaVersion,
            payload,
          }),
        );
        return await this.#summary(file, id, payload.byteLength);
      });
    } catch (error) {
      if (error instanceof DocumentRefusal) throw error;
      throw logged("document could not be rewritten", error);
    }
  }

  async remove(containerId: string, packId: string, id: string): Promise<void> {
    const file = this.#path(containerId, packId, id);
    try {
      await this.#withLock(file, async () => {
        await rm(file, { force: true });
        // The previous copy goes with the document. A backup left behind would
        // be restored as the person's document on the next open.
        await rm(`${file}${BACKUP_SUFFIX}`, { force: true });
      });
    } catch (error) {
      throw logged("document could not be removed", error);
    }
  }

  #isHostFile(name: string): boolean {
    return (
      name.endsWith(BACKUP_SUFFIX) || name.includes(CORRUPT_INFIX) || name.includes(TEMPORARY_INFIX)
    );
  }

  async #summary(file: string, name: string, size: number): Promise<DocumentSummary> {
    const details = await lstat(file);
    if (!details.isFile()) throw new Error("document is not a regular file");
    return { id: name, name, size, updatedAt: details.mtimeMs };
  }

  /** Serialize writes to one document. The shell is single-instance; this is its lock. */
  #withLock<T>(file: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(file) ?? Promise.resolve();
    const next = previous.then(action, action);
    // A failed write must not poison every later write; the caller still sees
    // the failure through `next`.
    this.#locks.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  }

  /**
   * Read the fixed prefix and the header body, and nothing after it.
   *
   * The payload offset is the only thing the caller needs to find the payload,
   * so a header read is genuinely a header read even when the payload is large
   * or damaged.
   */
  async #readHeader(file: string): Promise<HeaderRead> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(file, "r");
    } catch (error) {
      if (fsCode(error) === "ENOENT") return { kind: "missing" };
      throw error;
    }
    try {
      const prefix = new Uint8Array(PREFIX_BYTES);
      const prefixRead = await readFully(handle, prefix, 0);
      if (prefixRead < MAGIC_BYTES.byteLength) return { kind: "pre-envelope" };
      for (let index = 0; index < MAGIC_BYTES.byteLength; index += 1) {
        if (prefix[index] !== MAGIC_BYTES[index]) return { kind: "pre-envelope" };
      }
      if (prefixRead < PREFIX_BYTES) return { kind: "corrupt", reason: "its header is truncated" };

      const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
      const envelopeVersion = view.getUint16(MAGIC_BYTES.byteLength);
      if (envelopeVersion > DOCUMENT_ENVELOPE_VERSION) {
        return { kind: "newer", envelopeVersion };
      }
      if (envelopeVersion !== DOCUMENT_ENVELOPE_VERSION) {
        return { kind: "corrupt", reason: "its envelope version is not known" };
      }

      const headerLength = view.getUint32(MAGIC_BYTES.byteLength + 2);
      if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
        return { kind: "corrupt", reason: "its header length is not valid" };
      }
      const body = new Uint8Array(headerLength);
      const bodyRead = await readFully(handle, body, PREFIX_BYTES);
      if (bodyRead < headerLength) return { kind: "corrupt", reason: "its header is truncated" };

      const header = parseHeaderBody(body);
      if (header === null)
        return { kind: "corrupt", reason: "its header is not a document header" };

      const details = await handle.stat();
      const payloadOffset = PREFIX_BYTES + headerLength;
      if (details.size - payloadOffset !== header.payloadLength) {
        return { kind: "corrupt", reason: "its payload length does not match the header" };
      }
      return { kind: "ok", header, payloadOffset };
    } finally {
      await handle.close();
    }
  }

  async #headerFor(file: string, packId: string, id: string): Promise<HeaderRead> {
    const read = await this.#readHeader(file);
    if (read.kind !== "ok") return read;
    if (read.header.packId !== packId || read.header.documentId !== id) {
      // The header names another pack or another document: a copied or renamed
      // file is not the document it sits under.
      return { kind: "corrupt", reason: "its header names another document" };
    }
    return read;
  }

  #assertSchema(
    header: DocumentEnvelopeHeader,
    options: DocumentOpenOptions,
    containerId: string,
    packId: string,
    id: string,
  ): void {
    const understood = options.schemaVersion ?? DOCUMENT_SCHEMA_VERSION;
    if (header.schemaVersion > understood) {
      const exportPath = this.#exportPath(containerId, packId, id);
      throw new DocumentRefusal(
        "newer-schema",
        `This document uses Suite document schema ${header.schemaVersion}; this build understands up to ${understood}. Open it in a newer Suite, or copy it out of ${exportPath}.`,
        exportPath,
      );
    }
  }

  #tooLarge(containerId: string, packId: string, id: string): DocumentRefusal {
    return new DocumentRefusal(
      "too-large",
      "This document is larger than this build reads. Open it in a newer Suite.",
      this.#exportPath(containerId, packId, id),
    );
  }

  /** A refusal that leaves the file exactly where it is. */
  #unreadable(containerId: string, packId: string, id: string, reason: string): DocumentRefusal {
    const exportPath = this.#exportPath(containerId, packId, id);
    return new DocumentRefusal(
      "corrupt",
      `This document could not be read because ${reason}. It is left at ${exportPath}, so nothing is lost.`,
      exportPath,
    );
  }

  /** Turn a non-`ok` header read into the refusal the caller sees. */
  async #refuse(
    read: Exclude<HeaderRead, { kind: "ok" }>,
    containerId: string,
    packId: string,
    id: string,
    file: string,
  ): Promise<never> {
    const exportPath = this.#exportPath(containerId, packId, id);
    if (read.kind === "missing") {
      throw new DocumentRefusal("corrupt", "This document is not there.", exportPath);
    }
    if (read.kind === "pre-envelope") {
      throw new DocumentRefusal(
        "pre-envelope",
        `This document was written before the host envelope, so this build leaves it as it is. Its bytes are at ${exportPath}.`,
        exportPath,
      );
    }
    if (read.kind === "newer") {
      throw new DocumentRefusal(
        "newer-envelope",
        `This document uses Suite document envelope ${read.envelopeVersion}; this build understands up to ${DOCUMENT_ENVELOPE_VERSION}. Open it in a newer Suite, or copy it out of ${exportPath}.`,
        exportPath,
      );
    }
    return this.#quarantineAndRefuse(file, containerId, packId, id, read.reason);
  }

  /**
   * Move an unreadable document aside and refuse it.
   *
   * The file is renamed, never deleted and never rewritten, so the person keeps
   * the only copy. A fresh document is not created in its place: the caller
   * decides what to show, and a `create` of the name is a separate, explicit act.
   */
  async #quarantineAndRefuse(
    file: string,
    containerId: string,
    packId: string,
    id: string,
    reason: string,
  ): Promise<never> {
    const quarantined = `${file}${CORRUPT_INFIX}${Date.now()}`;
    let moved = false;
    try {
      await rename(file, quarantined);
      moved = true;
    } catch (error) {
      if (fsCode(error) !== "ENOENT") throw error;
    }
    const name = basename(quarantined);
    const exportPath = this.#exportPath(containerId, packId, moved ? name : id);
    const where = moved
      ? `It was moved to ${exportPath} so nothing is lost.`
      : `It is still at ${exportPath}.`;
    console.warn(`[shell] document quarantined at ${quarantined}: ${reason}`);
    throw new DocumentRefusal(
      "corrupt",
      `This document could not be read because ${reason}. ${where}`,
      exportPath,
    );
  }

  /**
   * Recover from a crash during a write.
   *
   * An unfinished temporary file is discarded, because the rename never
   * happened and the document it would have replaced is still whole. If the
   * document itself is gone but its previous copy is there, the crash landed
   * between the backup and the rename, so the previous copy is restored.
   */
  async #recover(file: string): Promise<void> {
    const running = this.#recovering.get(file);
    if (running !== undefined) return running;
    const recovery = this.#recoverOnce(file).finally(() => {
      this.#recovering.delete(file);
    });
    this.#recovering.set(file, recovery);
    return recovery;
  }

  async #recoverOnce(file: string): Promise<void> {
    const directory = dirname(file);
    const name = basename(file);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (fsCode(error) === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.startsWith(`${name}${TEMPORARY_INFIX}`)) continue;
      await rm(join(directory, entry), { force: true }).catch((error: unknown) => {
        console.warn("[shell] could not discard an unfinished document write", error);
      });
    }
    const exists = await lstat(file).then(
      () => true,
      (error: unknown) => {
        if (fsCode(error) === "ENOENT") return false;
        throw error;
      },
    );
    if (exists) return;
    const backup = `${file}${BACKUP_SUFFIX}`;
    try {
      await rename(backup, file);
      console.warn(`[shell] restored a document from its previous copy at ${file}`);
    } catch (error) {
      if (fsCode(error) !== "ENOENT") throw error;
    }
  }

  /** Keep the last good file beside the document before it is replaced. */
  async #keepPrevious(file: string): Promise<void> {
    await copyFile(file, `${file}${BACKUP_SUFFIX}`).catch((error: unknown) => {
      if (fsCode(error) !== "ENOENT") throw error;
    });
  }

  /** Temporary file, flush, rename, then flush the directory entry. */
  async #writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
    const temporary = `${file}${TEMPORARY_INFIX}${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporary, "w");
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, file);
    } catch (error) {
      if (handle !== null) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    await this.#syncDirectory(dirname(file));
  }

  async #syncDirectory(directory: string): Promise<void> {
    // Best effort: the rename is already atomic, and some filesystems refuse to
    // sync a directory handle. A failure here must not turn a good write into an
    // error the pack sees.
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(directory, "r");
      await handle.sync();
    } catch {
      // Ignored: see above.
    } finally {
      if (handle !== null) await handle.close().catch(() => undefined);
    }
  }
}
