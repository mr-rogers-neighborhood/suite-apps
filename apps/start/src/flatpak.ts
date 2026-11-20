import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { CONTRACT_VERSION, SUITE_PROTOCOL_PREFIX, type SuiteAppManifest } from "@suite/contracts";
import type { CatalogueEntry } from "./catalogue.js";
import type { DiscoveredApp, DiscoveryResult, FlatpakInstall } from "./registry.js";

/**
 * Flatpak as a second writer, and what Start may say about it.
 *
 * ADR-0001 says one process writes a binary path. Start writes AppImages it
 * installed; Flatpak writes Flatpaks. Start's part is the same either way: it
 * discovers what is installed, launches it, and says where the update comes
 * from. It never writes into a Flatpak install tree, so it never becomes the
 * second writer.
 *
 * The top half is the rules: the shape of `flatpak list --json`, which of those
 * apps are suite apps, and the launch line, so each is a test rather than a
 * subprocess. The bottom half is the three calls that need a process — list,
 * locate, and the resolved binary — kept behind one small surface.
 */

/** The application-id namespace every suite app publishes under. */
export const FLATPAK_APP_PREFIX = "run.suite.";

/** One installed Flatpak application, from `flatpak list --app --json`. */
export interface FlatpakApp {
  /** Reverse-DNS application id, e.g. `run.suite.canvas`. */
  readonly applicationId: string;
  readonly name: string;
  readonly version: string;
  /** The ref branch, usually `stable` or `master`. */
  readonly branch: string;
  /** The remote it came from, e.g. `flathub` or `suite-local`. */
  readonly origin: string;
  /** `user` or `system`; where the deployment lives. */
  readonly installation: string;
  /**
   * The deployed commit, when it was resolved.
   *
   * `flatpak list --json` does not carry it, so discovery asks `flatpak info
   * --show-commit` once per suite app. It is what makes "the store has a
   * different build" a fact rather than a version guess: the remote does not
   * publish the app's version in `remote-info`.
   */
  readonly commit?: string;
}

/** The Flatpak application id a catalogue app publishes under. */
export function flatpakIdFor(appId: string): string {
  return `${FLATPAK_APP_PREFIX}${appId}`;
}

/**
 * Read `flatpak list --app --json`.
 *
 * The command is a port of the C API's field names, not this repository's, so
 * the parser is deliberately forgiving: a row without an application id is not
 * an app, and anything else missing gets an empty string rather than a guessed
 * value. Nothing here decides whether a row belongs to the suite.
 */
export function parseFlatpakList(text: string): readonly FlatpakApp[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  return value.flatMap((row): FlatpakApp[] => {
    if (typeof row !== "object" || row === null) return [];
    const fields = row as Record<string, unknown>;
    const applicationId = fields.application_id;
    if (typeof applicationId !== "string" || applicationId.length === 0) return [];
    const text = (key: string): string =>
      typeof fields[key] === "string" ? (fields[key] as string) : "";
    return [
      {
        applicationId,
        name: text("name"),
        version: text("version"),
        branch: text("branch"),
        origin: text("origin"),
        installation: text("installation"),
      },
    ];
  });
}

/** The Flatpak install of one catalogue app, when this machine has one. */
export function suiteFlatpakFor(
  entry: Pick<CatalogueEntry, "id">,
  apps: readonly FlatpakApp[],
): FlatpakApp | null {
  const wanted = flatpakIdFor(entry.id);
  return apps.find((candidate) => candidate.applicationId === wanted) ?? null;
}

/**
 * The manifest Start shows for a Flatpak install.
 *
 * A Flatpak carries the app's own `suite.app.json` inside its sandbox, where
 * nothing outside can read it without unpacking the deployment. The catalogue
 * already mirrors that manifest for the AppImage path — it is what the install
 * button writes beside a downloaded binary — so the same table supplies the
 * identity here and Flatpak's own deployment metadata supplies the version.
 *
 * `update` is deliberately absent: an app inside a Flatpak cannot replace its
 * own installation, so advertising the AppImage feed would describe an update
 * path that does not exist. Flatpak's remote is the update channel.
 */
export function flatpakManifest(entry: CatalogueEntry, version: string): SuiteAppManifest {
  return {
    format: "suite.app",
    id: entry.id,
    name: entry.name,
    version,
    contractVersion: CONTRACT_VERSION,
    deepLinkPrefix: `${SUITE_PROTOCOL_PREFIX}${entry.id}/`,
    fileExtensions: [...entry.extensions],
    protocols: [],
    capabilities: [...entry.capabilities],
  };
}

/**
 * Add the Flatpak installs discovery did not see.
 *
 * Discovery reads manifests beside executables and requires an install record,
 * which is exactly right for what Start placed and wrong for what Flatpak
 * placed: Flatpak has its own database, its own signatures and its own writer.
 * So a Flatpak becomes a `DiscoveredApp` here, and a copy Start or a person
 * already made wins — two copies of one app share a profile, and the AppImage
 * is the one with a path Start is allowed to replace.
 *
 * `executable` is the `flatpak` CLI itself; `flatpak.application` is what makes
 * `spawnCommand` put `run <id>` in front of the app's own arguments.
 */
export function withFlatpakInstalls(
  result: DiscoveryResult,
  installs: readonly FlatpakApp[],
  catalogue: readonly CatalogueEntry[],
  executable: string,
): DiscoveryResult {
  const apps: DiscoveredApp[] = [...result.apps];

  for (const entry of catalogue) {
    if (apps.some((app) => app.manifest.id === entry.id)) continue;
    const install = suiteFlatpakFor(entry, installs);
    // A deployment with no version cannot answer "what is installed here", and a
    // card that guessed would be worse than a card that says nothing.
    if (install === null || install.version.length === 0) continue;

    apps.push({
      manifest: flatpakManifest(entry, install.version),
      // There is no manifest file on this side of the sandbox. Discovery has
      // already done its work; nothing downstream reads this field.
      manifestPath: "",
      executable,
      installedAt: null,
      flatpak: {
        application: install.applicationId,
        installation: install.installation,
        ...(install.commit === undefined ? {} : { commit: install.commit }),
      },
    });
  }

  return { apps, rejected: result.rejected };
}

/** How Start starts a Flatpak: the CLI, then `run`, then the app's own arguments. */
export function flatpakRunArgs(applicationId: string, argv: readonly string[]): readonly string[] {
  return ["run", applicationId, ...argv];
}

/**
 * The scope flag for one installation.
 *
 * A machine can hold the same app in both installations, and then an unscoped
 * `flatpak uninstall` has to ask a question a window is not open for. Naming
 * the scope the discovery saw avoids the prompt rather than answering it.
 */
export function flatpakScopeArgs(installation: string): readonly string[] {
  if (installation === "user") return ["--user"];
  if (installation === "system") return ["--system"];
  return [];
}

/**
 * The `flatpak` CLI, resolved from `PATH` the way a shell would.
 *
 * `SUITE_START_FLATPAK` names a different binary — a test's stand-in — and an
 * explicit empty value disables Flatpak entirely, which is what a hermetic
 * test needs on a machine that has one installed. Null otherwise; a machine
 * without Flatpak is supported, because the AppImage path does not depend on it.
 */
export function findFlatpak(): string | null {
  const named = process.env.SUITE_START_FLATPAK;
  if (named !== undefined) {
    const trimmed = named.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  const name = process.platform === "win32" ? "flatpak.exe" : "flatpak";
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Run the CLI and collect its output. Rejects on a non-zero exit. */
export function runFlatpak(
  args: readonly string[],
  binary: string = findFlatpak() ?? "flatpak",
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(binary, [...args], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Flatpak's own words are what the card should show; "Command failed" is not.
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolvePromise(stdout);
    });
  });
}

/**
 * What Flatpak has installed, or nothing when it cannot answer.
 *
 * A broken Flatpak must not break the launcher, so a failed listing is an empty
 * list rather than an exception. The caller decides how loudly to say so.
 */
export async function listFlatpaks(): Promise<readonly FlatpakApp[]> {
  if (findFlatpak() === null) return [];
  try {
    return parseFlatpakList(await runFlatpak(["list", "--app", "--json"]));
  } catch {
    return [];
  }
}

/** Where Flatpak deployed one app, for "Reveal". Null when it cannot say. */
export async function flatpakLocation(install: FlatpakInstall): Promise<string | null> {
  try {
    const location = (
      await runFlatpak([
        ...flatpakScopeArgs(install.installation),
        "info",
        "--show-location",
        install.application,
      ])
    ).trim();
    return location.length > 0 ? location : null;
  } catch {
    return null;
  }
}

/**
 * The store this hub installs from.
 *
 * One named remote, because that is the one `scripts/flatpak.mjs` creates and
 * the one a person can inspect with `flatpak remotes`. An empty
 * `SUITE_START_FLATPAK_REMOTE` (or a machine with no Flatpak) means no store.
 */
export const STORE_REMOTE = "suite-local";

export function storeRemote(): string {
  const named = process.env.SUITE_START_FLATPAK_REMOTE?.trim();
  return named === undefined || named.length === 0 ? STORE_REMOTE : named;
}

const COMMIT_HASH = /^[0-9a-f]{64}$/u;

/** Read the one line `--show-commit` prints. */
export function parseCommitOutput(text: string): string | null {
  const first = text.trim().split(/\s+/u)[0] ?? "";
  return COMMIT_HASH.test(first) ? first : null;
}

/** Read the `Version:` line from `flatpak info`. */
export function parseVersionOutput(text: string): string | null {
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim().startsWith("Version:")) continue;
    const value = line.slice(line.indexOf(":") + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/** What the store says it offers for one catalogue app. */
export function storeInfoArgs(remote: string, application: string): readonly string[] {
  return ["remote-info", "--user", "--show-commit", remote, application];
}

/** The commit of the deployment on this machine. */
export function installedCommitArgs(install: FlatpakInstall): readonly string[] {
  return [...flatpakScopeArgs(install.installation), "info", "--show-commit", install.application];
}

/** `flatpak info` for one deployment, which is where the version lives. */
export function installedInfoArgs(install: FlatpakInstall): readonly string[] {
  return [...flatpakScopeArgs(install.installation), "info", install.application];
}

/** Install one app from the store. */
export function storeInstallArgs(remote: string, application: string): readonly string[] {
  return ["install", "--user", "--noninteractive", remote, application];
}

/** Replace the deployment Flatpak already owns. */
export function storeUpdateArgs(install: FlatpakInstall): readonly string[] {
  return [
    ...flatpakScopeArgs(install.installation),
    "update",
    "--noninteractive",
    install.application,
  ];
}
