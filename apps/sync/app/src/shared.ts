import type { RelayScope, ScopeOption } from "./scope.js";

/**
 * What the window asks the main process for, and what comes back.
 *
 * The page never names a path, a URL, a bind or a command it wants run: it asks for the relay's
 * state and for a scope by id, and main decides what both mean.
 */

export const SYNC_IPC = {
  state: "suite:sync:state",
  start: "suite:sync:start",
  stop: "suite:sync:stop",
  setScope: "suite:sync:scope",
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
  /** The chosen reach. */
  readonly scope: RelayScope;
  /** What the bind exposes, which is `loopback` when the tailnet is not running. */
  readonly effective: RelayScope;
  /** True when `SUITE_SYNC_BIND` decides the bind, so the selector cannot. */
  readonly scopeLocked: boolean;
  /** The three options, with the copy and the confirmation flag decided in main. */
  readonly options: readonly ScopeOption[];
  readonly problem: string | null;
  readonly autostart: boolean;
  readonly version: string;
  /** The relay link, exactly as the code carries it. Null while the relay is stopped. */
  readonly link: string | null;
  readonly code: RelayCode | null;
}
