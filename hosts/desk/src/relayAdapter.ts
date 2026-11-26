import { randomUUID } from "node:crypto";

/**
 * The pack-facing half of sync.
 *
 * A pack receives one narrow service: open a pinned connection to this host's
 * relay, send opaque frames, receive opaque frames, close. The host opens the
 * socket, keeps the token and never reads a frame. There is no general network
 * API here and no document: the only values a pack names are a relay address and
 * its certificate pin, and the request is refused unless they match the relay
 * this host supervises.
 *
 * Every connection is scoped to the sender the host derived from the view: a
 * token from one tab cannot be spent by another, and closing a view closes the
 * connections it owned.
 */

const FINGERPRINT_LENGTH = 64;

/** A copied fingerprint in any of the shapes a terminal prints. */
export function normaliseRelayFingerprint(value: string): string | null {
  const trimmed = value.trim().replace(/^sha-?256\s*[:=]?\s*/iu, "");
  const hex = trimmed.replace(/[\s:]/gu, "");
  if (hex.length !== FINGERPRINT_LENGTH || !/^[0-9a-f]+$/iu.test(hex)) return null;
  return hex.toUpperCase().match(/.{2}/gu)?.join(":") ?? null;
}

export interface RelayScope {
  readonly webContentsId: number;
  readonly tabId: string;
  readonly packId: string;
  /** Whether the pack declared `relay`. The broker refuses again if it did not. */
  readonly allowed: boolean;
}

export interface RelayRuntime {
  readonly ready: boolean;
  readonly address: string | null;
  readonly fingerprint: string | null;
}

export interface RelayConnectRequest {
  readonly url: string;
  readonly certificateSha256?: string;
}

export interface RelayIssued {
  /** The only name for this connection across IPC. The pack keeps it in the preload. */
  readonly token: string;
  readonly url: string;
  readonly fingerprint: string | null;
}

export interface RelaySocketHandlers {
  frame(frame: Uint8Array): void;
  close(reason: string): void;
}

export interface RelaySocket {
  send(frame: Uint8Array): void;
  close(): void;
}

export type OpenRelaySocket = (
  url: string,
  fingerprint: string | null,
  handlers: RelaySocketHandlers,
) => Promise<RelaySocket>;

/** Where a delivered event goes. The main process turns this into one webContents send. */
export interface RelayBrokerSink {
  frame(webContentsId: number, token: string, frame: Uint8Array): void;
  close(webContentsId: number, token: string, reason: string): void;
}

export interface RelayBrokerOptions {
  readonly runtime: () => RelayRuntime;
  readonly openSocket: OpenRelaySocket;
  readonly sink: RelayBrokerSink;
  /** Bounded so one tab cannot open an unbounded number of sockets. */
  readonly maxConnectionsPerTab?: number;
  /** Bounded so a pack cannot ask the host to copy a document-sized buffer. */
  readonly maxFrameBytes?: number;
}

/** A refusal a pack can read. The sentence names the next action, never a document. */
export class RelayRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayRefusedError";
  }
}

interface Connection {
  readonly token: string;
  readonly scope: RelayScope;
  closed: boolean;
  socket: RelaySocket | null;
}

const DEFAULT_MAX_CONNECTIONS_PER_TAB = 4;
const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

function readRequest(value: unknown): RelayConnectRequest {
  if (typeof value !== "object" || value === null) {
    throw new RelayRefusedError("a relay connection needs a relay address");
  }
  const record = value as { url?: unknown; certificateSha256?: unknown };
  if (typeof record.url !== "string" || !/^wss?:\/\/\S+$/u.test(record.url)) {
    throw new RelayRefusedError("a relay connection needs a ws:// or wss:// address");
  }
  if (record.certificateSha256 === undefined) {
    return { url: record.url };
  }
  if (typeof record.certificateSha256 !== "string") {
    throw new RelayRefusedError("that relay certificate fingerprint is malformed");
  }
  const fingerprint = normaliseRelayFingerprint(record.certificateSha256);
  if (fingerprint === null) {
    throw new RelayRefusedError("that relay certificate fingerprint is malformed");
  }
  return { url: record.url, certificateSha256: fingerprint };
}

function requireFrame(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new RelayRefusedError("a relay frame is bytes");
  }
  return value;
}

/**
 * The connection registry.
 *
 * `connect` is asynchronous because the socket must open before a pack can send
 * on it. A frame the relay delivers before the caller has the connection is held
 * by the same record, so nothing is dropped.
 */
export class RelayBroker {
  readonly #options: RelayBrokerOptions;
  readonly #maxConnectionsPerTab: number;
  readonly #maxFrameBytes: number;
  readonly #connections = new Map<string, Connection>();

  constructor(options: RelayBrokerOptions) {
    this.#options = options;
    this.#maxConnectionsPerTab = options.maxConnectionsPerTab ?? DEFAULT_MAX_CONNECTIONS_PER_TAB;
    this.#maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  async connect(scope: RelayScope, value: unknown): Promise<RelayIssued> {
    if (!scope.allowed) {
      throw new RelayRefusedError("the relay capability is not enabled for this pack");
    }
    const request = readRequest(value);
    const runtime = this.#options.runtime();
    if (!runtime.ready || runtime.address === null) {
      throw new RelayRefusedError("the relay is not running yet");
    }
    if (request.url !== runtime.address) {
      throw new RelayRefusedError("the relay capability connects only to this host's relay");
    }

    const expected = runtime.fingerprint;
    if (expected !== null) {
      if (request.certificateSha256 === undefined) {
        throw new RelayRefusedError("this relay needs its certificate fingerprint");
      }
      if (request.certificateSha256 !== expected) {
        throw new RelayRefusedError("the relay certificate does not match the pinned fingerprint");
      }
    }

    const open = [...this.#connections.values()].filter(
      (connection) => !connection.closed && connection.scope.tabId === scope.tabId,
    ).length;
    if (open >= this.#maxConnectionsPerTab) {
      throw new RelayRefusedError("this tab already has as many relay connections as it may open");
    }

    const token = randomUUID();
    const connection: Connection = {
      token,
      scope: { ...scope },
      closed: false,
      socket: null,
    };
    this.#connections.set(token, connection);

    try {
      connection.socket = await this.#options.openSocket(request.url, expected, {
        frame: (frame) => {
          if (connection.closed) return;
          if (frame.byteLength > this.#maxFrameBytes) {
            this.#close(connection, "the relay sent a frame that is too large");
            return;
          }
          this.#options.sink.frame(scope.webContentsId, token, frame);
        },
        close: (reason) => this.#close(connection, reason),
      });
    } catch (error) {
      connection.closed = true;
      this.#connections.delete(token);
      throw new RelayRefusedError(
        error instanceof Error ? error.message : "the relay connection could not be opened",
      );
    }

    if (connection.closed) {
      connection.socket.close();
      throw new RelayRefusedError("the relay connection was closed while it was opening");
    }
    return { token, url: request.url, fingerprint: expected };
  }

  send(scope: RelayScope, token: unknown, value: unknown): void {
    const connection = this.#owned(scope, token);
    const frame = requireFrame(value);
    if (frame.byteLength > this.#maxFrameBytes) {
      throw new RelayRefusedError("that frame is too large");
    }
    if (connection.socket === null) {
      throw new RelayRefusedError("the relay connection is not open");
    }
    connection.socket.send(frame);
  }

  close(scope: RelayScope, token: unknown): void {
    const connection = this.#owned(scope, token);
    this.#close(connection, "the pack closed the connection");
  }

  /** Close every connection one tab owned. Called when its view is destroyed. */
  releaseOwner(tabId: string): void {
    for (const connection of [...this.#connections.values()]) {
      if (connection.scope.tabId === tabId) this.#close(connection, "the tab closed");
    }
  }

  closeAll(): void {
    for (const connection of [...this.#connections.values()]) {
      this.#close(connection, "the host is closing");
    }
  }

  #owned(scope: RelayScope, token: unknown): Connection {
    if (typeof token !== "string") {
      throw new RelayRefusedError("that relay connection does not belong to this tab");
    }
    const connection = this.#connections.get(token);
    if (
      connection === undefined ||
      connection.closed ||
      connection.scope.webContentsId !== scope.webContentsId ||
      connection.scope.tabId !== scope.tabId
    ) {
      throw new RelayRefusedError("that relay connection does not belong to this tab");
    }
    return connection;
  }

  #close(connection: Connection, reason: string): void {
    if (connection.closed) return;
    connection.closed = true;
    this.#connections.delete(connection.token);
    try {
      connection.socket?.close();
    } catch {
      // The socket is already gone; the close notice is still the pack's answer.
    }
    this.#options.sink.close(connection.scope.webContentsId, connection.token, reason);
  }
}
