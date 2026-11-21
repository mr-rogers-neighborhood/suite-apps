#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  createSyncServer,
  FileHostStore,
  fingerprintLine,
  HostRegistry,
  isLoopbackHost,
  type TlsMaterial,
} from "@suite/host";
import { RELAY_PROTOCOL_VERSION } from "@suite/sync";

export { isLoopbackHost };

export const SERVER_NAME = "suite-sync";

/**
 * The version `--version` reports.
 *
 * Read from the package that was built rather than written here twice. It used to be a constant,
 * and it drifted: the artifact shipped as 0.3.4 while `--version` said 0.1.0 — which is the exact
 * command the relay guide tells a person to run after an upgrade. Falls back to the constant only
 * when the package file is not beside `dist/`, so a copied-out single file still answers.
 */
function readServerVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("../package.json") as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

const FALLBACK_VERSION = "0.0.0";

export const SERVER_VERSION = readServerVersion();
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_STORE = ".suite-sync";

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ServeOptions {
  readonly host: string;
  readonly port: number;
  readonly store: string;
  /**
   * Accept any signature.
   *
   * A host checks device signatures, so it needs a device key to check against — and
   * there is no key registry yet. Without this flag the server refuses to start rather
   * than run a mailbox that admits anything; with it, everything is admitted and the
   * only thing standing between a stranger and the store is the network being loopback.
   */
  readonly trustAll: boolean;
  /**
   * Say out loud that `--trust-all` is reaching a network.
   *
   * `--trust-all` on loopback means "the only caller is a process on this machine". The same flag
   * on a LAN address means "any device that can route here may write to the mailbox", which is a
   * different decision and must be made deliberately. Without this, a relay that a person left
   * running on a home network would be an open mailbox nobody chose to open.
   */
  readonly trustAllRemote: boolean;
  /**
   * A self-signed certificate and its key, for `wss://`.
   *
   * Both or neither. Loopback may stay plaintext; any reachable address must use this unless
   * the person also passes `--allow-plaintext`.
   */
  readonly tlsCert: string | null;
  readonly tlsKey: string | null;
  /** Say out loud that a reachable address is being served without TLS. */
  readonly allowPlaintext: boolean;
}

export type ServeOptionsParse =
  | { readonly ok: true; readonly value: ServeOptions }
  | { readonly ok: false; readonly error: string };

const USAGE = `suite-sync ${SERVER_VERSION} (relay protocol ${RELAY_PROTOCOL_VERSION})

Usage:
  suite-sync --version                   print the server and protocol versions
  suite-sync status                      report how a serve would be configured
  suite-sync serve [--host <host>] [--port <port>] [--store <dir>] [--trust-all]
                   [--trust-all-remote] [--tls-cert <pem> --tls-key <pem>]
                   [--allow-plaintext]

The store holds one append-only file of encrypted frames per workspace. The host
cannot read a frame, merge two, or answer a question about a document.

--trust-all admits a frame from any device, because there is no device registry yet.
On loopback that is the only caller on the machine. On any other address it admits
every device that can reach the port, so it is refused until --trust-all-remote says
that is intended.

--tls-cert and --tls-key serve wss://. On startup the host prints the certificate's
SHA-256 fingerprint; each app pins that line. A self-signed pair is enough:

  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \\
    -keyout relay-key.pem -out relay-cert.pem -days 825 \\
    -subj "/CN=suite-sync relay"

Loopback may serve ws://. Any other address needs TLS and refuses to start without
it unless --allow-plaintext is passed; that choice prints a warning and is never
made silently.
`;

/**
 * Read the flags `serve` and `status` share.
 *
 * The loopback rule that decides whether those flags are sufficient lives in `@suite/host`,
 * because the embedded host enforces the same decision; `isLoopbackHost` is re-exported above
 * for the CLI's own callers and tests.
 */
export function parseServeOptions(argv: readonly string[]): ServeOptionsParse {
  const options: {
    host: string;
    port: number;
    store: string;
    trustAll: boolean;
    trustAllRemote: boolean;
    tlsCert: string | null;
    tlsKey: string | null;
    allowPlaintext: boolean;
  } = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    store: DEFAULT_STORE,
    trustAll: false,
    trustAllRemote: false,
    tlsCert: null,
    tlsKey: null,
    allowPlaintext: false,
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
      case "--trust-all":
        options.trustAll = true;
        break;
      case "--trust-all-remote":
        options.trustAllRemote = true;
        break;
      case "--tls-cert":
        options.tlsCert = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--tls-key":
        options.tlsKey = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--allow-plaintext":
        options.allowPlaintext = true;
        break;
      default:
        return { ok: false, error: `unknown argument: ${argument ?? ""}` };
    }
  }

  if (options.host.length === 0) return { ok: false, error: "--host needs a value" };
  if (options.store.length === 0) return { ok: false, error: "--store needs a value" };
  if (options.tlsCert !== null && options.tlsCert.length === 0) {
    return { ok: false, error: "--tls-cert needs a value" };
  }
  if (options.tlsKey !== null && options.tlsKey.length === 0) {
    return { ok: false, error: "--tls-key needs a value" };
  }
  if ((options.tlsCert === null) !== (options.tlsKey === null)) {
    return { ok: false, error: "--tls-cert and --tls-key go together" };
  }
  if (options.trustAllRemote && !options.trustAll) {
    return { ok: false, error: "--trust-all-remote only means something with --trust-all" };
  }

  return { ok: true, value: options };
}

export function formatStatus(options: ServeOptions): string {
  const secure = options.tlsCert !== null;
  const plaintextReachable = !secure && !isLoopbackHost(options.host);
  return [
    `${SERVER_NAME} ${SERVER_VERSION} (relay protocol ${RELAY_PROTOCOL_VERSION})`,
    `address:  ${options.host}:${options.port}`,
    `store:    ${options.store}`,
    `transport: ${secure ? `wss (certificate pinned) — ${options.tlsCert}` : "ws (plaintext)"}`,
    `signatures: ${options.trustAll ? "not checked (--trust-all)" : "checked"}`,
    ...(options.trustAll && !isLoopbackHost(options.host)
      ? [`reachable: every device that can route to this address (--trust-all-remote)`]
      : []),
    ...(plaintextReachable
      ? [
          options.allowPlaintext
            ? "warning:  plaintext on a reachable address (--allow-plaintext); anyone who can route here can read the metadata and drop or replay traffic"
            : "refused:  a reachable address needs TLS; add --tls-cert and --tls-key, or --allow-plaintext",
        ]
      : []),
  ].join("\n");
}

export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === "--version" || command === "version") {
    return { code: 0, stdout: `${SERVER_NAME} ${SERVER_VERSION}\n`, stderr: "" };
  }

  if (command === undefined || command === "--help" || command === "help") {
    return { code: 0, stdout: USAGE, stderr: "" };
  }

  const parsed = parseServeOptions(rest);
  if (!parsed.ok) return { code: 2, stdout: "", stderr: `${parsed.error}\n${USAGE}` };

  if (command === "status") {
    return { code: 0, stdout: `${formatStatus(parsed.value)}\n`, stderr: "" };
  }

  if (command === "serve") {
    if (!parsed.value.trustAll) {
      return {
        code: 1,
        stdout: "",
        stderr:
          "this host would check device signatures and has no device keys to check against.\n" +
          "Run with --trust-all on a loopback address, or wait for the device registry.\n",
      };
    }
    if (!isLoopbackHost(parsed.value.host) && !parsed.value.trustAllRemote) {
      return {
        code: 1,
        stdout: "",
        stderr:
          `--trust-all on ${parsed.value.host} admits every device that can reach this port.\n` +
          "There is no device registry yet, so nothing would narrow that down.\n" +
          "Add --trust-all-remote if that is the relay you mean to run, or bind 127.0.0.1.\n",
      };
    }
    const server = await (async () => {
      let tls: TlsMaterial | undefined;
      if (parsed.value.tlsCert !== null && parsed.value.tlsKey !== null) {
        try {
          tls = {
            cert: await readFile(parsed.value.tlsCert, "utf8"),
            key: await readFile(parsed.value.tlsKey, "utf8"),
          };
        } catch (error) {
          throw new Error(
            `could not read the TLS certificate or key: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return createSyncServer({
        registry: new HostRegistry(),
        host: parsed.value.host,
        port: parsed.value.port,
        store: new FileHostStore(parsed.value.store),
        verifyFrame: () => true,
        verifyRole: () => true,
        ...(tls === undefined ? {} : { tls }),
        allowPlaintext: parsed.value.allowPlaintext,
      });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
    });

    if ("error" in server) {
      return { code: 1, stdout: "", stderr: `${server.error}\n` };
    }

    const warning =
      !server.secure && !isLoopbackHost(parsed.value.host)
        ? "warning: serving ws:// on a reachable address without TLS. Anyone who can route here can read the metadata and drop or replay traffic.\n"
        : "";
    const fingerprint = server.fingerprint === null ? [] : [fingerprintLine(server.fingerprint)];
    return {
      code: 0,
      stdout: `${formatStatus(parsed.value)}\nlistening on ${server.url}\n${fingerprint.join("\n")}${
        fingerprint.length === 0 ? "" : "\n"
      }`,
      stderr: warning,
    };
  }

  return { code: 2, stdout: "", stderr: `unknown command: ${command}\n${USAGE}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
