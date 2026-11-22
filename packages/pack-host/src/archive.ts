import { comparePackPaths, isSafePackPath, type PackManifest } from "@suite/pack";
import { Unzip, UnzipInflate, Zip, ZipDeflate } from "fflate";

/**
 * The pack archive: one signed manifest plus payload files in one zip.
 *
 * The archive is untrusted input. A zip header can claim any uncompressed size it likes, so the
 * reader uses fflate's streaming `Unzip` and checks each entry's declared size before it starts
 * decompressing. It also holds every path to `isSafePackPath`, because a zip entry may climb with
 * `..` just as a filesystem write can, and it refuses duplicate names because a map would silently
 * keep only the last one. The manifest stays raw bytes: parsing and verifying it is `@suite/pack`'s
 * job, not this reader's.
 */

const MIB = 1024 * 1024;

const DEFAULT_MAX_ARCHIVE_BYTES = 64 * MIB;
const DEFAULT_MAX_FILE_BYTES = 64 * MIB;
const DEFAULT_MAX_TOTAL_BYTES = 128 * MIB;
const DEFAULT_MAX_FILES = 2048;

const MANIFEST_NAME = "manifest.json";
const ZIP_LEVEL = 6;

/**
 * The one timestamp every archive entry carries: 1980-01-01 local time, the earliest date a zip
 * can encode. It is built from local components, so the encoded DOS field is the same in every
 * timezone, and the archive is a pure function of its manifest and files.
 */
const ARCHIVE_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const LOCAL_FILE_HEADER = 0x04_03_4b_50;
const CENTRAL_FILE_HEADER = 0x02_01_4b_50;
const END_OF_DIRECTORY = 0x06_05_4b_50;
const ZIP64_END_OF_DIRECTORY = 0x06_06_4b_50;
const ZIP64_END_OF_DIRECTORY_LOCATOR = 0x07_06_4b_50;
const END_OF_DIRECTORY_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xff_ff;
const CENTRAL_HEADER_BYTES = 46;
const UNIX_MADE_BY = 3;
const OSX_MADE_BY = 19;
const FILE_TYPE_MASK = 0o17_00_00;
const REGULAR_FILE = 0o10_00_00;

export type PackArchiveErrorCode =
  | "invalid-zip"
  | "too-large"
  | "too-many-files"
  | "invalid-path"
  | "duplicate-path"
  | "missing-manifest"
  | "not-regular";

/** A refusal from the archive contract. The code says which rule, and the message is for a person. */
export class PackArchiveError extends Error {
  readonly code: PackArchiveErrorCode;

  constructor(code: PackArchiveErrorCode, message: string) {
    super(message);
    this.name = "PackArchiveError";
    this.code = code;
  }
}

export interface PackArchiveLimits {
  /** The compressed archive size. Defaults to 64 MiB. */
  readonly maxArchiveBytes?: number;
  /** One uncompressed entry. Defaults to 64 MiB. */
  readonly maxFileBytes?: number;
  /** Every uncompressed entry together, the manifest included. Defaults to 128 MiB. */
  readonly maxTotalBytes?: number;
  /** Entries in the archive, the manifest included. Defaults to 2048. */
  readonly maxFiles?: number;
}

export interface PackArchive {
  /** Raw manifest.json bytes. The caller parses them with `@suite/pack`. */
  readonly manifestBytes: Uint8Array;
  /** Payload files by relative slash-separated path, excluding manifest.json. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/**
 * Read a pack archive without trusting its zip headers.
 *
 * Declared sizes are checked before decompression; the bytes actually produced are checked again, so
 * an archive that lies about its size cannot decompress past the limit. A failure is always a
 * `PackArchiveError` with one of the codes above and a message that names no absolute path.
 */
export async function readPackArchive(
  bytes: Uint8Array,
  limits: PackArchiveLimits = {},
): Promise<PackArchive> {
  const maxArchiveBytes = limits.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;

  if (bytes.byteLength > maxArchiveBytes) {
    throw new PackArchiveError("too-large", "The archive is larger than this host accepts.");
  }
  if (!looksLikeZip(bytes)) {
    throw new PackArchiveError("invalid-zip", "The archive is not a readable zip file.");
  }

  // A zip can carry a symlink or a device node by writing its Unix mode into the
  // central directory, which `fflate` does not surface. Refuse those entries before
  // any bytes are decompressed.
  refuseNonRegularEntries(bytes);

  const files = new Map<string, Uint8Array>();
  let manifestBytes: Uint8Array | null = null;
  let entries = 0;
  let declaredTotal = 0;
  let receivedTotal = 0;
  // fflate catches a throwing `ondata` and calls it again with the error, so the first refusal is
  // remembered and rethrown rather than replaced by a generic `invalid-zip`.
  let failure: PackArchiveError | null = null;

  const refuse = (code: PackArchiveErrorCode, message: string): never => {
    const error = new PackArchiveError(code, message);
    failure = error;
    throw error;
  };

  try {
    const unzip = new Unzip((file) => {
      entries += 1;
      if (entries > maxFiles) {
        refuse("too-many-files", "The archive has more files than this host accepts.");
      }

      const path = file.name;
      if (!isSafePackPath(path)) {
        refuse("invalid-path", "The archive contains a path that leaves the pack.");
      }

      const isManifest = path === MANIFEST_NAME;
      if (isManifest ? manifestBytes !== null : files.has(path)) {
        refuse("duplicate-path", "The archive contains the same path twice.");
      }

      const declared = file.originalSize;
      if (declared !== undefined) {
        if (!Number.isSafeInteger(declared) || declared < 0) {
          refuse("invalid-zip", "The archive declares an impossible file size.");
        }
        if (declared > maxFileBytes) {
          refuse("too-large", "A file in the archive is larger than this host accepts.");
        }
        declaredTotal += declared;
        if (declaredTotal > maxTotalBytes) {
          refuse(
            "too-large",
            "The archive expands to more than this host accepts before decompression.",
          );
        }
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      file.ondata = (error, chunk, final) => {
        if (error !== null) {
          throw failure ?? new PackArchiveError("invalid-zip", "The archive is damaged.");
        }

        received += chunk.byteLength;
        receivedTotal += chunk.byteLength;
        if (received > maxFileBytes || receivedTotal > maxTotalBytes) {
          refuse("too-large", "A file in the archive expanded past the size this host accepts.");
        }
        if (declared !== undefined && received > declared) {
          refuse("invalid-zip", "The archive grew past the size it declared.");
        }
        if (chunk.byteLength > 0) chunks.push(chunk);
        if (!final) return;

        if (declared !== undefined && received !== declared) {
          refuse("invalid-zip", "The archive ended before the size it declared.");
        }
        const data = join(chunks, received);
        if (isManifest) manifestBytes = data;
        else files.set(path, data);
      };

      file.start();
    });

    unzip.register(UnzipInflate);
    unzip.push(bytes, true);
  } catch (error) {
    if (error instanceof PackArchiveError) throw error;
    if (failure !== null) throw failure;
    throw new PackArchiveError("invalid-zip", "The archive is not a readable zip file.");
  }

  if (manifestBytes === null) {
    throw new PackArchiveError("missing-manifest", "The archive has no manifest.json at its root.");
  }

  return { manifestBytes, files };
}

/**
 * Build a pack archive.
 *
 * The manifest is written first as pretty JSON, then the payload in sorted path order, and every
 * entry carries the same fixed timestamp. The same manifest and files therefore produce the same
 * bytes on any machine at any time, which is what makes the `.sha256` sidecar reproducible.
 *
 * Entries live in a prototype-free record: a payload file may legitimately be named `__proto__`,
 * and on a plain object that assignment would change the prototype instead of adding a key.
 *
 * A `manifest.json` in the payload would collide with the manifest the reader looks for, so it is
 * refused here rather than written over.
 */
export function buildPackArchive(
  manifest: PackManifest,
  files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  if (Object.hasOwn(files, MANIFEST_NAME)) {
    throw new PackArchiveError("duplicate-path", "The archive already contains its manifest.");
  }

  const entries: Record<string, Uint8Array> = Object.create(null);
  entries[MANIFEST_NAME] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  for (const path of Object.keys(files).sort(comparePackPaths)) {
    if (!isSafePackPath(path)) {
      throw new PackArchiveError("invalid-path", "A pack file path leaves the pack.");
    }
    const content = files[path];
    if (content === undefined) continue;
    entries[path] = content;
  }

  return zipEntries(entries);
}

/**
 * Write the entries in insertion order with one fixed timestamp.
 *
 * The streaming writer is deliberate: `zipSync` takes a record and indexes it by name, so an entry
 * called `__proto__` would change that record's prototype instead of becoming a file. This one
 * keeps its entries in an array, where any legal pack path is just a name.
 */
function zipEntries(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const archive = new Zip((error, chunk) => {
    if (error !== null) {
      throw new PackArchiveError("invalid-zip", "The archive could not be written.");
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  });

  for (const [path, content] of Object.entries(entries)) {
    const file = new ZipDeflate(path, { level: ZIP_LEVEL });
    file.mtime = ARCHIVE_MTIME;
    archive.add(file);
    file.push(content, true);
  }
  archive.end();

  return join(chunks, total);
}

function join(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The two signatures a complete, readable zip starts and ends with. */
function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.byteLength < END_OF_DIRECTORY_MIN_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER) return false;
  return endOfDirectoryOffset(view, bytes.byteLength) >= 0;
}

/**
 * Offset of the end-of-central-directory record.
 *
 * A truncated archive can still start with a local header. This record is what says the writer
 * finished; scan the tail a zip comment may occupy.
 */
function endOfDirectoryOffset(view: DataView, length: number): number {
  if (length < END_OF_DIRECTORY_MIN_BYTES) return -1;
  const earliest = Math.max(0, length - (END_OF_DIRECTORY_MIN_BYTES + MAX_ZIP_COMMENT_BYTES));
  for (let offset = length - END_OF_DIRECTORY_MIN_BYTES; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  return -1;
}

/**
 * Refuse a symlink, device, socket or other non-regular file entry.
 *
 * The Unix file mode lives only in the central directory's external attributes; the local header
 * `fflate` reads does not carry it. Writers that do not name a Unix-like OS (or leave the mode
 * unspecified) are treated as regular files, which is what a pack build produces.
 */
function refuseNonRegularEntries(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOfDirectoryOffset(view, bytes.byteLength);
  if (end < 0) return;

  let entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let size = view.getUint32(end + 12, true);

  // Zip64 moves the count and the directory's location into a separate record. Pack archives fit
  // well inside the uncompressed caps, but a third-party writer can still choose zip64, so follow
  // the locator rather than walking the wrong bytes.
  if (entries === 0xff_ff || offset === 0xff_ff_ff_ff || size === 0xff_ff_ff_ff) {
    const located = zip64CentralDirectory(view, end, bytes.byteLength);
    if (located === null) {
      throw new PackArchiveError("invalid-zip", "The archive's directory is not readable.");
    }
    entries = located.entries;
    offset = located.offset;
    size = located.size;
  }

  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > bytes.byteLength
  ) {
    throw new PackArchiveError("invalid-zip", "The archive's directory is not readable.");
  }

  let cursor = offset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > bytes.byteLength) {
      throw new PackArchiveError("invalid-zip", "The archive's directory is not readable.");
    }
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_HEADER) {
      throw new PackArchiveError("invalid-zip", "The archive's directory is not readable.");
    }

    const madeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const attributes = view.getUint32(cursor + 38, true);
    const next = cursor + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
    if (next > bytes.byteLength) {
      throw new PackArchiveError("invalid-zip", "The archive's directory is not readable.");
    }

    if ((flags & 1) !== 0) {
      throw new PackArchiveError("invalid-zip", "The archive contains an encrypted entry.");
    }

    const os = madeBy >>> 8;
    if (os === UNIX_MADE_BY || os === OSX_MADE_BY) {
      const mode = attributes >>> 16;
      const type = mode & FILE_TYPE_MASK;
      if (type !== 0 && type !== REGULAR_FILE) {
        throw new PackArchiveError(
          "not-regular",
          "The archive contains a link or a non-regular file.",
        );
      }
    }

    cursor = next;
  }
}

interface Zip64Directory {
  readonly entries: number;
  readonly offset: number;
  readonly size: number;
}

function zip64CentralDirectory(view: DataView, end: number, length: number): Zip64Directory | null {
  const locator = end - 20;
  if (locator < 0 || view.getUint32(locator, true) !== ZIP64_END_OF_DIRECTORY_LOCATOR) {
    return null;
  }

  const record = bigintToNumber(view.getBigUint64(locator + 8, true));
  if (record === null || record + 56 > length) return null;
  if (view.getUint32(record, true) !== ZIP64_END_OF_DIRECTORY) return null;

  const entries = bigintToNumber(view.getBigUint64(record + 32, true));
  const size = bigintToNumber(view.getBigUint64(record + 40, true));
  const offset = bigintToNumber(view.getBigUint64(record + 48, true));
  if (entries === null || size === null || offset === null) return null;
  return { entries, offset, size };
}

function bigintToNumber(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}
