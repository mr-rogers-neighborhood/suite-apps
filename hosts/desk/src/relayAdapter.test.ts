import { describe, expect, it } from "vitest";
import {
  type OpenRelaySocket,
  RelayBroker,
  RelayRefusedError,
  type RelayScope,
  type RelaySocket,
  type RelaySocketHandlers,
} from "./relayAdapter.js";

const ADDRESS = "wss://127.0.0.1:8787/sync";
const PIN = `${"AA:".repeat(31)}AA`;

class FakeSocket implements RelaySocket {
  readonly sent: Uint8Array[] = [];
  closed = false;
  readonly handlers: RelaySocketHandlers;

  constructor(handlers: RelaySocketHandlers) {
    this.handlers = handlers;
  }

  send(frame: Uint8Array): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }
}

interface Harness {
  readonly broker: RelayBroker;
  readonly opened: Array<{ url: string; fingerprint: string | null; socket: FakeSocket }>;
  readonly frames: Array<{ webContentsId: number; token: string; frame: Uint8Array }>;
  readonly closes: Array<{ webContentsId: number; token: string; reason: string }>;
}

function harness(
  options: { ready?: boolean; fingerprint?: string | null; max?: number } = {},
): Harness {
  const opened: Array<{ url: string; fingerprint: string | null; socket: FakeSocket }> = [];
  const frames: Array<{ webContentsId: number; token: string; frame: Uint8Array }> = [];
  const closes: Array<{ webContentsId: number; token: string; reason: string }> = [];
  const openSocket: OpenRelaySocket = async (url, fingerprint, handlers) => {
    const socket = new FakeSocket(handlers);
    opened.push({ url, fingerprint, socket });
    return socket;
  };
  const broker = new RelayBroker({
    runtime: () => ({
      ready: options.ready ?? true,
      address: ADDRESS,
      fingerprint: options.fingerprint === undefined ? PIN : options.fingerprint,
    }),
    openSocket,
    sink: {
      frame: (webContentsId, token, frame) => frames.push({ webContentsId, token, frame }),
      close: (webContentsId, token, reason) => closes.push({ webContentsId, token, reason }),
    },
    ...(options.max === undefined ? {} : { maxConnectionsPerTab: options.max }),
  });
  return { broker, opened, frames, closes };
}

function scope(overrides: Partial<RelayScope> = {}): RelayScope {
  return {
    webContentsId: 7,
    tabId: "tab-1",
    packId: "canvas",
    allowed: true,
    ...overrides,
  };
}

describe("the pack-facing relay adapter", () => {
  it("refuses a pack that did not declare relay", async () => {
    const { broker } = harness();
    await expect(
      broker.connect(scope({ allowed: false }), { url: ADDRESS, certificateSha256: PIN }),
    ).rejects.toBeInstanceOf(RelayRefusedError);
  });

  it("refuses before the supervised relay is ready", async () => {
    const { broker } = harness({ ready: false });
    await expect(broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN })).rejects.toThrow(
      /not running yet/u,
    );
  });

  it("refuses another address, so it is not a general socket", async () => {
    const { broker } = harness();
    await expect(
      broker.connect(scope(), { url: "wss://elsewhere.example/sync", certificateSha256: PIN }),
    ).rejects.toThrow(/only to this host's relay/u);
  });

  it("requires the pin the host shows and refuses a different one", async () => {
    const { broker } = harness();
    await expect(broker.connect(scope(), { url: ADDRESS })).rejects.toThrow(
      /needs its certificate fingerprint/u,
    );
    await expect(
      broker.connect(scope(), { url: ADDRESS, certificateSha256: `${"BB:".repeat(31)}BB` }),
    ).rejects.toThrow(/does not match/u);
  });

  it("opens the pinned socket and forwards opaque bytes both ways", async () => {
    const { broker, opened, frames, closes } = harness();
    const issued = await broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.url).toBe(ADDRESS);
    expect(opened[0]?.fingerprint).toBe(PIN);

    const outbound = new Uint8Array([0, 1, 2, 255]);
    broker.send(scope(), issued.token, outbound);
    expect(opened[0]?.socket.sent[0]).toEqual(outbound);

    const inbound = new Uint8Array([9, 8, 7]);
    opened[0]?.socket.handlers.frame(inbound);
    expect(frames).toEqual([{ webContentsId: 7, token: issued.token, frame: inbound }]);

    opened[0]?.socket.handlers.close("relay went away");
    expect(closes).toEqual([{ webContentsId: 7, token: issued.token, reason: "relay went away" }]);
    expect(opened[0]?.socket.closed).toBe(true);
  });

  it("scopes a token to the sender and tab that opened it", async () => {
    const { broker, opened } = harness();
    const issued = await broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN });

    expect(() =>
      broker.send(scope({ webContentsId: 8 }), issued.token, new Uint8Array([1])),
    ).toThrow(/does not belong to this tab/u);
    expect(() => broker.send(scope({ tabId: "tab-2" }), issued.token, new Uint8Array([1]))).toThrow(
      /does not belong to this tab/u,
    );
    expect(() => broker.close(scope({ webContentsId: 8 }), issued.token)).toThrow(
      /does not belong to this tab/u,
    );
    expect(opened[0]?.socket.sent).toHaveLength(0);
  });

  it("caps the connections one tab may open", async () => {
    const { broker } = harness({ max: 1 });
    await broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN });
    await expect(broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN })).rejects.toThrow(
      /as many relay connections/u,
    );
  });

  it("closes a tab's connections when its view is gone", async () => {
    const { broker, opened, closes } = harness();
    const first = await broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN });
    const second = await broker.connect(scope({ tabId: "tab-2" }), {
      url: ADDRESS,
      certificateSha256: PIN,
    });

    broker.releaseOwner("tab-1");
    expect(opened[0]?.socket.closed).toBe(true);
    expect(opened[1]?.socket.closed).toBe(false);
    expect(closes.map((entry) => entry.token)).toEqual([first.token]);
    expect(second.token).not.toBe(first.token);
  });

  it("does not carry a document handle or path into the socket", async () => {
    const { broker, opened } = harness();
    const issued = await broker.connect(scope(), {
      url: ADDRESS,
      certificateSha256: PIN,
      documentPath: "/home/person/desk/documents/secret.canvas",
      documentId: "secret.canvas",
    } as unknown);
    expect(JSON.stringify(opened[0]?.url)).not.toContain("documents");
    expect(JSON.stringify(opened[0]?.fingerprint)).not.toContain("documents");
    expect(issued).not.toHaveProperty("documentPath");
    expect(JSON.stringify(issued)).not.toContain("secret.canvas");
  });

  it("refuses a frame that is not bytes or is too large", async () => {
    const { broker } = harness();
    const issued = await broker.connect(scope(), { url: ADDRESS, certificateSha256: PIN });
    expect(() => broker.send(scope(), issued.token, "a string")).toThrow(/is bytes/u);
    expect(() => broker.send(scope(), issued.token, new Uint8Array(17 * 1024 * 1024))).toThrow(
      /too large/u,
    );
  });
});
