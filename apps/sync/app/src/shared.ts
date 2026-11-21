/**
 * What the window asks the main process for, and what comes back.
 *
 * The page never names a path, a URL or a command it wants run: it asks for the relay's
 * state, and main decides what the state is.
 */

export const SYNC_IPC = {
  state: "suite:sync:state",
  start: "suite:sync:start",
  stop: "suite:sync:stop",
  copyLink: "suite:sync:copy-link",
  copyFingerprint: "suite:sync:copy-fingerprint",
  console: "suite:sync:console",
  autostart: "suite:sync:autostart",
  info: "suite:sync:info",
} as const;

/** Pushed after the relay or the autostart entry changes. */
export const SYNC_CHANGED = "suite:sync:changed";

/** The QR as rows of `1` and `0`, which is what the page draws. */
export interface RelayCode {
  readonly payload: string;
  readonly size: number;
  readonly rows: readonly string[];
}

export interface RelayView {
  readonly running: boolean;
  readonly address: string | null;
  readonly fingerprint: string | null;
  readonly consoleUrl: string | null;
  readonly store: string;
  readonly bind: string;
  readonly port: number;
  readonly problem: string | null;
  readonly autostart: boolean;
  readonly version: string;
  /** The relay link, exactly as the code carries it. Null while the relay is stopped. */
  readonly link: string | null;
  readonly code: RelayCode | null;
}
