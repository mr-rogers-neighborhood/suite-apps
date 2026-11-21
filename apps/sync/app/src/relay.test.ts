import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RelayService } from "./relay.js";

/**
 * The relay as the app runs it.
 *
 * These are real listeners on loopback, not a stand-in: the points worth checking are that
 * the pair exists before the first connection, that the pin survives a restart, and that a
 * port somebody else holds becomes the next port rather than a dead app.
 */

const stores: string[] = [];

async function storeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "suite-sync-app-"));
  stores.push(dir);
  return dir;
}

function service(options: { store: string; port?: number; bind?: string }): RelayService {
  return new RelayService({
    storeDir: options.store,
    bind: options.bind ?? "127.0.0.1",
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
    const relay = service({ store: await storeDir(), bind: "203.0.113.1", port: 8787 });
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
