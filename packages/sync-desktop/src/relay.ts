import type { RelayWebSocketFactory } from "@suite/sync";

import {
  createSyncLifecycleCore,
  type OpenSyncWebSocket,
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
export { createSyncStoresFor, type SyncStores } from "./stores/factory.js";
export { decodeStoreText, encodeStoreText, type SyncStoreFiles } from "./stores/port.js";
export { type ContactsStore } from "./stores/contacts.js";
export { type CursorStore } from "./stores/cursor.js";
export { type GroupStore } from "./stores/group.js";
export { type PendingIdentity, type PendingJoin, type PendingStore } from "./stores/pending.js";
export { type RelayConfig, type RelayConfigStore } from "./stores/relayConfig.js";

export interface RelaySyncLifecycleOptions extends SyncLifecycleOptions {
  /**
   * How to open a socket for a given certificate pin.
   *
   * A pack does not open the socket itself: its host does, and hands back a connection that
   * forwards opaque bytes. The pack's adapter turns that into the WebSocket shape the relay
   * client expects. A `null` fingerprint means a plaintext loopback relay.
   */
  readonly webSocketFor: OpenSyncWebSocket;
}

/**
 * The renderer lifecycle: the shared core with a caller-supplied socket.
 *
 * This entry imports no `node:` module. It is the one a pack uses, because a pack has no
 * filesystem, no TLS stack and no certificate to hash — only the host's relay service.
 */
export async function createRelaySyncLifecycle(
  options: RelaySyncLifecycleOptions,
): Promise<SyncLifecycle> {
  const { webSocketFor, ...rest } = options;
  return createSyncLifecycleCore(rest, webSocketFor);
}

/** A test seam, so a suite can hand the core a factory without a host. */
export function relaySocketFor(factory: RelayWebSocketFactory): OpenSyncWebSocket {
  return () => factory;
}
