import { copyFile, mkdir, readFile } from "node:fs/promises";

import { MainDocumentStore } from "@suite/document-runtime/node";
import {
  decodeWorkspaceFile,
  encodeWorkspaceFile,
  WorkspaceDocument,
  WorkspaceFileError,
  type WorkspaceSnapshot,
} from "@suite/planner-core";

import type { WorkspacePaths } from "./paths";

/**
 * Owns the authoritative document in the main process. Renderer edits arrive as CRDT updates and
 * are written to disk on a debounce through `@suite/document-runtime`; Planner keeps its own file
 * format, directory and one rolling backup.
 */
export class WorkspaceStore extends MainDocumentStore<WorkspaceDocument, WorkspaceSnapshot> {
  readonly #paths: WorkspacePaths;
  /**
   * True when this session started from nothing.
   *
   * The first-run case is the only one where a person has not yet said which workspace they
   * are in, so it is the only one that gets a start screen. Any other run means a file was
   * already there and they expect to land in it.
   */
  readonly #created: boolean;

  private constructor(doc: WorkspaceDocument, paths: WorkspacePaths, created: boolean) {
    super({
      doc,
      path: paths.workspace,
      tempPath: paths.temp,
      serialize: encodeWorkspaceFile,
      backup: async () => {
        try {
          await copyFile(paths.workspace, paths.backup);
        } catch {
          // First save: there is no previous file to keep.
        }
      },
      logWriteError: (error) => {
        console.error("Suite Planner: could not write the workspace", error);
      },
    });
    this.#paths = paths;
    this.#created = created;
  }

  static async open(paths: WorkspacePaths): Promise<WorkspaceStore> {
    await mkdir(paths.dir, { recursive: true });
    const { doc, created } = await loadOrCreate(paths);
    return new WorkspaceStore(doc, paths, created);
  }

  /** Whether this session began with no workspace file at all. */
  get created(): boolean {
    return this.#created;
  }

  /** The folder the workspace lives in. Sync keeps its identity and group state here. */
  get directory(): string {
    return this.#paths.dir;
  }

  async importFrom(source: string): Promise<void> {
    const raw = await readFile(source, "utf8");
    const decoded = decodeWorkspaceFile(raw);
    if (decoded.isErr()) throw decoded.error;

    const next = WorkspaceDocument.fromSnapshot(decoded.value);
    const validation = next.validate();
    if (validation.isErr()) throw validation.error;

    this.replaceDocument(next);
    await this.flush();
  }
}

async function loadOrCreate(
  paths: WorkspacePaths,
): Promise<{ doc: WorkspaceDocument; created: boolean }> {
  for (const candidate of [paths.workspace, paths.backup]) {
    try {
      const raw = await readFile(candidate, "utf8");
      const decoded = decodeWorkspaceFile(raw);
      if (decoded.isErr()) {
        // A newer file is not a damaged one. Falling back to the backup and then creating a fresh
        // workspace would end with this build writing its older schema over the newer document, so
        // the version refusal is terminal and the person is told which version they need.
        if (
          decoded.error.code === "unsupported-version" ||
          decoded.error.code === "unsupported-schema"
        ) {
          throw decoded.error;
        }
        console.warn(
          `Suite Planner: ${candidate} is not a valid workspace (${decoded.error.code})`,
        );
        continue;
      }
      const doc = WorkspaceDocument.fromSnapshot(decoded.value);
      const validation = doc.validate();
      if (validation.isErr()) {
        console.warn(`Suite Planner: ${candidate} failed validation`, validation.error);
        continue;
      }
      return { doc, created: false };
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      // The file does not exist yet; try the backup, then start a new workspace.
    }
  }
  return { doc: WorkspaceDocument.create(), created: true };
}
