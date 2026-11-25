#!/usr/bin/env node
/**
 * `biome check` for one workspace project, with the path and the cwd pinned.
 *
 * Each project used to spell its own `biome check .`. `.` is resolved against
 * whatever directory the caller stood in and then filtered by the project's
 * `files.includes` and VCS ignore file, so the same command could inspect the
 * whole project or nothing at all. A fresh gate export unpacked under a `.dev`
 * directory — which every app's config excludes — reached this check with zero
 * files, biome exited non-zero, and the row went red as though the code had a
 * lint error. That red was never about the code (#425).
 *
 * This runner hands biome the project root as one explicit path and sets the
 * working directory itself, so the set of files no longer depends on the
 * caller. It then reads biome's own summary. A check that inspected nothing is
 * reported as such with `LINT_NOTHING_INSPECTED` (2), which is distinct from a
 * lint finding (1) and from a run that could not start (3). It is never silent
 * and it is never called a pass.
 *
 * Usage (from a project's own `lint` script):
 *   node ../../scripts/lint.mjs
 *   node ../../scripts/lint.mjs --write
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  LINT_MISCONFIGURED,
  LINT_NOTHING_INSPECTED,
  checkedFileCount,
  lintOutcome,
} from "./lib/lintGuard.mjs";

const project = process.cwd();
const binary = join(project, "node_modules", ".bin", process.platform === "win32" ? "biome.cmd" : "biome");
const config = ["biome.json", "biome.jsonc"].find((name) => existsSync(join(project, name)));

if (!existsSync(binary)) {
  process.stderr.write(
    `no biome binary at ${binary}.\n` +
      "Run `pnpm install` in the workspace first; this project has no lint without it.\n",
  );
  process.exit(LINT_MISCONFIGURED);
}

// The config is named rather than discovered: biome otherwise walks up from the
// cwd, so a config in a parent directory (or a nested one under a scratch
// export) could decide what this project lints.
const args = ["check", ...(config === undefined ? [] : [`--config-path=${config}`]), project];
const result = spawnSync(binary, [...args, ...process.argv.slice(2)], {
  cwd: project,
  encoding: "utf8",
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);
if (result.error !== undefined) process.stderr.write(`${result.error.message}\n`);

const outcome = lintOutcome({ status: result.status, output });
const checked = checkedFileCount(output);

if (outcome === LINT_NOTHING_INSPECTED) {
  process.stderr.write(
    `\nlint inspected ${checked === null ? "no files" : `${checked} files`} under ${project}.\n` +
      "That is not a pass: biome reached no source file. Its `files.includes` or its VCS\n" +
      "ignore file excluded every path it was given, so nothing was checked. Fix the\n" +
      "ignore set — do not read this run as a result about the code.\n",
  );
}

process.exit(outcome);
