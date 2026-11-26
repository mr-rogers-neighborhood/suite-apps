import type { RelayService } from "@suite/pack-runtime";
import type { RelayWebSocket, RelayWebSocketFactory } from "@suite/sync";
import { PIN_REQUIRED_MESSAGE, RelayPinError } from "@suite/sync/node";

/**
 * A WebSocket-shaped adapter over the host's opaque-frame relay service.
 *
 * The protocol's client speaks JSON strings on a `WebSocket`; a pack has neither
 * a socket nor a URL it may open. `window.suite.relay` gives it bytes in and
 * bytes out, so this adapter is the whole translation: UTF-8 out, UTF-8 in, and
 * a close passed through as a close.
 *
 * It is written as a queue rather than an async factory because
 * `RelayWebSocketFactory` is synchronous and the host's `connect` returns a
 * promise. Nothing is lost: a frame sent before the host has opened the socket
 * waits in order, and frames the host buffered are delivered by the preload when
 * `onFrame` is registered.
 */

/**
 * The host said this pack may not use its relay service.
 *
 * It extends `RelayPinError` on purpose. The shared lifecycle treats that class
 * as a final refusal: no reconnect, and the reason reaches the person. A relay
 * that is merely not running is a different error and keeps its retry.
 */
export class RelayCapabilityRefused extends RelayPinError {
  constructor(message: string) {
    super(message);
    this.name = "RelayCapabilityRefused";
  }
}

export interface HostRelaySocketOptions {
  readonly relay: RelayService | undefined;
  /** The certificate a `wss://` connection must present. Read at connect time. */
  readonly pinFor: (url: string) => string | null;
}

type OpenListener = () => void;
type MessageListener = (event: { data: unknown }) => void;
type CloseListener = () => void;
type ErrorListener = (event: { error?: Error }) => void;

function capabilityRefusal(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/capability/iu.test(message) && /relay/iu.test(message)) {
    return new RelayCapabilityRefused(message);
  }
  return error instanceof Error ? error : new Error(message);
}

export function createHostRelayWebSocketFactory(
  options: HostRelaySocketOptions,
): RelayWebSocketFactory {
  return (url) => {
    const open: OpenListener[] = [];
    const message: MessageListener[] = [];
    const close: CloseListener[] = [];
    const failure: ErrorListener[] = [];
    let ready = false;
    let closed = false;
    let closeEmitted = false;
    let connection: Awaited<ReturnType<RelayService["connect"]>> | null = null;
    const queue: string[] = [];

    const emitClose = (): void => {
      if (closeEmitted) return;
      closeEmitted = true;
      for (const listener of close) listener();
    };

    const emitError = (error: Error): void => {
      for (const listener of failure) listener({ error });
    };

    function drain(): void {
      if (connection === null) return;
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) continue;
        void connection.send(new TextEncoder().encode(next)).catch((error: unknown) => {
          emitError(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }

    const relay = options.relay;
    if (relay === undefined) {
      queueMicrotask(() => {
        emitError(new RelayCapabilityRefused("This host does not offer the relay capability."));
        emitClose();
      });
    } else {
      const pin = options.pinFor(url);
      if (url.toLowerCase().startsWith("wss://") && pin === null) {
        queueMicrotask(() => {
          emitError(new RelayPinError(PIN_REQUIRED_MESSAGE));
          emitClose();
        });
      } else {
        void relay
          .connect({
            url,
            ...(pin === null ? {} : { certificateSha256: pin }),
          })
          .then((opened) => {
            if (closed) {
              void opened.close();
              return;
            }
            connection = opened;
            opened.onFrame((frame) => {
              if (closed) return;
              for (const listener of message) {
                listener({ data: new TextDecoder().decode(frame) });
              }
            });
            opened.onClose(() => {
              if (closed) return;
              closed = true;
              emitClose();
            });
            ready = true;
            drain();
            for (const listener of open) listener();
          })
          .catch((error: unknown) => {
            if (closed) return;
            emitError(capabilityRefusal(error));
            emitClose();
          });
      }
    }

    const socket = {
      send(data: string) {
        if (closed) return;
        if (!ready || connection === null) {
          queue.push(data);
          return;
        }
        void connection.send(new TextEncoder().encode(data)).catch((error: unknown) => {
          emitError(error instanceof Error ? error : new Error(String(error)));
        });
      },
      close() {
        if (closed) return;
        closed = true;
        queue.length = 0;
        void connection?.close().catch(() => undefined);
        emitClose();
      },
      addEventListener(type: string, listener: unknown) {
        switch (type) {
          case "open":
            open.push(listener as OpenListener);
            return;
          case "message":
            message.push(listener as MessageListener);
            return;
          case "close":
            close.push(listener as CloseListener);
            return;
          case "error":
            failure.push(listener as ErrorListener);
            return;
        }
      },
    };
    return socket as RelayWebSocket;
  };
}
