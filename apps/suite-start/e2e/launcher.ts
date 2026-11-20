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

export const START_DIR = resolve(fileURLToPath(import.meta.url), "..", "..", "apps", "start");

export interface Sandbox {
  readonly root: string;
  readonly data: string;
  /** Where every fake app's directory lives, one per app. */
  readonly apps: string;
  dispose(): Promise<void>;
}

export async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "suite-start-e2e-"));
  const data = join(root, "data");
  const apps = join(root, "apps");
  await mkdir(data, { recursive: true });
  await mkdir(apps, { recursive: true });
  return { root, data, apps, dispose: () => rm(root, { recursive: true, force: true }) };
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
  options: { id?: string; name?: string; extensions?: string[] } = {},
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
      version: "0.1.0",
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
 * A stand-in `flatpak` CLI.
 *
 * Start asks one binary three questions — what is installed, where a deployment
 * lives, and to run one — so the script answers exactly those and writes the
 * `run` arguments where a spec can read them.
 */
export async function fakeFlatpak(
  box: Sandbox,
  options: { application?: string; version?: string; name?: string } = {},
): Promise<{ executable: string; logPath: string; location: string }> {
  const executable = join(box.apps, "flatpak");
  const logPath = join(box.root, "flatpak-launched.txt");
  const location = join(box.root, "flatpak-deploy");
  await mkdir(location, { recursive: true });
  const listing = JSON.stringify([
    {
      name: options.name ?? "Suite Canvas",
      application_id: options.application ?? "run.suite.canvas",
      version: options.version ?? "0.1.0",
      branch: "master",
      arch: "x86_64",
      origin: "suite-local",
      installation: "user",
    },
  ]);

  await writeFile(
    executable,
    `#!/bin/sh
if [ "$1" = "list" ]; then
  cat <<'JSON'
${listing}
JSON
  exit 0
fi
if [ "$1" = "--user" ] || [ "$1" = "--system" ]; then
  shift
fi
if [ "$1" = "run" ]; then
  shift
  printf '%s\\n' "$@" > "${logPath}"
  exit 0
fi
if [ "$1" = "info" ]; then
  printf '%s\\n' "${location}"
  exit 0
fi
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
      SUITE_START_DATA: box.data,
      SUITE_START_VERSION: "0.1.0-e2e",
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
