import { createNodeStoreFiles } from "./node.js";
import { createSyncStoresFor, type SyncStores } from "./factory.js";

export {
  createSyncStoresFor,
  type SyncStores,
} from "./factory.js";

export interface SyncStorePaths {
  readonly dataDir: string;
  readonly workspaceId: string;
}

/** The Electron hosts' stores: the shared layout over `node:fs`. */
export function createSyncStores(paths: SyncStorePaths): SyncStores {
  return createSyncStoresFor(createNodeStoreFiles(paths.dataDir), paths.workspaceId);
}
