import type { RelayConnectOptions, RelayConnection, RelayService } from "@suite/pack-runtime";

/**
 * A relay service double that records opaque frames and lets a test deliver one.
 *
 * It is deliberately not a relay server: it proves what the pack handed the host
 * and what the pack does with bytes the host delivered. The protocol's own tests
 * cover the relay's session behavior.
 */
export interface FakeRelay {
  readonly relay: RelayService;
  readonly sent: Uint8Array[];
  readonly options: RelayConnectOptions[];
  readonly delivers: Uint8Array[];
  deliver(frame: Uint8Array): void;
  close(reason: string): void;
  connectOptions(): readonly RelayConnectOptions[];
}

export function fakeRelay(options: { readonly refuse?: string | Error } = {}): FakeRelay {
  const sent: Uint8Array[] = [];
  const connects: RelayConnectOptions[] = [];
  const delivers: Uint8Array[] = [];
  let frameListener: ((frame: Uint8Array) => void) | null = null;
  let closeListener: ((reason: string) => void) | null = null;

  const relay: RelayService = {
    async connect(request): Promise<RelayConnection> {
      connects.push(request);
      if (options.refuse !== undefined) {
        throw options.refuse instanceof Error ? options.refuse : new Error(options.refuse);
      }
      return {
        async send(frame) {
          sent.push(new Uint8Array(frame));
        },
        onFrame(listener) {
          frameListener = listener;
          return () => {
            if (frameListener === listener) frameListener = null;
          };
        },
        onClose(listener) {
          closeListener = listener;
          return () => {
            if (closeListener === listener) closeListener = null;
          };
        },
        async close() {
          closeListener?.("closed");
        },
      };
    },
  };

  return {
    relay,
    sent,
    options: connects,
    delivers,
    deliver(frame) {
      delivers.push(new Uint8Array(frame));
      frameListener?.(frame);
    },
    close(reason) {
      closeListener?.(reason);
    },
    connectOptions: () => connects,
  };
}
