import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAddressInUse,
  locateSyncBinary,
  type RelayProcess,
  type RelayStream,
  readRelayStore,
  SuiteSyncRelay,
} from "./syncRelay.js";

/**
 * The relay lifecycle, without a socket.
 *
 * Every test stands a fake process in for `suite-sync`. The adapter's job is to find a
 * binary, translate a line of output into state, and stop what it started; none of that
 * needs a port, and a test that opened one would be testing the relay instead.
 */

class FakeStream implements RelayStream {
  private readonly listeners: ((chunk: string) => void)[] = [];

  setEncoding(): void {
    // The adapter only needs the stream to hand it strings.
  }

  on(_event: "data", listener: (chunk: string) => void): unknown {
    this.listeners.push(listener);
    return this;
  }

  emitData(chunk: string): void {
    for (const listener of this.listeners) listener(chunk);
  }
}

class FakeProcess implements RelayProcess {
  readonly pid = 4242;
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly signals: (NodeJS.Signals | undefined)[] = [];

  private readonly exitListeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] =
    [];
  private exited = false;

  once(
    _event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown {
    this.exitListeners.push(listener);
    return this;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    this.exit(0, null);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    for (const listener of this.exitListeners) listener(code, signal);
  }
}

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "suite-start-relay-"));
}

/** A relay whose binary exists and whose process is the fake above. */
async function fakeRelay(options: {
  readonly scope?: "loopback" | "network";
  readonly lanAddress?: () => string | null;
  readonly exitOnSpawn?: number;
}): Promise<{
  relay: SuiteSyncRelay;
  child: () => FakeProcess;
  args: () => readonly string[];
}> {
  const binary = "/opt/suite/suite-sync";
  let current = new FakeProcess();
  let args: readonly string[] = [];
  const relay = new SuiteSyncRelay({
    dataDir: await folder(),
    env: { SUITE_SYNC_BIN: binary, PATH: "" },
    exists: (path) => path === binary,
    scope: options.scope ?? "loopback",
    ...(options.lanAddress === undefined ? {} : { lanAddress: options.lanAddress }),
    spawn: (command, argv) => {
      expect(command).toBe(binary);
      args = [...argv];
      current = new FakeProcess();
      if (options.exitOnSpawn !== undefined) {
        const spawned = current;
        queueMicrotask(() => spawned.exit(options.exitOnSpawn ?? 0, null));
      }
      return current;
    },
  });
  return { relay, child: () => current, args: () => args };
}

describe("finding the relay", () => {
  it("uses an explicit SUITE_SYNC_BIN and says when that path is missing", () => {
    expect(
      locateSyncBinary({
        env: { SUITE_SYNC_BIN: "/opt/suite-sync" },
        exists: (path) => path === "/opt/suite-sync",
      }),
    ).toEqual({ path: "/opt/suite-sync", problem: null });

    const missing = locateSyncBinary({
      env: { SUITE_SYNC_BIN: "/opt/gone" },
      exists: () => false,
    });
    expect(missing.path).toBeNull();
    expect(missing.problem).toContain("/opt/gone");
  });

  it("prefers a copy beside Start to one on PATH", () => {
    const resources = "/app/resources";
    const beside = join(resources, "suite-sync");
    expect(
      locateSyncBinary({
        env: { PATH: "/usr/local/bin" },
        resourcesPath: resources,
        execPath: "/app/suite-start",
        exists: (path) => path === beside || path === "/usr/local/bin/suite-sync",
        platform: "linux",
      }),
    ).toEqual({ path: beside, problem: null });
  });

  it("falls back to PATH", () => {
    const onPath = join("/usr/local/bin", "suite-sync");
    expect(
      locateSyncBinary({
        env: { PATH: ["/nowhere", "/usr/local/bin"].join(delimiter) },
        resourcesPath: "/app/resources",
        execPath: "/app/suite-start",
        exists: (path) => path === onPath,
        platform: "linux",
      }),
    ).toEqual({ path: onPath, problem: null });
  });

  it("is a state, not a throw, when nothing is installed", async () => {
    const relay = new SuiteSyncRelay({
      dataDir: await folder(),
      env: { SUITE_SYNC_BIN: "/opt/gone" },
      exists: () => false,
      spawn: () => {
        throw new Error("nothing should be spawned");
      },
    });

    const state = await relay.start();
    expect(state).toMatchObject({
      installed: false,
      running: false,
      address: null,
      binary: null,
    });
    expect(state.problem).toContain("/opt/gone");
    // The store location is still useful: it is where the relay would keep its frames.
    expect(state.store.endsWith("/sync")).toBe(true);
  });
});

describe("starting and stopping the relay", () => {
  it("starts serve on loopback, parses the address, and stops what it started", async () => {
    const { relay, child, args } = await fakeRelay({});
    const pending = relay.start();
    child().stdout.emitData("suite-sync 0.0.0 (relay protocol 1)\n");
    child().stdout.emitData("listening on ws://127.0.0.1:4321/sync\n");
    const started = await pending;

    expect(started).toMatchObject({
      installed: true,
      running: true,
      scope: "loopback",
      address: "ws://127.0.0.1:4321/sync",
      port: 4321,
      problem: null,
    });
    // The pair exists even on loopback, so the pane has a fingerprint to show
    // before somebody turns the network switch on.
    expect(started.fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
    expect(args()).toContain("serve");
    expect(args()).toContain("--store");
    expect(args()).toContain("--trust-all");
    expect(args()).not.toContain("--trust-all-remote");
    expect(args()).not.toContain("--tls-cert");
    expect(args()).not.toContain("--tls-key");

    const stopped = await relay.stop();
    expect(child().signals).toEqual(["SIGTERM"]);
    expect(stopped).toMatchObject({ installed: true, running: false, address: null });
  });

  it("serves the network scope with wss and the pair Start keeps", async () => {
    const { relay, child, args } = await fakeRelay({
      scope: "network",
      lanAddress: () => "192.168.1.20",
    });
    const pending = relay.start();
    child().stdout.emitData("listening on wss://0.0.0.0:4321/sync\n");
    const started = await pending;

    expect(started.address).toBe("wss://192.168.1.20:4321/sync");
    expect(started.address).not.toContain("0.0.0.0");
    expect(started.fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
    expect(args()).toContain("--host");
    expect(args()).toContain("0.0.0.0");
    expect(args()).toContain("--trust-all-remote");
    expect(args()).toContain("--tls-cert");
    expect(args()).toContain("--tls-key");
    expect(args()).not.toContain("--allow-plaintext");
    await relay.stop();
  });

  it("reuses the same certificate across restarts and keeps the console URL", async () => {
    const dataDir = await folder();
    const binary = "/opt/suite/suite-sync";
    let child = new FakeProcess();
    const options = {
      dataDir,
      env: { SUITE_SYNC_BIN: binary, PATH: "" },
      exists: (path: string) => path === binary,
      scope: "network" as const,
      lanAddress: () => "192.168.1.20",
      spawn: () => {
        child = new FakeProcess();
        return child;
      },
    };

    const first = new SuiteSyncRelay(options);
    const starting = first.start();
    child.stdout.emitData("listening on wss://0.0.0.0:4321/sync\n");
    child.stdout.emitData("console: http://127.0.0.1:9999/console?token=one-time\n");
    const started = await starting;
    expect(started.consoleUrl).toBe("http://127.0.0.1:9999/console?token=one-time");
    expect(started.fingerprint).not.toBeNull();
    await first.stop();

    const second = new SuiteSyncRelay(options);
    const restarting = second.start();
    child.stdout.emitData("listening on wss://0.0.0.0:4321/sync\n");
    const restarted = await restarting;
    expect(restarted.fingerprint).toBe(started.fingerprint);
    expect(restarted.consoleUrl).toBeNull();
    await second.stop();
  });

  it("reports a non-zero exit as a stopped relay with the relay's own words", async () => {
    const { relay, child } = await fakeRelay({});
    const pending = relay.start();
    child().stderr.emitData("Error: listen EADDRINUSE: address already in use 127.0.0.1:8787\n");
    child().exit(1, null);
    const state = await pending;

    expect(state).toMatchObject({ installed: true, running: false, address: null });
    expect(state.problem).toContain("exited (1)");
    expect(state.problem).toContain("EADDRINUSE");
    expect(isAddressInUse(state.problem)).toBe(true);
  });

  it("changes scope by reopening, not by claiming a narrower socket", async () => {
    const { relay, child } = await fakeRelay({ lanAddress: () => "192.168.1.20" });
    const first = relay.start();
    const firstChild = child();
    firstChild.stdout.emitData("listening on ws://127.0.0.1:4321/sync\n");
    await first;

    const changing = relay.setScope("network");
    // The running process is asked to go before the new one is spawned.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstChild.signals).toEqual(["SIGTERM"]);
    // `setScope` spawns a second fake, reached through the next emitted line.
    const spawned = child();
    expect(spawned).not.toBe(firstChild);
    spawned.stdout.emitData("listening on wss://0.0.0.0:4321/sync\n");
    const state = await changing;

    expect(state.scope).toBe("network");
    expect(state.running).toBe(true);
    expect(state.address).toBe("wss://192.168.1.20:4321/sync");
    await relay.stop();
  });
});

describe("the relay's store", () => {
  it("summarises workspaces from public metadata and never a frame payload", async () => {
    const directory = await folder();
    const workspaceId = "a".repeat(64);
    const key = {
      deviceId: "b".repeat(64),
      publicKey: "a-public-key",
      name: "Studio laptop",
    };
    await writeFile(
      join(directory, `${workspaceId}.frames.jsonl`),
      `${JSON.stringify({ type: "log", nextIndex: 2 })}\n` +
        `${JSON.stringify({
          type: "frame",
          index: 0,
          frame: {
            workspaceId,
            deviceId: key.deviceId,
            kind: "update",
            epoch: 3,
            index: 0,
            signature: "sig",
            payload: "ciphertext",
            receivedAt: "2026-01-01T00:00:00.000Z",
          },
        })}\n`,
    );
    await writeFile(join(directory, `${workspaceId}.keys.jsonl`), `${JSON.stringify(key)}\n`);
    await writeFile(
      join(directory, `${workspaceId}.roles.jsonl`),
      `${JSON.stringify({
        workspaceId,
        deviceId: key.deviceId,
        role: "owner",
        seq: 0,
        signerId: key.deviceId,
        signature: "sig",
      })}\n`,
    );

    const workspaces = await readRelayStore(directory);
    expect(workspaces).toEqual([
      {
        workspaceId,
        frames: 1,
        newestEpoch: 3,
        members: [{ deviceId: key.deviceId, name: "Studio laptop", role: "owner" }],
      },
    ]);
  });

  it("is empty for a directory that does not exist yet", async () => {
    await mkdir(join(await folder(), "sync"), { recursive: true });
    expect(await readRelayStore(join(await folder(), "missing"))).toEqual([]);
  });
});
