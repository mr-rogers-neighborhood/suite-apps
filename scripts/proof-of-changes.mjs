#!/usr/bin/env node
/**
 * Desktop Proof of Changes runner via each app's Playwright `@proof` scenario.
 *
 * Runs the tagged `@proof` scenario headlessly (under `xvfb-run` when available,
 * otherwise in Electron's `--ozone-platform=headless` mode with `DISPLAY` and
 * `WAYLAND_DISPLAY` cleared so the user's desktop session is never touched),
 * collects screenshots and traces under `.dev/proof/<app>/`, and writes a short
 * markdown "Proof of Changes" block to `.dev/proof/index.md`.
 *
 * Usage:
 *   node scripts/proof-of-changes.mjs
 *   node scripts/proof-of-changes.mjs --only budget
 *   node scripts/proof-of-changes.mjs --affected --base origin/main
 *   node scripts/proof-of-changes.mjs --only canvas --no-build
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeAffected, readProjects } from "./affected.mjs";
import { PIPELINE } from "./lib/pipeline.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUT_DIR = join(ROOT, ".dev", "proof");

const DESKTOP_TARGETS = {
  desk: {
    dir: "hosts/desk",
    playwrightArgs: ["exec", "playwright", "test", "--grep", "@proof"],
    buildCommands: [["pnpm", ["--filter", "@suite/desk", "run", "build:all"]]],
  },
  help: {
    dir: "legacy/help",
    playwrightArgs: ["exec", "playwright", "test", "--grep", "@proof"],
    buildCommands: [["pnpm", ["--filter", "@suite/help", "run", "build"]]],
  },
  canvas: {
    dir: "legacy/canvas/e2e",
    playwrightArgs: [
      "exec",
      "playwright",
      "test",
      "--config=playwright.desktop.config.ts",
      "--grep",
      "@proof",
    ],
    buildCommands: [["pnpm", ["--filter", "@suite/canvas", "run", "build:all"]]],
  },
  planner: {
    dir: "legacy/planner",
    playwrightArgs: ["exec", "playwright", "test", "--grep", "@proof"],
    buildCommands: [["pnpm", ["--filter", "@suite/planner", "run", "build"]]],
  },
  budget: {
    dir: "legacy/budget",
    playwrightArgs: ["exec", "playwright", "test", "--grep", "@proof"],
    buildCommands: [["pnpm", ["--filter", "@suite/budget", "run", "build"]]],
  },
};

/** Select desktop pipeline entries from `--only` or `--affected`. */
export function selectProofApps({ only = null, changedPaths = null, projects = null, rows = PIPELINE }) {
  const desktopRows = rows.filter((row) => row.desktop === true);
  if (only !== null) {
    const match = desktopRows.filter((row) => row.repo === only);
    if (match.length === 0) {
      const valid = desktopRows.map((row) => row.repo).join(", ");
      throw new Error(`unknown desktop app "${only}" (expected one of: ${valid})`);
    }
    return match;
  }
  if (changedPaths !== null) {
    const affected = computeAffected({
      paths: changedPaths,
      projects: projects ?? readProjects(ROOT),
      rows,
    });
    return affected.proofRows;
  }
  return desktopRows;
}

/** Extract scenario titles, status, duration, and named `test.step` entries from Playwright JSON output. */
export function parsePlaywrightReport(report) {
  const scenarios = [];
  function visitSuite(suite) {
    for (const spec of suite.specs ?? []) {
      for (const testCase of spec.tests ?? []) {
        const lastResult = testCase.results?.at(-1);
        const steps = (lastResult?.steps ?? [])
          .filter((step) => step.category === undefined || step.category === "test.step")
          .map((step) => ({
            title: step.title,
            durationMs: step.duration ?? 0,
            error: step.error?.message ?? null,
          }));
        scenarios.push({
          title: spec.title,
          status: lastResult?.status ?? (spec.ok ? "passed" : "failed"),
          durationMs: lastResult?.duration ?? 0,
          steps,
          error: lastResult?.error?.message ?? null,
        });
      }
    }
    for (const child of suite.suites ?? []) visitSuite(child);
  }
  for (const suite of report?.suites ?? []) visitSuite(suite);
  return scenarios;
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Build the concise markdown "Proof of Changes" block for one or more app runs. */
export function formatProofMarkdown({ commit, displayMode, results, ciArtifactPrefix = null }) {
  const passed = results.filter((item) => item.ok).length;
  const total = results.length;
  const lines = [
    "## Proof of Changes",
    "",
    `- **Commit:** \`${commit}\` · **Display:** \`${displayMode}\` · **Result:** ${passed}/${total} passed`,
  ];

  if (total === 0) {
    lines.push("", "No desktop apps were selected for proof.");
    return `${lines.join("\n")}\n`;
  }

  for (const item of results) {
    const statusLabel = item.ok ? "passed" : "failed";
    lines.push(
      "",
      `### \`${item.package}\` (\`${item.repo}\`) — ${statusLabel} (${formatDuration(item.durationMs)})`,
    );

    if (item.scenarios.length === 0) {
      lines.push("", `- **Error:** ${item.detail}`);
    } else {
      let printedScenarioError = false;
      for (const scenario of item.scenarios) {
        lines.push("", `- **Scenario:** \`${scenario.title}\``);
        if (scenario.steps.length > 0) {
          lines.push("- **What it showed:**");
          for (const step of scenario.steps) {
            const state = step.error ? "failed" : "ok";
            lines.push(`  - ${step.title} (${state}, ${formatDuration(step.durationMs)})`);
          }
        }
        if (scenario.error) {
          printedScenarioError = true;
          const firstLine = scenario.error.split("\n")[0];
          lines.push(`- **Failure:** ${firstLine}`);
        }
      }
      if (!item.ok && !printedScenarioError) {
        lines.push(`- **Failure:** ${item.detail}`);
      }
    }

    const artifactLinks = [
      ...item.screenshots.map((file) => `Screenshot: [${file.name}](${file.relPath})`),
      ...(item.trace ? [`Trace: [${item.trace.name}](${item.trace.relPath})`] : []),
    ];
    if (artifactLinks.length > 0) {
      lines.push("- **Artifacts:**");
      for (const link of artifactLinks) lines.push(`  - ${link}`);
    }
    if (ciArtifactPrefix !== null) {
      lines.push(`- **CI Artifact:** \`${ciArtifactPrefix}${item.repo}\``);
    }
  }

  return `${lines.join("\n")}\n`;
}

function onPath(name) {
  const pathValue = process.env.PATH ?? "";
  return pathValue
    .split(delimiter)
    .some((directory) => directory.length > 0 && existsSync(join(directory, name)));
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function changedFiles(base) {
  const output = execFileSync("git", ["diff", "--name-only", "-z", `${base}...HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}

function buildLibraries() {
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "./packages/*",
      "--filter",
      "./hosts/*/packages/*",
      "--filter",
      "./legacy/*/packages/*",
      "--filter",
      "./packs/*/packages/*",
      "--filter",
      "./services/*/packages/*",
      "--workspace-concurrency=2",
      "run",
      "build",
    ],
    { cwd: ROOT, stdio: "inherit", env: process.env },
  );
  return result.status === 0;
}

function buildApp(repo) {
  const target = DESKTOP_TARGETS[repo];
  for (const [cmd, args] of target.buildCommands) {
    const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
    if (result.status !== 0) return false;
  }
  return true;
}

/** Verify a proof run passed and produced at least one non-empty screenshot artifact. */
export function evaluateProofOutcome({ exitStatus, scenarios, screenshots, emptyScreenshots }) {
  const passed = exitStatus === 0 && scenarios.every((scenario) => scenario.status === "passed");
  if (!passed) {
    return { ok: false, detail: `playwright exited ${exitStatus ?? 1}` };
  }
  if (emptyScreenshots.length > 0) {
    return {
      ok: false,
      detail: `empty screenshot artifact(s): ${emptyScreenshots.join(", ")}`,
    };
  }
  if (screenshots.length === 0) {
    return { ok: false, detail: "proof produced no screenshot artifacts" };
  }
  return { ok: true, detail: "passed" };
}

function collectArtifacts(appOutDir, outRoot) {
  if (!existsSync(appOutDir)) return { screenshots: [], emptyScreenshots: [], trace: null };
  const entries = readdirSync(appOutDir).sort();
  const screenshots = [];
  const emptyScreenshots = [];
  for (const name of entries) {
    if (!name.endsWith(".png")) continue;
    const fullPath = join(appOutDir, name);
    if (statSync(fullPath).size === 0) {
      emptyScreenshots.push(name);
      continue;
    }
    screenshots.push({
      name,
      relPath: relative(outRoot, fullPath).replaceAll("\\", "/"),
    });
  }
  const traceName = entries.find((name) => name === "trace.zip");
  const trace =
    traceName && statSync(join(appOutDir, traceName)).size > 0
      ? {
          name: traceName,
          relPath: relative(outRoot, join(appOutDir, traceName)).replaceAll("\\", "/"),
        }
      : null;
  return { screenshots, emptyScreenshots, trace };
}

function runAppProof(row, outRoot, useXvfb) {
  const target = DESKTOP_TARGETS[row.repo];
  const appOutDir = join(outRoot, row.repo);
  rmSync(appOutDir, { recursive: true, force: true });
  mkdirSync(appOutDir, { recursive: true });

  const reportPath = join(appOutDir, "report.json");
  const env = {
    ...process.env,
    SUITE_PROOF_DIR: appOutDir,
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
  };
  if (useXvfb) {
    // Clear WAYLAND_DISPLAY so Electron renders inside the Xvfb display instead of the user's Wayland session.
    delete env.WAYLAND_DISPLAY;
  } else {
    // Clear both display variables so Electron cannot open a window on the user's desktop.
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
    env.SUITE_ELECTRON_HEADLESS = "1";
  }

  const command = useXvfb ? "xvfb-run" : "pnpm";
  const args = useXvfb
    ? ["-a", "pnpm", ...target.playwrightArgs, "--reporter=list,json"]
    : [...target.playwrightArgs, "--reporter=list,json"];

  const startedAt = Date.now();
  const run = spawnSync(command, args, {
    cwd: join(ROOT, target.dir),
    stdio: "inherit",
    env,
  });
  const durationMs = Date.now() - startedAt;

  let scenarios = [];
  if (existsSync(reportPath)) {
    try {
      scenarios = parsePlaywrightReport(JSON.parse(readFileSync(reportPath, "utf8")));
    } catch {
      scenarios = [];
    }
  }
  const { screenshots, emptyScreenshots, trace } = collectArtifacts(appOutDir, outRoot);
  const { ok, detail } = evaluateProofOutcome({
    exitStatus: run.status,
    scenarios,
    screenshots,
    emptyScreenshots,
  });

  return {
    repo: row.repo,
    package: row.package,
    ok,
    durationMs,
    detail,
    scenarios,
    screenshots,
    trace,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;
  if (onlyIndex >= 0 && !only) {
    process.stderr.write("proof-of-changes: --only requires an app name\n");
    process.exit(2);
  }

  const affected = argv.includes("--affected");
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : "origin/main";
  const outIndex = argv.indexOf("--out");
  const outRoot = outIndex >= 0 ? resolve(ROOT, argv[outIndex + 1]) : DEFAULT_OUT_DIR;
  const noBuild = argv.includes("--no-build");
  const json = argv.includes("--json");

  const selected = selectProofApps({
    only,
    changedPaths: affected ? changedFiles(base) : null,
  });

  mkdirSync(outRoot, { recursive: true });
  const useXvfb = onPath("xvfb-run");
  const displayMode = useXvfb ? "xvfb-run" : "headless (ozone)";

  if (selected.length > 0 && !noBuild) {
    process.stdout.write("\n▶ proof build: workspace libraries\n");
    if (!buildLibraries()) {
      process.stderr.write("proof-of-changes: library build failed\n");
      process.exit(1);
    }
    for (const row of selected) {
      process.stdout.write(`\n▶ proof build: ${row.repo}\n`);
      if (!buildApp(row.repo)) {
        process.stderr.write(`proof-of-changes: build failed for ${row.repo}\n`);
        process.exit(1);
      }
    }
  }

  const results = [];
  for (const row of selected) {
    process.stdout.write(`\n▶ proof run: ${row.repo} (${displayMode})\n`);
    results.push(runAppProof(row, outRoot, useXvfb));
  }

  const ciArtifactPrefix = process.env.GITHUB_ACTIONS === "true" ? "desktop-proof-" : null;
  const markdown = formatProofMarkdown({
    commit: gitSha(),
    displayMode,
    results,
    ciArtifactPrefix,
  });
  const indexPath = join(outRoot, "index.md");
  writeFileSync(indexPath, markdown);

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: results.every((r) => r.ok), displayMode, indexPath, results }, null, 2)}\n`);
  } else {
    process.stdout.write(`\n${markdown}\nWrote ${relative(ROOT, indexPath)}\n`);
  }

  if (!results.every((item) => item.ok)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
