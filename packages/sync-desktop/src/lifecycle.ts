import { createNodeWebSocketFactory } from "@suite/sync/node";

import {
  createSyncLifecycleCore,
  type SyncLifecycle,
  type SyncLifecycleOptions,
} from "./core.js";

export {
  EchoRefused,
  PIN_MALFORMED_MESSAGE,
  PIN_REQUIRED_MESSAGE,
  RelayPinError,
  type JoinRequestResult,
  type OpenSyncWebSocket,
  type PreparedJoin,
  type ReconnectPolicy,
  type SyncIdentity,
  type SyncLifecycle,
  type SyncLifecycleOptions,
  type SyncStatus,
} from "./core.js";

/**
 * The Electron host's lifecycle: a Node socket that pins the relay certificate.
 *
 * The shared core owns the group, cursor, queue and reconnect policy. This wrapper supplies
 * the one thing a renderer cannot: a TLS connection whose peer certificate can be hashed and
 * compared before a frame is sent. A pack supplies its own through `@suite/sync-desktop/relay`
 * because the host, not the pack, owns the socket.
 */
export async function createSyncLifecycle(options: SyncLifecycleOptions): Promise<SyncLifecycle> {
  return createSyncLifecycleCore(options, (fingerprint) =>
    fingerprint === null
      ? createNodeWebSocketFactory()
      : createNodeWebSocketFactory({ fingerprint }),
  );
}
