/**
 * The renderer-safe entry to `@suite/sync-desktop`.
 *
 * The package root also exports its Node stores, which import `node:fs`,
 * `node:path` and `node:crypto`. A pack must not carry those, even as unused
 * stubs, so the browser build points at the shared lifecycle source instead.
 * The lifecycle itself is platform-free: it imports the protocol and a socket
 * factory, and the pack supplies the factory over the host's relay service.
 *
 * This is a pack-side build alias, not a fork. The shared package stays the one
 * owner of the group, cursor, pending join and frame queue.
 */
export { createSyncLifecycle, EchoRefused } from "../../../../../packages/sync-desktop/src/lifecycle";
export type {
  JoinRequestResult,
  PreparedJoin,
  ReconnectPolicy,
  SyncIdentity,
  SyncLifecycle,
  SyncLifecycleOptions,
  SyncStatus,
} from "../../../../../packages/sync-desktop/src/lifecycle";
