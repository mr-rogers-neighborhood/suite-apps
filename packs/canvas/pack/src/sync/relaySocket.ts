import type { RelayService } from "@suite/pack-runtime";
import type { RelayWebSocket, RelayWebSocketFactory } from "@suite/sync";
import { RelayPinError } from "@suite/sync-desktop/relay";

/**
 * The relay as a WebSocket, over the host's opaque-frame service.
 *
 * The relay protocol speaks JSON text; the host forwards bytes. This is the whole of the
 * translation, and it is deliberately the only place a frame is constructed: `send` encodes,
 * `message` decodes, and the host never sees a document, a key or a parsed frame.
 *
 * The socket shape is synchronous because `createRelayClient` builds one before it awaits
 * anything. `relay.connect` is not, so the adapter is a placeholder with listener queues that
 * flushes once the host's connection resolves — the same late-open case a browser WebSocket
 * has.
 */

interface Listener {
  readonly open: Array<() => void>;
  readonly message: Array<(event: { data: unknown }) => void>;
  readonly close: Array<() => void>;
  readonly error: Array<(event: { error?: Error }) => void>;
}

export function createHostRelaySocketFactory(
  relay: RelayService,
  fingerprint: string | null,
): RelayWebSocketFactory {
  return (url) => connect(relay, url, fingerprint);
}

function connect(
  relay: RelayService,
  url: string,
  fingerprint: string | null,
): RelayWebSocket {
  const listeners: Listener = { open: [], message: [], close: [], error: [] };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let opened = false;
  let closed = false;
  let connection: Awaited<ReturnType<RelayService["connect"]>> | null = null;

  const emitError = (error: Error): void => {
    for (const listener of listeners.error) listener({ error });
  };
  const emitClose = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of listeners.close) listener();
  };

  const pending = relay
    .connect({
      url,
      ...(fingerprint === null ? {} : { certificateSha256: fingerprint }),
    })
    .then((openedConnection) => {
      // The caller closed while the host was still opening: the socket is not ours to keep.
      if (closed) {
        void openedConnection.close();
        return;
      }
      connection = openedConnection;
      openedConnection.onFrame((frame) => {
        if (closed) return;
        const data = decoder.decode(frame);
        for (const listener of listeners.message) listener({ data });
      });
      openedConnection.onClose(() => emitClose());
      opened = true;
      for (const listener of listeners.open) listener();
    })
    .catch((error: unknown) => {
      emitError(refusal(error));
      emitClose();
    });

  // A caller that closes before the host's socket opens must not leave it behind.
  void pending;

  return {
    send(data: string) {
      if (connection === null || closed) {
        throw new Error("the relay connection is not open");
      }
      // The host checks the size and the token; this is the only place a relay string becomes
      // bytes in the pack.
      void connection.send(encoder.encode(data));
    },

    close() {
      if (closed) return;
      closed = true;
      void connection?.close();
    },

    addEventListener(type: "open" | "message" | "close" | "error", listener: never): void {
      switch (type) {
        case "open":
          listeners.open.push(listener as () => void);
          if (opened) queueMicrotask(() => (listener as () => void)());
          return;
        case "message":
          listeners.message.push(listener as (event: { data: unknown }) => void);
          return;
        case "close":
          listeners.close.push(listener as () => void);
          if (closed) queueMicrotask(() => (listener as () => void)());
          return;
        case "error":
          listeners.error.push(listener as (event: { error?: Error }) => void);
          return;
      }
    },
  } as RelayWebSocket;
}

/**
 * Name a host refusal for what it is.
 *
 * A certificate mismatch and a missing capability are decisions, not a relay that went quiet:
 * the lifecycle must publish `refused` with the host's sentence rather than "asleep" and a
 * retry that cannot work. Everything else keeps its own words and is retried.
 */
function refusal(error: unknown): Error {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "the host could not open the relay connection";
  return /capabilit|certificate|fingerprint|malformed|only to this host/iu.test(message)
    ? new RelayPinError(message)
    : error instanceof Error
      ? error
      : new Error(message);
}
