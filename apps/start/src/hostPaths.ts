import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { joinPath, suiteApplicationsRoot } from "@suite/contracts";
import { PRE_RELEASE_DOCUMENTS_FOLDER } from "./channels.js";
import type { Host } from "./host.js";
import { REGISTRY_FILENAME } from "./installs.js";

/**
 * Where Start writes on the *host*, whichever form it runs as.
 *
 * A Flatpak re-roots `XDG_CONFIG_HOME` and `XDG_DATA_HOME` into
 * `~/.var/app/<id>`, and that is the right place for Electron's own caches — a
 * sandbox should not scatter profile files across the real home. It is the wrong
 * place for the things Start shares with the rest of the suite: the menu entries
 * a desktop reads, the icons a theme resolves, the install records the published
 * CLI also reads, and `~/Applications/Suite` where the apps actually live. The
 * Flatpak manifest grants those exact host paths, so the table below names them
 * directly and never asks an XDG variable where they are.
 *
 * One table rather than a sandboxed copy and a host copy: the values are the same
 * on both sides, and a second set would be a way for them to drift. `home` is the
 * host home; inside Flatpak `$HOME` stays the host's, which is what lets the
 * granted paths be addressed at all.
 */
export interface HostPaths {
  /** `~/.local/share/applications`: the user's menu entries. */
  readonly applications: string;
  /** `~/.local/share/icons`: the hicolor tree a menu entry's icon lives in. */
  readonly icons: string;
  /** `~/.local/share/suite`: machine-local state shared by the suite. */
  readonly suiteData: string;
  /** `~/.config/suite`: Start's records, shared with the command-line launcher. */
  readonly suiteConfig: string;
  /** `~/Applications/Suite`: where older copies may live and Start still looks. */
  readonly appsRoot: string;
}

export interface HostPathOptions {
  readonly platform: string;
  readonly home: string;
  /** `SUITE_START_APPS_ROOT`, which is how a test installs somewhere throwaway. */
  readonly appsRootOverride?: string | undefined;
}

/**
 * The one table of host-relative paths.
 *
 * Written as parts rather than joined strings so the platform separator is applied
 * once, by `joinPath`, and so a test can read the convention without a filesystem.
 * These are the Linux/XDG names the manifest grants; the suite publishes no other
 * platform's build today.
 */
const TABLE = {
  applications: [".local", "share", "applications"],
  icons: [".local", "share", "icons"],
  suiteData: [".local", "share", "suite"],
  suiteConfig: [".config", "suite"],
  appsRoot: ["Applications", "Suite"],
} as const satisfies Record<keyof HostPaths, readonly string[]>;

export function hostPaths(options: HostPathOptions): HostPaths {
  const { platform, home } = options;
  const under = (parts: readonly string[]): string => joinPath(platform, home, ...parts);
  const appsRootOverride = options.appsRootOverride?.trim();
  return {
    applications: under(TABLE.applications),
    icons: under(TABLE.icons),
    suiteData: under(TABLE.suiteData),
    suiteConfig: under(TABLE.suiteConfig),
    appsRoot:
      appsRootOverride !== undefined && appsRootOverride.length > 0
        ? suiteApplicationsRoot(platform, home, appsRootOverride)
        : under(TABLE.appsRoot),
  };
}

/** The directory Start's own records live in: `<suite config>/start`. */
export function startStateRoot(paths: HostPaths): string {
  return join(paths.suiteConfig, "start");
}

/**
 * The install registry both forms read.
 *
 * Under the suite config rather than Electron's `userData`: the published CLI is
 * not an Electron app and has no `userData`, and a person running it should see
 * the same installs the window shows. `SUITE_START_REGISTRY` still names another
 * file, which is what a test or a portable install needs.
 */
export function registryPathFor(paths: HostPaths, env: NodeJS.ProcessEnv = process.env): string {
  const named = env.SUITE_START_REGISTRY?.trim();
  return named !== undefined && named.length > 0
    ? named
    : join(startStateRoot(paths), REGISTRY_FILENAME);
}

/** The lock that keeps two Start forms from both opening. */
export function hubLockPath(paths: HostPaths): string {
  return join(startStateRoot(paths), "hub.lock");
}

/** The dashboard layout's file name, under Start's own state directory. */
export const DASHBOARD_FILENAME = "dashboard.json";

/**
 * The dashboard layout: this host's, this device's.
 *
 * Beside the install registry rather than in a document folder, because it is the host's
 * own arrangement and no app may read or own it.
 */
export function dashboardPath(paths: HostPaths): string {
  return join(startStateRoot(paths), DASHBOARD_FILENAME);
}

/**
 * The pre-release documents root: `<home>/Documents/Suite Slop`.
 *
 * A sibling of `Documents/Suite`, not a folder inside it, so deleting a channel's
 * data can never reach a stable document.
 */
export function preReleaseDocumentsRoot(home: string): string {
  return join(home, "Documents", PRE_RELEASE_DOCUMENTS_FOLDER);
}

/**
 * Whether a path is really a member of the pre-release documents tree.
 *
 * `resolve` collapses `..` before the comparison, and the trailing separator makes
 * `Suite Slop-other` fail. The root itself is not a member: an uninstall deletes
 * one app's folder, never the shared tree.
 */
export function isInsidePreReleaseTree(home: string, path: string): boolean {
  const root = resolve(preReleaseDocumentsRoot(home));
  const target = resolve(path);
  return target !== root && target.startsWith(`${root}${sep}`);
}

/**
 * Delete one pre-release data folder through the host seam.
 *
 * The Flatpak manifest grants `xdg-documents` read-only, so a sandboxed Start
 * cannot delete its own documents; the host can. The path is resolved and checked
 * against `<home>/Documents/Suite Slop` first, then passed as one argv element:
 * `rm -rf -- <path>`, never a shell string. Returns false when the path is not a
 * member of that tree, in which case nothing is run.
 */
export async function removePreReleaseTree(options: {
  readonly home: string;
  readonly path: string;
  readonly host: Host;
}): Promise<boolean> {
  if (!isInsidePreReleaseTree(options.home, options.path)) return false;
  await options.host.run({
    file: "rm",
    args: ["-rf", "--", resolve(options.path)],
  });
  return true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

export interface RegistryAdoption {
  readonly adopted: boolean;
  readonly source: string;
  readonly destination: string;
}

/**
 * Move the registry a pre-Flatpak Start wrote into the shared config directory.
 *
 * Runs once, and only when the destination is absent: a registry that is already
 * there is newer than the one in `userData` and must not be overwritten. The copy
 * lands through a dot-named temporary file and a rename, so a crash leaves either
 * the old registry or the new one, never half of each.
 */
export async function adoptLegacyRegistry(options: {
  readonly legacy: string;
  readonly next: string;
}): Promise<RegistryAdoption> {
  const { legacy, next } = options;
  const unchanged = { adopted: false, source: legacy, destination: next };
  if (legacy === next) return unchanged;
  if ((await exists(next)) || !(await exists(legacy))) return unchanged;

  await mkdir(dirname(next), { recursive: true });
  const temporary = join(dirname(next), `.${REGISTRY_FILENAME}.adopting`);
  await copyFile(legacy, temporary);
  await rename(temporary, next);
  return { adopted: true, source: legacy, destination: next };
}

export interface HubLock {
  readonly pid: number;
  /** When the holder started, so a reused pid is visible as a different process. */
  readonly startedAt: string;
}

export function parseHubLock(text: string): HubLock | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const pid = (value as { pid?: unknown }).pid;
  const startedAt = (value as { startedAt?: unknown }).startedAt;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof startedAt !== "string" || startedAt.length === 0) return null;
  return { pid, startedAt };
}

export function hubLockText(pid: number, startedAt: string): string {
  return `${JSON.stringify({ pid, startedAt }, null, 2)}\n`;
}

export type HubLockOutcome =
  | { readonly kind: "free" }
  | { readonly kind: "held"; readonly holder: HubLock };

/**
 * Whether this process may take the lock.
 *
 * Electron's own single-instance lock lives in `userData`, which differs between
 * a dev run and a Flatpak install, so the two forms could otherwise both open.
 * A stale pid — the usual case after a crash — is taken over rather than left to
 * block every later launch.
 */
export function claimHubLock(
  existing: string | null,
  pid: number,
  alive: (candidate: number) => boolean,
): HubLockOutcome {
  const holder = existing === null ? null : parseHubLock(existing);
  if (holder !== null && holder.pid !== pid && alive(holder.pid)) {
    return { kind: "held", holder };
  }
  return { kind: "free" };
}

/**
 * Take the cross-form lock, and say whether this process got it.
 *
 * The write is atomic for the same reason the registry's is: a process that dies
 * mid-write must not leave a file the next one reads as a live holder.
 */
export async function takeHubLock(
  path: string,
  pid: number,
  alive: (candidate: number) => boolean,
  startedAt: string = new Date().toISOString(),
): Promise<HubLockOutcome> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    // No lock is the ordinary first launch.
  }
  const outcome = claimHubLock(existing, pid, alive);
  if (outcome.kind === "held") return outcome;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${pid}`;
  await writeFile(temporary, hubLockText(pid, startedAt));
  await rename(temporary, path);
  return outcome;
}

/** Remove the lock only when this process still holds it. */
export async function releaseHubLock(path: string, pid: number): Promise<void> {
  try {
    const holder = parseHubLock(await readFile(path, "utf8"));
    if (holder === null || holder.pid !== pid) return;
    await rm(path, { force: true });
  } catch {
    // A missing lock is already the state this function wants.
  }
}
