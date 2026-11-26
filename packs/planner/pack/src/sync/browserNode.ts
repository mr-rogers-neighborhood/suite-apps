import type { RelayWebSocketFactory } from "@suite/sync";

import {
  PIN_MALFORMED_MESSAGE,
  PIN_MISMATCH_MESSAGE,
  PIN_REQUIRED_MESSAGE,
  RelayPinError,
} from "./relayErrors";

/**
 * The browser half of `@suite/sync/node`.
 *
 * `@suite/sync-desktop` imports the Node module for its pin class, its three
 * sentences and a WebSocket factory. A pack has none of those: the host opens
 * the socket through `window.suite.relay`, and the pack supplies the factory.
 * The browser build aliases the Node entry here so the shared lifecycle can run
 * unchanged; the factory below is deliberately a refusal, because asking the
 * pack to open its own socket is the boundary this capability exists to keep.
 */
export { PIN_MALFORMED_MESSAGE, PIN_MISMATCH_MESSAGE, PIN_REQUIRED_MESSAGE, RelayPinError };

export function createNodeWebSocketFactory(): RelayWebSocketFactory {
  return () => {
    throw new RelayPinError(
      "This pack must use the host's relay service; it cannot open a socket itself.",
    );
  };
}
