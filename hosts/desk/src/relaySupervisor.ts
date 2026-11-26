import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { PassThrough } from "node:stream";
import { Worker } from "node:worker_threads";
import {
  isRelayWorkerOutput,
  type RelayWorkerInput,
  type RelayWorkerOutput,
} from "./relayWorkerMessages.js";

/**
 * The host's supervisor for the relay worker.
 *
 * The host owns the lifecycle, not the relay: it starts the worker entry with
 * its own store, waits for one readiness line before reporting sync as
 * available, applies a bounded restart policy when the worker dies, and sends
 * `stop` before it exits. The worker never receives a document handle or a
 * document path: the only path in its argument list is the store.
 *
 * The relay runs in a `worker_threads` thread, not a spawned process. The host
 * is the Electron binary, and under Flatpak that binary is zypak-wrapped; a
 * child started with `ELECTRON_RUN_AS_NODE=1` made zypak abort
 * (`DetermineZygoteStrategy: Assertion failed: bus`) because the child's
 * whitelisted environment has no session bus. The packaged host also fuses
 * `runAsNode` off, so that child could never have run the relay. A thread is
 * plain Node code in this process and stays inside the same sandbox.
 *
 * Nothing here imports Electron, so the whole lifecycle is a Node test. The
 * pack-facing socket is a separate module; this one never opens a frame.
 */

export type RelaySupervisorLifecycle =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "crashed"
  | "failed";

export interface RelaySupervisorStatus {
  readonly state: RelaySupervisorLifecycle;
  /** The address a device is given, advertised rather than the literal bind. */
  readonly address: string | null;
  readonly bind: string | null;
  readonly port: number | null;
  readonly secure: boolean;
  /** The certificate pin a device copies, or null for a plaintext loopback relay. */
  readonly fingerprint: string | null;
  /** `suite://relay?...`, the code the tray used to show. */
  readonly code: string | null;
  readonly consoleUrl: string | null;
  /** The one path the worker is given. It is the relay's own store. */
  readonly store: string;
  /** How many times this supervisor has restarted the worker since the last start. */
  readonly restartCount: number;
  /** The last crash sentence, kept after a successful restart so a crash stays visible. */
  readonly lastError: string | null;
}

/** A worker shape a test can fake without starting a thread. */
export interface RelayWorker {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  /** Terminate the thread. The worker's `exit` event follows. */
  terminate(): unknown;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export interface SpawnRelayWorkerOptions {
  /** The relay's arguments: only the store, the bind and the port. */
  readonly workerData: { readonly argv: readonly string[] };
  readonly env: NodeJS.ProcessEnv;
}

export type SpawnRelayWorker = (url: URL, options: SpawnRelayWorkerOptions) => RelayWorker;

export interface RelaySupervisorOptions {
  /** The built worker entry, `dist/relayWorker.js` beside this module. */
  readonly worker: URL;
  /** The relay's own store. Never a document root. */
  readonly store: string;
  readonly host?: string;
  readonly port?: number;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly spawnWorker?: SpawnRelayWorker;
  readonly maxRestarts?: number;
  readonly restartWindowMs?: number;
  readonly restartDelayMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly now?: () => number;
  readonly onStatus?: (status: RelaySupervisorStatus) => void;
  readonly logger?: (line: string) => void;
}

/**
 * The environment the worker is allowed to inherit.
 *
 * This is a whitelist, not `process.env` minus a few keys: a host variable that
 * names a document root or a pack data directory must not travel by accident.
 * There is no `ELECTRON_RUN_AS_NODE` here any more: the worker is Node code in
 * this process, and the packaged host's `runAsNode` fuse is off.
 */
const PASS_THROUGH_ENV = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "TZ",
] as const;

export function relayWorkerEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASS_THROUGH_ENV) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Only the store, the bind and the port. Nothing that could name a document. */
export function relayWorkerArguments(store: string, host: string, port: number): readonly string[] {
  return ["--store", store, "--host", host, "--port", String(port)];
}

interface RelayReportState {
  readonly running: boolean;
  readonly address: string | null;
  readonly bind: string | null;
  readonly port: number | null;
  readonly secure: boolean;
  readonly fingerprint: string | null;
  readonly code: string | null;
  readonly consoleUrl: string | null;
  readonly store: string;
  readonly version: string;
  readonly protocolVersion: string | number;
  readonly checkedAt: string;
}

export type RelayChildReportType = "ready" | "status" | "stopped" | "error";

export interface RelayChildReport {
  readonly type: RelayChildReportType;
  readonly message: string | null;
  readonly state: RelayReportState;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read one handshake line.
 *
 * A line that is not this shape is a log line from a future build, not a
 * readiness signal, so it is ignored rather than trusted.
 */
export function parseRelayReport(line: string): RelayChildReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.protocol !== 1) return null;
  const type = record.type;
  if (type !== "ready" && type !== "status" && type !== "stopped" && type !== "error") return null;
  const state = record.state;
  if (typeof state !== "object" || state === null) return null;
  const value = state as Record<string, unknown>;
  return {
    type,
    message: stringOrNull(record.message),
    state: {
      running: value.running === true,
      address: stringOrNull(value.address),
      bind: stringOrNull(value.bind),
      port: typeof value.port === "number" ? value.port : null,
      secure: value.secure === true,
      fingerprint: stringOrNull(value.fingerprint),
      code: stringOrNull(value.code),
      consoleUrl: stringOrNull(value.consoleUrl),
      store: typeof value.store === "string" ? value.store : "",
      version: typeof value.version === "string" ? value.version : "",
      protocolVersion:
        typeof value.protocolVersion === "string" || typeof value.protocolVersion === "number"
          ? value.protocolVersion
          : 0,
      checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : "",
    },
  };
}

const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RESTART_WINDOW_MS = 5 * 60_000;
const DEFAULT_RESTART_DELAY_MS = 500;
const DEFAULT_READINESS_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the relay worker could not start, and did not say why";
}

function exitSentence(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string | null,
): string {
  const how = signal === null ? `code ${code ?? "unknown"}` : `signal ${signal}`;
  const detail = stderr === null ? "" : ` Last line: ${stderr}`;
  return `the relay worker exited (${how}).${detail}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * The real worker: a thread that speaks the relay's line protocol.
 *
 * The thread is given two in-memory pipes. `stdin` forwards each line to the
 * worker; stdout and stderr collect the lines it sends back, so the supervisor's
 * readiness handshake and `stop` command are the same code they were for a
 * process.
 */
class ThreadRelayWorker extends EventEmitter implements RelayWorker {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly #thread: Worker;

  constructor(url: URL, options: SpawnRelayWorkerOptions) {
    super();
    this.#thread = new Worker(url, { workerData: options.workerData, env: options.env });
    this.stdin.on("data", (chunk: unknown) => {
      this.#post({ type: "line", line: String(chunk) });
    });
    this.stdin.on("end", () => {
      this.#post({ type: "close" });
    });
    this.#thread.on("message", (message: unknown) => {
      if (isRelayWorkerOutput(message)) this.#receive(message);
    });
    this.#thread.on("error", (error: Error) => {
      this.emit("error", error);
    });
    this.#thread.on("exit", (code: number) => {
      this.stdout.end();
      this.stderr.end();
      this.emit("exit", code, null);
    });
  }

  terminate(): unknown {
    return this.#thread.terminate();
  }

  #post(message: RelayWorkerInput): void {
    try {
      this.#thread.postMessage(message);
    } catch {
      // A stopped thread has no port. Its exit event owns the outcome.
    }
  }

  #receive(message: RelayWorkerOutput): void {
    if (message.stream === "stderr") this.stderr.write(message.line);
    else this.stdout.write(message.line);
  }
}

export class RelaySupervisor {
  readonly #workerUrl: URL;
  readonly #store: string;
  readonly #host: string;
  readonly #port: number;
  readonly #baseEnv: NodeJS.ProcessEnv;
  readonly #spawnWorker: SpawnRelayWorker;
  readonly #maxRestarts: number;
  readonly #restartWindowMs: number;
  readonly #restartDelayMs: number;
  readonly #readinessTimeoutMs: number;
  readonly #stopTimeoutMs: number;
  readonly #now: () => number;
  readonly #onStatus: ((status: RelaySupervisorStatus) => void) | undefined;
  readonly #logger: ((line: string) => void) | undefined;

  #status: RelaySupervisorStatus;
  #worker: RelayWorker | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #readinessTimer: ReturnType<typeof setTimeout> | null = null;
  #stopResolve: (() => void) | null = null;
  #stopPromise: Promise<RelaySupervisorStatus> | null = null;
  #stopping = false;
  #lastStderr: string | null = null;
  #failures: number[] = [];

  constructor(options: RelaySupervisorOptions) {
    this.#workerUrl = options.worker;
    this.#store = options.store;
    this.#host = options.host ?? "127.0.0.1";
    this.#port = options.port ?? 0;
    this.#baseEnv = options.baseEnv ?? process.env;
    this.#spawnWorker =
      options.spawnWorker ?? ((url, spawnOptions) => new ThreadRelayWorker(url, spawnOptions));
    this.#maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.#restartWindowMs = options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
    this.#restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
    this.#readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.#stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
    this.#onStatus = options.onStatus;
    this.#logger = options.logger;
    this.#status = {
      state: "stopped",
      address: null,
      bind: null,
      port: null,
      secure: false,
      fingerprint: null,
      code: null,
      consoleUrl: null,
      store: this.#store,
      restartCount: 0,
      lastError: null,
    };
  }

  get status(): RelaySupervisorStatus {
    return this.#status;
  }

  get ready(): boolean {
    return this.#status.state === "ready";
  }

  /** Start the worker now, cancelling a scheduled restart. */
  start(): RelaySupervisorStatus {
    if (this.#worker !== null) return this.#status;
    this.#cancelRestart();
    this.#failures = [];
    this.#lastStderr = null;
    this.#status = { ...this.#status, restartCount: 0, lastError: null };
    this.#launch();
    return this.#status;
  }

  /**
   * Stop accepting work, then wait for the worker to exit.
   *
   * The stop command is the ordering: the worker closes its listener and store
   * before it writes `stopped` or exits. A worker that does not answer is
   * terminated after the bound, so the host is never held open by a broken relay.
   */
  async stop(): Promise<RelaySupervisorStatus> {
    if (this.#stopPromise !== null) return this.#stopPromise;
    const stopping = this.#stop();
    this.#stopPromise = stopping;
    try {
      return await stopping;
    } finally {
      this.#stopPromise = null;
    }
  }

  async #stop(): Promise<RelaySupervisorStatus> {
    this.#cancelRestart();
    this.#clearReadinessTimer();
    const worker = this.#worker;
    if (worker === null) {
      this.#stopping = false;
      this.#emitStopped();
      return this.#status;
    }

    this.#stopping = true;
    this.#emit({ state: "stopping" });
    const exited = new Promise<void>((resolve) => {
      this.#stopResolve = resolve;
    });
    this.#write(worker, '{"type":"stop"}\n');
    const timedOut = await Promise.race([
      exited.then(() => false),
      delay(this.#stopTimeoutMs).then(() => true),
    ]);
    if (timedOut && this.#worker === worker) {
      this.#logger?.("the relay worker did not stop in time; terminating it");
      this.#terminate(worker);
      await Promise.race([exited, delay(1000)]);
    }
    if (this.#worker === worker) {
      this.#worker = null;
      this.#finishStopped();
    }
    return this.#status;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  #launch(): void {
    if (this.#worker !== null) return;
    const argv = relayWorkerArguments(this.#store, this.#host, this.#port);
    const env = relayWorkerEnvironment(this.#baseEnv);
    this.#lastStderr = null;
    this.#emit({
      state: "starting",
      address: null,
      bind: null,
      port: null,
      secure: false,
      fingerprint: null,
      code: null,
      consoleUrl: null,
    });

    let worker: RelayWorker;
    try {
      worker = this.#spawnWorker(this.#workerUrl, { workerData: { argv }, env });
    } catch (error) {
      this.#handleFailure(`the relay worker could not start: ${describeError(error)}`);
      return;
    }
    this.#worker = worker;
    this.#readLines(worker.stdout, (line) => this.#onLine(worker, line));
    this.#readLines(worker.stderr, (line) => {
      if (line.trim().length === 0) return;
      this.#lastStderr = line.trim();
      this.#logger?.(`relay: ${line}`);
    });
    worker.once("exit", (code, signal) => this.#onExit(worker, code, signal));
    worker.once("error", (error) => {
      if (this.#worker !== worker) return;
      this.#worker = null;
      this.#clearReadinessTimer();
      this.#handleFailure(`the relay worker failed: ${error.message}`);
    });
    this.#readinessTimer = setTimeout(() => {
      if (this.#worker !== worker || this.#status.state === "ready") return;
      this.#worker = null;
      this.#clearReadinessTimer();
      this.#terminate(worker);
      this.#handleFailure(`the relay did not report ready within ${this.#readinessTimeoutMs} ms`);
    }, this.#readinessTimeoutMs);
    this.#readinessTimer.unref?.();
  }

  #onLine(worker: RelayWorker, line: string): void {
    if (line.trim().length === 0) return;
    const report = parseRelayReport(line);
    if (report === null) {
      this.#logger?.(`relay: ${line}`);
      return;
    }
    if (this.#worker !== worker) return;
    if (report.type === "error") {
      this.#lastStderr = report.message;
      this.#logger?.(`relay: ${report.message ?? "the relay reported an error"}`);
      this.#emit({ lastError: report.message });
      return;
    }
    if (this.#stopping) return;
    if (report.type === "ready" || report.type === "status") {
      this.#clearReadinessTimer();
      this.#emit({
        state: "ready",
        address: report.state.address,
        bind: report.state.bind,
        port: report.state.port,
        secure: report.state.secure,
        fingerprint: report.state.fingerprint,
        code: report.state.code,
        consoleUrl: report.state.consoleUrl,
      });
    }
  }

  #onExit(worker: RelayWorker, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#worker !== worker) return;
    this.#worker = null;
    this.#clearReadinessTimer();
    if (this.#stopping) {
      this.#finishStopped();
      return;
    }
    this.#handleFailure(exitSentence(code, signal, this.#lastStderr));
  }

  #handleFailure(message: string): void {
    this.#clearReadinessTimer();
    this.#lastStderr = null;
    const now = this.#now();
    this.#failures = [...this.#failures.filter((at) => now - at <= this.#restartWindowMs), now];
    const restarted = this.#status.restartCount;
    if (this.#failures.length > this.#maxRestarts) {
      this.#emit({
        state: "failed",
        address: null,
        bind: null,
        port: null,
        secure: false,
        fingerprint: null,
        code: null,
        consoleUrl: null,
        lastError: `${message} The relay was restarted ${restarted} time(s); it will not be retried.`,
      });
      return;
    }

    this.#status = { ...this.#status, restartCount: restarted + 1 };
    this.#emit({
      state: "crashed",
      address: null,
      bind: null,
      port: null,
      secure: false,
      fingerprint: null,
      code: null,
      consoleUrl: null,
      lastError: message,
    });
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.#launch();
    }, this.#restartDelayMs);
    this.#restartTimer.unref?.();
  }

  #finishStopped(): void {
    this.#stopping = false;
    this.#emitStopped();
    this.#stopResolve?.();
    this.#stopResolve = null;
  }

  #emitStopped(): void {
    this.#emit({
      state: "stopped",
      address: null,
      bind: null,
      port: null,
      secure: false,
      fingerprint: null,
      code: null,
      consoleUrl: null,
      restartCount: 0,
      lastError: null,
    });
  }

  #emit(patch: Partial<RelaySupervisorStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#onStatus?.(this.#status);
  }

  #readLines(stream: Readable | null, onLine: (line: string) => void): void {
    if (stream === null) return;
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    lines.on("line", onLine);
  }

  #write(worker: RelayWorker, line: string): void {
    try {
      worker.stdin?.write(line);
    } catch {
      // The exit handler owns the outcome; a closed pipe is not a second failure.
    }
  }

  #terminate(worker: RelayWorker): void {
    try {
      const result = worker.terminate();
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // The exit event owns the outcome; a thread that is already gone is not a
      // second failure.
    }
  }

  #clearReadinessTimer(): void {
    if (this.#readinessTimer === null) return;
    clearTimeout(this.#readinessTimer);
    this.#readinessTimer = null;
  }

  #cancelRestart(): void {
    if (this.#restartTimer === null) return;
    clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }
}
