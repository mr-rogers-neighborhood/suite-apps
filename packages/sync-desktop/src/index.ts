/**
 * `@suite/sync-desktop`: what Canvas and Planner share about desktop sync.
 *
 * The stores keep the same files in the same places under each app's own data directory.
 * The lifecycle owns the socket, the cursor, the pending join, the frame queue and the
 * reconnect policy. Each app still owns its installation key, its contacts decision, its
 * capability surface, its IPC names and the events it raises from the shared core.
 *
 * A pack imports `@suite/sync-desktop/relay` instead: the same core, with a socket its host
 * supplies, and no `node:` module in the graph.
 */
export {
  createSyncLifecycle,
  EchoRefused,
  type JoinRequestResult,
  type PreparedJoin,
  type ReconnectPolicy,
  type SyncIdentity,
  type SyncLifecycle,
  type SyncLifecycleOptions,
  type SyncStatus,
} from "./lifecycle.js";
export {
  type ContactsStore,
  createContactsStore,
} from "./stores/contacts.js";
export {
  type CursorStore,
  createCursorStore,
} from "./stores/cursor.js";
export {
  createGroupStore,
  type GroupStore,
} from "./stores/group.js";
export {
  createSyncStores,
  createSyncStoresFor,
  type SyncStores,
  type SyncStorePaths,
} from "./stores/index.js";
export { createNodeStoreFiles } from "./stores/node.js";
export {
  createPendingStore,
  type PendingIdentity,
  type PendingJoin,
  type PendingStore,
} from "./stores/pending.js";
export {
  decodeStoreText,
  encodeStoreText,
  type SyncStoreFiles,
} from "./stores/port.js";
export {
  createRelayConfigStore,
  type RelayConfig,
  type RelayConfigStore,
} from "./stores/relayConfig.js";
