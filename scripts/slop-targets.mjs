#!/usr/bin/env node
/**
 * Which host artifacts a slop push has to rebuild.
 *
 * Slop published the Desk Flatpak and the Suite Go APK on every push to `main`,
 * so a docs page or a release script spent the same minutes as a host change.
 * This decides from the push diff, using the same workspace graph as the gate:
 * a shared package reaches a host only through that host's declared
 * dependencies, so a new shared package does not need an edit here.
 *
 * The rules are deliberately conservative. Anything that is not a host source,
 * a workspace project or an ignored path counts as a shared input and rebuilds
 * both: a stale slop artifact is worse than a few saved minutes.
 *
 * Usage:
 *   node scripts/slop-targets.mjs --base <sha>
 *
 * With `GITHUB_OUTPUT` set, `desk`, `go`, `any`, `shared` and `changed` are
 * written as step outputs. A missing or all-zero base (a first push, a force
 * push, a manual dispatch) rebuilds both.
 *
 * spec: C4.1 C4.2
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dependentClosure,
  isDocPath,
  normalizePath,
  projectForPath,
  readProjects,
} from "./affected.mjs";
import { PIPELINE } from "./lib/pipeline.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Root files that can change what either host builds. */
const SHARED_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

/** Directories that feed packaging rather than one host's sources. */
const SHARED_PREFIXES = ["scripts/", "packaging/"];

/** Paths that cannot change a host artifact: prose, repository metadata, CI. */
function isIgnored(path) {
  return (
    isDocPath(path) ||
    path.startsWith(".github/") ||
    path.startsWith(".agents/") ||
    path === ".gitignore" ||
    path === ".gitattributes" ||
    path === ".editorconfig"
  );
}

/** `ignore`, `shared` (rebuild both) or the workspace project that owns the path. */
export function classifySlopPath(path, projects) {
  const normalized = normalizePath(path);
  if (isIgnored(normalized)) return { kind: "ignore" };
  if (SHARED_FILES.has(normalized) || SHARED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return { kind: "shared" };
  }
  const project = projectForPath(normalized, projects);
  // An unrecognised path is a shared input: guessing could ship a stale host.
  return project === null ? { kind: "shared" } : { kind: "project", project };
}

/**
 * The whole decision, as a pure function.
 *
 * `paths` are repository-relative, `projects` is `readProjects`' shape and
 * `targets` names the host rows to decide (`{ key, package }`). Returns one
 * boolean per target, plus why.
 */
export function computeSlopTargets({ paths, projects, targets }) {
  const changed = paths.map(normalizePath).filter((path) => path.length > 0);
  const direct = new Set();
  let shared = false;
  const sharedPaths = [];

  for (const path of changed) {
    const classified = classifySlopPath(path, projects);
    if (classified.kind === "ignore") continue;
    if (classified.kind === "shared") {
      shared = true;
      sharedPaths.push(path);
      continue;
    }
    direct.add(classified.project.name);
  }

  const closure = dependentClosure(projects, direct);
  const selected = {};
  for (const target of targets) selected[target.key] = shared || closure.has(target.package);

  return {
    ...selected,
    shared,
    sharedPaths,
    changed: changed.length,
    // Any host building anything is what keeps the publish job alive.
    any: targets.some((target) => selected[target.key]),
  };
}

/** The host rows this decision is about, read from the one pipeline list. */
export function slopTargets(rows = PIPELINE) {
  return rows
    .filter((row) => row.repo === "desk" || row.repo === "go")
    .map((row) => ({ key: row.repo, package: row.package }));
}

function commitExists(root, ref) {
  const result = spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: root });
  return result.status === 0;
}

function changedPaths(root, base) {
  const output = execFileSync("git", ["diff", "--name-only", "-z", base, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  return output.split("\0").filter((path) => path.length > 0);
}

function writeOutput(lines) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function main() {
  const argv = process.argv.slice(2);
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : "origin/main";
  const targets = slopTargets();

  // A first push, a force push and a dispatch have no usable parent. Rebuild
  // both rather than infer a scope from a diff that is not there.
  const usable = typeof base === "string" && base.length > 0 && !/^0+$/.test(base);
  const result =
    usable && commitExists(ROOT, base)
      ? computeSlopTargets({ paths: changedPaths(ROOT, base), projects: readProjects(ROOT), targets })
      : {
          desk: true,
          go: true,
          any: true,
          shared: true,
          sharedPaths: [],
          changed: 0,
        };

  const lines = [
    `desk=${result.desk === true}`,
    `go=${result.go === true}`,
    `any=${result.any === true}`,
    `shared=${result.shared === true}`,
    `changed=${result.changed}`,
  ];
  writeOutput(lines);

  if (!result.any) {
    const sentence =
      "No host artifact input changed (docs or workflow files only); nothing to publish.";
    process.stdout.write(`${sentence}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${sentence}\n`);
    }
    return;
  }

  const reason = result.shared ? "a shared input changed" : `${result.changed} changed file(s)`;
  const scope = [result.desk ? "desk" : null, result.go ? "go" : null].filter(Boolean).join(" + ");
  process.stdout.write(`slop targets for ${base}: ${scope} (${reason})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
