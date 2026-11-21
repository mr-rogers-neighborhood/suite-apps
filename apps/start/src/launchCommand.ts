import { flatpakRunArgs } from "./flatpak.js";
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
