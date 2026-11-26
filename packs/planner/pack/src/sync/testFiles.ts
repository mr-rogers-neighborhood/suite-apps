import type { FileEntry, FilesService } from "@suite/pack-runtime";

/**
 * The scoped files root a pack receives, in memory.
 *
 * The shared fake host's `memoryFiles` is the picker/file-handle half, not the
 * pack-root half. Sync needs `read` and `write` under the pack's own root, so
 * these tests use a small store that records exactly the paths the pack wrote.
 */
export interface MemoryScopedFiles {
  readonly files: Map<string, Uint8Array>;
  readonly paths: string[];
  readonly service: Partial<FilesService> &
    Pick<FilesService, "read" | "write" | "remove" | "mkdir">;
}

export function memoryScopedFiles(initial: Record<string, Uint8Array> = {}): MemoryScopedFiles {
  const files = new Map(Object.entries(initial).map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  const paths: string[] = [];

  function entry(path: string): FileEntry {
    const bytes = files.get(path) ?? new Uint8Array();
    return {
      path,
      name: path.split("/").pop() ?? path,
      kind: "file",
      size: bytes.byteLength,
      mtimeMs: paths.length + 1,
    };
  }

  const service: MemoryScopedFiles["service"] = {
    async read(path) {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error(`no such file: ${path}`);
      return new Uint8Array(bytes);
    },
    async write(path, bytes) {
      files.set(path, new Uint8Array(bytes));
      paths.push(path);
      return entry(path);
    },
    async mkdir() {
      return;
    },
    async remove(path) {
      files.delete(path);
    },
    async list() {
      return [...files.keys()].map(entry);
    },
    async stat(path) {
      return files.has(path) ? entry(path) : null;
    },
  };

  return { files, paths, service };
}
