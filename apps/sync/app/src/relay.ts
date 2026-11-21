import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  advertisedRelayUrl,
  createSyncServer,
  ensureSelfSignedPair,
  FileHostStore,
  HostRegistry,
  type SyncServer,
} from "@suite/host";

/**
 * The relay this app owns.
 *
 * It runs in the main process rather than as a child `suite-sync`: the Flatpak carries one
 * Electron runtime and no Node of its own, so a second binary would be a second copy of the
 * same code. What it stores is still the relay's, not the app's: `<data>/suite-sync` is a
 * directory of sealed frames and signed role records, and nothing here opens a frame.
 *
 * The host is asked to verify device signatures through `@suite/host`'s own admission path.
 * There is no device registry yet, so — exactly like the CLI's `--trust-all`, which is the
 * only mode `serve` accepts — the signature check is the host's business and this passes the
 * invitation-only policy the host already enforces: a known device id with a pinned key, a
 * role, and a live invitation to join.
 */

/** How many ports to try before giving up on "something else is already there". */
const PORT_ATTEMPTS = 10;

export interface RelayOptions {
  /** The store directory. The certificate pair lives in `<storeDir>/tls`. */
  readonly storeDir: string;
  /** The address to bind. `0.0.0.0` is what lets another device reach it. */
  readonly bind: string;
  /** The first port to try. `0` asks the OS for a free one, which is what tests use. */
  readonly port: number;
  /** What the console reports as the relay's version. */
  readonly version: string;
}

export interface RelayState {
  readonly running: boolean;
  /** The address a device is given: the LAN address when the bind is a wildcard. */
  readonly address: string | null;
  readonly bind: string;
  readonly port: number;
  readonly fingerprint: string | null;
  readonly consoleUrl: string | null;
  readonly store: string;
  readonly problem: string | null;
}

/** Whether the listen failure means "that port is taken", which is worth retrying. */
function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

function describe(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the relay could not start, and did not say why";
}

export class RelayService {
  readonly #options: RelayOptions;
  #server: SyncServer | null = null;
  #fingerprint: string | null = null;
  #problem: string | null = null;

  constructor(options: RelayOptions) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#server !== null;
  }

  get state(): RelayState {
    const server = this.#server;
    return {
      running: server !== null,
      address: server === null ? null : advertisedRelayUrl(server.host, server.port, server.secure),
      bind: this.#options.bind,
      port: server?.port ?? this.#options.port,
      fingerprint: server?.fingerprint ?? this.#fingerprint,
      consoleUrl: server?.console?.url ?? null,
      store: this.#options.storeDir,
      problem: this.#problem,
    };
  }

  /**
   * Serve, or return what is already serving.
   *
   * The certificate pair is made once and kept: every device pins its fingerprint, so a new
   * pair on each launch would mean re-entering the pin on every device after every restart.
   */
  async start(): Promise<RelayState> {
    if (this.#server !== null) return this.state;

    const pair = ensureSelfSignedPair(join(this.#options.storeDir, "tls"), {
      commonName: "Suite Sync relay",
    });
    const tls = {
      cert: readFileSync(pair.certPath),
      key: readFileSync(pair.keyPath),
    };
    this.#fingerprint = pair.fingerprint;

    const attempts = this.#options.port === 0 ? 1 : PORT_ATTEMPTS;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.#server = await createSyncServer({
          registry: new HostRegistry(),
          host: this.#options.bind,
          port: this.#options.port + attempt,
          store: new FileHostStore(this.#options.storeDir),
          verifyFrame: () => true,
          verifyRole: () => true,
          tls,
          console: { version: this.#options.version, storePath: this.#options.storeDir },
        });
        this.#problem = null;
        return this.state;
      } catch (error) {
        lastError = error;
        // Only a port that somebody else holds is worth the next one: a broken store or a
        // refused address would fail the same way ten times.
        if (!isAddressInUse(error)) break;
      }
    }

    this.#problem = describe(lastError);
    return this.state;
  }

  /** Stop serving. The pair stays where it is, so the pin survives the next start. */
  async stop(): Promise<RelayState> {
    const server = this.#server;
    this.#server = null;
    if (server !== null) await server.close();
    return this.state;
  }
}
