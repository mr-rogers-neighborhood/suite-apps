import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemberRole } from "@suite/sync";
import { describe, expect, it } from "vitest";
import {
  advertisedRelayUrl,
  type ConsoleRoom,
  type ConsoleState,
  createRelayConsole,
  type RelayConsole,
} from "./console.js";
import { createSyncServer, HostRegistry } from "./server.js";
import { MemoryHostStore } from "./store.js";

const workspaceId = "a".repeat(64);
const deviceId = "b".repeat(64);
const fingerprint = `AA:${"BB:".repeat(30)}CC`;

function room(overrides: Partial<ConsoleRoom> = {}): ConsoleRoom {
  return {
    workspaceId,
    log: { length: 4, newestEpoch: 7 },
    sockets: new Set([{}, {}]),
    roles: { roles: { [deviceId]: "owner" as MemberRole } },
    keys: new Map([[deviceId, { name: "Studio laptop" }]]),
    invites: { workspaceId, invites: {}, spent: {} },
    ...overrides,
  };
}

async function consoleWith(options: { rooms?: readonly ConsoleRoom[] } = {}): Promise<{
  console: RelayConsole;
  store: string;
}> {
  const store = await mkdtemp(join(tmpdir(), "suite-console-store-"));
  await writeFile(join(store, "metadata.jsonl"), "x".repeat(2048));
  const console = await createRelayConsole({
    rooms: () => options.rooms ?? [room()],
    version: "9.9.9",
    protocolVersion: 1,
    store,
    relayUrl: "wss://192.168.1.20:8787/sync",
    bind: "0.0.0.0:8787",
    fingerprint,
  });
  return { console, store };
}

function stateUrl(console: RelayConsole): string {
  return `http://127.0.0.1:${console.port}/console/state?token=${encodeURIComponent(console.token)}`;
}

describe("the relay console", () => {
  it("binds loopback, rejects a missing token, and accepts the query or the header", async () => {
    const { console } = await consoleWith();
    try {
      expect(console.host).toBe("127.0.0.1");
      expect(console.port).toBeGreaterThan(0);

      const refused = await fetch(`http://127.0.0.1:${console.port}/console`);
      expect(refused.status).toBe(401);
      expect(await refused.text()).not.toContain("Studio laptop");

      const page = await fetch(console.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("access-control-allow-origin")).toBeNull();
      expect(page.headers.get("cache-control")).toBe("no-store");

      const header = await fetch(`http://127.0.0.1:${console.port}/console`, {
        headers: { "x-suite-console-token": console.token },
      });
      expect(header.status).toBe(200);

      // A header is for a script; a query parameter is for a browser that was
      // handed one URL. Neither is checked with a string comparison.
      const wrong = await fetch(`http://127.0.0.1:${console.port}/console?token=nope`);
      expect(wrong.status).toBe(401);

      const missing = await fetch(
        `http://127.0.0.1:${console.port}/elsewhere?token=${console.token}`,
      );
      expect(missing.status).toBe(404);
    } finally {
      await console.close();
    }
  });

  it("shows status, store, workspaces and the fingerprint, and no keys or payloads", async () => {
    const { console, store } = await consoleWith();
    try {
      const text = await (await fetch(console.url)).text();
      expect(text).toContain("Suite Sync");
      expect(text).toContain("9.9.9");
      expect(text).toContain("wss://192.168.1.20:8787/sync");
      expect(text).toContain(store);
      expect(text).toContain("2.0 KiB");
      expect(text).toContain(fingerprint);
      expect(text).toContain(workspaceId);
      expect(text).toContain("Studio laptop");
      expect(text).toContain("owner");
      expect(text).toContain("2 connections");
      expect(text).not.toContain("payload");
      expect(text).not.toContain("publicKey");
      expect(text).not.toContain("ciphertext");
    } finally {
      await console.close();
    }
  });

  it("serves the same facts as JSON, without device keys", async () => {
    const { console } = await consoleWith();
    try {
      const response = await fetch(stateUrl(console));
      expect(response.status).toBe(200);
      const state = (await response.json()) as ConsoleState;
      expect(state).toMatchObject({
        status: "running",
        version: "9.9.9",
        protocolVersion: 1,
        secure: true,
        relayUrl: "wss://192.168.1.20:8787/sync",
        bind: "0.0.0.0:8787",
        fingerprint,
      });
      expect(state.store.bytes).toBe(2048);
      expect(state.workspaces).toEqual([
        {
          workspaceId,
          frames: 4,
          newestEpoch: 7,
          connectedDevices: 2,
          members: [{ name: "Studio laptop", role: "owner" }],
        },
      ]);
      expect(JSON.stringify(state)).not.toContain("publicKey");

      const empty = await (async () => {
        const other = await createRelayConsole({
          rooms: () => [],
          version: "9.9.9",
          protocolVersion: 1,
          store: state.store.path,
          relayUrl: "ws://127.0.0.1:8787/sync",
          bind: "127.0.0.1:8787",
          fingerprint: null,
        });
        try {
          return (await (await fetch(stateUrl(other))).json()) as ConsoleState;
        } finally {
          await other.close();
        }
      })();
      expect(empty.secure).toBe(false);
      expect(empty.workspaces).toEqual([]);
    } finally {
      await console.close();
    }
  });

  it("gives every start a different token", async () => {
    const first = await consoleWith();
    const second = await consoleWith();
    try {
      expect(first.console.token).not.toBe(second.console.token);
      expect(first.console.token).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    } finally {
      await first.console.close();
      await second.console.close();
    }
  });
});

describe("advertised relay addresses", () => {
  it("never advertises a wildcard bind", () => {
    expect(advertisedRelayUrl("127.0.0.1", 8787, false)).toBe("ws://127.0.0.1:8787/sync");
    expect(advertisedRelayUrl("localhost", 8787, true)).toBe("wss://127.0.0.1:8787/sync");
    expect(advertisedRelayUrl("0.0.0.0", 8787, true)).not.toContain("0.0.0.0");
    expect(advertisedRelayUrl("0.0.0.0", 8787, true)).toMatch(/^wss:\/\//u);
    expect(advertisedRelayUrl("relay.example", 8787, true)).toBe("wss://relay.example:8787/sync");
  });
});

describe("a server that starts a console", () => {
  it("keeps the console optional and serves it when asked", async () => {
    const store = await mkdtemp(join(tmpdir(), "suite-console-server-"));
    const registry = new HostRegistry();
    const server = await createSyncServer({
      registry,
      host: "127.0.0.1",
      port: 0,
      store: new MemoryHostStore(),
      verifyFrame: () => true,
      verifyRole: () => true,
      console: { version: "9.9.9", storePath: store },
    });
    try {
      expect(server.console).not.toBeNull();
      const url = server.console?.url ?? "";
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/console\?token=/u);
      expect((await fetch(url)).status).toBe(200);
    } finally {
      await server.close();
    }

    const privateServer = await createSyncServer({
      registry,
      host: "127.0.0.1",
      port: 0,
      store: new MemoryHostStore(),
      verifyFrame: () => true,
      verifyRole: () => true,
    });
    try {
      expect(privateServer.console).toBeNull();
    } finally {
      await privateServer.close();
    }
  });
});
