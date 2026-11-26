/**
 * The two messages that cross between the supervisor and the relay worker.
 *
 * The relay's handshake is one JSON line at a time (`services/relay/src/child.ts`),
 * so the worker carries those lines verbatim rather than inventing a second
 * status shape. The supervisor keeps one reader and one `stop` command, whether
 * the relay is a thread or, before this, a process.
 */

/** Supervisor to worker: one stdin line, or the host closing the pipe. */
export type RelayWorkerInput =
  | { readonly type: "line"; readonly line: string }
  | { readonly type: "close" };

/** Worker to supervisor: one line the relay wrote, on the stream it wrote it to. */
export interface RelayWorkerOutput {
  readonly type: "line";
  readonly stream: "stdout" | "stderr";
  readonly line: string;
}

export function isRelayWorkerOutput(value: unknown): value is RelayWorkerOutput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "line" &&
    (record.stream === "stdout" || record.stream === "stderr") &&
    typeof record.line === "string"
  );
}
