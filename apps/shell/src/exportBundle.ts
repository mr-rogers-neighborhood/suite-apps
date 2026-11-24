import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isSafePackPath, type PackBlob } from "@suite/pack";
import type { BlobScope, BlobStores } from "./blobs.js";

/**
 * A pack's export bundle (S6.8).
 *
 * The host picks the destination (through its own save dialog, never the pack)
 * and supplies the pack's declared `export` entry with a handle scoped to
 * relative paths inside that destination. The entry writes its documents. The
 * host then writes every `asset` blob as its original bytes at
 * `assets/<sha256>`, records each file with its hash and length, verifies every
 * hash it wrote, and writes `manifest.json` last. `derived` and `cache` blobs
 * are not exported: derived is backed up but not exported by default, and cache
 * is disposable.
 *
 * The manifest is canonical by construction: fixed key order and no whitespace,
 * so two exports of the same content have the same manifest bytes. Its shape:
 *
 *   {
 *     "format": "suite.export",
 *     "version": 1,
 *     "pack": { "id": "...", "version": "..." },
 *     "packExport": "export.html" | null,
 *     "documents": [{ "path", "sha256", "bytes" }],
 *     "assets": [{ "path", "store", "sha256", "bytes" }]
 *   }
 *
 * A pack with no declared `export` entry is still exported for its assets, with
 * `packExport: null` and no documents. S6.8 says a pack declares one; refusing
 * the whole export because of a manifest omission would strand the person's
 * assets. The null makes the omission visible instead of pretending the pack
 * exported a document it did not.
 *
 * The entry body is pack code and never runs here: `ExportEntryRunner` is the
 * boundary the shell's pack layer implements by running the declared entry in
 * the pack's renderer with this handle. A test supplies one.
 */

/** The slice of a manifest an export needs. A `PackManifest` is assignable to it. */
export interface ExportPack {
  readonly id: string;
  readonly version: string;
  readonly blobs?: readonly PackBlob[];
  readonly export?: { readonly entry: string };
}

/**
 * What the pack's export entry may do.
 *
 * `path` is relative and slash-separated inside the host-chosen bundle; the
 * entry never sees the absolute destination. The host owns `manifest.json` and
 * `assets/`, so those names are reserved.
 */
export interface ExportSaveHandle {
  write(path: string, bytes: Uint8Array): Promise<void>;
}

/** The pack-owned half: running one declared export entry. */
export interface ExportEntryRunner {
  export(entry: string, save: ExportSaveHandle): Promise<void>;
}

export interface ExportDocumentEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ExportAssetEntry extends ExportDocumentEntry {
  readonly store: string;
}

export interface ExportManifest {
  readonly format: "suite.export";
  readonly version: 1;
  readonly pack: { readonly id: string; readonly version: string };
  /** The entry that ran, or `null` when the pack declared none. */
  readonly packExport: string | null;
  readonly documents: readonly ExportDocumentEntry[];
  readonly assets: readonly ExportAssetEntry[];
}

export type ExportBundleErrorKind =
  | "invalid-path"
  | "reserved-name"
  | "duplicate"
  | "failed"
  | "verify";

/** A refusal a pack can show as a sentence. It never carries an absolute path. */
export class ExportBundleError extends Error {
  readonly kind: ExportBundleErrorKind;

  constructor(kind: ExportBundleErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExportBundleError";
    this.kind = kind;
  }
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function comparePaths(left: { readonly path: string }, right: { readonly path: string }): number {
  return left.path.localeCompare(right.path);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: a NUL or other control character is never a legitimate bundle path.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * A path inside the bundle, or a refusal.
 *
 * The same rule as a pack file path: relative, slash-separated, no empty, `.`
 * or `..` segment and no backslash. Control characters and a drive colon are
 * refused too, so a name cannot become a host path on another platform.
 */
function bundlePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new ExportBundleError("invalid-path", "The export entry wrote an invalid path.");
  }
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.includes(":") ||
    CONTROL_CHARACTER.test(value) ||
    !isSafePackPath(value)
  ) {
    throw new ExportBundleError(
      "invalid-path",
      "The export entry wrote a path outside the bundle.",
    );
  }
  return value;
}

export class ExportBundle {
  readonly #blobs: BlobStores;

  constructor(blobs: BlobStores) {
    this.#blobs = blobs;
  }

  /**
   * Write the bundle for one pack into a host-chosen destination.
   *
   * The destination is an absolute directory the host obtained from its own
   * dialog. It is created if needed; existing files with the same relative
   * names are replaced atomically, and the manifest is written after every
   * other file so a failed export never claims a complete bundle.
   */
  async export(
    scope: BlobScope,
    pack: ExportPack,
    destination: string,
    runner: ExportEntryRunner,
  ): Promise<ExportManifest> {
    if (typeof destination !== "string" || destination.length === 0) {
      throw new ExportBundleError("invalid-path", "The export destination is not available.");
    }

    const documents = new Map<string, ExportDocumentEntry>();
    let packExport: string | null = null;

    if (pack.export !== undefined) {
      const entry = pack.export.entry;
      if (typeof entry !== "string" || entry.length === 0) {
        throw new ExportBundleError("invalid-path", "The pack declares no export entry to run.");
      }
      packExport = entry;
      await mkdir(destination, { recursive: true });
      try {
        await runner.export(entry, this.#handle(destination, documents));
      } catch (error) {
        if (error instanceof ExportBundleError) throw error;
        throw new ExportBundleError("failed", `The pack's export entry ${entry} did not finish.`, {
          cause: error,
        });
      }
    }

    const assets = await this.#writeAssets(scope, pack, destination);
    const manifest: ExportManifest = {
      format: "suite.export",
      version: 1,
      pack: { id: pack.id, version: pack.version },
      packExport,
      documents: [...documents.values()].sort(comparePaths),
      assets,
    };

    await mkdir(destination, { recursive: true });
    await this.#writeFile(
      join(destination, "manifest.json"),
      new TextEncoder().encode(JSON.stringify(manifest)),
    );
    return manifest;
  }

  /**
   * Write every declared `asset` store's blobs at `assets/<sha256>`.
   *
   * The file name is the hash, so two assets with the same content are one file
   * and one manifest row. Every hash is read back and checked before the
   * manifest is written; a mismatch aborts the export rather than shipping a
   * bundle whose manifest lies.
   */
  async #writeAssets(
    scope: BlobScope,
    pack: ExportPack,
    destination: string,
  ): Promise<readonly ExportAssetEntry[]> {
    const declarations = pack.blobs ?? [];
    const byPath = new Map<string, ExportAssetEntry>();

    for (const declaration of declarations) {
      if (declaration.class !== "asset") continue;
      const listed = await this.#blobs.list(scope, declarations, declaration.store);
      for (const blob of listed) {
        const path = `assets/${blob.sha256}`;
        if (byPath.has(path)) continue;

        const contents = await this.#blobs.get(scope, declarations, declaration.store, blob.sha256);
        if (contents === null) {
          throw new ExportBundleError(
            "failed",
            `The asset ${blob.sha256} disappeared while the bundle was written.`,
          );
        }
        await mkdir(join(destination, "assets"), { recursive: true });
        await this.#writeFile(join(destination, "assets", blob.sha256), contents.data);

        const written = new Uint8Array(await readFile(join(destination, "assets", blob.sha256)));
        if (checksum(written) !== blob.sha256 || written.byteLength !== contents.data.byteLength) {
          throw new ExportBundleError(
            "verify",
            `The exported asset ${blob.sha256} does not match its hash.`,
          );
        }
        byPath.set(path, {
          path,
          store: declaration.store,
          sha256: blob.sha256,
          bytes: contents.data.byteLength,
        });
      }
    }

    return [...byPath.values()].sort(comparePaths);
  }

  #handle(destination: string, documents: Map<string, ExportDocumentEntry>): ExportSaveHandle {
    return {
      write: async (path: string, bytes: Uint8Array): Promise<void> => {
        const clean = bundlePath(path);
        if (clean === "manifest.json" || clean === "assets" || clean.startsWith("assets/")) {
          throw new ExportBundleError(
            "reserved-name",
            `The export entry may not write ${clean}; the host owns that name.`,
          );
        }
        if (documents.has(clean)) {
          throw new ExportBundleError(
            "duplicate",
            `The export entry wrote ${clean} more than once.`,
          );
        }
        if (!(bytes instanceof Uint8Array)) {
          throw new ExportBundleError("failed", "An exported document is bytes.");
        }

        const file = join(destination, ...clean.split("/"));
        await mkdir(dirname(file), { recursive: true });
        await this.#writeFile(file, bytes);
        documents.set(clean, {
          path: clean,
          sha256: checksum(bytes),
          bytes: bytes.byteLength,
        });
      },
    };
  }

  /** Temporary file, flush, rename, so a failed write never leaves half a bundle file. */
  async #writeFile(file: string, bytes: Uint8Array): Promise<void> {
    const temporary = `${file}.tmp-${randomUUID()}`;
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
  }
}
