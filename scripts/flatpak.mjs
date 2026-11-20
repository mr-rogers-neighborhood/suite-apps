#!/usr/bin/env node
/**
 * Build a Suite app for Flatpak and publish it to the local OSTree repository.
 *
 * Flatpak is a second way to install the same build, not a second build. The
 * manifest packages what `package:dir` produced, so the binary under test is
 * the one the other artifact forms carry.
 *
 *   node scripts/flatpak.mjs                 # Canvas: package, build, install
 *   node scripts/flatpak.mjs --no-build      # reuse the unpacked build
 *
 * The repository lives outside the checkout, at ~/suite-flatpak/repo, and is
 * added as the user remote `suite-local`. It is unsigned: local testing adds it
 * with --no-gpg-verify. A shared or published repo needs `flatpak
 * build-update-repo --gpg-sign=...` and a key the client already trusts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const APPS = {
  canvas: {
    id: "run.suite.canvas",
    package: "@suite/canvas-desktop",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.canvas.yml"),
    unpacked: join(ROOT, "apps", "canvas", "desktop", "release", "linux-unpacked"),
  },
};

const argv = process.argv.slice(2);
const appName = argv.includes("--app") ? argv[argv.indexOf("--app") + 1] : "canvas";
const build = !argv.includes("--no-build");
const install = !argv.includes("--no-install");

const app = APPS[appName];
if (!app) {
  process.stderr.write(`unknown app ${appName}; known: ${Object.keys(APPS).join(", ")}\n`);
  process.exit(2);
}

const stateDir = join(homedir(), "suite-flatpak");
const repo = process.env.SUITE_FLATPAK_REPO ?? join(stateDir, "repo");
const buildDir = join(ROOT, "packaging", "flatpak", ".build", app.id);

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

const builder = probe("flatpak-builder", ["--version"]);
if (builder === null) {
  process.stderr.write("flatpak-builder is not installed\n");
  process.exit(1);
}
process.stdout.write(`flatpak-builder ${builder} · ${app.id}\n`);
process.stdout.write(`user installation · ${join(dataHome, "flatpak")}\n`);

if (build) {
  run("pnpm", ["--filter", app.package, "run", "package:dir"]);
}

if (!existsSync(app.unpacked)) {
  process.stderr.write(`missing ${app.unpacked}; run without --no-build\n`);
  process.exit(1);
}

mkdirSync(buildDir, { recursive: true });
run("flatpak-builder", [
  "--user",
  "--force-clean",
  `--repo=${repo}`,
  `--state-dir=${join(stateDir, "builder")}`,
  buildDir,
  app.manifest,
]);

run("flatpak", ["build-update-repo", "--prune", repo]);

const remotes = spawnSync("flatpak", ["remotes", "--user", "--columns=name"], { encoding: "utf8" });
if (!(remotes.stdout ?? "").split("\n").includes("suite-local")) {
  run("flatpak", ["remote-add", "--user", "--if-not-exists", "--no-gpg-verify", "suite-local", repo]);
}

// Install through the named remote, not flatpak-builder's own `<id>-origin`,
// so the app's updates come from the same place a marketplace client reads.
const installed = (spawnSync("flatpak", ["list", "--user", "--app", "--columns=application"], { encoding: "utf8" }).stdout ?? "")
  .split("\n")
  .includes(app.id);
if (install) {
  run("flatpak", installed ? ["update", "--user", "-y", app.id] : ["install", "--user", "-y", "suite-local", app.id]);
}

process.stdout.write(`\n${app.id} is in ${repo}\n`);
process.stdout.write(`run it with: flatpak run ${app.id}\n`);
if (sessionDataHome !== undefined && sessionDataHome !== dataHome) {
  process.stdout.write(
    `this session's XDG_DATA_HOME is elsewhere, so use:\n  XDG_DATA_HOME=${dataHome} flatpak run ${app.id}\n`,
  );
}
