import { BudgetDocument, type BudgetSnapshot } from "@suite/budget-core";
import { DocumentReplica as SharedDocumentReplica } from "@suite/document-runtime";
import { createContext, useContext, useSyncExternalStore } from "react";

import { getBridge } from "../platform/bridge";

/**
 * The renderer's replica of the open budget. `@suite/document-runtime` owns the single `observe`
 * call site: edits are merged locally, forwarded to main as CRDT updates, and the UI reads a
 * rebuilt snapshot. This file names Budget's document and bridge for that runtime.
 */
export class DocumentReplica extends SharedDocumentReplica<BudgetDocument, BudgetSnapshot> {
  constructor(doc: BudgetDocument) {
    super({
      doc,
      load: BudgetDocument.fromSnapshot,
      commit: (update) => getBridge().commit(update),
      errorLabel: "Suite Budget",
    });
  }

  undo(): void {
    this.document.undo();
  }

  redo(): void {
    this.document.redo();
  }

  canUndo(): boolean {
    return this.document.canUndo();
  }

  canRedo(): boolean {
    return this.document.canRedo();
  }
}

export const WorkspaceContext = createContext<DocumentReplica | null>(null);

export function bootDocument(snapshot: Uint8Array): DocumentReplica {
  return new DocumentReplica(BudgetDocument.fromSnapshot(snapshot));
}

export function useReplica(): DocumentReplica {
  const replica = useContext(WorkspaceContext);
  if (!replica) throw new Error("useReplica must be used inside WorkspaceContext");
  return replica;
}

export function useWorkspaceSnapshot(): BudgetSnapshot {
  const replica = useReplica();
  return useSyncExternalStore(replica.subscribe, replica.getSnapshot, replica.getSnapshot);
}
