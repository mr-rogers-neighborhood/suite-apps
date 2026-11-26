import { createHash } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  normaliseRelayFingerprint,
  type RelaySocket,
  type RelaySocketHandlers,
} from "./relayAdapter.js";

/**
 * The real socket behind the relay capability.
 *
 * A relay a person runs is self-signed, so the trust decision is the fingerprint
 * the host already shows. `ws` cannot be asked to compare that pin itself, so
 * the TLS connection is accepted and then the peer certificate is hashed before
 * the socket is handed to a pack. A mismatch terminates the connection and
 * resolves nothing.
 *
 * The host never reads a frame. Bytes go to the listener exactly as `ws`
 * delivered them.
 */

const CONNECT_TIMEOUT_MS = 10_000;

interface PeerCertificate {
  readonly raw?: Buffer;
}

interface TlsSocketLike {
  getPeerCertificate?(): PeerCertificate;
}

function peerFingerprint(socket: WebSocket): string | null {
  const tls = (socket as unknown as { _socket?: TlsSocketLike })._socket;
  try {
    const raw = tls?.getPeerCertificate?.().raw;
    if (raw === undefined) return null;
    return normaliseRelayFingerprint(createHash("sha256").update(raw).digest("hex"));
  } catch {
    return null;
  }
}

function toBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

export function openPinnedRelaySocket(
  url: string,
  fingerprint: string | null,
  handlers: RelaySocketHandlers,
): Promise<RelaySocket> {
  const secure = url.startsWith("wss:");
  const socket = new WebSocket(url, secure ? { rejectUnauthorized: false } : undefined);

  return new Promise<RelaySocket>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = (): void => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clear();
      socket.terminate();
      reject(new Error(message));
    };

    timer = setTimeout(() => fail("the relay did not answer in time"), CONNECT_TIMEOUT_MS);
    timer.unref?.();

    socket.once("open", () => {
      if (settled) return;
      if (secure && fingerprint !== null) {
        const actual = peerFingerprint(socket);
        if (actual === null || actual !== fingerprint) {
          fail("the relay certificate did not match the pinned fingerprint");
          return;
        }
      }
      settled = true;
      clear();
      resolve({
        send(frame: Uint8Array): void {
          if (socket.readyState !== WebSocket.OPEN) {
            throw new Error("the relay connection is not open");
          }
          socket.send(frame);
        },
        close(): void {
          socket.close();
        },
      });
    });

    socket.on("message", (data) => {
      handlers.frame(toBytes(data));
    });
    socket.on("close", (_code, reason) => {
      if (!settled) {
        fail("the relay closed before the connection was ready");
        return;
      }
      handlers.close(reason.toString() || "the relay connection closed");
    });
    socket.on("error", (error) => {
      if (!settled) {
        fail(error.message);
        return;
      }
      handlers.close(error.message);
    });
  });
}
