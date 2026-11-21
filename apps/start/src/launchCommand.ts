import { flatpakRunArgs } from "./flatpak.js";
import type { HostCommand } from "./host.js";
import type { DiscoveredApp } from "./registry.js";

/**
 * What a launch would execute, without starting it.
 *
 * A Flatpak is started by the CLI that owns it, so the application id goes between
 * `run` and whatever the person opened. That is the only difference between the two
 * forms, and it belongs to the package backend rather than to routing: routing still
 * speaks in one plan shape.
 */
export function launchCommand(
  app: Pick<DiscoveredApp, "executable" | "flatpak">,
  argv: readonly string[],
): { readonly command: string; readonly args: readonly string[] } {
  if (app.flatpak !== undefined) {
    return {
      command: app.executable,
      args: flatpakRunArgs(app.flatpak.application, argv),
    };
  }
  return { command: app.executable, args: [...argv] };
}

/** The variable that tells an app it was started by the hub (D45). */
export const MANAGED_BY_ENV = "SUITE_MANAGED_BY";

export interface LaunchIntentOptions {
  /** Set when Start is the one starting it, so the app can tell it was managed. */
  readonly managed?: boolean;
}

/**
 * A launch as the host seam receives it: a file, an argv and the environment.
 *
 * `launchCommand` still answers "which thing would run"; this adds the one piece of
 * environment a managed launch carries. The sandbox prefix is the seam's job
 * (`flatpak-spawn --host`), so planning a launch and executing one cannot disagree
 * about where it runs.
 */
export function launchIntent(
  app: Pick<DiscoveredApp, "executable" | "flatpak">,
  argv: readonly string[],
  options: LaunchIntentOptions = {},
): HostCommand {
  const { command, args } = launchCommand(app, argv);
  return {
    file: command,
    args,
    ...(options.managed === true ? { env: { [MANAGED_BY_ENV]: "start" } } : {}),
  };
}

/**
 * How Start may close a running app before replacing or removing it.
 *
 * On the host the pid is the app (or the `flatpak` CLI that owns it), so SIGTERM is
 * exactly what the AppImage/Arch build does today. Inside a Flatpak sandbox the pid
 * belongs to `flatpak-spawn`: signalling the helper does not reach the app. There a
 * Flatpak is closed by application id (`flatpak kill`) and an AppImage has to be
 * closed by the person, because nothing may guess at a host-wide `pkill`.
 */
export type StopApproach = "signal" | "flatpak-kill" | "manual";

export function stopApproach(input: {
  readonly sandboxed: boolean;
  readonly flatpak: boolean;
}): StopApproach {
  if (!input.sandboxed) return "signal";
  return input.flatpak ? "flatpak-kill" : "manual";
}
