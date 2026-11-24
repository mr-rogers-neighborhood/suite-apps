#!/usr/bin/env node
/**
 * The whole Suite's gate, from one repository.
 *
 * Each entry below names a repository root that still owns its own `check:full`.
 * This runner decides the order, builds the shared libraries those gates
 * typecheck against, and, with `--fresh`, that the tree under test came from the
 * commit rather than from whatever is lying around.
 *
 * Order is dependency order: sync publishes the protocol, start publishes the
 * shared packages, then the apps. `suite-go` is last because it consumes the
 * same theme and UI packages through the phone.
 *
 * `--fresh` is the difference between "this tree passes" and "this commit
 * passes". It exports HEAD with `git archive` into `.dev/gate/<sha>`, installs
 * from the lockfile with no node_modules or build output present, and runs the
 * gate there. Without it, a warm cache can make a broken commit green.
 *
 * Usage:
 *   node scripts/gate.mjs
 *   node scripts/gate.mjs --fresh
 *   node scripts/gate.mjs --only canvas
 *   node scripts/gate.mjs --no-e2e
 *   node scripts/gate.mjs --e2e
 *   node scripts/gate.mjs --dry
 *   node scripts/gate.mjs --json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pruneGateExports } from "./lib/gateExports.mjs";
import { PIPELINE } from "./lib/pipeline.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const dry = argv.includes("--dry");
const json = argv.includes("--json");
const e2e = !argv.includes("--no-e2e") && !dry;
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex < 0 ? null : argv[onlyIndex + 1];

const selected = only === null ? PIPELINE : PIPELINE.filter((entry) => entry.repo === only);
if (selected.length === 0) {
  process.stderr.write(`no repository named ${only}\n`);
  process.exit(2);
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, stdio: dry ? "ignore" : "inherit", env: process.env });
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

/** Whether a command exists on PATH, without running it. */
function onPath(name) {
  const path = process.env.PATH ?? "";
  return path
    .split(delimiter)
    .some((directory) => directory.length > 0 && existsSync(join(directory, name)));
}

/**
 * How a browser/desktop suite can reach a display, or null when it cannot.
 *
 * `xvfb-run` wins even when the person has a desktop session: the cross-app
 * suite launches the real Electron app twenty-odd times, and on a real display
 * that is a burst of windows over whatever they were doing. A virtual display
 * runs the same test with none of the intrusion.
 */
function e2eDisplay() {
  if (onPath("xvfb-run")) return "xvfb";
  const hasDisplay =
    (process.env.DISPLAY ?? "").length > 0 || (process.env.WAYLAND_DISPLAY ?? "").length > 0;
  return hasDisplay ? "desktop" : null;
}

/**
 * Run a repository's browser/desktop tests.
 *
 * `display` comes from `e2eDisplay`. A headless host with neither Xvfb nor a
 * display fails loudly: Playwright would otherwise fail with "missing X
 * server", which reads like a test failure.
 */
function runE2e(repoDir, display) {
  const command = "pnpm";
  const args = ["exec", "playwright", "test"];
  if (display === "xvfb") return run("xvfb-run", ["-a", command, ...args], repoDir);
  if (display === "desktop") return run(command, args, repoDir);
  return { status: 1, signal: null };
}

/** A clean export of HEAD, with no node_modules, dist or untracked files. */
function exportHead() {
  const sha = gitSha();
  const gateDir = join(ROOT, ".dev", "gate");
  const target = join(gateDir, sha);
  const bundle = join(gateDir, `${sha}.tar`);
  rmSync(target, { recursive: true, force: true });
  rmSync(bundle, { force: true });
  mkdirSync(target, { recursive: true });

  // `git archive` writes to a file rather than a pipe: spawnSync buffers a piped
  // stdout up to `maxBuffer` and the Suite's archive is larger than the 1 MiB
  // default, which fails as ENOBUFS.
  const archive = spawnSync("git", ["archive", "--format=tar", "-o", bundle, "HEAD"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (archive.status !== 0) throw new Error(`git archive HEAD failed (exit ${archive.status})`);

  const untar = spawnSync("tar", ["-xf", bundle, "-C", target], { stdio: ["ignore", "inherit", "inherit"] });
  rmSync(bundle, { force: true });
  if (untar.status !== 0) throw new Error("tar failed to unpack the archive");

  // The export sits inside this working tree, so git would walk up and find the
  // real repository above it. Anything in the export that asks git for history
  // would get "no such path" instead of "this tree has no history", and tools
  // that stay idempotent by reading history (Canvas's doc indexes) would rewrite
  // their output. A ceiling at the export makes the tree look like the archive
  // it is.
  process.env.GIT_CEILING_DIRECTORIES = target;

  const install = run("pnpm", ["install", "--frozen-lockfile"], target);
  if (install.status !== 0) throw new Error("pnpm install failed in the fresh export");
  return target;
}

const workdir = fresh ? exportHead() : ROOT;
const results = [];

// Docker is what runs gitleaks for Canvas's `security:secrets` step. This
// desktop does not grant the agent access to the daemon because that is a
// root-equivalent permission; the independent VM gate has a daemon and runs the
// scan for real. Make the local skip explicit rather than a silent pass.
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
  encoding: "utf8",
});
if (docker.status !== 0) process.env.SUITE_SKIP_DOCKER_SECURITY = "1";

if (!json) {
  process.stdout.write(
    `\nSuite gate · ${fresh ? `fresh export of ${gitSha()}` : "working tree"} · ${relative(ROOT, workdir) || "."}\n`,
  );
}

// The library packages publish `dist/`, and their consumers resolve through
// that output rather than through source. Turbo used to express this as
// `typecheck: dependsOn ["^build"]`; one build up front is the monorepo
// equivalent. Without it a clean export typechecks against directories that do
// not exist yet, while a warm checkout passes.
const build = dry
  ? { ok: true, detail: "dry run" }
  : (() => {
      if (!json) process.stdout.write("\n▶ libraries\n");
      const result = run(
        "pnpm",
        [
          "--filter",
          "./packages/*",
          "--filter",
          "./apps/*/packages/*",
          "--workspace-concurrency=2",
          "run",
          "build",
        ],
        workdir,
      );
      return { ok: result.status === 0, detail: result.status === 0 ? "built" : `exit ${result.status}` };
    })();

if (!json) process.stdout.write(`${build.ok ? "ok  " : "FAIL"}  libraries  ${build.detail}\n`);

if (!build.ok) {
  results.push({ repo: "libraries", package: "apps/*/packages/*", ok: false, detail: build.detail });
}

// The pack build scripts are not inside a workspace package, so no app's
// `check:full` runs their tests. They import the libraries built above, so they
// run here: after the build, before any app can call the tree green. The Budget
// round-trip uses an ephemeral key and verifies against its own public half, so
// a clean checkout with no owner signing key still proves the signed path. The
// pack shape check runs in the same row, so a pack that drifts fails CI here.
const scripts =
  dry || !build.ok
    ? { ok: build.ok, detail: build.ok ? "dry run" : "not run: libraries failed" }
    : (() => {
        if (!json) process.stdout.write("\n▶ scripts\n");
        const tests = run(
          "node",
          [
            "--test",
            "scripts/pack.test.mjs",
            "scripts/pack-index.test.mjs",
            "scripts/budget-pack.test.mjs",
            "scripts/pack-shape.test.mjs",
            "scripts/affected.test.mjs",
            "scripts/release-manifest.test.mjs",
            "scripts/channel.test.mjs",
            "scripts/shell-channel.test.mjs",
            "scripts/android-release.test.mjs",
            "scripts/release-status.test.mjs",
            "scripts/delivery-signals.test.mjs",
            "scripts/flatpak-remote.test.mjs",
            "scripts/spec.test.mjs",
          ],
          workdir,
        );
        const shape = run("node", ["scripts/pack-shape.mjs"], workdir);
        const ok = tests.status === 0 && shape.status === 0;
        return {
          ok,
          detail: ok
            ? "pack shape, pack, channel, affected, release and spec tests"
            : `tests exit ${tests.status}, pack shape exit ${shape.status}`,
        };
      })();

if (!json) process.stdout.write(`${scripts.ok ? "ok  " : "FAIL"}  scripts  ${scripts.detail}\n`);

if (!scripts.ok) {
  results.push({
    repo: "scripts",
    package: "scripts/*.test.mjs",
    ok: false,
    detail: scripts.detail,
  });
}

// The prelude's tests live with Budget's app, which owns the Vitest version. They
// need no signing key; the signed round-trip above is the key-bearing path, and
// this is the bridge's list/create/commit/export/import behaviour.
const packTests =
  dry || !build.ok || !scripts.ok
    ? { ok: build.ok && scripts.ok, detail: dry ? "dry run" : "not run: earlier step failed" }
    : (() => {
        if (!json) process.stdout.write("\n▶ budget pack\n");
        const result = run("pnpm", ["--dir", "apps/budget", "run", "test:pack"], workdir);
        return {
          ok: result.status === 0,
          detail: result.status === 0 ? "prelude tests" : `exit ${result.status}`,
        };
      })();

if (!json) {
  process.stdout.write(`${packTests.ok ? "ok  " : "FAIL"}  budget pack  ${packTests.detail}\n`);
}

if (!packTests.ok) {
  results.push({
    repo: "budget pack",
    package: "apps/budget (test:pack)",
    ok: false,
    detail: packTests.detail,
  });
}

for (const entry of build.ok && scripts.ok && packTests.ok ? selected : []) {
  const repoDir = join(workdir, "apps", entry.repo);
  if (!existsSync(join(repoDir, "package.json"))) {
    results.push({ ...entry, ok: false, detail: "missing repo" });
    break;
  }

  if (!json) process.stdout.write(`\n▶ ${entry.repo}\n`);
  if (dry) {
    results.push({ ...entry, ok: true, detail: "dry run" });
    continue;
  }

  const result = run("pnpm", ["--filter", entry.package, "run", "check:full"], workdir);
  const ok = result.status === 0;
  results.push({ ...entry, ok, detail: ok ? "passed" : `exit ${result.status}` });
  if (!ok) break;
}

// E2E after every repository's own gate: a UI spec failure should not hide whether
// the other apps' checks passed. It only runs when the checks are green.
let e2eRan = false;
if (e2e && results.length > 0 && results.every((row) => row.ok)) {
  const display = e2eDisplay();
  // A real session is not asked to give up its screen for a test run. The suite
  // is skipped unless the person passes `--e2e`, and the status says so.
  const skipDesktop = display === "desktop" && !argv.includes("--e2e");
  if (skipDesktop && !json) {
    process.stdout.write(
      "\ne2e skipped: no xvfb-run on this desktop session. Install Xvfb, run the gate on the VM, or pass --e2e to accept the windows.\n",
    );
  }
  for (const entry of selected.filter((row) => row.e2e === true)) {
    // No result row on a skip: `ok` has always meant "ran and passed", and a
    // desktop without Xvfb must not put a green e2e line in the report. The
    // notice above and `e2e: false` in the status carry the skip instead.
    if (skipDesktop) continue;
    if (!json) process.stdout.write(`\n▶ ${entry.repo} · e2e\n`);
    const suite = runE2e(join(workdir, "apps", entry.repo), display);
    const ok = suite.status === 0;
    e2eRan = e2eRan || ok;
    results.push({
      ...entry,
      repo: `${entry.repo} e2e`,
      ok,
      detail: ok ? "passed" : display === null ? "no display and no xvfb-run" : `exit ${suite.status}`,
    });
    if (!ok) break;
  }
}

const covered = selected.every((entry) => results.some((row) => row.repo === entry.repo));
const status = {
  ok: results.every((entry) => entry.ok) && covered,
  fresh,
  commit: gitSha(),
  at: new Date().toISOString(),
  build,
  scripts,
  // Whether the suite actually ran, not whether it was requested. A skipped
  // desktop run must not read as proof of the e2e step.
  e2e: e2eRan,
  e2eRequested: e2e,
  // A partial run proves one repository, not the suite. `release.mjs` refuses
  // to publish on it; the field is null for a full run.
  only,
  results,
};
const statusPath = join(ROOT, ".dev", "gate-status.json");
mkdirSync(dirname(statusPath), { recursive: true });
writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);

if (json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
else {
  for (const entry of results) {
    process.stdout.write(`${entry.ok ? "ok  " : "FAIL"}  ${entry.repo}  ${entry.detail}\n`);
  }
  process.stdout.write(`\n${status.ok ? "gate passed" : "gate failed"} · ${statusPath}\n`);
}

// Only a passing `--fresh` run has a proof worth keeping, and only after the
// status file names it. A failed run keeps every export: the tree it ran in is
// the evidence for the failure. A dry run deletes nothing.
if (fresh && status.ok && !dry) {
  const removed = pruneGateExports(join(ROOT, ".dev", "gate"), workdir);
  if (!json && removed.length > 0) {
    process.stdout.write(`pruned ${removed.length} older gate export(s)\n`);
  }
}

process.exit(status.ok ? 0 : 1);
