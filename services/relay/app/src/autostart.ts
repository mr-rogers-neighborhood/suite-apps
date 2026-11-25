import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Starting the relay when the person logs in.
 *
 * Two mechanisms could do this. The Background portal (`org.freedesktop.portal.Background`)
 * would ask the session to remember the app, but it needs a D-Bus client and a desktop that
 * implements the portal, and it cannot be exercised without a session. The XDG autostart file
 * is a text file whose meaning every desktop already agrees on, so this app writes that file
 * itself and the manifest grants exactly the one host directory it lands in:
 *
 *     --filesystem=xdg-config/autostart:create
 *
 * Flatpak redirects `xdg-config` into the app's own directory, with subdirectories named in a
 * grant kept where the host keeps them. So the file is written at `~/.config/autostart` inside
 * the sandbox and the session that reads it is the host's, which is the point: the entry it
 * executes is `flatpak run run.suite.sync --hidden`, a command that exists on the host.
 */

export const AUTOSTART_APP_ID = "run.suite.sync";

export interface AutostartLocation {
  readonly dir: string;
  readonly file: string;
  /** Whether this process is the Flatpak, whose config dir is redirected. */
  readonly sandboxed: boolean;
}

/**
 * Where the entry goes.
 *
 * Inside the Flatpak, `XDG_CONFIG_HOME` is the app's private config directory, and writing
 * there would produce a file no session reads. The granted path is the host's `~/.config`,
 * which the sandbox still sees at `~/.config`, so that is what this uses. Outside a Flatpak
 * the ordinary XDG variable decides.
 */
export function autostartLocation(options: {
  readonly appId: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}): AutostartLocation {
  const sandboxed = (options.env.FLATPAK_ID ?? "").trim().length > 0;
  const configHome = sandboxed
    ? join(options.home, ".config")
    : (options.env.XDG_CONFIG_HOME ?? "").trim() || join(options.home, ".config");
  const dir = join(configHome, "autostart");
  return { dir, file: join(dir, `${options.appId}.desktop`), sandboxed };
}

/**
 * One Exec value, with each argument quoted only when it needs to be.
 *
 * The entry is read by the session, not by a shell, but a path with a space is still two
 * arguments unless it is quoted; the desktop-entry specification's quoting is the one a
 * session understands.
 */
export function execValue(parts: readonly string[]): string {
  return parts
    .map((part) =>
      /[\s"'\\$`]/u.test(part) ? `"${part.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : part,
    )
    .join(" ");
}

export interface AutostartEntryOptions {
  readonly name: string;
  readonly comment: string;
  readonly exec: string;
}

export function autostartEntry(options: AutostartEntryOptions): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${options.name}`,
    `Comment=${options.comment}`,
    `Exec=${options.exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/**
 * The command a login session should run.
 *
 * The session, not the sandbox, runs the line. Inside the Flatpak `flatpak run` is the
 * command that exists; a checkout points at the Electron binary it is already using.
 */
export function autostartExecLine(options: {
  readonly appId: string;
  readonly env: NodeJS.ProcessEnv;
  readonly execPath: string;
  readonly appRoot: string;
}): string {
  const sandboxed = (options.env.FLATPAK_ID ?? "").trim().length > 0;
  return sandboxed
    ? execValue(["flatpak", "run", options.appId, "--hidden"])
    : execValue([options.execPath, options.appRoot, "--hidden"]);
}

/** The whole entry, built from the environment that will execute it. */
export function autostartEntryFor(options: {
  readonly appId: string;
  readonly name: string;
  readonly comment: string;
  readonly env: NodeJS.ProcessEnv;
  readonly execPath: string;
  readonly appRoot: string;
}): string {
  return autostartEntry({
    name: options.name,
    comment: options.comment,
    exec: autostartExecLine(options),
  });
}

export function autostartEnabled(location: AutostartLocation): boolean {
  return existsSync(location.file);
}

/** Write the entry. Returns what was written, so a caller can report the path. */
export function enableAutostart(location: AutostartLocation, contents: string): string {
  mkdirSync(location.dir, { recursive: true });
  writeFileSync(location.file, contents, { encoding: "utf8", mode: 0o644 });
  return location.file;
}

/** Remove the entry. A file that was not there is already the state asked for. */
export function disableAutostart(location: AutostartLocation): boolean {
  if (!existsSync(location.file)) return false;
  rmSync(location.file, { force: true });
  return true;
}

export interface AutostartCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `suite-sync autostart on|off|status`, the same file the window's checkbox writes.
 *
 * This exists so the mechanism can be exercised in the packaged app without a desktop
 * session: `flatpak run --command=suite-sync run.suite.sync autostart on` writes the entry
 * the desktop will read, and `status` proves where it went.
 */
export function autostartCommand(options: {
  readonly argv: readonly string[];
  readonly location: AutostartLocation;
  readonly entry: () => string;
}): AutostartCommandResult {
  const [action] = options.argv;
  if (action === "status") {
    return {
      code: 0,
      stdout: `${autostartEnabled(options.location) ? "on" : "off"}\n${options.location.file}\n`,
      stderr: "",
    };
  }
  if (action === "on") {
    const file = enableAutostart(options.location, options.entry());
    return { code: 0, stdout: `wrote ${file}\n`, stderr: "" };
  }
  if (action === "off") {
    const removed = disableAutostart(options.location);
    return {
      code: 0,
      stdout: `${removed ? "removed" : "not there"} ${options.location.file}\n`,
      stderr: "",
    };
  }
  return {
    code: 2,
    stdout: "",
    stderr: "usage: suite-sync autostart <on|off|status>\n",
  };
}
