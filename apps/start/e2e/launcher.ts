import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from "@playwright/test";

/**
 * The launcher's harness.
 *
 * Start reads files it owns, `installs.json` and `recents.json` in the data
 * directory, and a release catalog the environment points at. A spec writes them
 * and then starts the real application, which is the only way to see what it
 * does with a handoff from the operating system.
 */

export const START_DIR = resolve(fileURLToPath(import.meta.url), "..", "..");

export interface Sandbox {
  readonly root: string;
  readonly data: string;
  /** Where every fake app's directory lives, one per app. */
  readonly apps: string;
  /** A throwaway applications root, so an install never writes into $HOME. */
  readonly installedApps: string;
  /**
   * An empty release-feed root, so no spec can read a published feed.
   *
   * Without it, `feedFor` falls back to the feed compiled into each catalogue
   * entry, and a test that pressed Install would download a real release.
   */
  readonly feeds: string;
  /**
   * A throwaway `$HOME`, so desktop entries, the hub's report and the default
   * documents root belong to this spec rather than to the person running it.
   */
  readonly home: string;
  /**
   * Electron's `userData`, which holds Chromium's profile and the
   * single-instance lock inside it.
   *
   * One per sandbox: two launchers sharing a profile do not run side by side —
   * the second `requestSingleInstanceLock` fails, the process quits, and the
   * spec that was starting it fails with "Target page, context or browser has
   * been closed". That is the whole flake when a gate runs beside another one.
   */
  readonly userData: string;
  dispose(): Promise<void>;
}

export async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "suite-start-e2e-"));
  const data = join(root, "data");
  const apps = join(root, "apps");
  const installedApps = join(root, "installed-apps");
  const feeds = join(root, "feeds");
  const home = join(root, "home");
  const userData = join(root, "user-data");
  await mkdir(data, { recursive: true });
  await mkdir(apps, { recursive: true });
  await mkdir(installedApps, { recursive: true });
  await mkdir(feeds, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(userData, { recursive: true });
  return {
    root,
    data,
    apps,
    installedApps,
    feeds,
    home,
    userData,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * A stand-in app: an executable and the manifest beside it.
 *
 * The executable is a shell script that writes its arguments where the spec can
 * read them, so "Start launched the right thing with the right link" is checked
 * against a file rather than against an assumption.
 */
export async function fakeApp(
  box: Sandbox,
  options: { id?: string; name?: string; extensions?: string[]; version?: string } = {},
): Promise<{ executable: string; manifestPath: string; logPath: string }> {
  const id = options.id ?? "canvas";
  const app = join(box.apps, id);
  await mkdir(app, { recursive: true });
  const executable = join(app, `suite-${id}`);
  const manifestPath = join(app, "suite.app.json");
  const logPath = join(box.root, `${id}-launched.txt`);

  await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > ${logPath}\n`, { mode: 0o755 });
  await writeFile(
    manifestPath,
    JSON.stringify({
      format: "suite.app",
      id,
      name: options.name ?? "Suite Canvas",
      version: options.version ?? "0.1.0",
      contractVersion: "1.0.0",
      deepLinkPrefix: `suite://${id}/`,
      fileExtensions: options.extensions ?? ["canvas"],
      protocols: [`suite-${id}`],
      capabilities: ["document.file"],
    }),
  );
  return { executable, manifestPath, logPath };
}

export async function install(box: Sandbox, record: unknown): Promise<void> {
  await writeFile(join(box.data, "installs.json"), JSON.stringify({ apps: [record] }, null, 2));
}

/**
 * A stand-in `flatpak` CLI, with enough state to test the store.
 *
 * Start asks one binary what is installed, what the remotes and the store offer,
 * where a deployment lives, and to install/update/run one. Files under the
 * sandbox stand in for Flatpak's database, so an install is visible to the next
 * `list` and an update changes the commit the next `info` reports. The remote
 * commands answer the same shapes the real CLI does: one remote name per line
 * for `remotes`, and a JSON array for `remote-ls`.
 */
export async function fakeFlatpak(
  box: Sandbox,
  options: {
    application?: string;
    version?: string;
    name?: string;
    installed?: boolean;
    commit?: string;
    storeCommit?: string;
    /** Add `run.suite.sync` to the same store and listing, installed or not. */
    sync?: { installed?: boolean; version?: string; commit?: string };
  } = {},
): Promise<{ executable: string; logPath: string; location: string }> {
  const application = options.application ?? "run.suite.canvas";
  const version = options.version ?? "0.1.0";
  const commit = options.commit ?? "a".repeat(64);
  const storeCommit = options.storeCommit ?? commit;
  const installed = options.installed ?? true;

  const executable = join(box.apps, "flatpak");
  const logPath = join(box.root, "flatpak-launched.txt");
  const location = join(box.root, "flatpak-deploy");
  const state = join(box.root, "flatpak-state");
  await mkdir(location, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(join(state, "version"), version);
  await writeFile(join(state, "installed-commit"), commit);
  await writeFile(join(state, "store-commit"), storeCommit);
  if (installed) await writeFile(join(state, "installed"), "");

  if (options.sync !== undefined) {
    await writeFile(join(state, "sync-version"), options.sync.version ?? "0.11.3");
    await writeFile(join(state, "sync-commit"), options.sync.commit ?? "b".repeat(64));
    if (options.sync.installed === true) await writeFile(join(state, "sync-installed"), "");
  }

  const appRow = JSON.stringify({
    name: options.name ?? "Suite Canvas",
    application_id: application,
    version: "@VERSION@",
    branch: "master",
    arch: "x86_64",
    origin: "suite-local",
    installation: "user",
  });
  const syncRow = JSON.stringify({
    name: "Suite Sync",
    application_id: "run.suite.sync",
    version: "@VERSION@",
    branch: "master",
    arch: "x86_64",
    origin: "suite-local",
    installation: "user",
  });

  await writeFile(
    executable,
    `#!/bin/sh
STATE="${state}"
LOG="${logPath}"
LOCATION="${location}"
if [ "$1" = "list" ]; then
  printf '['
  SEP=''
  if [ -f "$STATE/installed" ]; then
    printf '%s' "$SEP"
    sed "s/@VERSION@/$(cat "$STATE/version")/" <<'JSON'
${appRow}
JSON
    SEP=','
  fi
  if [ -f "$STATE/sync-installed" ]; then
    printf '%s' "$SEP"
    sed "s/@VERSION@/$(cat "$STATE/sync-version")/" <<'JSON'
${syncRow}
JSON
  fi
  printf ']\\n'
  exit 0
fi
if [ "$1" = "--user" ] || [ "$1" = "--system" ]; then
  shift
fi
# The last argument names the app for install and info.
LAST=''
for ARG in "$@"; do LAST="$ARG"; done
case "$1" in
  remotes)
    # flatpak remotes --user --columns=name: one name per line, no header.
    printf 'suite-local\\nflathub\\n'
    ;;
  remote-ls)
    # flatpak remote-ls --user --app --json --columns=application,branch,commit:
    # a JSON array of the refs this store publishes.
    printf '[{"application_id":"${application}","branch":"master","commit":"%s"}]\\n' "$(cat "$STATE/store-commit")"
    ;;
  remote-info)
    printf '%s\\n' "$(cat "$STATE/store-commit")"
    ;;
  info)
    shift
    case "$1" in
      --show-commit)
        if [ "$LAST" = "run.suite.sync" ]; then
          cat "$STATE/sync-commit"
        else
          cat "$STATE/installed-commit"
        fi
        ;;
      --show-location) printf '%s\\n' "$LOCATION" ;;
      *)
        if [ "$LAST" = "run.suite.sync" ]; then
          printf '\\nSuite Sync\\n\\n            ID: run.suite.sync\\n       Version: %s\\n\\n' "$(cat "$STATE/sync-version")"
        else
          printf '\\nSuite Canvas\\n\\n            ID: ${application}\\n       Version: %s\\n\\n' "$(cat "$STATE/version")"
        fi
        ;;
    esac
    ;;
  install)
    if [ "$LAST" = "run.suite.sync" ]; then
      touch "$STATE/sync-installed"
      printf 'install run.suite.sync\\n' >>"$LOG"
    else
      touch "$STATE/installed"
      cp "$STATE/store-commit" "$STATE/installed-commit"
      printf 'install\\n' >>"$LOG"
    fi
    ;;
  update)
    cp "$STATE/store-commit" "$STATE/installed-commit"
    printf 'update\\n' >>"$LOG"
    ;;
  kill)
    # The sandboxed close path names the application, not a pid.
    shift
    printf 'kill %s\\n' "$1" >>"$LOG"
    ;;
  run)
    shift
    printf '%s\\n' "$@" >"$LOG"
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );

  return { executable, logPath, location };
}

export interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
  close(): Promise<void>;
}

export async function launch(
  box: Sandbox,
  args: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): Promise<Launched> {
  const app = await electron.launch({
    args: [START_DIR, ...args],
    env: {
      ...process.env,
      // The home a person's hub writes into: desktop entries and the documents root
      // Start scans when a spec does not name one. A spec's own `$HOME` keeps those
      // out of the real one, and out of another spec's.
      HOME: box.home,
      // The data root a launch writes into. Pin it inside the sandbox so two runs
      // cannot share one temporary file.
      XDG_DATA_HOME: join(box.home, ".local", "share"),
      // Chromium's profile and the single-instance lock it carries. Without an
      // override every launch — and every other Playwright run on the machine —
      // shares one, and all but the first quit before a window exists.
      SUITE_START_USER_DATA: box.userData,
      SUITE_START_DATA: box.data,
      SUITE_START_VERSION: "0.1.0-e2e",
      // An install must land in the sandbox, never in the real ~/Applications.
      SUITE_START_APPS_ROOT: box.installedApps,
      // No published feed: a spec that wants one supplies its own base.
      SUITE_START_FEED_BASE: box.feeds,
      // Hermetic on a machine that has Flatpak and a real suite app installed:
      // only a spec that supplies a stand-in may see a Flatpak.
      SUITE_START_FLATPAK: "",
      ...env,
    },
    timeout: 45_000,
  });
  const page = await app.firstWindow();
  await expect(page.locator("h1")).toHaveText("Suite", { timeout: 30_000 });
  return {
    app,
    page,
    close: async () => {
      await app.close().catch(() => {});
    },
  };
}

/** The arguments the fake app recorded, or null when it was never started. */
export async function launchedWith(logPath: string): Promise<string[] | null> {
  try {
    return (await readFile(logPath, "utf8")).split("\n").filter((line) => line !== "");
  } catch {
    return null;
  }
}
