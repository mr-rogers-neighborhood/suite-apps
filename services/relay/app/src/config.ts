import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SCOPE, isRelayScope, type RelayScope } from "./scope.js";

/**
 * The one choice the app remembers.
 *
 * The reach scope is stored in the app's own config, not beside the relay's store: the store is the
 * relay's data and an operator may point it elsewhere, while "who can reach this machine" is a
 * decision about this app. Inside the Flatpak `XDG_CONFIG_HOME` is the app's private config
 * directory, so this needs no host grant.
 */

export const CONFIG_FORMAT = "suite.sync.relay";

export function relayConfigPath(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
}): string {
  const configHome = (options.env.XDG_CONFIG_HOME ?? "").trim() || join(options.home, ".config");
  return join(configHome, "suite-sync", "relay.json");
}

/**
 * Read the stored scope.
 *
 * A missing file, an unreadable one or a value this build does not know all mean the safe default.
 * A relay that guessed "network" from a corrupt file would widen itself without anybody asking.
 */
export function readScope(path: string): RelayScope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_SCOPE;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SCOPE;
  const scope = (parsed as { scope?: unknown }).scope;
  return isRelayScope(scope) ? scope : DEFAULT_SCOPE;
}

/** Store the choice. The next launch, including `--hidden` from login, starts in this scope. */
export function writeScope(path: string, scope: RelayScope): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ format: CONFIG_FORMAT, scope }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
