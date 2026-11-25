import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  parseRelayReport,
  type RelayChildProcess,
  RelaySupervisor,
  type RelaySupervisorOptions,
  type RelaySupervisorStatus,
  relayChildArgs,
  relayChildEnvironment,
  type SpawnRelayChild,
} from "./relaySupervisor.js";

const STORE = "/home/person/.config/Suite Desk/desk/relay";
const ENTRY = "/repo/services/relay/dist/child.js";

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    running: true,
    address: "wss://127.0.0.1:8787/sync",
    bind: "127.0.0.1:8787",
    port: 8787,
    secure: true,
    fingerprint: "AB:CD",
    code: "suite://relay?u=wss%3A%2F%2F127.0.0.1%3A8787%2Fsync&f=AB%3ACD",
    consoleUrl: "http://127.0.0.1:8788/console?token=t",
    store: STORE,
    version: "0.0.0-test",
    protocolVersion: 1,
    checkedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

class FakeChild extends EventEmitter implements RelayChildProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: string[] = [];
  readonly signals: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk) => this.written.push(String(chunk)));
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(String(signal ?? "SIGTERM"));
    this.exit(null, "SIGKILL");
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
  }

  ready(overrides: Record<string, unknown> = {}): void {
    this.stdout.write(
      `${JSON.stringify({ type: "ready", protocol: 1, state: state(overrides) })}\n`,
    );
  }

  fail(message: string): void {
    this.stdout.write(
      `${JSON.stringify({ type: "error", protocol: 1, state: state({ running: false }), message })}\n`,
    );
  }
}

interface SpawnRecord {
  readonly child: FakeChild;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

interface Harness {
  readonly supervisor: RelaySupervisor;
  readonly spawns: SpawnRecord[];
  readonly statuses: RelaySupervisorStatus[];
}

function harness(overrides: Partial<RelaySupervisorOptions> = {}): Harness {
  const spawns: SpawnRecord[] = [];
  const statuses: RelaySupervisorStatus[] = [];
  let clock = 1_000;
  const spawn: SpawnRelayChild = (command, args, options) => {
    const child = new FakeChild();
    spawns.push({ child, command, args: [...args], env: options.env });
    return child;
  };
  const supervisor = new RelaySupervisor({
    entry: ENTRY,
    store: STORE,
    execPath: "/usr/bin/node",
    host: "127.0.0.1",
    port: 0,
    baseEnv: {
      PATH: "/usr/bin",
      LANG: "en_GB.UTF-8",
      HOME: "/home/person",
      SUITE_DESK_DATA: "/home/person/.config/Suite Desk/desk",
      SUITE_DESK_DOCUMENTS: "/home/person/.config/Suite Desk/desk/documents",
      SUITE_DESK_TRUST: "/home/person/.config/Suite Desk/desk/trust",
      PACK_SECRET: "do-not-carry",
    },
    spawn,
    restartDelayMs: 2,
    readinessTimeoutMs: 500,
    stopTimeoutMs: 500,
    maxRestarts: 3,
    now: () => {
      clock += 10;
      return clock;
    },
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { supervisor, spawns, statuses };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for a relay state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("the relay child environment", () => {
  it("passes only the store and no host data or document path", () => {
    const env = relayChildEnvironment({
      PATH: "/usr/bin",
      LANG: "en_GB.UTF-8",
      HOME: "/home/person",
      SUITE_DESK_DATA: "/home/person/desk",
      SUITE_DESK_DOCUMENTS: "/home/person/desk/documents",
      SUITE_DESK_TRUST: "/home/person/desk/trust",
      PACK_SECRET: "do-not-carry",
    });
    expect(env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      PATH: "/usr/bin",
      LANG: "en_GB.UTF-8",
    });
    expect(JSON.stringify(env)).not.toContain("/documents");
  });

  it("puts only the store, the bind and the port in the argument list", () => {
    expect(relayChildArgs(STORE, "127.0.0.1", 8787)).toEqual([
      "--store",
      STORE,
      "--host",
      "127.0.0.1",
      "--port",
      "8787",
    ]);
  });
});

describe("the supervisor", () => {
  it("spawns the child with only its store", () => {
    const { supervisor, spawns } = harness();
    // A host object that carries a document path must not leak into the child.
    (supervisor as unknown as { documentRoot?: string }).documentRoot =
      "/home/person/desk/documents/secret.canvas";
    supervisor.start();

    expect(spawns).toHaveLength(1);
    const spawn = spawns[0] as SpawnRecord;
    expect(spawn.command).toBe("/usr/bin/node");
    expect(spawn.args).toEqual([ENTRY, "--store", STORE, "--host", "127.0.0.1", "--port", "0"]);
    expect(JSON.stringify(spawn.env)).not.toContain("documents");
    expect(JSON.stringify(spawn.args)).not.toContain("documents");
    expect(spawn.env.SUITE_DESK_DATA).toBeUndefined();
    expect(spawn.env.SUITE_DESK_DOCUMENTS).toBeUndefined();
    expect(spawn.env.PACK_SECRET).toBeUndefined();
    expect(spawn.env.HOME).toBeUndefined();
  });

  it("reports starting, then ready only after the child says so", async () => {
    const { supervisor, spawns, statuses } = harness();
    supervisor.start();
    expect(supervisor.status.state).toBe("starting");
    expect(supervisor.ready).toBe(false);

    (spawns[0] as SpawnRecord).child.ready();
    await waitFor(() => supervisor.ready);

    expect(supervisor.status).toMatchObject({
      state: "ready",
      address: "wss://127.0.0.1:8787/sync",
      fingerprint: "AB:CD",
      code: "suite://relay?u=wss%3A%2F%2F127.0.0.1%3A8787%2Fsync&f=AB%3ACD",
      consoleUrl: "http://127.0.0.1:8788/console?token=t",
      restartCount: 0,
      lastError: null,
    });
    expect(statuses.map((status) => status.state)).toContain("starting");
    expect(statuses.map((status) => status.state)).toContain("ready");
  });

  it("does not treat an arbitrary line as readiness", async () => {
    const { supervisor, spawns } = harness();
    supervisor.start();
    (spawns[0] as SpawnRecord).child.stdout.write("not a handshake\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(supervisor.status.state).toBe("starting");
  });

  it("restarts a crashed child and keeps the crash visible", async () => {
    const { supervisor, spawns } = harness();
    supervisor.start();
    (spawns[0] as SpawnRecord).child.ready();
    await waitFor(() => supervisor.ready);

    (spawns[0] as SpawnRecord).child.exit(1);
    expect(supervisor.status.state).toBe("crashed");
    expect(supervisor.status.lastError).toContain("code 1");
    expect(supervisor.status.restartCount).toBe(1);

    await waitFor(() => spawns.length === 2);
    (spawns[1] as SpawnRecord).child.ready();
    await waitFor(() => supervisor.ready);

    expect(supervisor.status.restartCount).toBe(1);
    expect(supervisor.status.lastError).toContain("code 1");
  });

  it("stops retrying after the bounded number of restarts", async () => {
    const { supervisor, spawns } = harness({ maxRestarts: 1 });
    supervisor.start();
    (spawns[0] as SpawnRecord).child.ready();
    await waitFor(() => supervisor.ready);

    (spawns[0] as SpawnRecord).child.exit(1);
    await waitFor(() => spawns.length === 2);
    (spawns[1] as SpawnRecord).child.exit(1);

    expect(supervisor.status.state).toBe("failed");
    expect(supervisor.status.lastError).toContain("will not be retried");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawns).toHaveLength(2);
  });

  it("sends stop before the child exits and does not restart it", async () => {
    const { supervisor, spawns } = harness();
    supervisor.start();
    (spawns[0] as SpawnRecord).child.ready();
    await waitFor(() => supervisor.ready);

    const stopping = supervisor.stop();
    expect(supervisor.status.state).toBe("stopping");
    const child = (spawns[0] as SpawnRecord).child;
    expect(child.written.join("")).toContain('{"type":"stop"}\n');

    child.exit(0);
    await stopping;
    expect(supervisor.status.state).toBe("stopped");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawns).toHaveLength(1);
  });

  it("kills a child that does not stop in time", async () => {
    const { supervisor, spawns } = harness({ stopTimeoutMs: 10 });
    supervisor.start();
    const child = (spawns[0] as SpawnRecord).child;
    child.ready();
    await waitFor(() => supervisor.ready);

    const stopping = supervisor.stop();
    // The fake kill emits the exit the real process would emit.
    await stopping;
    expect(child.signals).toContain("SIGKILL");
    expect(supervisor.status.state).toBe("stopped");
  });

  it("fails visibly when the child never reports ready", async () => {
    const { supervisor, spawns } = harness({ readinessTimeoutMs: 10, maxRestarts: 0 });
    supervisor.start();
    expect(spawns).toHaveLength(1);
    await waitFor(() => supervisor.status.state === "failed");
    expect(supervisor.status.lastError).toContain("did not report ready");
  });

  it("turns an error report into the crash sentence", async () => {
    const { supervisor, spawns } = harness();
    supervisor.start();
    const child = (spawns[0] as SpawnRecord).child;
    child.fail("the store could not be opened");
    await waitFor(() => supervisor.status.lastError !== null);
    child.exit(1);
    await waitFor(() => supervisor.status.state === "crashed");
    expect(supervisor.status.lastError).toContain("the store could not be opened");
  });

  it("reads a handshake line and ignores a foreign protocol", () => {
    expect(parseRelayReport("not json")).toBeNull();
    expect(
      parseRelayReport(JSON.stringify({ type: "ready", protocol: 2, state: state() })),
    ).toBeNull();
    expect(
      parseRelayReport(JSON.stringify({ type: "ready", protocol: 1, state: state() })),
    ).toMatchObject({ type: "ready", state: { address: "wss://127.0.0.1:8787/sync" } });
  });
});
