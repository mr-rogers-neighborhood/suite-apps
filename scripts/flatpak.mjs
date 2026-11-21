#!/usr/bin/env node
/**
 * Build a Suite app for Flatpak and publish it to the local OSTree repository.
 *
 * Flatpak is a second way to install the same build, not a second build. The
 * manifest packages what `package:dir` produced, so the binary under test is
 * the one the other artifact forms carry.
 *
 *   node scripts/flatpak.mjs                 # Canvas: package, build, install
 *   node scripts/flatpak.mjs --app planner   # Planner, same path
 *   node scripts/flatpak.mjs --app budget    # Budget, same path
 *   node scripts/flatpak.mjs --no-build      # reuse the unpacked build
 *
 * The repository lives outside the checkout, at ~/suite-flatpak/repo, and is
 * added as the user remote `suite-local`. When scripts/store-key.sh has made a
 * key, the repo summary is signed and the remote verifies it; without a key the
 * remote is added with --no-gpg-verify for local testing only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  planner: {
    id: "run.suite.planner",
    package: "@suite/planner",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.planner.yml"),
    unpacked: join(ROOT, "apps", "planner", "release", "linux-unpacked"),
  },
  budget: {
    id: "run.suite.budget",
    package: "@suite/budget",
    manifest: join(ROOT, "packaging", "flatpak", "run.suite.budget.yml"),
    unpacked: join(ROOT, "apps", "budget", "release", "linux-unpacked"),
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

// The store's signing key, when one has been made. The fingerprint is not a
// secret; the private key stays in ~/.gnupg and never enters the repository.
const keyIdPath = join(stateDir, "store-key.id");
const publicKeyPath = join(stateDir, "suite-store.gpg");
const keyId =
  process.env.SUITE_STORE_KEY_ID?.trim() ||
  (existsSync(keyIdPath) ? readFileSync(keyIdPath, "utf8").trim() : "");

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
  ...(keyId.length > 0 ? [`--gpg-sign=${keyId}`] : []),
  "--force-clean",
  `--repo=${repo}`,
  `--state-dir=${join(stateDir, "builder")}`,
  buildDir,
  app.manifest,
]);

if (keyId.length === 0) {
  process.stdout.write(
    "\nno store key: the repository summary will be unsigned. Run scripts/store-key.sh to make one.\n",
  );
}

run("flatpak", [
  "build-update-repo",
  "--prune",
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
