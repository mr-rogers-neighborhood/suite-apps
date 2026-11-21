import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Where a process runs, and how a packaged Start reaches it.
 *
 * A dev run is the host: `execFile` and `spawn` do what they say. A Start packaged
 * as a Flatpak is not the host. Its sandbox has no `flatpak` binary, and the
 * manifest grants one door out: `--talk-name=org.freedesktop.Flatpak`, which
 * `flatpak-spawn --host` uses. So every process Start starts goes through this
 * seam rather than through `child_process` directly, and the difference between
 * the two forms is one argv prefix rather than a second implementation of the
 * backend.
 *
 * Nothing here builds a shell string. A command is a file and an argument list,
 * and a sandboxed one adds `--host` and one `--env=KEY=VALUE` per variable. A
 * document name, an app id or a path that arrives from outside stays one argv
 * element, which is the whole reason `execFile`/`spawn` are used rather than a
 * shell.
 */

/** The variable Flatpak sets inside every sandbox it starts. */
export const FLATPAK_ID_ENV = "FLATPAK_ID";

/** The host binary Flatpak provides inside the sandbox for exactly this. */
export const FLATPAK_SPAWN = "flatpak-spawn";

/** The id Flatpak gives this hub, and the one its self-update names. */
export const SELF_FLATPAK_ID = "run.suite.start";

/** The sandbox's own application id, or null on the host. */
export function sandboxId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env[FLATPAK_ID_ENV]?.trim();
  return id === undefined || id.length === 0 ? null : id;
}

/** Whether this process is inside a Flatpak sandbox. */
export function isSandboxed(env: NodeJS.ProcessEnv = process.env): boolean {
  return sandboxId(env) !== null;
}

/** One command, before the host has decided how to reach it. */
export interface HostCommand {
  readonly file: string;
  readonly args: readonly string[];
  /** Extra environment for the process. The host's own is inherited. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface HostRunOptions {
  /** How much captured output to hold. Flatpak's listings are small; keep a ceiling. */
  readonly maxBuffer?: number;
  readonly cwd?: string;
}

/**
 * A launched child, reduced to what a launch observer needs.
 *
 * Deliberately not a `ChildProcess`: the sandboxed form runs `flatpak-spawn`,
 * whose pid is the relay's rather than the app's, and a fake child in a test must
 * be able to answer the same three questions without a process at all.
 */
export interface HostChild {
  readonly pid: number | null;
  /** UTF-8 stderr as it arrives. Used only for the first moment of a launch. */
  onStderr(listener: (chunk: string) => void): void;
  /** The child is gone. Called once, whatever the code. */
  onExit(listener: (code: number | null) => void): void;
  /** Stop listening and let Start exit without waiting for this child. */
  release(): void;
}

export interface Host {
  readonly sandboxed: boolean;
  /** The argv this host would run. For a dry run, and for the sandbox prefix. */
  plan(command: HostCommand): HostCommand;
  /** Run to completion and collect stdout. Rejects on a non-zero exit. */
  run(command: HostCommand, options?: HostRunOptions): Promise<string>;
  /** Start detached, keep stderr, and let go. */
  spawn(command: HostCommand): HostChild;
  /**
   * Whether a command exists here, memoised for the life of this seam.
   *
   * The answer cannot change while Start runs, and the flatpak probe runs on every
   * listing otherwise. A named path (`SUITE_START_FLATPAK`) bypasses this.
   */
  which(name: string): Promise<string | null>;
}

/** The argv `flatpak-spawn` needs: the host flag, then each variable one element. */
export function flatpakSpawnArgs(
  file: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): readonly string[] {
  return [
    "--host",
    ...Object.entries(env).map(([key, value]) => `--env=${key}=${value}`),
    file,
    ...args,
  ];
}

function hostChild(child: ReturnType<typeof spawn>): HostChild {
  return {
    pid: child.pid ?? null,
    onStderr(listener) {
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => listener(chunk));
    },
    onExit(listener) {
      child.once("exit", (code) => listener(code));
    },
    release() {
      child.stderr?.removeAllListeners("data");
      child.stderr?.destroy();
      child.unref();
    },
  };
}

function searchPath(name: string): string | null {
  const wanted = process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, wanted);
    if (existsSync(candidate)) return candidate;
  }
  // A name that is already a path is used as one, which is what an explicit
  // `SUITE_START_FLATPAK` points at.
  return wantsPath(name) && existsSync(name) ? name : null;
}

function wantsPath(name: string): boolean {
  return name.includes("/") || name.includes("\\");
}

/** The host itself: no wrapper, no prefix, exactly the argv it was handed. */
function directHost(): Host {
  const probes = new Map<string, string | null>();
  return {
    sandboxed: false,
    plan: (command) => command,
    run({ file, args, env }, options = {}) {
      return new Promise((resolvePromise, reject) => {
        execFile(
          file,
          [...args],
          {
            maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            env: env === undefined ? process.env : { ...process.env, ...env },
          },
          (error, stdout, stderr) => {
            // A tool's own words are what a card should show; "Command failed" is not.
            if (error) reject(new Error(stderr.trim() || error.message));
            else resolvePromise(stdout);
          },
        );
      });
    },
    spawn({ file, args, env }) {
      const child = spawn(file, [...args], {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: env === undefined ? process.env : { ...process.env, ...env },
      });
      return hostChild(child);
    },
    async which(name) {
      if (probes.has(name)) return probes.get(name) ?? null;
      const found = searchPath(name);
      probes.set(name, found);
      return found;
    },
  };
}

/**
 * Flatpak's sandbox, which reaches the host through `flatpak-spawn --host`.
 *
 * A probe is a real invocation (`<name> --version`) rather than a walk of the
 * sandbox's PATH, because the command that matters — `flatpak` — is not in the
 * sandbox at all. It is on the host, behind the one D-Bus name the manifest grants.
 */
function sandboxedHost(): Host {
  const direct = directHost();
  const probes = new Map<string, string | null>();
  const wrap = (command: HostCommand): HostCommand => ({
    file: FLATPAK_SPAWN,
    args: flatpakSpawnArgs(command.file, command.args, command.env ?? {}),
  });

  return {
    sandboxed: true,
    plan: wrap,
    run: (command, options) => direct.run(wrap(command), options),
    spawn: (command) => direct.spawn(wrap(command)),
    async which(name) {
      if (probes.has(name)) return probes.get(name) ?? null;
      let found: string | null = null;
      try {
        await direct.run(
          { file: FLATPAK_SPAWN, args: ["--host", name, "--version"] },
          { maxBuffer: 64 * 1024 },
        );
        // The host resolves the name again when the command actually runs, so the
        // probe's answer is the name, not a path this sandbox could hand back.
        found = name;
      } catch {
        found = null;
      }
      probes.set(name, found);
      return found;
    },
  };
}

export function hostFor(sandboxed: boolean): Host {
  return sandboxed ? sandboxedHost() : directHost();
}

/** The host this build runs on, decided once from the sandbox id. */
export function defaultHost(): Host {
  return hostFor(isSandboxed());
}

export type HostToolRunner = (file: string, args: readonly string[]) => Promise<void>;

/**
 * A cache-refresh tool, where a machine without it is not an error.
 *
 * `update-desktop-database` and `gtk-update-icon-cache` are conveniences: a
 * freshly written file is still found on the next scan. Both are absent on many
 * machines, so a missing command is logged once and then ignored rather than
 * repeated for every icon Start writes.
 */
export function toolRunner(
  host: Host,
  warn: (message: string) => void = console.warn,
): HostToolRunner {
  const reported = new Set<string>();
  return async (file, args) => {
    try {
      await host.run({ file, args });
    } catch (error) {
      if (reported.has(file)) return;
      reported.add(file);
      const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "";
      warn(`[host] ${file} is not available; its cache was not refreshed${detail}`);
    }
  };
}
