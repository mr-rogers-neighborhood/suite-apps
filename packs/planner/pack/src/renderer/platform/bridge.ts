import type { PlannerBridge } from "@suite/planner-core";

/**
 * One row of the host's recent list, as the renderer reads it.
 *
 * It is structurally the pack-runtime `RecentDocument` without importing that
 * package: the frozen Electron shell builds this renderer tree and does not
 * depend on the pack runtime. A host without `recents` simply leaves the calls
 * absent.
 */
export interface RecentDocumentRow {
  readonly packId: string;
  readonly documentId: string | null;
  readonly name: string | null;
  readonly openedAt: number;
}

/**
 * The bridge as this pack's renderer sees it.
 *
 * `PlannerBridge` is the frozen app's contract. A host that declares `recents`
 * gives the pack two more calls, and the launcher uses them to list the host's
 * own rows and open one. They are optional so a host without the capability
 * simply shows no list.
 */
export interface PlannerRendererBridge extends PlannerBridge {
  recentDocuments?(): Promise<readonly RecentDocumentRow[]>;
  openRecentDocument?(documentId: string): Promise<boolean>;
}

export function getBridge(): PlannerRendererBridge {
  const bridge = window.suitePlanner as PlannerRendererBridge | undefined;
  if (!bridge) {
    throw new Error("Suite Planner must run inside its desktop shell");
  }
  return bridge;
}
