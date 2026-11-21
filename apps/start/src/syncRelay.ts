import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { ensureRelayCertificate, type RelayCertificate } from "./syncTls.js";

/**
 * The Suite Sync relay, as Start runs it.
 *
 * Start does not host the relay. It finds a `suite-sync` binary, starts `serve` as a
 * child process, and reports what that process says. The frames, roles and pinned keys
 * belong to the relay's own store; Start never opens a frame and never binds a socket.
 */

/** Where the relay may be reached from. */
export type RelayScope = "loopback" | "network";

export interface RelayMember {
  readonly deviceId: string;
  /** What the device called itself. A fingerprint is not something a person can weigh. */
  readonly name: string;
  readonly role: "owner" | "editor" | "viewer" | null;
}

export interface RelayWorkspace {
  readonly workspaceId: string;
  readonly frames: number;
  readonly newestEpoch: number | null;
  readonly members: readonly RelayMember[];
}

export interface RelayState {
  /** Whether a `suite-sync` binary was found, whether or not it is running. */
  readonly installed: boolean;
  readonly running: boolean;
  readonly scope: RelayScope;
  /** The address a device would be given, or null while stopped. */
  readonly address: string | null;
  readonly port: number;
  /** Where the relay keeps its frames and role records. */
  readonly store: string;
  /** The binary Start would run, or null when none was found. */
  readonly binary: string | null;
  readonly workspaces: readonly RelayWorkspace[];
  /** The certificate other devices pin, or null when Start could not make one. */
  readonly fingerprint: string | null;
  /** The loopback-only console's one-time URL, or null for a relay without one. */
  readonly consoleUrl: string | null;
  /** Why the relay is not installed or why the last start failed. Null when all is well. */
  readonly problem: string | null;
}

/** The part of a child process this adapter needs. Narrow so a test can stand one in. */
export interface RelayStream {
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
}

export interface RelayProcess {
  readonly pid?: number;
  readonly stdout: RelayStream | null;
  readonly stderr: RelayStream | null;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type RelaySpawn = (
  command: string,
  args: readonly string[],
  options: {
    readonly stdio: ["ignore", "pipe", "pipe"];
    readonly env: NodeJS.ProcessEnv;
  },
) => RelayProcess;

export interface LocateSyncOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
  readonly resourcesPath?: string;
  readonly execPath?: string;
}

export interface LocatedSync {
  readonly path: string | null;
  readonly problem: string | null;
}

export interface SyncRelayOptions extends LocateSyncOptions {
  /** Start's data directory. Frames go in `<dataDir>/sync`, as they did before. */
  readonly dataDir: string;
  readonly port?: number;
  readonly scope?: RelayScope;
  readonly spawn?: RelaySpawn;
  readonly lanAddress?: () => string | null;
  /** How long to wait for the relay to print its address. */
  readonly startupTimeoutMs?: number;
  /** Called when a running relay exits without being asked to. */
  readonly onExit?: (state: RelayState) => void;
}

export const DEFAULT_RELAY_PORT = 8787;
const BINARY_NAME = "suite-sync";
const STARTUP_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 3_000;
const LISTENING = /listening on\s+(\S+)/u;
const CONSOLE = /console:\s+(\S+)/u;
const ADDRESS_IN_USE = /EADDRINUSE|address already in use/iu;

/**
 * Find the relay.
 *
 * An explicit `SUITE_SYNC_BIN` wins and does not fall through: a person who named a
 * binary meant that one, and quietly running another because the path is stale would
 * hide the mistake. Otherwise a copy shipped beside Start is preferred to whatever the
 * PATH happens to resolve.
 */
export function locateSyncBinary(options: LocateSyncOptions = {}): LocatedSync {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const platform = options.platform ?? process.platform;
  const name = platform === "win32" ? `${BINARY_NAME}.exe` : BINARY_NAME;

  const named = env.SUITE_SYNC_BIN?.trim();
  if (named !== undefined && named.length > 0) {
    return exists(named)
      ? { path: named, problem: null }
      : {
          path: null,
          problem: `SUITE_SYNC_BIN points at ${named}, which is not there.`,
        };
  }

  const beside: string[] = [];
  const resources = options.resourcesPath ?? process.resourcesPath;
  if (typeof resources === "string" && resources.length > 0) {
    beside.push(join(resources, name));
  }
  const executable = options.execPath ?? process.execPath;
  if (typeof executable === "string" && executable.length > 0) {
    beside.push(join(dirname(executable), name));
  }
  for (const candidate of new Set(beside)) {
    if (exists(candidate)) return { path: candidate, problem: null };
  }

  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, name);
    if (exists(candidate)) return { path: candidate, problem: null };
  }

  return {
    path: null,
    problem: "Suite Sync is not installed: no suite-sync was found beside Suite Start or on PATH.",
  };
}

export class SuiteSyncRelay {
  private readonly env: NodeJS.ProcessEnv;
  private readonly exists: (path: string) => boolean;
  private readonly spawnRelay: RelaySpawn;
  private readonly platform: NodeJS.Platform;
  private readonly lanAddress: () => string | null;
  private readonly startupTimeoutMs: number;
  private readonly onExit: ((state: RelayState) => void) | undefined;
  private readonly configuredPort: number;
  private readonly certificate: RelayCertificate | null;
  private readonly certificateProblem: string | null;

  readonly store: string;

  private scope: RelayScope;
  private located: LocatedSync | null = null;
  private child: RelayProcess | null = null;
  private port: number;
  private problem: string | null = null;
  private stopping = false;
  private console: string | null = null;

  constructor(options: SyncRelayOptions) {
    this.store = join(options.dataDir, "sync");
    this.configuredPort = options.port ?? DEFAULT_RELAY_PORT;
    this.port = this.configuredPort;
    this.scope = options.scope ?? "loopback";
    this.env = options.env ?? process.env;
    this.exists = options.exists ?? existsSync;
    this.platform = options.platform ?? process.platform;
    this.lanAddress = options.lanAddress ?? firstLanAddress;
    this.startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.onExit = options.onExit;

    // The pair is made before the first start, not when the network switch is
    // first flipped: the fingerprint a person reads in the pane has to be the one
    // the relay will present, and a pair generated by the relay on each boot
    // would unpin every device.
    try {
      this.certificate = ensureRelayCertificate(join(this.store, "tls"));
      this.certificateProblem = null;
    } catch (error) {
      this.certificate = null;
      this.certificateProblem = `Suite Sync cannot use its certificate: ${describeError(error)}`;
    }

    this.spawnRelay =
      options.spawn ??
      ((command, args, spawnOptions) =>
        spawn(command, [...args], spawnOptions) as unknown as RelayProcess);
  }

  /**
   * Start the relay, or say why it could not be started.
   *
   * A missing binary is a state, not an exception: the pane has a sentence to show and
   * Start has everything else to do. A process that exits non-zero is the same shape,
   * with the relay's own last words in the sentence.
   */
  async start(port = this.configuredPort): Promise<RelayState> {
    if (this.child !== null) return this.snapshot();

    this.located ??= locateSyncBinary({
      env: this.env,
      exists: this.exists,
      platform: this.platform,
    });
    if (this.located.path === null) {
      this.problem = this.located.problem;
      return this.snapshot();
    }

    this.port = port;
    this.problem = null;
    this.console = null;
    this.stopping = false;

    if (this.scope === "network" && this.certificate === null) {
      this.problem =
        this.certificateProblem ?? "Suite Sync needs a certificate to reach a network.";
      return this.snapshot();
    }

    const args = [
      "serve",
      "--host",
      this.scope === "network" ? "0.0.0.0" : "127.0.0.1",
      "--port",
      String(port),
      "--store",
      this.store,
      // The CLI has no device registry to verify a signature against yet. On loopback
      // that means the only caller is this machine; the network case acknowledges it.
      "--trust-all",
      ...(this.scope === "network" ? ["--trust-all-remote"] : []),
      // Loopback may stay plaintext; an address other machines can reach must be
      // wss, and the pair is Start's so the fingerprint survives a restart.
      ...(this.scope === "network" && this.certificate !== null
        ? ["--tls-cert", this.certificate.certPath, "--tls-key", this.certificate.keyPath]
        : []),
    ];

    let child: RelayProcess;
    try {
      child = this.spawnRelay(this.located.path, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: this.env,
      });
    } catch (error) {
      this.problem = `Suite Sync could not be started: ${describeError(error)}`;
      return this.snapshot();
    }

    this.child = child;

    return new Promise<RelayState>((done) => {
      let settled = false;
      let stderr = "";
      let timer: NodeJS.Timeout | undefined;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        void this.snapshot().then(done);
      };

      timer = setTimeout(() => {
        if (settled) return;
        this.problem = `Suite Sync did not report an address within ${this.startupTimeoutMs / 1000}s.`;
        this.child = null;
        try {
          child.kill("SIGTERM");
        } catch {
          // Already gone; the sentence above is still the honest one.
        }
        finish();
      }, this.startupTimeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        const consoleMatch = CONSOLE.exec(chunk);
        if (consoleMatch !== null && consoleMatch[1] !== undefined) {
          this.console = consoleMatch[1];
        }

        const match = LISTENING.exec(chunk);
        if (match === null) return;
        const address = match[1];
        if (address === undefined) return;
        const listeningPort = portFromAddress(address);
        if (listeningPort === null) return;
        this.port = listeningPort;
        this.problem = null;
        // The relay prints `listening on` before the console URL. Resolve a tick
        // later so a chunk boundary between the two lines does not hide the
        // console button until the next state push.
        setTimeout(finish, 25);
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < 4096) stderr += chunk;
      });

      child.once("exit", (code, signal) => {
        const wasRunning = this.child === child && !this.stopping;
        if (this.child === child) this.child = null;
        this.console = null;

        if (!this.stopping) {
          this.port = this.configuredPort;
          const detail = firstLine(stderr);
          this.problem =
            code === 0
              ? "Suite Sync stopped."
              : `Suite Sync exited (${code ?? signal ?? "no exit code"})${
                  detail === null ? "." : `: ${detail}`
                }`;
        }

        if (wasRunning) {
          void this.snapshot().then((state) => this.onExit?.(state));
        }
        finish();
      });
    });
  }

  /** Stop the process Start started. A relay Start did not start is not Start's to stop. */
  async stop(): Promise<RelayState> {
    const child = this.child;
    if (child === null) return this.snapshot();

    this.stopping = true;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    try {
      child.kill("SIGTERM");
    } catch {
      // The process is already gone; clearing it below is still correct.
    }

    const settled = await Promise.race([
      exited.then(() => true),
      delay(STOP_TIMEOUT_MS).then(() => false),
    ]);
    if (!settled) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Nothing left to signal.
      }
    }
    if (this.child === child) this.child = null;
    this.stopping = false;
    this.port = this.configuredPort;
    this.console = null;
    this.problem = null;
    return this.snapshot();
  }

  /**
   * Change where the relay is reachable from.
   *
   * A socket cannot be narrowed without being reopened, so a running relay is stopped
   * and started again. A stopped one records the choice for the next start.
   */
  async setScope(scope: RelayScope): Promise<RelayState> {
    if (scope === this.scope) return this.snapshot();
    const wasRunning = this.child !== null;
    if (wasRunning) await this.stop();
    this.scope = scope;
    return wasRunning ? this.start() : this.snapshot();
  }

  /** The pane's state. Workspaces are read from the relay's public metadata, never a frame. */
  async snapshot(): Promise<RelayState> {
    const binary = this.binaryPath();
    const running = this.child !== null;
    const problem =
      binary === null
        ? (this.located?.problem ?? this.problem)
        : (this.problem ?? (this.scope === "network" ? this.certificateProblem : null));
    return {
      installed: binary !== null,
      running,
      scope: this.scope,
      address: running ? this.advertised() : null,
      port: running ? this.port : this.configuredPort,
      store: this.store,
      binary,
      workspaces: running ? await readRelayStore(this.store) : [],
      fingerprint: this.certificate?.fingerprint ?? null,
      consoleUrl: running ? this.console : null,
      problem,
    };
  }

  /**
   * The address a device would be given.
   *
   * Not the bind address: a relay on `0.0.0.0` is reachable at one of this machine's
   * interface addresses, and only the machine knows which. Reporting the wildcard
   * would hand a person a link that works nowhere.
   */
  private advertised(): string | null {
    if (this.child === null) return null;
    if (this.scope === "loopback") return `ws://127.0.0.1:${this.port}/sync`;
    return `wss://${this.lanAddress() ?? "127.0.0.1"}:${this.port}/sync`;
  }

  private binaryPath(): string | null {
    this.located ??= locateSyncBinary({
      env: this.env,
      exists: this.exists,
      platform: this.platform,
    });
    return this.located.path;
  }
}

/** The port in the address the relay printed, or null when the line is not one. */
function portFromAddress(address: string): number | null {
  try {
    const parsed = new URL(address);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    const match = /:(\d{1,5})(?:\/|$)/u.exec(address);
    const digits = match?.[1];
    if (digits === undefined) return null;
    const port = Number.parseInt(digits, 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  }
}

/** Whether a relay problem is a port collision, which another port can solve. */
export function isAddressInUse(problem: string | null): boolean {
  return problem !== null && ADDRESS_IN_USE.test(problem);
}

function firstLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return line ?? null;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the process could not be created";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The first address another machine on this network could reach, if there is one. */
function firstLanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

/**
 * Read the relay's workspace summaries.
 *
 * Only the public metadata in the store: workspace ids, frame positions and epochs, and
 * the device names and roles the relay already pins. A frame's payload is never decoded,
 * and a torn line is skipped rather than failing the whole pane.
 */
export async function readRelayStore(directory: string): Promise<readonly RelayWorkspace[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }

  const suffixes = [
    ".frames.jsonl",
    ".roles.jsonl",
    ".invites.jsonl",
    ".keys.jsonl",
    ".removed.jsonl",
  ];
  const ids = new Set<string>();
  for (const name of names) {
    const suffix = suffixes.find((candidate) => name.endsWith(candidate));
    if (suffix === undefined) continue;
    ids.add(name.slice(0, -suffix.length));
  }

  const workspaces = await Promise.all(
    [...ids].filter(isWorkspaceId).map(async (workspaceId): Promise<RelayWorkspace> => {
      const frames = await readLines(join(directory, `${workspaceId}.frames.jsonl`));
      const roles = await readLines(join(directory, `${workspaceId}.roles.jsonl`));
      const keys = await readLines(join(directory, `${workspaceId}.keys.jsonl`));

      let frameCount = 0;
      let newestEpoch: number | null = null;
      for (const value of frames) {
        const record = asRecord(value);
        if (record === null) continue;
        const frame = asRecord(record.frame) ?? record;
        if (record.type === "frame" || typeof frame.kind === "string") {
          frameCount += 1;
          const epoch = frame.epoch;
          if (typeof epoch === "number" && Number.isInteger(epoch)) {
            newestEpoch = newestEpoch === null ? epoch : Math.max(newestEpoch, epoch);
          }
        }
      }

      const newestRole = new Map<string, { role: RelayMember["role"]; seq: number }>();
      for (const value of roles) {
        const record = asRecord(value);
        if (record === null) continue;
        const deviceId = record.deviceId;
        const role = record.role;
        const seq = record.seq;
        if (typeof deviceId !== "string" || !isRole(role)) continue;
        if (typeof seq !== "number" || !Number.isInteger(seq)) continue;
        const previous = newestRole.get(deviceId);
        if (previous === undefined || seq > previous.seq) newestRole.set(deviceId, { role, seq });
      }

      const namesByDevice = new Map<string, string>();
      for (const value of keys) {
        const record = asRecord(value);
        if (record === null) continue;
        if (typeof record.deviceId !== "string" || typeof record.name !== "string") continue;
        namesByDevice.set(record.deviceId, record.name);
      }

      return {
        workspaceId,
        frames: frameCount,
        newestEpoch,
        members: [...namesByDevice.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([deviceId, name]) => ({
            deviceId,
            name,
            role: newestRole.get(deviceId)?.role ?? null,
          })),
      };
    }),
  );

  return workspaces.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

const WORKSPACE_ID = /^[0-9a-f]{64}$/u;

function isWorkspaceId(value: string): boolean {
  return WORKSPACE_ID.test(value);
}

function isRole(value: unknown): value is RelayMember["role"] {
  return value === "owner" || value === "editor" || value === "viewer";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

async function readLines(path: string): Promise<readonly unknown[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const values: unknown[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // A torn append costs one line, not the workspace.
    }
  }
  return values;
}
