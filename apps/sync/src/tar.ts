import { gzipSync } from "node:zlib";

/**
 * A tar.gz with no dependency.
 *
 * A release artifact is a directory of files plus the hashes that name them. The obvious tool is a
 * tar library, but `suite-sync` has no bundler, and adding one to write an archive is the kind of
 * dependency a separate trust boundary should not take. ustar is a 512-byte header and a body; what
 * follows is the smallest correct version — no long-name extensions beyond the prefix split, no
 * sparse files, no links.
 *
 * `tar -tzf` reads what this writes, which is the test.
 */

const BLOCK = 512;
const NAME_LIMIT = 100;
const PREFIX_LIMIT = 155;

export interface TarEntry {
  /** Relative to the archive root. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** Defaults to 0o644. */
  readonly mode?: number;
  /** Defaults to the archive's mtime. */
  readonly mtime?: number;
}

export interface TarOptions {
  /** The folder every entry lives under once extracted. */
  readonly root?: string;
  readonly mtime?: number;
  readonly level?: number;
}

function encodeOctal(value: number, width: number): string {
  // ustar: width-1 octal digits then a NUL. A value that does not fit is refused rather than
  // truncated, because a size that silently wraps produces a corrupt archive that looks fine.
  const max = 8 ** (width - 1) - 1;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`tar: ${String(value)} does not fit in ${width - 1} octal digits`);
  }
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function writeString(block: Buffer, offset: number, value: string, width: number): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > width) throw new Error(`tar: "${value}" is longer than ${width} bytes`);
  bytes.copy(block, offset);
}

/** Split `a/b/c` into ustar's prefix + name pair, or `null` when it cannot be represented. */
function splitName(path: string): { prefix: string; name: string } | null {
  if (Buffer.byteLength(path) <= NAME_LIMIT) return { prefix: "", name: path };
  // Walk candidates from the right: the longest legal name wins, which keeps the prefix short.
  for (let index = path.length - 1; index > 0; index -= 1) {
    if (path[index] !== "/") continue;
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(name) <= NAME_LIMIT && Buffer.byteLength(prefix) <= PREFIX_LIMIT) {
      return { prefix, name };
    }
  }
  return null;
}

/**
 * A header for a path ustar cannot hold.
 *
 * GNU tar and bsdtar both understand `././@LongLink`: a `typeflag "L"` entry whose body is the real
 * path, followed by a header carrying a truncated name. A release artifact holds `node_modules`, and
 * a dependency with a long scoped name plus a deep `dist/` exceeds 255 bytes without doing anything
 * unusual — so this is not a theoretical branch.
 */
function longNameEntry(path: string, mtime: number): Buffer[] {
  const body = Buffer.concat([Buffer.from(path, "utf8"), Buffer.alloc(1)]);
  const block = Buffer.alloc(BLOCK);
  writeString(block, 0, "././@LongLink", NAME_LIMIT);
  block.write(encodeOctal(0o644, 8), 100, 8, "ascii");
  block.write(encodeOctal(0, 8), 108, 8, "ascii");
  block.write(encodeOctal(0, 8), 116, 8, "ascii");
  block.write(encodeOctal(body.length, 12), 124, 12, "ascii");
  block.write(encodeOctal(mtime, 12), 136, 12, "ascii");
  block.fill(" ", 148, 156);
  block.write("L", 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");

  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);
  return [block, padded];
}

function header(entry: { path: string; size: number; mode: number; mtime: number }): Buffer {
  const split = splitName(entry.path);
  // The long-name entry already carried the real path; this header only has to be well formed.
  const name = split?.name ?? entry.path.slice(0, NAME_LIMIT);
  const prefix = split?.prefix ?? "";
  const block = Buffer.alloc(BLOCK);
  writeString(block, 0, name, NAME_LIMIT);
  block.write(encodeOctal(entry.mode, 8), 100, 8, "ascii");
  block.write(encodeOctal(0, 8), 108, 8, "ascii"); // uid
  block.write(encodeOctal(0, 8), 116, 8, "ascii"); // gid
  block.write(encodeOctal(entry.size, 12), 124, 12, "ascii");
  block.write(encodeOctal(entry.mtime, 12), 136, 12, "ascii");
  // The checksum is taken with the field filled with spaces, then written as 6 octal + NUL + space.
  block.fill(" ", 148, 156);
  block.write("0", 156, 1, "ascii"); // typeflag: a regular file
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  writeString(block, 345, prefix, PREFIX_LIMIT);

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

/**
 * Pack `entries` into a gzipped tar.
 *
 * `root` is the folder every entry lives under once extracted, so a release unpacks into one
 * directory rather than into the caller's current one.
 */
export function tarGz(entries: readonly TarEntry[], options: TarOptions = {}): Uint8Array {
  const { root = "suite-sync", mtime = 0, level = 9 } = options;
  if (entries.length === 0) throw new Error("tar: nothing to archive");
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes);
    const path = `${root}/${entry.path}`;
    const mtimeOfEntry = entry.mtime ?? mtime;
    if (splitName(path) === null) parts.push(...longNameEntry(path, mtimeOfEntry));
    parts.push(
      header({
        path,
        size: bytes.length,
        mode: entry.mode ?? 0o644,
        mtime: mtimeOfEntry,
      }),
    );
    parts.push(bytes);
    const remainder = bytes.length % BLOCK;
    if (remainder !== 0) parts.push(Buffer.alloc(BLOCK - remainder));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level });
}
