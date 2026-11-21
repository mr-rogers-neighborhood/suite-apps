import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelayClient, formatFingerprint, type RelayClientHandlers } from "@suite/sync";
import { createNodeWebSocketFactory } from "@suite/sync/node";
import { describe, expect, it } from "vitest";
import { createSyncServer, HostRegistry, type SyncServer } from "./server.js";
import { MemoryHostStore } from "./store.js";
import { certificateFingerprint, ensureSelfSignedPair, isLoopbackHost } from "./tls.js";

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

  it("refuses a pin that is not a SHA-256 digest before it dials", () => {
    expect(() => createNodeWebSocketFactory({ fingerprint: "not a fingerprint" })).toThrow(
      /not a certificate fingerprint/u,
    );
  });
});

describe("a pair the host makes for itself", () => {
  async function pairIn(directory: string) {
    return ensureSelfSignedPair(join(directory, "tls"));
  }

  it("writes both halves private and reports the fingerprint of what it wrote", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-pair-"));
    const pair = await pairIn(directory);

    const cert = await readFile(pair.certPath, "utf8");
    const key = await readFile(pair.keyPath, "utf8");
    expect(certificateFingerprint(cert)).toBe(pair.fingerprint);
    expect(key).toContain("BEGIN PRIVATE KEY");
    expect((await stat(pair.certPath)).mode & 0o777).toBe(0o600);
    expect((await stat(pair.keyPath)).mode & 0o777).toBe(0o600);
  });

  it("keeps the same pair, and the same pin, on the next start", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-pair-"));
    const first = await pairIn(directory);
    const again = await pairIn(directory);

    expect(again.fingerprint).toBe(first.fingerprint);
    expect(again.certPath).toBe(first.certPath);
  });

  it("serves wss with the pair it made", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-pair-"));
    const pair = await pairIn(directory);
    const server = await createSyncServer(
      serverOptions({
        cert: await readFile(pair.certPath, "utf8"),
        key: await readFile(pair.keyPath, "utf8"),
      }),
    );
    try {
      expect(server.secure).toBe(true);
      expect(server.fingerprint).toBe(pair.fingerprint);
    } finally {
      await server.close();
    }
  });

  it("refuses to guess when only half the pair is there", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-pair-"));
    await pairIn(directory);
    await writeFile(join(directory, "tls", "relay-key.pem"), "", "utf8");
    // Still a file, but not this certificate's key: a pair that cannot serve.
    await expect(pairIn(directory)).rejects.toThrow(/not the private key|not a certificate/u);
  });
});

describe("a certificate, every time", () => {
  it("parses for OpenSSL on every generation, not just most of them", () => {
    // A serial whose first byte was 0x00 used to be encoded non-minimally, and OpenSSL
    // rejected roughly one certificate in a hundred as `illegal padding`. Three hundred is
    // cheap enough to turn that into a failure here rather than in the field — the loop runs
    // in under a second.
    for (let index = 0; index < 300; index += 1) {
      const directory = mkdtempSync(join(tmpdir(), "suite-pair-"));
      expect(() => ensureSelfSignedPair(join(directory, "tls"))).not.toThrow();
    }
  });
});
