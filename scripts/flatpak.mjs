#!/usr/bin/env node
/**
 * Build a Suite app for Flatpak and publish it to the local OSTree repository.
 *
 * Flatpak is a second way to install the same build, not a second build. The
 * manifest packages what `package:dir` produced, so the binary under test is
 * the one the other artifact forms carry.
 *
 *   node scripts/flatpak.mjs                 # Canvas stable: package, build, install
 *   node scripts/flatpak.mjs --app planner   # Planner stable, same path
 *   node scripts/flatpak.mjs --app budget    # Budget stable, same path
 *   node scripts/flatpak.mjs --app start     # Start (the hub) stable, same path
 *   node scripts/flatpak.mjs --app help      # Help stable, same path
 *   node scripts/flatpak.mjs --app sync      # Sync (the tray relay) stable, same path
 *   node scripts/flatpak.mjs --app shell     # Suite Shell (the host) stable, same path
 *   node scripts/flatpak.mjs --no-build      # reuse the unpacked build
 *   node scripts/flatpak.mjs --app shell --channel slop
 *                                            # pre-release id on the slop branch
 *   node scripts/flatpak.mjs --app shell --channel nightly
 *                                            # the host pre-release id on nightly
 *   node scripts/flatpak.mjs --app shell --channel nightly --dry-run
 *                                            # write the generated files and print
 *                                            # the identity; no build or install
 *   node scripts/flatpak.mjs --app planner --channel slop --session
 *                                            # the factory's local session build of
 *                                            # a frozen legacy app; never published
 *
 * The repository lives outside the checkout, at ~/suite-flatpak/repo, and is
 * added as the user remote `suite-local`. When scripts/store-key.sh has made a
 * key, the repo summary is signed and the remote verifies it; without a key the
 * remote is added with --no-gpg-verify for local testing only.
 *
 * A pre-release is generated from the stable manifest beside it: the id is
 * `run.suite.slop.<app>`, the branch is the channel, the display name names the
 * channel, and the desktop entry registers no MIME type and no scheme handler.
 * Other apps keep the `suite.app.json` pre-release manifest; the Shell has no
 * such file, so it rewrites its stable manifest to the pre-release id instead
 * and lets the pre-release Flatpak sandbox keep its data apart from stable.
 * The stable flow reads the committed manifest and is otherwise unchanged.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  branchFor,
  channelProblem,
  channelProblemForApp,
  desktopEntry,
  displayName,
  flatpakId,
  isPreRelease,
  launcherScript,
  preReleaseAppManifest,
  preReleaseMetainfo,
  channelRecord,
} from "./lib/channel.mjs";
import { shellDataRoot, shellPreReleaseManifest } from "./lib/shellChannel.mjs";
import { STATIC_DELTA_ARGUMENTS } from "./lib/flatpakRemote.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const APPS = {
  canvas: {
    id: "run.suite.canvas",
    name: "Suite Canvas",
    package: "@suite/canvas-desktop",
    project: join(ROOT, "apps", "canvas", "desktop"),
    folder: "canvas",
    binary: "suite-canvas",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.canvas.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.canvas.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.canvas.metainfo.xml"),
    unpacked: join(ROOT, "apps", "canvas", "desktop", "release", "linux-unpacked"),
  },
  planner: {
    id: "run.suite.planner",
    name: "Suite Planner",
    package: "@suite/planner",
    project: join(ROOT, "apps", "planner"),
    folder: "planner",
    binary: "suite-planner",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.planner.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.planner.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.planner.metainfo.xml"),
    unpacked: join(ROOT, "apps", "planner", "release", "linux-unpacked"),
  },
  budget: {
    id: "run.suite.budget",
    name: "Suite Budget",
    package: "@suite/budget",
    project: join(ROOT, "apps", "budget"),
    folder: "budget",
    binary: "suite-budget",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.budget.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.budget.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.budget.metainfo.xml"),
    unpacked: join(ROOT, "apps", "budget", "release", "linux-unpacked"),
  },
  help: {
    id: "run.suite.help",
    name: "Suite Help",
    package: "@suite/help",
    project: join(ROOT, "apps", "help"),
    folder: "help",
    binary: "suite-help",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.help.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.help.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.help.metainfo.xml"),
    unpacked: join(ROOT, "apps", "help", "release", "linux-unpacked"),
  },
  start: {
    id: "run.suite.start",
    name: "Suite Start",
    package: "@suite/start",
    project: join(ROOT, "apps", "start"),
    folder: "start",
    binary: "suite-start",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.start.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.start.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.start.metainfo.xml"),
    unpacked: join(ROOT, "apps", "start", "release", "linux-unpacked"),
  },
  shell: {
    id: "run.suite.shell",
    name: "Suite Shell",
    package: "@suite/shell",
    project: join(ROOT, "apps", "shell"),
    folder: "shell",
    binary: "suite",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.shell.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.shell.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.shell.metainfo.xml"),
    unpacked: join(ROOT, "apps", "shell", "release", "linux-unpacked"),
  },
  sync: {
    id: "run.suite.sync",
    name: "Suite Sync",
    package: "@suite/sync-app",
    project: join(ROOT, "apps", "sync", "app"),
    folder: "sync",
    binary: "suite-sync",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.sync.yml"),
    desktop: join(ROOT, "packaging", "flatpak", "run.suite.sync.desktop"),
    metainfo: join(ROOT, "packaging", "flatpak", "run.suite.sync.metainfo.xml"),
    // Outside apps/sync: the app depends on @suite/sync-server, whose package root that is, so
    // an output inside it would be copied into the app as a dependency.
    unpacked: join(ROOT, ".artifacts", "sync-app", "linux-unpacked"),
    verify: join(ROOT, "apps", "sync", "app", "scripts", "check-package.mjs"),
  },
};

function argumentValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    process.stderr.write(`${flag} needs a value\n`);
    process.exit(2);
  }
  return value;
}

const argv = process.argv.slice(2);
const appName = argumentValue(argv, "--app") ?? "canvas";
const channel = argumentValue(argv, "--channel") ?? "stable";
const build = !argv.includes("--no-build");
const install = !argv.includes("--no-install");
// The factory's slop build is a session channel, not a release: it may build a
// frozen legacy app, but it builds into the local repository and is never
// published. Naming the flag keeps that exception explicit.
const session = argv.includes("--session");

const channelMiss = channelProblem(channel);
if (channelMiss !== null) {
  process.stderr.write(`${channelMiss}\n`);
  process.exit(2);
}

const frozenMiss = channelProblemForApp(appName, channel, { session });
if (frozenMiss !== null) {
  process.stderr.write(`${frozenMiss}\n`);
  process.exit(1);
}

const app = APPS[appName];
if (!app) {
  process.stderr.write(`unknown app ${appName}; known: ${Object.keys(APPS).join(", ")}\n`);
  process.exit(2);
}

if (session && isPreRelease(channel)) {
  process.stdout.write(
    `${appName}: session build on ${channel}; it is local and is never published.\n`,
  );
}

// Start ships no suite.app.json, so it has no pre-release app identity to
// generate. Refuse before a package build or a manifest is written. Sync is the
// same: it is a server that happens to have a tray, and a channel would be a
// second mailbox on the same data. The Shell does have a channel: it rewrites
// its own manifest rather than reading suite.app.json, so it is not listed here.
const noPreRelease = { start: "Suite Start", sync: "Suite Sync" };
if (Object.hasOwn(noPreRelease, appName) && isPreRelease(channel)) {
  process.stderr.write(
    `${noPreRelease[appName]} has no pre-release identity: it ships no suite.app.json\n`,
  );
  process.exit(1);
}

const id = flatpakId(appName, channel);
const branch = branchFor(channel);
const preRelease = isPreRelease(channel);
const name = displayName(app.name, channel);
const dryRun = argv.includes("--dry-run");
const stateDir = join(homedir(), "suite-flatpak");
const repo = process.env.SUITE_FLATPAK_REPO ?? join(stateDir, "repo");
const buildDir = join(ROOT, "packaging", "flatpak", ".build", id);
const sourceDir = join(ROOT, "packaging", "flatpak", ".build", `${id}-sources`);

// The store's signing key, when one has been made. The fingerprint is not a
// secret; the private key stays in ~/.gnupg and never enters the repository.
const keyIdPath = join(stateDir, "store-key.id");
const publicKeyPath = join(stateDir, "suite-store.gpg");
const keyId =
  process.env.SUITE_STORE_KEY_ID?.trim() ||
  (existsSync(keyIdPath) ? readFileSync(keyIdPath, "utf8").trim() : "");

// A dry run previews the identity and writes the generated pre-release files,
// but never packages, builds, touches the signing key or installs. Exit before
// the key check so a preview works on a machine with no key and no
// flatpak-builder.
if (dryRun) {
  if (!existsSync(app.manifest)) {
    process.stderr.write(`missing ${app.manifest}; Flatpak needs the stable manifest\n`);
    process.exit(1);
  }
  const manifestPath = preRelease ? generatePreReleaseManifest() : app.manifest;
  process.stdout.write(`${name} · ${id}${preRelease ? ` on branch ${branch}` : " (stable)"}\n`);
  process.stdout.write(`manifest · ${manifestPath}\n`);
  if (preRelease) {
    process.stdout.write(`desktop · ${join(sourceDir, `${id}.desktop`)}\n`);
    process.stdout.write(`metainfo · ${join(sourceDir, `${id}.metainfo.xml`)}\n`);
    process.stdout.write(`launcher · ${join(sourceDir, id)}\n`);
  }
  // The Shell has no shared Documents folder; its data is the sandbox keyed by
  // the id, and the pre-release id is what keeps stable and pre-release apart.
  if (appName === "shell") process.stdout.write(`data · ${shellDataRoot(channel)}\n`);
  process.stdout.write("dry run: no build, no repository write, no install\n");
  process.exit(0);
}

/**
 * A fingerprint whose key is gone fails deep inside flatpak-builder with a GPG
 * message, after the build. Name it here instead, and say what to run.
 */
if (keyId.length > 0) {
  const listed = spawnSync("gpg", ["--batch", "--list-keys", keyId], { stdio: "ignore" });
  if (listed.error) {
    process.stderr.write(`gpg is not installed, so the store key ${keyId} cannot be used\n`);
    process.exit(1);
  }
  if (listed.status !== 0) {
    process.stderr.write(
      `store key ${keyId} is not in the keyring. Run scripts/store-key.sh to make one,\n` +
        "or unset SUITE_STORE_KEY_ID to publish an unsigned repository.\n",
    );
    process.exit(1);
  }

  // Keep the public key beside the fingerprint in step with the keyring, so the
  // remote always imports the key the summary was signed with.
  mkdirSync(stateDir, { recursive: true });
  const exported = spawnSync("gpg", ["--batch", "--export", keyId]);
  if (exported.status !== 0 || exported.stdout.length === 0) {
    process.stderr.write(`could not export the public half of ${keyId}\n`);
    process.exit(1);
  }
  writeFileSync(publicKeyPath, exported.stdout);
}

// Orca (and similar launchers) point XDG_DATA_HOME at a per-session directory,
// and a user Flatpak installed there exists only inside that session. The app
// belongs in the user's real data directory so the desktop sees it.
const dataHome = process.env.SUITE_FLATPAK_XDG_DATA_HOME ?? join(homedir(), ".local", "share");
const sessionDataHome = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = dataHome;

function run(command, args, cwd = ROOT) {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function probe(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : null;
}

/** Read one `Key=value` line from a desktop entry. */
function desktopField(text, key) {
  const match = new RegExp(`^${key}=(.*)$`, "mu").exec(text);
  return match?.[1]?.trim() ?? "";
}

/**
 * Write the Shell pre-release files and its rewritten manifest.
 *
 * The desktop entry, metainfo, launcher and icon names all carry the
 * pre-release id. The icons are the stable PNGs copied under the new name, so
 * the rewritten manifest's install lines find them without a second icon
 * source. The stable manifest's build steps, asar desktop-name patch and
 * narrow grants are preserved by `shellPreReleaseManifest`.
 */
function generateShellPreReleaseManifest() {
  mkdirSync(sourceDir, { recursive: true });

  const stableDesktop = readFileSync(app.desktop, "utf8");
  const desktop = desktopEntry({
    id,
    name,
    comment: desktopField(stableDesktop, "Comment"),
    categories: desktopField(stableDesktop, "Categories") || "Utility;",
    startupClass: id,
  });
  writeFileSync(join(sourceDir, `${id}.desktop`), desktop);

  // The stable metainfo names the stable icon next to the id and launchable the
  // shared helper already rewrites. Point the icon at the pre-release id too.
  const metainfo = preReleaseMetainfo(readFileSync(app.metainfo, "utf8"), {
    stableId: app.id,
    id,
    name,
  }).replace(
    `<icon type="stock">${app.id}</icon>`,
    `<icon type="stock">${id}</icon>`,
  );
  writeFileSync(join(sourceDir, `${id}.metainfo.xml`), metainfo);

  writeFileSync(
    join(sourceDir, id),
    launcherScript({ id, folder: app.folder, binary: app.binary }),
    { mode: 0o755 },
  );

  const icons = join(sourceDir, "icons");
  mkdirSync(icons, { recursive: true });
  for (const size of [48, 64, 128, 256, 512]) {
    copyFileSync(
      join(ROOT, "packaging", "flatpak", "icons", `${app.id}-${size}.png`),
      join(icons, `${id}-${size}.png`),
    );
  }

  const manifest = shellPreReleaseManifest(readFileSync(app.manifest, "utf8"), {
    id,
    channel,
    stableId: app.id,
    unpacked: app.unpacked,
  });
  const manifestPath = join(sourceDir, `${id}.yml`);
  writeFileSync(manifestPath, manifest);
  return manifestPath;
}

/**
 * Write the pre-release manifest and the files it packages.
 *
 * The stable manifest supplies the runtime, finish arguments and module shape;
 * only the identity, branch, desktop entry, channels and the tier documents
 * folder differ. Keeping the grants in one place means a permission decided for
 * stable is not silently different for a tier.
 *
 * Shell takes the other branch: it ships no suite.app.json, and its data is the
 * Flatpak sandbox rather than a Documents folder, so the generated manifest is
 * the stable Shell manifest rewritten to the pre-release id.
 */
function generatePreReleaseManifest() {
  if (appName === "shell") return generateShellPreReleaseManifest();

  const stableManifest = readFileSync(app.manifest, "utf8");
  const finishStart = stableManifest.indexOf("finish-args:");
  const modulesStart = stableManifest.indexOf("modules:");
  if (finishStart < 0 || modulesStart < finishStart) {
    throw new Error(`${app.manifest} has no finish-args or modules block to reuse`);
  }

  mkdirSync(sourceDir, { recursive: true });

  const header = stableManifest
    .slice(0, finishStart)
    .replace(/^app-id:.*$/mu, `app-id: ${id}`)
    .replace(/^command:.*$/mu, `command: ${id}`);
  const finishArgs = stableManifest.slice(finishStart, modulesStart).trimEnd();
  // A tier may read a stable document to copy it into its own tree, but stable
  // documents are never its to write. Its own writes go to the sibling
  // `Documents/Suite Slop/<App>`, which the first run makes.
  const tierLines = finishArgs.split("\n");
  const stableDocumentsGrant = "--filesystem=xdg-documents/Suite:create";
  const stableGrantIndex = tierLines.findLastIndex(
    (line) => line.trim() === `- ${stableDocumentsGrant}`,
  );
  if (stableGrantIndex >= 0) {
    // Drop the stable grant with the comment that explains its `:create`; the
    // tier keeps read access, not write access.
    let commentStart = stableGrantIndex;
    while (commentStart > 0 && tierLines[commentStart - 1].trimStart().startsWith("#")) {
      commentStart--;
    }
    tierLines.splice(
      commentStart,
      stableGrantIndex - commentStart + 1,
      "  # A tier may read a stable document to copy it, but never write it.",
      "  - --filesystem=xdg-documents/Suite:ro",
    );
  }
  tierLines.push(
    "  # A tier writes beside stable, never into it.",
    "  - --filesystem=xdg-documents/Suite Slop:create",
  );
  const tierFinishArgs = tierLines.join("\n");

  const stableDesktop = readFileSync(app.desktop, "utf8");
  const desktop = desktopEntry({
    id,
    name,
    comment: desktopField(stableDesktop, "Comment"),
    categories: desktopField(stableDesktop, "Categories") || "Office;",
    startupClass: id,
  });
  writeFileSync(join(sourceDir, `${id}.desktop`), desktop);

  const metainfo = preReleaseMetainfo(readFileSync(app.metainfo, "utf8"), {
    stableId: app.id,
    id,
    name,
  });
  writeFileSync(join(sourceDir, `${id}.metainfo.xml`), metainfo);

  writeFileSync(
    join(sourceDir, id),
    launcherScript({ id, folder: app.folder, binary: app.binary }),
    { mode: 0o755 },
  );

  const baseManifest = JSON.parse(readFileSync(join(app.project, "suite.app.json"), "utf8"));
  const appManifest = preReleaseAppManifest(baseManifest, channel);
  writeFileSync(join(sourceDir, "suite.app.json"), `${JSON.stringify(appManifest, null, 2)}\n`);
  writeFileSync(
    join(sourceDir, "suite.channel.json"),
    `${JSON.stringify(channelRecord({ app: appName, channel }), null, 2)}\n`,
  );

  const icons = [48, 64, 128, 256, 512]
    .map(
      (size) =>
        `      - install -Dm644 icons/${app.id}-${size}.png ` +
        `/app/share/icons/hicolor/${size}x${size}/apps/${id}.png`,
    )
    .join("\n");

  const manifest = [
    `# Generated by scripts/flatpak.mjs --channel ${channel}.`,
    "# The stable manifest is the source of the runtime and sandbox permissions.",
    "# The tier documents folder is the one grant this file adds.",
    header.trimEnd(),
    "",
    tierFinishArgs,
    "",
    "modules:",
    `  - name: suite-${appName}-${channel}`,
    "    buildsystem: simple",
    "    build-commands:",
    `      - mkdir -p /app/${app.folder}`,
    `      - cp -a app/. /app/${app.folder}/`,
    `      - install -Dm644 suite.app.json /app/${app.folder}/suite.app.json`,
    `      - install -Dm644 suite.channel.json /app/${app.folder}/suite.channel.json`,
    `      - install -Dm755 ${id} /app/bin/${id}`,
    `      - install -Dm644 ${id}.desktop /app/share/applications/${id}.desktop`,
    `      - install -Dm644 ${id}.metainfo.xml /app/share/metainfo/${id}.metainfo.xml`,
    icons,
    "    sources:",
    "      - type: dir",
    `        path: ${app.unpacked}`,
    "        dest: app",
    "      - type: file",
    `        path: ${join(sourceDir, id)}`,
    "      - type: file",
    `        path: ${join(sourceDir, `${id}.desktop`)}`,
    "      - type: file",
    `        path: ${join(sourceDir, `${id}.metainfo.xml`)}`,
    "      - type: file",
    `        path: ${join(sourceDir, "suite.app.json")}`,
    "      - type: file",
    `        path: ${join(sourceDir, "suite.channel.json")}`,
    "      - type: dir",
    "        path: ../../icons",
    "        dest: icons",
    "",
  ].join("\n");

  const manifestPath = join(sourceDir, `${id}.yml`);
  writeFileSync(manifestPath, manifest);
  return manifestPath;
}

const builder = probe("flatpak-builder", ["--version"]);
if (builder === null) {
  process.stderr.write("flatpak-builder is not installed\n");
  process.exit(1);
}
process.stdout.write(`flatpak-builder ${builder} · ${id}${preRelease ? ` (${branch})` : ""}\n`);
process.stdout.write(`user installation · ${join(dataHome, "flatpak")}\n`);

if (build) {
  if (!existsSync(app.manifest)) {
    process.stderr.write(
      `missing ${app.manifest}; Flatpak needs the stable manifest before a tier can reuse it\n`,
    );
    process.exit(1);
  }
  // A single-app package run must not assume the workspace was prepared. The
  // app's typecheck resolves shared packages through their `dist` and through
  // the workspace links in `node_modules`; a fresh checkout — or one that
  // pulled a change adding a workspace dependency — has neither until an
  // install and the library build run. Without this it fails deep inside the
  // app's build with "Cannot find module @suite/…", which reads like a code
  // error rather than a missing step.
  run("pnpm", ["install", "--frozen-lockfile"]);
  run("pnpm", [
    "--filter",
    "./packages/*",
    "--filter",
    "./apps/*/packages/*",
    "--workspace-concurrency=2",
    "run",
    "build",
  ]);
  run("pnpm", ["--filter", app.package, "run", "package:dir"]);
}

if (!existsSync(app.unpacked)) {
  process.stderr.write(`missing ${app.unpacked}; run without --no-build\n`);
  process.exit(1);
}

// `--no-build` reuses a tree this run did not produce, so check it before it becomes a Flatpak.
if (app.verify) run(process.execPath, [app.verify, app.unpacked]);

const manifestPath = preRelease ? generatePreReleaseManifest() : app.manifest;
mkdirSync(buildDir, { recursive: true });
// `--repo` fills an OSTree inside an existing directory. The default repo sits
// under `stateDir`; a `SUITE_FLATPAK_REPO` elsewhere is made here, on the build
// path only, so `--dry-run` still touches nothing.
mkdirSync(repo, { recursive: true });
run("flatpak-builder", [
  "--user",
  ...(keyId.length > 0 ? [`--gpg-sign=${keyId}`] : []),
  "--force-clean",
  ...(preRelease ? [`--default-branch=${branch}`] : []),
  `--repo=${repo}`,
  `--state-dir=${join(stateDir, "builder")}`,
  buildDir,
  manifestPath,
]);

if (keyId.length === 0) {
  process.stdout.write(
    "\nno store key: the repository summary will be unsigned. Run scripts/store-key.sh to make one.\n",
  );
}

run("flatpak", [
  "build-update-repo",
  "--prune",
  // Write `deltas/` for this commit: an update from the previous build then
  // fetches the changed objects, not the whole ~230 MiB ref again.
  ...STATIC_DELTA_ARGUMENTS,
  ...(keyId.length > 0 ? [`--gpg-sign=${keyId}`] : []),
  repo,
]);

const remotes = spawnSync("flatpak", ["remotes", "--user", "--columns=name"], { encoding: "utf8" });
const hasRemote = (remotes.stdout ?? "").split("\n").includes("suite-local");
if (!hasRemote) {
  run("flatpak", [
    "remote-add",
    "--user",
    "--if-not-exists",
    ...(keyId.length > 0 ? [`--gpg-import=${publicKeyPath}`] : ["--no-gpg-verify"]),
    "suite-local",
    repo,
  ]);
} else if (keyId.length > 0) {
  // An earlier run added the remote unsigned. Import the key and turn
  // verification on, so `flatpak update` checks the summary from now on.
  run("flatpak", [
    "remote-modify",
    "--user",
    `--gpg-import=${publicKeyPath}`,
    "--gpg-verify",
    "suite-local",
  ]);
}

// Install through the named remote, not flatpak-builder's own `<id>-origin`,
// so the app's updates come from the same place a marketplace client reads.
const installed = (spawnSync("flatpak", ["list", "--user", "--app", "--columns=application"], { encoding: "utf8" }).stdout ?? "")
  .split("\n")
  .includes(id);
if (install) {
  if (preRelease) {
    // `--or-update` installs the tier branch, and replaces an existing
    // pre-release install when the branch moved from slop to canary to beta.
    run("flatpak", [
      "install",
      "--user",
      "-y",
      "--or-update",
      "suite-local",
      `${id}//${branch}`,
    ]);
  } else {
    run("flatpak", installed ? ["update", "--user", "-y", id] : ["install", "--user", "-y", "suite-local", id]);
  }
}

process.stdout.write(`\n${name} is in ${repo} as ${id}${preRelease ? ` on branch ${branch}` : ""}\n`);
process.stdout.write(`run it with: flatpak run ${id}\n`);
if (sessionDataHome !== undefined && sessionDataHome !== dataHome) {
  process.stdout.write(
    `this session's XDG_DATA_HOME is elsewhere, so use:\n  XDG_DATA_HOME=${dataHome} flatpak run ${id}\n`,
  );
}
