import { formatRelayLink, qrMatrix } from "@suite/sync";
import type { RelayCode } from "./shared.js";

/**
 * The parts of the shell that are decisions rather than Electron calls.
 *
 * The tray menu, the code, and what closing the window means are all built here so a test can
 * read them without a display. `main.ts` turns the result into a `Menu` and a `BrowserWindow`.
 */

export interface ShellState {
  readonly running: boolean;
  readonly address: string | null;
  readonly fingerprint: string | null;
  readonly consoleUrl: string | null;
  readonly problem: string | null;
}

/** One row of the tray menu, before Electron sees it. */
export type TrayCommand = "copy-link" | "console" | "window" | "quit";

export type TrayItem =
  | { readonly kind: "separator" }
  | {
      readonly kind: "item";
      /**
       * A command the menu can run, or `null` for a line that only reports. A report is
       * disabled rather than clickable, so a menu never looks like it did something.
       */
      readonly id: TrayCommand | null;
      readonly label: string;
      readonly enabled: boolean;
    };

/**
 * The relay link, exactly as the console and the QR carry it.
 *
 * A stopped relay has no address to give away, so it has no link; a running one carries the
 * certificate pin, because a self-signed `wss://` relay is unusable without it.
 */
export function relayLink(state: ShellState): string | null {
  if (state.address === null) return null;
  return formatRelayLink({
    url: state.address,
    fingerprint: state.fingerprint,
    workspaceId: null,
    inviteId: null,
  });
}

/** The code, drawn from the same payload the copy button uses. */
export function relayCode(state: ShellState): RelayCode | null {
  const payload = relayLink(state);
  if (payload === null) return null;
  const matrix = qrMatrix(payload);
  return { payload, size: matrix.size, rows: matrix.rows };
}

/** What the tray offers, as labels and commands. */
export function trayMenu(state: ShellState): readonly TrayItem[] {
  const status = state.running ? "Relay running" : "Relay stopped";
  return [
    {
      kind: "item",
      id: null,
      label: state.problem === null ? status : `${status} — ${state.problem}`,
      enabled: false,
    },
    {
      kind: "item",
      id: null,
      label: state.address ?? "Not listening",
      enabled: false,
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "copy-link",
      label: "Copy relay link",
      enabled: state.running && state.address !== null,
    },
    {
      kind: "item",
      id: "console",
      label: "Open console",
      enabled: state.consoleUrl !== null,
    },
    { kind: "item", id: "window", label: "Open Suite Sync", enabled: true },
    { kind: "separator" },
    { kind: "item", id: "quit", label: "Quit", enabled: true },
  ];
}

/**
 * What closing the window does.
 *
 * A tray is a way back, so with one the window hides and the relay keeps serving. Without
 * one, hiding would leave a process with no window and no icon, so the close is a close.
 */
export function closeAction(context: {
  readonly quitting: boolean;
  readonly hasTray: boolean;
}): "hide" | "close" {
  if (context.quitting || !context.hasTray) return "close";
  return "hide";
}
