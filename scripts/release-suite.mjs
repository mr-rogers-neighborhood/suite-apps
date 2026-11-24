#!/usr/bin/env node
/**
 * Publish Suite Desk and Suite Go: package the host, build the Flatpak, publish the signed
 * remote, refresh the rolling release, attach Suite Go's APK, and relink.
 *
 * The host is the top row of the rolling release and the only desktop artifact
 * this sequence packages itself. The individual scripts each own one step;
 * this one runs them in the order that keeps every artifact on a commit the
 * gate proved:
 *
 * 1. `scripts/gate.mjs --fresh` — proves HEAD, writes `.dev/gate-status.json`.
 * 2. `pnpm --filter @suite/shell package:dir` — the Electron tree.
 * 3. `scripts/flatpak.mjs --app shell` — build, sign and install locally.
 * 4. `scripts/flatpak-remote.mjs --target <s3|lan> --publish` — the signed
 *    remote. `s3` is the public store; `lan` is the fallback test host.
 * 5. `scripts/release-status.mjs --draft` — create or update the rolling
 *    `suite-YYYY.MM.DD` release as a draft.
 * 6. `scripts/android-release.mjs --publish` — attach `suite-go.apk` and its
 *    checksum to that draft.
 * 7. `scripts/release-status.mjs --publish` — publish the drafts, relink the
 *    body and write `RELEASES.md` now that the APK exists.
 *
 * Nothing is published unless `--publish` is passed, and then only for a HEAD
 * `.dev/gate-status.json` proves. `--skip-gate` reuses an existing proof; it
 * does not waive the rule. A dry run prints the commands and changes nothing,
 * and never passes `--publish` to a child.
 *
 * The `s3` target reads its own credentials, bucket and distribution inside
 * `scripts/flatpak-remote.mjs`; this script only forwards `--target`.
 *
 * Usage:
 *   node scripts/release-suite.mjs                            # dry run
 *   node scripts/release-suite.mjs --publish                  # publish to s3
 *   node scripts/release-suite.mjs --target lan --publish     # the fallback host
 *   node scripts/release-suite.mjs --skip-gate --publish      # reuse the proof
 *   node scripts/release-suite.mjs --skip-apk --publish       # desktop only
 *   node scripts/release-suite.mjs --help
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GO_APK_ALIAS } from "./android-release.mjs";
import { targetProblem } from "./lib/flatpakRemote.mjs";
import { gateProblems } from "./release.mjs";
import { goApkName } from "./release-status.mjs";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where `android-release.mjs` leaves the named APK, relative to the root. */
export const APK_DIR = "apps/go/.dev/release";

/** The proof file the gate writes and every publish reads. */
export const GATE_STATUS = ".dev/gate-status.json";

/** The public store is the desktop update path; `lan` is the fallback host. */
export const DEFAULT_TARGET = "s3";

const USAGE = `usage: node scripts/release-suite.mjs [options]

  --publish            run the steps and publish; without it this is a dry run
  --target <place>     s3 (public store) or lan (local test host); default: ${DEFAULT_TARGET}
  --skip-gate          reuse .dev/gate-status.json instead of running the gate
  --skip-apk           do not build or attach Suite Go's APK
  --help               print this text

The dry run prints every command and passes --publish to none of them.

--publish refuses unless .dev/gate-status.json names HEAD, says ok, came from a
fresh export and is not a --only run. Run \`node scripts/gate.mjs --fresh\` first.
`;

function quote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

/** One command, exactly as a person would paste it. */
export function commandText(step) {
  return [step.command, ...step.args.map(quote)].join(" ");
}

/**
 * Parse the command line.
 *
 * `--target` is checked here, before any step can run, so a typo fails at once
 * rather than inside `flatpak-remote.mjs` after the host has been packaged.
 */
export function parseArgs(argv) {
  const options = {
    publish: false,
    target: DEFAULT_TARGET,
    skipGate: false,
    skipApk: false,
    help: false,
  };

  function takeValue(index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    return value;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--skip-gate") options.skipGate = true;
    else if (arg === "--skip-apk") options.skipApk = true;
    else if (arg === "--target") {
      options.target = takeValue(index, "--target");
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }

  const targetMiss = targetProblem(options.target);
  if (targetMiss !== null) throw new Error(targetMiss);

  return options;
}

/**
 * The ordered steps one release runs.
 *
 * `publish` is the only source of a child's `--publish`: a dry run builds the
 * same list without it, so there is no path where a dry run can act by
 * accident. The relink is the same command as the first release-status step,
 * kept as its own step because only the second one sees the uploaded APK.
 */
export function releaseSteps({
  publish = false,
  target = DEFAULT_TARGET,
  skipGate = false,
  skipApk = false,
} = {}) {
  const steps = [];
  if (!skipGate) {
    steps.push({
      id: "gate",
      command: "node",
      args: ["scripts/gate.mjs", "--fresh"],
      note: "prove HEAD in a clean export and write .dev/gate-status.json",
    });
  }
  steps.push({
    id: "package",
    command: "pnpm",
    args: ["--filter", "@suite/shell", "package:dir"],
    note: "build the host's unpacked Electron tree",
  });
  steps.push({
    id: "flatpak",
    command: "node",
    args: ["scripts/flatpak.mjs", "--app", "shell"],
    note: "build, sign and install run.suite.shell locally",
  });
  steps.push({
    id: "remote",
    command: "node",
    args: [
      "scripts/flatpak-remote.mjs",
      "--target",
      target,
      ...(publish ? ["--publish"] : []),
    ],
    note:
      target === "s3"
        ? "publish the signed remote to the public store"
        : "publish to the lan test host",
  });
  steps.push({
    id: "release-status",
    command: "node",
    // A dry run prints the plain command so a copy is the script's own dry run;
    // a publish drafts first, because a published release is immutable.
    args: ["scripts/release-status.mjs", ...(publish ? ["--draft"] : [])],
    note: "create or update the rolling release as a draft",
  });
  if (!skipApk) {
    steps.push({
      id: "apk",
      command: "node",
      args: ["scripts/android-release.mjs", ...(publish ? ["--publish"] : [])],
      note: "build Suite Go's APK and attach it to the draft, with its checksum",
    });
  }
  steps.push({
    id: "relink",
    command: "node",
    args: ["scripts/release-status.mjs", ...(publish ? ["--publish"] : [])],
    note: "publish the drafts and write RELEASES.md now that the APK exists",
  });
  return steps;
}

/**
 * Why this gate status does not permit a publish, or null when it does.
 *
 * The rule is `scripts/release.mjs`'s, unchanged: the recorded commit must be
 * HEAD, the run must have passed, it must come from a clean `--fresh` export,
 * and it must not be an `--only` run. A suite proof is not a single-repo loop.
 */
export function publishRefusal(status, head) {
  const problems = gateProblems(status, head);
  if (problems.length === 0) return null;
  return (
    `${problems.join("\n\n")}\n\n` +
    "Publish only a commit the gate proved. Run `node scripts/gate.mjs --fresh`, " +
    "or correct HEAD, then run this again."
  );
}

/** The gate status file, or null when it is missing or unreadable. */
export function readGateStatus({ root = ROOT } = {}) {
  try {
    return JSON.parse(readFileSync(join(root, GATE_STATUS), "utf8"));
  } catch {
    return null;
  }
}

function currentHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw new Error(`git: ${result.error.message}`);
  if (result.status !== 0) throw new Error("could not read HEAD");
  return result.stdout.trim();
}

/** The Suite Go version whose APK the release attaches, or null when absent. */
function goVersion() {
  try {
    const config = JSON.parse(readFileSync(join(ROOT, "apps/go/app.config.json"), "utf8"));
    return typeof config.version === "string" && config.version.length > 0 ? config.version : null;
  } catch {
    return null;
  }
}

/**
 * The install lines a person runs after the release.
 *
 * The host installs from the signed remote. The APK lives outside Flatpak, so
 * its path and the stable alias are both named: the versioned file is canonical
 * and `suite-go.apk` is what `releases/latest` always serves.
 */
export function installLines(version = goVersion()) {
  const lines = [
    "Suite Desk (desktop):",
    "  flatpak install --user suite run.suite.shell",
    "  flatpak run run.suite.shell",
  ];
  if (version !== null) {
    const apk = join(APK_DIR, goApkName(version));
    lines.push("Suite Go (mobile):");
    lines.push(`  adb install -r -t ${apk}`);
    lines.push(`  ${apk} (stable alias: ${join(APK_DIR, GO_APK_ALIAS)})`);
  } else {
    lines.push("Suite Go (mobile):");
    lines.push(`  ${join(APK_DIR, GO_APK_ALIAS)} (versioned APK name unknown)`);
  }
  return lines;
}

function run(step) {
  process.stdout.write(`\n$ ${commandText(step)}\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw new Error(`${step.command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${step.command} exited ${result.status}`);
}

/** Throw unless the gate proof permits a publish of this HEAD. */
function assertProof() {
  const refusal = publishRefusal(readGateStatus(), currentHead());
  if (refusal !== null) throw new Error(refusal);
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const steps = releaseSteps(options);
  const head = currentHead();
  const status = readGateStatus();
  const refusal = publishRefusal(status, head);

  process.stdout.write(options.publish ? "\nSuite Desk + Suite Go release · publish\n" : "\nSuite Desk + Suite Go release · dry run\n");
  process.stdout.write(`\n  head        ${head}\n`);
  process.stdout.write(
    `  gate proof  ${
      status === null
        ? "none"
        : `${String(status.commit).slice(0, 12)}${status.fresh === true ? " fresh" : " working tree"}${
            status.ok === true ? "" : " (failed)"
          }${typeof status.only === "string" && status.only.length > 0 ? ` (only ${status.only})` : ""}`
    }\n`,
  );
  process.stdout.write(`  target      ${options.target}\n`);
  process.stdout.write(`  apk         ${options.skipApk ? "skipped" : "attached"}\n`);

  if (options.publish && options.skipGate) {
    // Nothing regenerates the proof, so refuse before the first build.
    assertProof();
  }

  for (const step of steps) {
    if (!options.publish) {
      process.stdout.write(`\n  $ ${commandText(step)}\n`);
      process.stdout.write(`    ${step.note}\n`);
      continue;
    }
    run(step);
    // The gate step is what writes the proof; read it before any packaging.
    if (step.id === "gate") assertProof();
  }

  process.stdout.write("\nInstall what this published:\n\n");
  for (const line of installLines()) process.stdout.write(`  ${line}\n`);

  if (!options.publish) {
    process.stdout.write(
      refusal === null
        ? "\ndry run: nothing was run, packaged or published.\n" +
            "To publish: node scripts/release-suite.mjs --publish\n"
        : `\ndry run: nothing was run, packaged or published.\n` +
            "A publish would refuse:\n\n" +
            `${refusal}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    process.exit(1);
  }
}
