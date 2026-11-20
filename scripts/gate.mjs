#!/usr/bin/env node
/**
 * The whole Suite's gate, from one repository.
 *
 * Each entry below names a repository root that still owns its own `check:full`.
 * This runner decides only the order and, with `--fresh`, that the tree under
 * test came from the commit rather than from whatever is lying around.
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
 *   node scripts/gate.mjs --only suite-canvas
 *   node scripts/gate.mjs --dry
 *   node scripts/gate.mjs --json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository roots inside the monorepo, in the order their gates must run. */
const PIPELINE = [
  { repo: "suite-sync", package: "suite-sync" },
  { repo: "suite-start", package: "suite-start" },
  { repo: "suite-canvas", package: "suite" },
  { repo: "suite-planner", package: "suite-planner" },
  { repo: "suite-budget", package: "suite-budget" },
  { repo: "suite-go", package: "suite-go" },
];

const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const dry = argv.includes("--dry");
const json = argv.includes("--json");
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

/** A clean export of HEAD, with no node_modules, dist or untracked files. */
function exportHead() {
  const target = join(ROOT, ".dev", "gate", gitSha());
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const archive = spawnSync("git", ["archive", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
  if (archive.status !== 0) throw new Error("git archive HEAD failed");

  const untar = spawnSync("tar", ["-x", "-C", target], { input: archive.stdout, stdio: ["pipe", "inherit", "inherit"] });
  if (untar.status !== 0) throw new Error("tar failed to unpack the archive");

  const install = run("pnpm", ["install", "--frozen-lockfile"], target);
  if (install.status !== 0) throw new Error("pnpm install failed in the fresh export");
  return target;
}

const workdir = fresh ? exportHead() : ROOT;
const results = [];

if (!json) {
  process.stdout.write(
    `\nSuite gate · ${fresh ? `fresh export of ${gitSha()}` : "working tree"} · ${relative(ROOT, workdir) || "."}\n`,
  );
}

for (const entry of selected) {
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

const status = {
  ok: results.every((entry) => entry.ok) && results.length === selected.length,
  fresh,
  commit: gitSha(),
  at: new Date().toISOString(),
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

process.exit(status.ok ? 0 : 1);
