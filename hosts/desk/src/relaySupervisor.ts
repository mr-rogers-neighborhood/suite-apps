import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/**
 * The host's supervisor for the relay child.
 *
 * The host owns the lifecycle, not the relay: it spawns `services/relay`'s child
 * entry with its own store, waits for one readiness line before reporting sync
 * as available, applies a bounded restart policy when the child dies, and sends
 * `stop` before it exits. The child never receives a document handle or a
 * document path: the only path in its argument list is the store.
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
  /** The one path the child is given. It is the relay's own store. */
  readonly store: string;
  /** How many times this supervisor has restarted the child since the last start. */
  readonly restartCount: number;
  /** The last crash sentence, kept after a successful restart so a crash stays visible. */
  readonly lastError: string | null;
}

/** A process shape a test can fake without a real child. */
export interface RelayChildProcess {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export interface SpawnRelayChildOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: readonly ["pipe", "pipe", "pipe"];
}

export type SpawnRelayChild = (
  command: string,
  args: readonly string[],
  options: SpawnRelayChildOptions,
) => RelayChildProcess;

export interface RelaySupervisorOptions {
  /** The built child entry, `services/relay/dist/child.js` in a checkout. */
  readonly entry: string;
  /** The relay's own store. Never a document root. */
  readonly store: string;
  readonly execPath?: string;
  readonly host?: string;
  readonly port?: number;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly spawn?: SpawnRelayChild;
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
 * The environment the child is allowed to inherit.
 *
 * This is a whitelist, not `process.env` minus a few keys: a host variable that
 * names a document root or a pack data directory must not travel by accident.
 * `ELECTRON_RUN_AS_NODE` is set because the host's own executable is Electron.
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

export function relayChildEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of PASS_THROUGH_ENV) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Only the store, the bind and the port. Nothing that could name a document. */
export function relayChildArgs(store: string, host: string, port: number): readonly string[] {
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
    : "the relay child could not start, and did not say why";
}

function exitSentence(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string | null,
): string {
  const how = signal === null ? `code ${code ?? "unknown"}` : `signal ${signal}`;
  const detail = stderr === null ? "" : ` Last line: ${stderr}`;
  return `the relay child exited (${how}).${detail}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class RelaySupervisor {
  readonly #entry: string;
  readonly #store: string;
  readonly #execPath: string;
  readonly #host: string;
  readonly #port: number;
  readonly #baseEnv: NodeJS.ProcessEnv;
  readonly #spawnChild: SpawnRelayChild;
  readonly #maxRestarts: number;
  readonly #restartWindowMs: number;
  readonly #restartDelayMs: number;
  readonly #readinessTimeoutMs: number;
  readonly #stopTimeoutMs: number;
  readonly #now: () => number;
  readonly #onStatus: ((status: RelaySupervisorStatus) => void) | undefined;
  readonly #logger: ((line: string) => void) | undefined;

  #status: RelaySupervisorStatus;
  #child: RelayChildProcess | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #readinessTimer: ReturnType<typeof setTimeout> | null = null;
  #stopResolve: (() => void) | null = null;
  #stopPromise: Promise<RelaySupervisorStatus> | null = null;
  #stopping = false;
  #lastStderr: string | null = null;
  #failures: number[] = [];

  constructor(options: RelaySupervisorOptions) {
    this.#entry = options.entry;
    this.#store = options.store;
    this.#execPath = options.execPath ?? process.execPath;
    this.#host = options.host ?? "127.0.0.1";
    this.#port = options.port ?? 0;
    this.#baseEnv = options.baseEnv ?? process.env;
    this.#spawnChild =
      options.spawn ??
      ((command, args, spawnOptions) =>
        nodeSpawn(command, args, {
          env: spawnOptions.env,
          stdio: ["pipe", "pipe", "pipe"],
        }));
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

  /** Start the child now, cancelling a scheduled restart. */
  start(): RelaySupervisorStatus {
    if (this.#child !== null) return this.#status;
    this.#cancelRestart();
    this.#failures = [];
    this.#lastStderr = null;
    this.#status = { ...this.#status, restartCount: 0, lastError: null };
    this.#launch();
    return this.#status;
  }

  /**
   * Stop accepting work, then wait for the child to exit.
   *
   * The stop command is the ordering: the child closes its listener and store
   * before it writes `stopped` or exits. A child that does not answer is killed
   * after the bound, so the host is never held open by a broken relay.
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
    const child = this.#child;
    if (child === null) {
      this.#stopping = false;
      this.#emitStopped();
      return this.#status;
    }

    this.#stopping = true;
    this.#emit({ state: "stopping" });
    const exited = new Promise<void>((resolve) => {
      this.#stopResolve = resolve;
    });
    this.#write(child, '{"type":"stop"}\n');
    const timedOut = await Promise.race([
      exited.then(() => false),
      delay(this.#stopTimeoutMs).then(() => true),
    ]);
    if (timedOut && this.#child === child) {
      this.#logger?.("the relay child did not stop in time; killing it");
      child.kill("SIGKILL");
      await Promise.race([exited, delay(1000)]);
    }
    if (this.#child === child) {
      this.#child = null;
      this.#finishStopped();
    }
    return this.#status;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  #launch(): void {
    if (this.#child !== null) return;
    const args = relayChildArgs(this.#store, this.#host, this.#port);
    const env = relayChildEnvironment(this.#baseEnv);
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

    let child: RelayChildProcess;
    try {
      child = this.#spawnChild(this.#execPath, [this.#entry, ...args], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      this.#handleFailure(`the relay child could not start: ${describeError(error)}`);
      return;
    }
    this.#child = child;
    this.#readLines(child.stdout, (line) => this.#onLine(child, line));
    this.#readLines(child.stderr, (line) => {
      if (line.trim().length === 0) return;
      this.#lastStderr = line.trim();
      this.#logger?.(`relay: ${line}`);
    });
    child.once("exit", (code, signal) => this.#onExit(child, code, signal));
    child.once("error", (error) => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#clearReadinessTimer();
      this.#handleFailure(`the relay child failed: ${error.message}`);
    });
    this.#readinessTimer = setTimeout(() => {
      if (this.#child !== child || this.#status.state === "ready") return;
      this.#child = null;
      this.#clearReadinessTimer();
      child.kill("SIGKILL");
      this.#handleFailure(`the relay did not report ready within ${this.#readinessTimeoutMs} ms`);
    }, this.#readinessTimeoutMs);
    this.#readinessTimer.unref?.();
  }

  #onLine(child: RelayChildProcess, line: string): void {
    if (line.trim().length === 0) return;
    const report = parseRelayReport(line);
    if (report === null) {
      this.#logger?.(`relay: ${line}`);
      return;
    }
    if (this.#child !== child) return;
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

  #onExit(child: RelayChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#child !== child) return;
    this.#child = null;
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

  #write(child: RelayChildProcess, line: string): void {
    try {
      child.stdin?.write(line);
    } catch {
      // The exit handler owns the outcome; a closed pipe is not a second failure.
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
