import { PassThrough } from "node:stream";
import { parentPort, workerData } from "node:worker_threads";
import { runRelayChild } from "@suite/sync-server/dist/child.js";
import type { RelayWorkerInput, RelayWorkerOutput } from "./relayWorkerMessages.js";

/**
 * The relay's worker-thread entry.
 *
 * The relay is the same code `serve` runs (`services/relay/src/child.ts`); only
 * the transport around it changes. A `worker_threads` thread is Node code in
 * the host's own process, so nothing here launches the Electron binary. That
 * matters under Flatpak: the Electron executable is zypak-wrapped, and zypak
 * aborts (`DetermineZygoteStrategy: Assertion failed: bus`) when the sandboxed
 * session bus is absent from the environment the supervisor hands a child.
 * `runAsNode` is also fused off in the packaged host, so an Electron child
 * could not have run the relay even with a session bus.
 *
 * The handshake is unchanged: `runRelayChild` reads its one `stop` command and
 * writes one JSON line per report. `argv` carries only the store, the bind and
 * the port, and the thread's `env` is the supervisor's whitelist.
 *
 * Worker entry, not a module the host imports: `new Worker(new URL(...))` in
 * `relaySupervisor.ts` starts it. It is compiled beside that file
 * (`dist/relayWorker.js`) and shipped inside the app's asar.
 */

interface RelayWorkerData {
  readonly argv: readonly string[];
}

const port = parentPort;
if (port === null) {
  throw new Error("the relay worker must be started as a worker thread, not imported");
}
const channel = port;

const data = workerData as RelayWorkerData | undefined;
const stdin = new PassThrough();
const stdout = new PassThrough();
const stderr = new PassThrough();

channel.on("message", (message: RelayWorkerInput) => {
  if (message.type === "line") stdin.write(message.line);
  else if (message.type === "close") stdin.end();
});

/** One relay stream, forwarded line by line to the supervisor. */
function forward(stream: PassThrough, name: RelayWorkerOutput["stream"]): void {
  stream.on("data", (chunk: Buffer) => {
    channel.postMessage({
      type: "line",
      stream: name,
      line: String(chunk),
    } satisfies RelayWorkerOutput);
  });
}

forward(stdout, "stdout");
forward(stderr, "stderr");

const code = await runRelayChild(data?.argv ?? [], {
  stdin,
  stdout,
  stderr,
  // Signals reach the host's main thread, never this one. The supervisor stops
  // the worker with `stop` and terminates the thread when it does not answer.
  installSignals: false,
});
process.exit(code);
