import { mkdtemp, rm } from "node:fs/promises";
import { type NetworkInterfaceInfo, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RelayService } from "./relay.js";
import type { RelayScope } from "./scope.js";

/**
 * The relay as the app runs it.
 *
 * These are real listeners, not a stand-in: the points worth checking are that the pair exists
 * before the first connection, that the pin survives a restart, that a port somebody else holds
 * becomes the next port rather than a dead app, and that each reach binds what it says it does.
 */

const stores: string[] = [];

async function storeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "suite-sync-app-"));
  stores.push(dir);
  return dir;
}

function iface(address: string): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/24`,
  };
}

/** The machine's own non-internal IPv4, when it has one, for a bind that can actually happen. */
function lanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

function service(options: {
  store: string;
  port?: number;
  scope?: RelayScope;
  envBind?: string;
  interfaces?: Record<string, NetworkInterfaceInfo[]>;
}): RelayService {
  return new RelayService({
    storeDir: options.store,
    scope: options.scope ?? "loopback",
    ...(options.envBind === undefined ? {} : { envBind: options.envBind }),
    ...(options.interfaces === undefined ? {} : { interfaces: () => options.interfaces ?? {} }),
    port: options.port ?? 0,
    version: "0.0.0-test",
  });
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("the embedded relay", () => {
  it("serves a pinned wss listener and a loopback console", async () => {
    const relay = service({ store: await storeDir() });
    const state = await relay.start();

    expect(state.running).toBe(true);
    expect(state.problem).toBeNull();
    expect(state.address).toMatch(/^wss:\/\/127\.0\.0\.1:\d+\/sync$/u);
    expect(state.fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
    expect(state.consoleUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/console\?token=\S+$/u);

    await relay.stop();
  });

  it("stops serving, and keeps the pin for the next start", async () => {
    const relay = service({ store: await storeDir() });
    const started = await relay.start();
    const stopped = await relay.stop();

    expect(stopped.running).toBe(false);
    expect(stopped.address).toBeNull();
    expect(stopped.consoleUrl).toBeNull();
    // The fingerprint is what every device pinned. Losing it would silently unpin them.
    expect(stopped.fingerprint).toBe(started.fingerprint);

    const again = await relay.start();
    expect(again.running).toBe(true);
    expect(again.fingerprint).toBe(started.fingerprint);
    await relay.stop();
  });

  it("keeps one pin across two app lifetimes of the same store", async () => {
    const store = await storeDir();
    const first = service({ store });
    const started = await first.start();
    await first.stop();

    const second = service({ store });
    const restarted = await second.start();
    expect(restarted.fingerprint).toBe(started.fingerprint);
    await second.stop();
  });

  it("is already serving when start is asked twice", async () => {
    const relay = service({ store: await storeDir() });
    const started = await relay.start();
    const again = await relay.start();

    expect(again.running).toBe(true);
    expect(again.address).toBe(started.address);
    await relay.stop();
  });

  it("takes the next port when the one it wants is held", async () => {
    const first = service({ store: await storeDir() });
    const held = await first.start();
    const port = Number(new URL(held.address ?? "").port);

    const second = service({ store: await storeDir(), port });
    const next = await second.start();

    expect(held.running).toBe(true);
    expect(next.running).toBe(true);
    expect(next.port).toBe(port + 1);
    expect(next.problem).toBeNull();

    await second.stop();
    await first.stop();
  });

  it("reports a sentence instead of throwing when it cannot bind", async () => {
    const relay = service({ store: await storeDir(), envBind: "203.0.113.1", port: 8787 });
    const state = await relay.start();

    expect(state.running).toBe(false);
    expect(state.problem).not.toBeNull();
    expect(state.address).toBeNull();
  });

  it("shows the store it was given, and never a document", async () => {
    const store = await storeDir();
    const relay = service({ store });
    const state = await relay.start();
    expect(state.store).toBe(store);
    await relay.stop();
  });
});

describe("the reach each scope binds", () => {
  it("defaults to loopback, and says so in the address", async () => {
    const relay = service({ store: await storeDir() });
    const state = await relay.start();

    expect(state.scope).toBe("loopback");
    expect(state.effective).toBe("loopback");
    expect(state.bind).toBe("127.0.0.1");
    expect(state.address).toBe(`wss://127.0.0.1:${state.port}/sync`);
    expect(state.problem).toBeNull();

    await relay.stop();
  });

  it("binds every interface only for the network scope", async () => {
    const relay = service({ store: await storeDir(), scope: "network" });
    const state = await relay.start();

    expect(state.scope).toBe("network");
    expect(state.effective).toBe("network");
    expect(state.bind).toBe("0.0.0.0");
    // The address a device is given is never the wildcard itself.
    expect(state.address).not.toContain("0.0.0.0");
    expect(state.address).toMatch(/^wss:\/\/\S+:\d+\/sync$/u);

    await relay.stop();
  });

  it("binds the tailnet address when Tailscale is up", async () => {
    const ipv4 = lanAddress();
    if (ipv4 === null) return; // A machine with no usable IPv4 cannot host this check.
    const relay = service({
      store: await storeDir(),
      scope: "tailnet",
      interfaces: { tailscale0: [iface(ipv4)] },
    });
    const state = await relay.start();

    expect(state.effective).toBe("tailnet");
    expect(state.bind).toBe(ipv4);
    expect(state.address).toBe(`wss://${ipv4}:${state.port}/sync`);
    expect(state.problem).toBeNull();

    await relay.stop();
  });

  it("serves loopback and reports why when Tailscale is not running", async () => {
    const relay = service({
      store: await storeDir(),
      scope: "tailnet",
      interfaces: { lo: [iface("127.0.0.1")] },
    });
    const state = await relay.start();

    expect(state.running).toBe(true);
    expect(state.scope).toBe("tailnet");
    expect(state.effective).toBe("loopback");
    expect(state.bind).toBe("127.0.0.1");
    expect(state.problem).toBe("Tailscale is not running on this machine.");

    await relay.stop();
  });

  it("lets SUITE_SYNC_BIND decide, and says the choice is locked", async () => {
    const relay = service({
      store: await storeDir(),
      scope: "network",
      envBind: "127.0.0.1",
    });
    const state = await relay.start();

    expect(state.bind).toBe("127.0.0.1");
    expect(state.effective).toBe("loopback");
    expect(state.locked).toBe(true);
    expect(state.address).toBe(`wss://127.0.0.1:${state.port}/sync`);

    await relay.stop();
  });

  it("keeps the old bind until it is restarted after a scope change", async () => {
    const relay = service({ store: await storeDir() });
    const first = await relay.start();

    const target = relay.setScope("network");
    expect(target.bind).toBe("0.0.0.0");
    // A running socket cannot change its bind; the window shows what is actually serving.
    expect(relay.state.bind).toBe("127.0.0.1");
    expect(relay.state.address).toBe(first.address);

    await relay.stop();
    const restarted = await relay.start();
    expect(restarted.bind).toBe("0.0.0.0");
    expect(restarted.scope).toBe("network");
    await relay.stop();
  });

  it("keeps the same pin across a scope change", async () => {
    const store = await storeDir();
    const relay = service({ store });
    const first = await relay.start();
    await relay.stop();

    relay.setScope("network");
    const second = await relay.start();
    expect(second.fingerprint).toBe(first.fingerprint);
    await relay.stop();
  });
});
