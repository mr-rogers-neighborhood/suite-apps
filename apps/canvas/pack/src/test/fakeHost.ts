import type {
  DocumentRecord,
  DocumentSummary,
  DocumentsService,
  FileHandle,
  FilesService,
} from "@suite/pack-runtime";

/**
 * In-memory host services for the pack tests.
 *
 * These are the pack-side contract, not a second implementation of the host: a document is bytes
 * under an id, and an external file is a handle a picker hands over. Anything the tests need to
 * observe (a save, a written file) is exposed beside it.
 */

export interface MemoryDocuments extends DocumentsService {
  readonly files: Map<string, Uint8Array>;
  readonly saves: Array<{ id: string; bytes: Uint8Array }>;
}

export function memoryDocuments(initial: Record<string, Uint8Array> = {}): MemoryDocuments {
  const files = new Map(Object.entries(initial));
  const saves: Array<{ id: string; bytes: Uint8Array }> = [];
  let tick = 1_000;

  function summary(id: string): DocumentSummary {
    const bytes = files.get(id) ?? new Uint8Array();
    return { id, name: id, size: bytes.byteLength, updatedAt: tick };
  }

  return {
    files,
    saves,
    async list() {
      return [...files.keys()]
        .map((id) => summary(id))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async create(name) {
      if (files.has(name)) throw new Error("document already exists");
      files.set(name, new Uint8Array());
      tick += 1;
      return summary(name);
    },
    async open(id): Promise<DocumentRecord | null> {
      const bytes = files.get(id);
      if (bytes === undefined) return null;
      return { ...summary(id), bytes: new Uint8Array(bytes) };
    },
    async save(id, bytes) {
      files.set(id, new Uint8Array(bytes));
      saves.push({ id, bytes: new Uint8Array(bytes) });
      tick += 1;
      return summary(id);
    },
    async remove(id) {
      files.delete(id);
      tick += 1;
    },
  };
}

export interface MemoryFiles extends Partial<FilesService> {
  /** Handles `pickOpen` returns, in order; `null` means the person cancelled. */
  readonly openQueue: Array<Uint8Array | null>;
  /** What `pickSave` wrote, in order. */
  readonly saved: Array<{ name: string; bytes: Uint8Array; closed: boolean }>;
  /** When set, the next `pickSave` is cancelled. */
  cancelSave: boolean;
  /** When set, the next `pickSave` rejects. */
  failSave: Error | null;
  /** When set, the next `pickOpen` rejects. */
  failOpen: Error | null;
}

function handleOf(name: string, bytes: Uint8Array): FileHandle {
  let written = new Uint8Array(bytes);
  let closed = false;
  return {
    async read() {
      return new Uint8Array(written);
    },
    async write(next) {
      if (closed) throw new Error("the handle is closed");
      written = new Uint8Array(next);
    },
    async close() {
      closed = true;
    },
    get info() {
      return { name, size: written.byteLength, mtimeMs: 1_000 };
    },
  } as FileHandle;
}

export function memoryFiles(): MemoryFiles {
  const openQueue: Array<Uint8Array | null> = [];
  const saved: Array<{ name: string; bytes: Uint8Array; closed: boolean }> = [];

  const files: MemoryFiles = {
    openQueue,
    saved,
    cancelSave: false,
    failSave: null,
    failOpen: null,
    async pickOpen() {
      if (files.failOpen !== null) {
        const error = files.failOpen;
        files.failOpen = null;
        throw error;
      }
      const next = openQueue.shift();
      if (next === undefined || next === null) return null;
      return handleOf("picker-input.canvas", next);
    },
    async pickSave(suggestedName) {
      if (files.failSave !== null) {
        const error = files.failSave;
        files.failSave = null;
        throw error;
      }
      if (files.cancelSave) {
        files.cancelSave = false;
        return null;
      }
      const target = { name: suggestedName, bytes: new Uint8Array(), closed: false };
      const handle: FileHandle = {
        get info() {
          return { name: target.name, size: target.bytes.byteLength, mtimeMs: 1_000 };
        },
        async read() {
          return new Uint8Array(target.bytes);
        },
        async write(bytes) {
          target.bytes = new Uint8Array(bytes);
        },
        async close() {
          target.closed = true;
        },
      };
      // The writer's `close` and `write` share one object, so the record is observed as it is
      // written rather than copied at pick time.
      saved.push(target);
      return handle;
    },
  };

  return files;
}

/** A UTF-8 view of saved bytes, for a test that reads what the picker wrote. */
export function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
