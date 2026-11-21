/**
 * `@suite/sync-desktop`: what Canvas and Planner share about desktop sync.
 *
 * The stores keep the same files in the same places under each app's own data directory.
 * The lifecycle owns the socket, the cursor, the pending join, the frame queue and the
 * reconnect policy. Each app still owns its installation key, its contacts decision, its
 * capability surface, its IPC names and the events it raises from the shared core.
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
  type SyncStores,
} from "./stores/index.js";
export {
  createPendingStore,
  type PendingIdentity,
  type PendingJoin,
  type PendingStore,
} from "./stores/pending.js";
export {
  createRelayConfigStore,
  type RelayConfig,
  type RelayConfigStore,
  type SyncStorePaths,
} from "./stores/relayConfig.js";
