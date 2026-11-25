import { DocumentReplica as SharedDocumentReplica } from "@suite/document-runtime";
import { WorkspaceDocument, type WorkspaceSnapshot } from "@suite/planner-core";
import { createContext, useContext, useSyncExternalStore } from "react";

import { getBridge } from "../platform/bridge";

/**
 * The renderer's replica of the document. `@suite/document-runtime` owns the single `observe`
 * call site: edits are merged locally, forwarded to main as CRDT updates, and the UI reads a
 * rebuilt snapshot. This file names Planner's document and bridge for that runtime.
 */
export class DocumentReplica extends SharedDocumentReplica<WorkspaceDocument, WorkspaceSnapshot> {
  constructor(doc: WorkspaceDocument) {
    super({
      doc,
      load: WorkspaceDocument.fromSnapshot,
      commit: (update) => getBridge().commit(update),
      errorLabel: "Suite Planner",
    });
  }
}

export const WorkspaceContext = createContext<DocumentReplica | null>(null);

export async function bootDocument(): Promise<{
  replica: DocumentReplica;
  created: boolean;
}> {
  const bridge = getBridge();
  const bytes = await bridge.loadSnapshot();
  const replica = new DocumentReplica(
    bytes === null ? WorkspaceDocument.create() : WorkspaceDocument.fromSnapshot(bytes),
  );
  // A host that had nothing gets the document the app just made, and a host whose document this
  // build upgraded gets the upgraded one. Both are local commits made before the replica
  // subscribed, so an update would never carry them; updates alone do not describe state that
  // existed before the subscription.
  if (bytes === null || replica.document.migratedFrom !== null) {
    await bridge.adopt?.(replica.document.snapshot());
  }
  bridge.onWorkspaceReplaced((snapshot) => replica.replace(snapshot));
  // A host without the method is a host that handed us a document, so nothing was invented.
  return { replica, created: (await bridge.wasCreated?.()) ?? false };
}

export function useReplica(): DocumentReplica {
  const replica = useContext(WorkspaceContext);
  if (!replica) throw new Error("useReplica must be used inside WorkspaceContext");
  return replica;
}

export function useWorkspaceSnapshot(): WorkspaceSnapshot {
  const replica = useReplica();
  return useSyncExternalStore(replica.subscribe, replica.getSnapshot, replica.getSnapshot);
}
