import type { PackDocument, PackDocumentMigration } from "@suite/pack";
import { DocumentRefusal, type DocumentStore } from "./documents.js";

/**
 * The host side of a pack's declared documents (S6.3, S6.6).
 *
 * A pack names its documents in the manifest, and each entry declares the
 * schema version it writes, the migrations that reach it and an optional
 * projection. This module owns what the host can do without knowing the format:
 * find the declaration, prove the migration chain, take one backup, invoke each
 * declared entry with a handle scoped to that one document, and stamp the
 * envelope's schema version. It never parses a payload, so it cannot read a
 * field, normalise one, or notice that a migration changed the shape.
 *
 * The entry body itself belongs to the pack. The host does not import pack code
 * in the main process; `DocumentEntryRunner` is the boundary the shell's pack
 * layer implements by running the declared entry in the pack's renderer with
 * this handle. A runner is all the host needs, and a test can supply one.
 */

/** Where a document sits. The caller supplies the container and pack it already resolved. */
export interface DocumentScope {
  readonly containerId: string;
  readonly packId: string;
}

/** A handle to the one document an entry may touch. It has no path and names no other document. */
export interface ScopedDocumentHandle {
  readonly id: string;
  /** The schema version the document is at when this step starts. */
  readonly from: number;
  /** The schema version this step must produce. */
  readonly to: number;
  /** The payload bytes exactly as stored. The host does not decode them. */
  read(): Promise<Uint8Array>;
  /** Replace the payload. The host writes it at `to`, atomically and without a per-step backup. */
  write(bytes: Uint8Array): Promise<void>;
}

/** A read-only handle a projection receives. The host refuses one unless the schema is current. */
export interface ScopedProjectionHandle {
  readonly id: string;
  readonly version: number;
  read(): Promise<Uint8Array>;
}

/**
 * The pack-owned half: running one declared entry.
 *
 * `entry` is the path the manifest declared; the shell's renderer binding maps
 * that path to the pack's own code. It receives only the scoped handle, never a
 * store, a path or a sibling document.
 */
export interface DocumentEntryRunner {
  migrate(entry: string, document: ScopedDocumentHandle): Promise<void>;
  project(entry: string, document: ScopedProjectionHandle): Promise<Uint8Array>;
}

/** One step of a chain that the host has already proved starts at the document's version. */
export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly entry: string;
}

/** What a successful `migrate` did. `steps` is empty when the document was already current. */
export interface MigrationResult {
  readonly documentId: string;
  readonly from: number;
  readonly to: number;
  readonly steps: readonly MigrationStep[];
}

export type DocumentEntryErrorKind =
  | "undeclared"
  | "invalid-declaration"
  | "missing"
  | "newer-schema"
  | "not-current"
  | "failed";

/** A refusal a pack can show as a sentence. It never carries an absolute path. */
export class DocumentEntryError extends Error {
  readonly kind: DocumentEntryErrorKind;

  constructor(kind: DocumentEntryErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentEntryError";
    this.kind = kind;
  }
}

/** Find the one declaration for `id`, or refuse a missing or duplicated one. */
export function findDocument(documents: readonly PackDocument[], id: string): PackDocument {
  const matches = documents.filter((document) => document.id === id);
  if (matches.length === 0) {
    // A lone `multi` declaration covers every document name a pack writes, the
    // same rule the envelope's schema stamp uses. Planner calls its file
    // `planner` while its declaration is the `workspace` format.
    const sole = documents.length === 1 ? documents[0] : undefined;
    if (sole !== undefined && sole.mode === "multi") return sole;
    throw new DocumentEntryError(
      "undeclared",
      `This pack does not declare a document named ${id}.`,
    );
  }
  if (matches.length > 1) {
    throw new DocumentEntryError(
      "invalid-declaration",
      `This pack declares ${id} more than once, so the host cannot choose its schema.`,
    );
  }
  const declaration = matches[0];
  if (declaration === undefined) {
    throw new DocumentEntryError(
      "undeclared",
      `This pack does not declare a document named ${id}.`,
    );
  }
  return declaration;
}

/**
 * The ordered steps from `from` to the declaration's version.
 *
 * The chain is proved before anything is written: a gap, a step that does not
 * advance, a step past the declared version, a loop or two steps that leave the
 * same version all refuse the migration and leave the document where it is. A
 * newer document is refused rather than migrated down (S6.4).
 */
export function planMigrations(document: PackDocument, from: number): readonly MigrationStep[] {
  if (from > document.version) {
    throw new DocumentEntryError(
      "newer-schema",
      `${document.id} is at schema ${from}; this pack declares schema ${document.version}, so it is left as it is.`,
    );
  }
  if (from === document.version) return [];

  const migrations = document.migrations ?? [];
  const steps: MigrationStep[] = [];
  const seen = new Set<number>([from]);
  let current = from;

  while (current < document.version) {
    const candidates = migrations.filter(
      (migration: PackDocumentMigration) => migration.from === current,
    );
    if (candidates.length === 0) {
      throw new DocumentEntryError(
        "invalid-declaration",
        `${document.id} has no migration from schema ${current}, so schema ${document.version} cannot be reached.`,
      );
    }
    if (candidates.length > 1) {
      throw new DocumentEntryError(
        "invalid-declaration",
        `${document.id} declares more than one migration from schema ${current}, so the host cannot choose one.`,
      );
    }
    const step = candidates[0];
    if (step === undefined) {
      throw new DocumentEntryError(
        "invalid-declaration",
        `${document.id} has no migration from schema ${current}.`,
      );
    }
    if (step.to <= step.from) {
      throw new DocumentEntryError(
        "invalid-declaration",
        `${document.id} declares a migration from ${step.from} to ${step.to}; a migration advances the schema.`,
      );
    }
    if (step.to > document.version) {
      throw new DocumentEntryError(
        "invalid-declaration",
        `${document.id} declares a migration past schema ${document.version}, which the pack does not write.`,
      );
    }
    if (seen.has(step.to)) {
      throw new DocumentEntryError(
        "invalid-declaration",
        `${document.id} declares a migration chain that returns to schema ${step.to}.`,
      );
    }
    steps.push({ from: step.from, to: step.to, entry: step.entry });
    seen.add(step.to);
    current = step.to;
  }

  return steps;
}

export interface DocumentMigrationsOptions {
  /** Called when the backup could not be restored; the original error is still raised. */
  readonly onRestoreFailure?: (error: unknown) => void;
}

/**
 * Invoke a pack's declared migrations and projections over the host's store.
 *
 * `migrate` is idempotent at the host level: the envelope's schema version is
 * the record that a step ran, so a second call on a current document invokes no
 * entry and writes nothing. A chain that fails is put back from the one backup
 * taken before it started, so the document the person had stays openable.
 */
export class DocumentMigrations {
  readonly #store: DocumentStore;
  readonly #onRestoreFailure: ((error: unknown) => void) | undefined;

  constructor(store: DocumentStore, options: DocumentMigrationsOptions = {}) {
    this.#store = store;
    this.#onRestoreFailure = options.onRestoreFailure;
  }

  async migrate(
    scope: DocumentScope,
    documents: readonly PackDocument[],
    documentId: string,
    runner: DocumentEntryRunner,
  ): Promise<MigrationResult> {
    const declaration = findDocument(documents, documentId);
    const header = await this.#store.header(scope.containerId, scope.packId, documentId);
    if (header === null) {
      throw new DocumentEntryError("missing", `This pack has no document named ${documentId}.`);
    }

    const from = header.schemaVersion;
    const steps = planMigrations(declaration, from);
    if (steps.length === 0) {
      return { documentId, from, to: from, steps: [] };
    }

    // One backup of the document as the person had it. Every step writes with
    // `keepBackup: false`, so the per-save rolling copy cannot replace this one
    // with an intermediate schema.
    await this.#store.backup(scope.containerId, scope.packId, documentId);

    try {
      for (const step of steps) {
        const handle = this.#handle(scope, documentId, declaration.version, step);
        await runner.migrate(step.entry, handle);

        const after = await this.#store.header(scope.containerId, scope.packId, documentId);
        if (after === null) {
          throw new Error(`the document disappeared during ${step.entry}`);
        }
        if (after.schemaVersion === step.from) {
          // An entry that only reshapes bytes the host cannot see still needs
          // the envelope stamped with the version it produced.
          await this.#store.rewrite(scope.containerId, scope.packId, documentId, {
            schemaVersion: step.to,
            keepBackup: false,
          });
        } else if (after.schemaVersion !== step.to) {
          throw new Error(`${step.entry} left the document at schema ${after.schemaVersion}`);
        }
      }

      const finished = await this.#store.header(scope.containerId, scope.packId, documentId);
      if (finished === null || finished.schemaVersion !== declaration.version) {
        throw new Error(`the chain did not reach schema ${declaration.version}`);
      }
      return { documentId, from, to: declaration.version, steps };
    } catch (error) {
      try {
        await this.#store.restore(scope.containerId, scope.packId, documentId);
      } catch (restoreError) {
        this.#onRestoreFailure?.(restoreError);
        throw new DocumentEntryError(
          "failed",
          `${documentId} could not finish migrating to schema ${declaration.version}, and its previous copy could not be put back. It is beside the document as ${documentId}.bak.`,
          { cause: error },
        );
      }
      // A document refusal already carries the sentence and the export path the
      // person needs; the old document is back, so it is still the one shown.
      if (error instanceof DocumentRefusal) throw error;
      throw new DocumentEntryError(
        "failed",
        `${documentId} could not finish migrating to schema ${declaration.version}. It was put back at schema ${from} and is still readable.`,
        { cause: error },
      );
    }
  }

  /**
   * Run the declared projection over a current document.
   *
   * A record is never read before its schema is current (S6.6): an older
   * document is refused with the migration version it needs, not projected as
   * if it were current. The projection is read-only, so the host writes nothing.
   */
  async project(
    scope: DocumentScope,
    documents: readonly PackDocument[],
    documentId: string,
    runner: DocumentEntryRunner,
  ): Promise<Uint8Array> {
    const declaration = findDocument(documents, documentId);
    const entry = declaration.projection;
    if (entry === undefined) {
      throw new DocumentEntryError(
        "undeclared",
        `This pack declares no projection for ${documentId}.`,
      );
    }

    const header = await this.#store.header(scope.containerId, scope.packId, documentId);
    if (header === null) {
      throw new DocumentEntryError("missing", `This pack has no document named ${documentId}.`);
    }
    if (header.schemaVersion !== declaration.version) {
      throw new DocumentEntryError(
        "not-current",
        `${documentId} is at schema ${header.schemaVersion}; migrate it to ${declaration.version} before it is projected.`,
      );
    }

    const opened = await this.#store.open(scope.containerId, scope.packId, documentId, {
      schemaVersion: declaration.version,
    });
    if (opened === null) {
      throw new DocumentEntryError("missing", `This pack has no document named ${documentId}.`);
    }
    const projected = await runner.project(entry, {
      id: documentId,
      version: declaration.version,
      read: async () => opened.bytes,
    });
    if (!(projected instanceof Uint8Array)) {
      throw new Error("a projection returns bytes");
    }
    return projected;
  }

  #handle(
    scope: DocumentScope,
    documentId: string,
    understood: number,
    step: MigrationStep,
  ): ScopedDocumentHandle {
    return {
      id: documentId,
      from: step.from,
      to: step.to,
      read: async () => {
        const opened = await this.#store.open(scope.containerId, scope.packId, documentId, {
          schemaVersion: understood,
        });
        if (opened === null) throw new Error(`the document ${documentId} is not there`);
        return opened.bytes;
      },
      write: async (bytes: Uint8Array) => {
        if (!(bytes instanceof Uint8Array)) throw new Error("a migration writes bytes");
        await this.#store.save(scope.containerId, scope.packId, documentId, bytes, {
          schemaVersion: step.to,
          keepBackup: false,
        });
      },
    };
  }
}
