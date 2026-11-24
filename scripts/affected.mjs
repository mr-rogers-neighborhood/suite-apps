#!/usr/bin/env node
/**
 * Which gate rows a change must run.
 *
 * A pull request gets the checks its diff can break, not the whole suite. The
 * mapping is read from the workspace graph (each project's own `package.json`
 * dependencies), never a hand-maintained list, so a new shared package reaches
 * its consumers without an edit here. A path the map does not understand runs
 * everything: a silent skip is worse than a slow pull request.
 *
 * Docs and spec changes take the cheap lane. They need the link, index and spec
 * checks, not an app build.
 *
 * Usage:
 *   node scripts/affected.mjs --base origin/main
 *   node scripts/affected.mjs --base origin/main --json
 *
 * With `GITHUB_OUTPUT` set, the result is also written as `matrix`, `any`,
 * `e2e` and `docs_only` step outputs. `matrix` always names at least one row;
 * an empty change set gets a `none` row so the required job still runs and
 * reports "nothing affected" rather than disappearing (spec C3.1).
 *
 * spec: C4.1 C4.2 C4.3
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINE } from "./lib/pipeline.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Paths that are documentation wherever they live. */
const DOC_SUFFIXES = [".md", ".mdx"];

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

/** A docs page: under `docs/`, under an app's `docs/`, or Markdown anywhere. */
export function isDocPath(path) {
  const normalized = normalizePath(path);
  return (
    normalized.startsWith("docs/") ||
    /^apps\/[^/]+\/docs\//.test(normalized) ||
    DOC_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

/** The spec corpus: prose, schema and fixtures, plus its own check. */
export function isSpecPath(path) {
  const normalized = normalizePath(path);
  return normalized.startsWith("docs/spec/") || normalized === "scripts/spec.test.mjs";
}

/** The project owning a path, longest directory first. */
export function projectFor(path, projects) {
  const normalized = normalizePath(path);
  let match = null;
  for (const project of projects) {
    if (normalized === project.dir || normalized.startsWith(`${project.dir}/`)) {
      if (match === null || project.dir.length > match.dir.length) match = project;
    }
  }
  return match;
}

/**
 * Expand a pnpm workspace pattern to project directories.
 *
 * Only `*` is needed by this workspace: the app, app-package and shared
 * package patterns. A `!` exclusion throws instead of being ignored: guessing
 * would make the map quietly wrong.
 */
export function expandPattern(root, pattern) {
  if (pattern.startsWith("!")) {
    throw new Error(`affected: workspace exclusion patterns are not supported (${pattern})`);
  }
  let current = [""];
  for (const segment of pattern.split("/")) {
    const next = [];
    for (const base of current) {
      if (segment !== "*") {
        next.push(base === "" ? segment : `${base}/${segment}`);
        continue;
      }
      const directory = join(root, base);
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        next.push(base === "" ? entry.name : `${base}/${entry.name}`);
      }
    }
    current = next;
  }
  return current.filter((dir) => existsSync(join(root, dir, "package.json")));
}

/** The `packages:` list from the workspace file, in order. */
export function workspacePatterns(root) {
  const text = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const patterns = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (item) {
      patterns.push(item[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    if (/^\S/.test(line)) break;
  }
  return patterns;
}

function dependencyNames(pkg) {
  const names = new Set();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
  }
  return [...names];
}

/** Every workspace project: its name, its directory and its workspace dependencies. */
export function readProjects(root) {
  const projects = [];
  for (const pattern of workspacePatterns(root)) {
    for (const dir of expandPattern(root, pattern)) {
      const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      if (typeof pkg.name !== "string") continue;
      projects.push({ name: pkg.name, dir, dependencies: dependencyNames(pkg) });
    }
  }
  return projects;
}

/** The changed projects plus every workspace project that depends on them. */
export function dependentClosure(projects, changedNames) {
  const known = new Set(projects.map((project) => project.name));
  const dependents = new Map();
  for (const project of projects) {
    for (const dependency of project.dependencies) {
      if (!known.has(dependency)) continue;
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency).add(project.name);
    }
  }

  const closure = new Set();
  const queue = [...changedNames].filter((name) => known.has(name));
  while (queue.length > 0) {
    const name = queue.pop();
    if (closure.has(name)) continue;
    closure.add(name);
    for (const dependent of dependents.get(name) ?? []) queue.push(dependent);
  }
  return closure;
}

/**
 * The whole decision, as a pure function.
 *
 * `paths` are repository-relative. `projects` is `readProjects`' shape and
 * `rows` is the pipeline. Returns the rows to run and why.
 */
export function computeAffected({ paths, projects, rows }) {
  const changed = paths.map(normalizePath).filter((path) => path.length > 0);
  const docsOnly = changed.length > 0 && changed.every(isDocPath);
  const spec = changed.some(isSpecPath);

  const direct = new Set();
  let global = false;
  for (const path of changed) {
    if (isDocPath(path)) continue;
    const project = projectFor(path, projects);
    if (project) direct.add(project.name);
    else global = true;
  }

  const closure = dependentClosure(projects, direct);
  // A row owns an e2e suite only when the pipeline marks it. No row does after
  // Start's suite left, but the flag stays a property of the row rather than a
  // hard-coded app name.
  const e2e = !global && rows.some((row) => row.e2e === true && closure.has(row.package));
  const selected = global ? rows : rows.filter((row) => closure.has(row.package));
  const proofRows = selected.filter((row) => row.desktop === true);

  return { rows: selected, proofRows, docsOnly, spec, global, e2e, changed: changed.length };
}

function changedPaths(root, base) {
  const output = execFileSync("git", ["diff", "--name-only", "-z", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  });
  return output.split("\0").filter((path) => path.length > 0);
}

function main() {
  const argv = process.argv.slice(2);
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : "origin/main";
  if (!base) {
    process.stderr.write("affected: --base needs a ref\n");
    process.exit(2);
  }

  const paths = changedPaths(ROOT, base);
  const result = computeAffected({
    paths,
    projects: readProjects(ROOT),
    rows: PIPELINE,
  });

  const matrix = result.rows.length > 0 ? result.rows : [{ repo: "none", package: "none" }];
  const proofMatrix =
    result.proofRows.length > 0 ? JSON.stringify({ include: result.proofRows }) : "";
  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `matrix=${JSON.stringify({ include: matrix })}`,
      `any=${result.rows.length > 0}`,
      `proof_matrix=${proofMatrix}`,
      `proof_any=${result.proofRows.length > 0}`,
      `e2e=${result.e2e}`,
      `docs_only=${result.docsOnly}`,
      `spec=${result.spec}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }

  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const scope = result.global
    ? "workspace-wide"
    : result.docsOnly
      ? "docs only"
      : `${result.rows.length} row(s)`;
  process.stdout.write(`affected by ${result.changed} file(s) against ${base}: ${scope}\n`);
  for (const row of result.rows) process.stdout.write(`  ${row.repo}  ${row.package}\n`);
  if (result.rows.length === 0) process.stdout.write("  nothing affected\n");
  if (result.e2e) process.stdout.write("  e2e: yes\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
