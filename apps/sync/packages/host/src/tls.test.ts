import { readFile } from "node:fs/promises";
import { createRelayClient, formatFingerprint, type RelayClientHandlers } from "@suite/sync";
import { createNodeWebSocketFactory } from "@suite/sync/node";
import { describe, expect, it } from "vitest";
import { createSyncServer, HostRegistry, type SyncServer } from "./server.js";
import { MemoryHostStore } from "./store.js";
import { certificateFingerprint, isLoopbackHost } from "./tls.js";

const workspaceId = "a".repeat(64);
const deviceId = "b".repeat(64);
const certificate = await readFile(
  new URL("./__fixtures__/relay-cert.pem", import.meta.url),
  "utf8",
);
const privateKey = await readFile(new URL("./__fixtures__/relay-key.pem", import.meta.url), "utf8");

/** The fixture's fingerprint, as `openssl x509 -sha256 -fingerprint` prints it. */
const FIXTURE_FINGERPRINT =
  "DD:B8:74:21:16:B4:42:D2:81:E2:BA:2F:DC:D2:2A:40:BF:61:73:FE:CC:F6:16:9A:C0:28:6F:50:CE:A1:85:8A";

const handlers: RelayClientHandlers = {
  onJoined: () => undefined,
  onFrame: () => undefined,
  onWaiting: () => undefined,
  onRoster: () => undefined,
  onEphemeral: () => undefined,
  onRemoved: () => undefined,
  onRefused: () => undefined,
  onError: () => undefined,
  onClosed: () => undefined,
};

function serverOptions(tls?: { cert: string; key: string }) {
  return {
    registry: new HostRegistry(),
    host: "127.0.0.1",
    port: 0,
    store: new MemoryHostStore(),
    verifyFrame: () => true,
    verifyRole: () => true,
    ...(tls === undefined ? {} : { tls }),
  };
}

async function secureServer(): Promise<SyncServer> {
  return createSyncServer(serverOptions({ cert: certificate, key: privateKey }));
}

describe("certificate fingerprints", () => {
  it("formats a SHA-256 digest the way openssl prints one", () => {
    expect(formatFingerprint(FIXTURE_FINGERPRINT.toLowerCase().replaceAll(":", ""))).toBe(
      FIXTURE_FINGERPRINT,
    );
  });

  it("hashes the certificate's DER bytes, not its PEM text", () => {
    expect(certificateFingerprint(certificate)).toBe(FIXTURE_FINGERPRINT);
    // The same certificate given as bytes must hash the same; a PEM re-encode must not.
    expect(certificateFingerprint(Buffer.from(certificate))).toBe(FIXTURE_FINGERPRINT);
  });
});

describe("the host's transport policy", () => {
  it("refuses a plaintext bind on an address other machines can reach", async () => {
    await expect(
      createSyncServer({
        ...serverOptions(),
        host: "0.0.0.0",
      }),
    ).rejects.toThrow(/needs TLS/u);
  });

  it("still serves plaintext on loopback", async () => {
    const server = await createSyncServer(serverOptions());
    try {
      expect(isLoopbackHost(server.host)).toBe(true);
      expect(server.secure).toBe(false);
      expect(server.fingerprint).toBeNull();
      expect(server.url).toMatch(/^ws:\/\//u);
    } finally {
      await server.close();
    }
  });

  it("accepts a reachable plaintext bind only when that is explicit", async () => {
    const server = await createSyncServer({
      ...serverOptions(),
      host: "0.0.0.0",
      allowPlaintext: true,
    });
    try {
      expect(server.secure).toBe(false);
      expect(server.url).toMatch(/^ws:\/\//u);
    } finally {
      await server.close();
    }
  });
});

describe("a pinned wss relay", () => {
  it("reports its own fingerprint and completes a handshake with the matching pin", async () => {
    const server = await secureServer();
    try {
      expect(server.secure).toBe(true);
      expect(server.url).toMatch(/^wss:\/\//u);
      expect(server.fingerprint).toBe(FIXTURE_FINGERPRINT);

      const client = await createRelayClient(
        {
          url: server.url,
          workspaceId,
          deviceId,
          publicKey: "a2V5",
          name: "a pinned client",
          sign: () => "signed",
          webSocket: createNodeWebSocketFactory({ fingerprint: server.fingerprint }),
        },
        handlers,
      );
      client.close();
    } finally {
      await server.close();
    }
  });

  it("refuses the handshake when the pin is for another certificate", async () => {
    const server = await secureServer();
    try {
      await expect(
        createRelayClient(
          {
            url: server.url,
            workspaceId,
            deviceId,
            publicKey: "a2V5",
            name: "a pinned client",
            sign: () => "signed",
            webSocket: createNodeWebSocketFactory({ fingerprint: "00".repeat(32) }),
          },
          handlers,
        ),
      ).rejects.toThrow(/does not match the fingerprint/u);
    } finally {
      await server.close();
    }
  });

  it("refuses wss when no pin was given, instead of trusting any certificate", () => {
    expect(() => createNodeWebSocketFactory()("wss://127.0.0.1:8787/sync")).toThrow(
      /fingerprint is required/u,
    );
  });
});
