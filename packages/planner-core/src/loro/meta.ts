import type { LoroDoc } from "loro-crdt";

import { createId } from "../ids";
import { SCHEMA_VERSION, type WorkspaceMeta, workspaceMetaSchema } from "../schema";
import { ROOTS } from "./constants";
import { readRecord } from "./helpers";

/**
 * A document written by a newer Planner, refused rather than opened.
 *
 * The message is the whole product here: it names the app, says which schema the file carries and
 * which one this build understands, and says what to do. Opening such a document would let this
 * build write its older schema over newer data, which is the outcome a version number exists to
 * prevent.
 */
export class WorkspaceSchemaError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number = SCHEMA_VERSION,
  ) {
    super(
      `This workspace uses Suite Planner schema ${found}; this build understands up to ` +
        `${supported}. Open it in a newer Suite Planner.`,
    );
    this.name = "WorkspaceSchemaError";
  }
}

export function initializeMeta(doc: LoroDoc, now: Date = new Date()): WorkspaceMeta {
  const map = doc.getMap(ROOTS.meta);
  if (map.get("workspaceId") === undefined) {
    map.set("workspaceId", createId("workspace"));
    map.set("schemaVersion", SCHEMA_VERSION);
    map.set("createdAt", now.toISOString());
  }
  return readMeta(doc);
}

/**
 * Bring a document up to this build's schema, or refuse it.
 *
 * A migration is additive by rule: schema 2 only added a nullable settings field, so upgrading a
 * version-1 document is that field and the version stamp. A future migration that has to rewrite
 * records belongs here, and the fixture test that opens a version-1 file is what proves it runs.
 *
 * The write happens on open, before the renderer sees the document, so the stamp is never a thing
 * some code paths remember and others do not.
 */
export function ensureCurrentSchema(doc: LoroDoc): number | null {
  const map = doc.getMap(ROOTS.meta);
  const stored = map.get("schemaVersion");
  const found = typeof stored === "number" ? stored : 0;

  if (found > SCHEMA_VERSION) throw new WorkspaceSchemaError(found);

  const upgradedFrom = found < SCHEMA_VERSION ? found : null;

  if (found < 2) {
    const settings = doc.getMap(ROOTS.settings);
    // An empty settings map is filled with every default by `ensureSettings`, which includes the
    // new field. A map that already has settings only needs the field schema 2 added.
    if (settings.size > 0 && settings.get("notificationsAskedAt") === undefined) {
      settings.set("notificationsAskedAt", null);
    }
  }

  if (stored !== SCHEMA_VERSION) {
    map.set("schemaVersion", SCHEMA_VERSION);
    doc.commit();
  }

  return upgradedFrom;
}

export function readMeta(doc: LoroDoc): WorkspaceMeta {
  return readRecord(workspaceMetaSchema, doc.getMap(ROOTS.meta));
}
