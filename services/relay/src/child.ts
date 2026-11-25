import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  advertisedRelayUrl,
  createSyncServer,
  ensureSelfSignedPair,
  FileHostStore,
  HostRegistry,
  type SyncServer,
} from "@suite/host";
import { formatRelayLink, RELAY_PROTOCOL_VERSION } from "@suite/sync";
import { SERVER_VERSION } from "./cli.js";

/**
 * The relay as a child of the host.
 *
 * The host owns the lifecycle: it spawns this process with a store directory,
 * waits for one readiness line, and writes a `stop` command before it exits.
 * The child owns the relay's store and socket, exactly as `serve` does. It has
 * no documents grant: the only path it is given is its own store, and there is
 * no argument or message that names a document, a document root or a handle.
 *
 * Stdout is the handshake, one JSON object per line. Stderr is for a person
 * reading a log. A frame never crosses here in plaintext; this module imports no
 * document layer and never opens a stored frame.
 */

export const RELAY_CHILD_PROTOCOL = 1;

/** The default bind for a host-managed relay: this machine only. */
export const DEFAULT_CHILD_HOST = "127.0.0.1";
/** Zero asks the operating system for a free port, so two hosts do not collide. */
export const DEFAULT_CHILD_PORT = 0;
/** How many ports above a requested one the child tries when it is taken. */
const PORT_ATTEMPTS = 10;

export interface RelayChildBindOptions {
  readonly host: string;
  readonly port: number;
  /** The relay's own store. The only path the host gives this process. */
  readonly store: string;
}

export interface RelayChildState {
  readonly running: boolean;
  /** The address a device is given, advertised rather than the literal bind. */
  readonly address: string | null;
  /** `host:port` as bound, for logs and for a sentence that needs the bind. */
  readonly bind: string | null;
  readonly port: number | null;
  readonly secure: boolean;
  /** The SHA-256 certificate pin, or null for a plaintext loopback relay. */
  readonly fingerprint: string | null;
  /** `suite://relay?...`, the code a person shares with another device. */
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
  readonly protocol: typeof RELAY_CHILD_PROTOCOL;
  readonly state: RelayChildState;
  /** A sentence for a report that failed; absent otherwise. */
  readonly message?: string;
}

export type RelayChildParse =
  | { readonly ok: true; readonly value: RelayChildBindOptions }
  | { readonly ok: false; readonly error: string };

/**
 * The argument vocabulary, and nothing wider.
 *
 * `--documents`, `--document`, `--file`, `--files`, `--data` and `--data-root`
 * are named in the refusal rather than merely unknown. A host that accidentally
 * grows a document path argument fails here, with a sentence that says why, and
 * the desk's guard test fails with it.
 */
const DOCUMENT_ARGUMENTS = new Set([
  "--document",
  "--documents",
  "--file",
  "--files",
  "--data",
  "--data-root",
  "--workspace",
]);

export function parseRelayChildOptions(argv: readonly string[]): RelayChildParse {
  const options = {
    host: DEFAULT_CHILD_HOST,
    port: DEFAULT_CHILD_PORT,
    store: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--host":
        options.host = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--port": {
        const raw = argv[index + 1] ?? "";
        const port = Number.parseInt(raw, 10);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          return { ok: false, error: `not a port: ${raw}` };
        }
        options.port = port;
        index += 1;
        break;
      }
      case "--store":
        options.store = argv[index + 1] ?? "";
        index += 1;
        break;
      default:
        if (DOCUMENT_ARGUMENTS.has(argument ?? "")) {
          return {
            ok: false,
            error: `the relay child starts without a documents grant; ${argument} is not an argument it accepts`,
          };
        }
        return { ok: false, error: `unknown argument: ${argument ?? ""}` };
    }
  }

  if (options.host.length === 0) return { ok: false, error: "--host needs a value" };
  if (options.store.length === 0) return { ok: false, error: "--store needs a value" };
  return { ok: true, value: options };
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the relay child could not start, and did not say why";
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function stoppedState(
  options: RelayChildBindOptions,
  version: string,
  now: () => Date,
): RelayChildState {
  return {
    running: false,
    address: null,
    bind: null,
    port: null,
    secure: false,
    fingerprint: null,
    code: null,
    consoleUrl: null,
    store: options.store,
    version,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    checkedAt: nowIso(now),
  };
}

function stateFor(
  server: SyncServer,
  options: RelayChildBindOptions,
  version: string,
  now: () => Date,
): RelayChildState {
  const address = advertisedRelayUrl(server.host, server.port, server.secure);
  return {
    running: true,
    address,
    bind: `${server.host}:${server.port}`,
    port: server.port,
    secure: server.secure,
    fingerprint: server.fingerprint,
    code: formatRelayLink({
      url: address,
      fingerprint: server.fingerprint,
      workspaceId: null,
      inviteId: null,
    }),
    consoleUrl: server.console?.url ?? null,
    store: options.store,
    version,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    checkedAt: nowIso(now),
  };
}

export interface RelayChild {
  readonly state: RelayChildState;
  /** Stop accepting work, close the socket and the console, then return. */
  close(): Promise<void>;
}

export interface StartRelayChildOptions extends RelayChildBindOptions {
  readonly version: string;
  readonly now?: () => Date;
  /** Ports above the requested one to try while another process holds it. */
  readonly attempts?: number;
  /** Injectable for a test that does not want a real listener. */
  readonly createServer?: typeof createSyncServer;
}

/**
 * Start the relay for a supervisor.
 *
 * The certificate pair is minted once under `<store>/tls` and reused, so the pin
 * a device copied survives a restart. A requested port that is taken is retried
 * a bounded number of times; any other failure is reported once and thrown.
 */
export async function startRelayChild(options: StartRelayChildOptions): Promise<RelayChild> {
  const now = options.now ?? (() => new Date());
  const open = options.createServer ?? createSyncServer;
  const pair = ensureSelfSignedPair(join(options.store, "tls"), {
    commonName: "Suite Sync relay",
  });
  const tls = {
    cert: readFileSync(pair.certPath),
    key: readFileSync(pair.keyPath),
  };

  const attempts = options.port === 0 ? 1 : (options.attempts ?? PORT_ATTEMPTS);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const server = await open({
        registry: new HostRegistry(),
        host: options.host,
        port: options.port + attempt,
        store: new FileHostStore(options.store),
        verifyFrame: () => true,
        verifyRole: () => true,
        tls,
        console: { version: options.version, storePath: options.store },
      });
      return {
        state: stateFor(server, options, options.version, now),
        async close() {
          await server.close();
          // A frame that was already being appended has finished by now; give
          // one turn of the loop to the store before the process exits.
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
      };
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) break;
    }
  }

  throw new Error(describeError(lastError));
}

export function childReport(
  type: RelayChildReportType,
  state: RelayChildState,
  message?: string,
): string {
  const report: RelayChildReport = {
    type,
    protocol: RELAY_CHILD_PROTOCOL,
    state,
    ...(message === undefined ? {} : { message }),
  };
  return `${JSON.stringify(report)}\n`;
}

export type RelayChildCommand = "stop" | "status" | null;

/** The only commands a host may send. Anything else is ignored, not guessed at. */
export function parseRelayChildCommand(line: string): RelayChildCommand {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    const type = (parsed as { type?: unknown }).type;
    if (type === "stop" || type === "status") return type;
    return null;
  } catch {
    return null;
  }
}

export interface RunRelayChildOptions {
  readonly version?: string;
  readonly stdin?: NodeJS.ReadableStream;
  readonly stdout?: NodeJS.WritableStream;
  readonly stderr?: NodeJS.WritableStream;
  readonly now?: () => Date;
  /** Install SIGTERM/SIGINT handlers. Off in a test that drives stdin itself. */
  readonly installSignals?: boolean;
  readonly start?: typeof startRelayChild;
}

/**
 * Run the handshake for one child process.
 *
 * Returns once the relay has stopped. A readiness line is written before any
 * caller can use the address; the `stop` command closes the listener first and
 * writes `stopped` only after the store and sockets are closed.
 */
export async function runRelayChild(
  argv: readonly string[],
  options: RunRelayChildOptions = {},
): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const now = options.now ?? (() => new Date());
  const version = options.version ?? SERVER_VERSION;
  const start = options.start ?? startRelayChild;

  const parsed = parseRelayChildOptions(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n`);
    return 2;
  }

  let child: RelayChild;
  try {
    child = await start({ ...parsed.value, version, now });
  } catch (error) {
    stdout.write(
      childReport("error", stoppedState(parsed.value, version, now), describeError(error)),
    );
    return 1;
  }

  const started = child;
  stdout.write(childReport("ready", started.state));

  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  let stoppedResolve: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    stoppedResolve = resolve;
  });
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });

  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      lines.close();
      // The host may have left the pipe open. Stopping is the reason to stop
      // reading it, so the process is not kept alive by its own stdin.
      const input = stdin as NodeJS.ReadableStream & {
        pause?: () => void;
        unref?: () => void;
      };
      input.pause?.();
      input.unref?.();
      await started.close();
      stdout.write(childReport("stopped", stoppedState(parsed.value, version, now)));
    })()
      .catch((error: unknown) => {
        stdout.write(
          childReport("error", stoppedState(parsed.value, version, now), describeError(error)),
        );
      })
      .finally(() => {
        stoppedResolve();
      });
    return stopPromise;
  };

  lines.on("line", (line) => {
    const command = parseRelayChildCommand(line);
    if (command === "stop") void stop();
    else if (command === "status" && !stopping) {
      stdout.write(childReport("status", started.state));
    }
  });
  // A host that closes the pipe is leaving; do the orderly stop rather than
  // leaving the store to a SIGKILL.
  lines.on("close", () => {
    if (!stopping) void stop();
  });

  if (options.installSignals !== false) {
    process.once("SIGTERM", () => void stop());
    process.once("SIGINT", () => void stop());
  }

  await stopped;
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = await runRelayChild(process.argv.slice(2));
  process.exitCode = code;
}
