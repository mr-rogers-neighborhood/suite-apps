#!/usr/bin/env node
/**
 * Build the Suite Go APK and attach it to the rolling Suite release.
 *
 * This is a **debug** build, signed with the build machine's debug keystore
 * (`~/.android/debug.keystore`). Two consequences, both deliberate:
 *
 * - **The signature is machine-specific.** An APK built on another machine is a
 *   different signer, so Android refuses it as an update. Switching machines
 *   needs `adb uninstall run.suite.go` once, then a fresh install.
 * - **This is not a store artifact.** There is no release signing key and no
 *   Play Store channel yet. The debug APK is what a person sideloads and what
 *   the owner tests; it is fine to attach to the rolling release for that.
 *
 * The upload also carries `suite-go.apk`, the same bytes under a stable name, so
 * `releases/latest/download/suite-go.apk` always names the newest build. The
 * versioned asset stays canonical and is what the release table links.
 *
 * The steps are the ones `apps/go/scripts/android.mjs` already uses for the dev
 * loop: build the web bundle, sync it into the committed Android project, then
 * `assembleDebug`. Nothing here needs a device: the APK is built, copied out
 * under a versioned name, checksummed, and the install line is printed for
 * whoever has one attached.
 *
 * Usage:
 *   node scripts/android-release.mjs             # build, name and check the APK
 *   node scripts/android-release.mjs --publish   # also upload it to the release
 *   node scripts/android-release.mjs --dry-run   # default; print, do not upload
 *   node scripts/android-release.mjs --help
 *
 * `--publish` uploads to the aggregate release `release-status.mjs` marks
 * Latest. It refuses when that release does not exist, because the rolling
 * release is created by `node scripts/release-status.mjs --publish`, not here.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveJdk, resolveSdkRoot } from "../apps/go/scripts/preflight.mjs";
import { currentAggregateTag, goApkName } from "./release-status.mjs";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const APP_DIR = join(ROOT, "apps", "go");
export const ANDROID_DIR = join(APP_DIR, "android");

/** Where the named, checksummed artifact waits. Ignored by git. */
export const RELEASE_DIR = join(APP_DIR, ".dev", "release");

/** What Gradle writes before the artifact is renamed for the release. */
const GRADLE_APK = join(
  ANDROID_DIR,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const USAGE = `usage: node scripts/android-release.mjs [options]

  --publish            upload the APK and its checksum to the rolling release
  --dry-run            print the upload command instead; the default
  --help               print this text

The build is always a debug build, signed with this machine's debug keystore.
It is a sideload artifact, not a store artifact; no signing key is read.
`;

function quote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

function commandText(name, args) {
  return [name, ...args.map(quote)].join(" ");
}

/** Run a command with the Android environment, printing it first. */
function command(name, args, { cwd = ROOT, env } = {}) {
  process.stdout.write(`\n$ ${commandText(name, args)}\n`);
  const result = spawnSync(name, args, {
    cwd,
    env: env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} exited ${result.status}`);
}

/** The APK version, from the config Gradle also reads. */
function appConfig() {
  return JSON.parse(readFileSync(join(APP_DIR, "app.config.json"), "utf8"));
}

/**
 * The stable name on the Latest release.
 *
 * `suite-go-<version>.apk` is canonical and is what the release table links.
 * This alias carries the same bytes under a name that never changes, so a
 * README can link `releases/latest/download/suite-go.apk` forever.
 */
export const GO_APK_ALIAS = "suite-go.apk";

/** The three asset names one publish uploads, in order. */
export function uploadNames(version) {
  const asset = goApkName(version);
  return [asset, `${asset}.sha256`, GO_APK_ALIAS];
}

/**
 * The SDK and JDK Gradle needs, or the reasons they are missing.
 *
 * `apps/go/scripts/preflight.mjs` already owns these lookups, including the
 * `SUITE_GO_JAVA_HOME` escape hatch and the unpacked JDK under `~/Android`.
 * Asking it here keeps a hand-run release and `pnpm android:install` on the
 * same toolchain, and a missing one becomes a sentence rather than a Gradle
 * stack trace forty lines deep.
 */
export function resolveToolchain() {
  const problems = [];
  const sdkRoot = resolveSdkRoot();
  const jdk = resolveJdk();

  if (sdkRoot === null) {
    problems.push(
      "no Android SDK found: set ANDROID_HOME, or install one at ~/Android/Sdk",
    );
  } else {
    const platformsDir = join(sdkRoot, "platforms");
    const platforms = existsSync(platformsDir) ? readdirSync(platformsDir) : [];
    if (platforms.length === 0) {
      problems.push(
        `the SDK at ${sdkRoot} has no platforms: install one with ` +
          `sdkmanager --sdk_root=${sdkRoot} "platforms;android-36"`,
      );
    }
  }

  if (jdk === null) {
    problems.push(
      "no JDK 17 or 21 found: set SUITE_GO_JAVA_HOME, or install one. " +
        "Gradle reads JAVA_HOME, not `java` on PATH.",
    );
  }

  if (!existsSync(join(ANDROID_DIR, "gradlew"))) {
    problems.push(
      "apps/go/android is missing: generate it once with " +
        "`pnpm --filter @suite/go-app exec cap add android`",
    );
  }

  return { sdkRoot, jdk, problems };
}

/** The toolchain variables Gradle and `cap sync` need in one environment. */
function androidEnvironment(sdkRoot, jdk) {
  const env = { ...process.env };
  env.ANDROID_HOME = sdkRoot;
  env.ANDROID_SDK_ROOT = sdkRoot;
  env.JAVA_HOME = jdk;
  env.PATH = `${join(sdkRoot, "platform-tools")}:${env.PATH ?? ""}`;
  return env;
}

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Build the debug APK, copy it out under its release name and checksum it.
 *
 * `suite-go-<version>.apk` is the asset name `release-status.mjs` links, so the
 * two scripts cannot drift on spelling. `suite-go.apk` is the same bytes under
 * the stable name the README links through `releases/latest`. The checksum file
 * uses the `sha256sum` format, which is what a person already has.
 */
function build({ config, env }) {
  const version = config.version;
  const [asset, checksum, alias] = uploadNames(version);
  mkdirSync(RELEASE_DIR, { recursive: true });

  command("pnpm", ["--filter", "@suite/go-app", "build"]);
  command("pnpm", ["--filter", "@suite/go-app", "exec", "cap", "sync", "android"], {
    cwd: APP_DIR,
    env,
  });
  command(
    "./gradlew",
    [
      "assembleDebug",
      `-PsuiteVersionName=${version}`,
      `-PsuiteVersionCode=${String(config.versionCode)}`,
      "-q",
    ],
    { cwd: ANDROID_DIR, env },
  );

  if (!existsSync(GRADLE_APK)) {
    throw new Error(
      `Gradle reported success but ${GRADLE_APK} is missing. The build output above names why.`,
    );
  }

  const apkPath = join(RELEASE_DIR, asset);
  copyFileSync(GRADLE_APK, apkPath);

  const sha256 = sha256OfFile(apkPath);
  const checksumPath = join(RELEASE_DIR, checksum);
  writeFileSync(checksumPath, `${sha256}  ${asset}\n`);

  // A copy, not a second build: the alias has to be the exact bytes the
  // versioned asset carries, or the stable URL would download another app.
  const aliasPath = join(RELEASE_DIR, alias);
  copyFileSync(apkPath, aliasPath);

  return { version, asset, apkPath, checksumPath, alias, aliasPath, sha256 };
}

/**
 * What `gh release view` answered, as three distinct states.
 *
 * A missing release and a missing or unauthenticated `gh` need different
 * remedies: the first wants `release-status.mjs --publish`, the second wants a
 * working GitHub CLI. `gh` reports a missing release on stderr; anything else
 * that is not a success is the CLI being unavailable.
 */
export function classifyReleaseView({ error = null, status = null, stderr = "" } = {}) {
  if (error !== null) return { state: "unavailable", detail: String(error.message ?? error) };
  if (status === 0) return { state: "present", detail: null };
  const text = String(stderr).trim();
  if (/release not found|HTTP 404/iu.test(text)) {
    return { state: "missing", detail: text };
  }
  return { state: "unavailable", detail: text || `gh exited ${status}` };
}

/** Whether gh can see the rolling release, and why not when it cannot. */
function readRelease(tag) {
  const result = spawnSync("gh", ["release", "view", tag, "--json", "tagName"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return classifyReleaseView({
    error: result.error ?? null,
    status: result.status,
    stderr: result.stderr ?? "",
  });
}

async function main(argv) {
  const options = { publish: false, dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else {
      process.stderr.write(`unknown option ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  if (options.publish && options.dryRun) {
    process.stderr.write("--publish and --dry-run contradict each other\n\n" + USAGE);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const config = appConfig();
  const packageVersion = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")).version;
  if (packageVersion !== config.version) {
    throw new Error(
      `apps/go/package.json says ${packageVersion} but app.config.json says ${config.version}. ` +
        "The APK name follows app.config.json, so the two have to agree before a release.",
    );
  }

  const toolchain = resolveToolchain();
  if (toolchain.problems.length > 0) {
    process.stderr.write(`${RED}Cannot build the Suite Go APK.${RESET}\n`);
    for (const problem of toolchain.problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(
      `\n${DIM}pnpm --filter @suite/go-app run doctor names the same gaps and the command for each.${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const tag = currentAggregateTag();
  const release = readRelease(tag);

  // Fail before a long build when there is nowhere to upload: the rolling release
  // belongs to `release-status.mjs`, and a missing `gh` is a different problem.
  if (options.publish && release.state === "missing") {
    throw new Error(
      `no GitHub release ${tag}, so there is nowhere to attach the APK.\n` +
        "Run `node scripts/release-status.mjs --publish` first; it creates the rolling " +
        "release. Then run this again.",
    );
  }
  if (options.publish && release.state === "unavailable") {
    throw new Error(
      `could not read GitHub release ${tag}, so the upload is refused` +
        (release.detail === "" ? "." : `:\n  ${release.detail}`) +
        "\nCheck `gh auth status` and that the repository is reachable, then run this again.",
    );
  }

  const env = androidEnvironment(toolchain.sdkRoot, toolchain.jdk);
  const built = build({ config, env });
  const size = statSync(built.apkPath).size;

  process.stdout.write(`\n${GREEN}debug APK${RESET} ${built.apkPath}\n`);
  process.stdout.write(`  size      ${size} bytes\n`);
  process.stdout.write(`  sha256    ${built.sha256}\n`);
  process.stdout.write(`  checksum  ${built.checksumPath}\n`);
  process.stdout.write(`  alias     ${built.aliasPath}\n`);
  process.stdout.write(
    `\nInstall on an attached phone:\n  adb install -r -t ${quote(built.apkPath)}\n`,
  );
  process.stdout.write(
    `${DIM}The debug signature is machine-specific: another build machine needs ` +
      `\`adb uninstall run.suite.go\` first.${RESET}\n`,
  );

  const upload = [
    "gh",
    [
      "release",
      "upload",
      tag,
      built.apkPath,
      built.checksumPath,
      built.aliasPath,
      "--clobber",
    ],
  ];

  if (options.publish) {
    command(upload[0], upload[1]);
    process.stdout.write(`\n${GREEN}uploaded${RESET} ${built.asset} to ${tag}\n`);
    return;
  }

  process.stdout.write(`\nDry run: nothing was uploaded. The upload would be:\n`);
  process.stdout.write(`  $ ${commandText(upload[0], upload[1])}\n`);
  if (release.state === "missing") {
    process.stdout.write(
      `${DIM}${tag} does not exist yet; \`--publish\` refuses until ` +
        "`node scripts/release-status.mjs --publish` has created it.${RESET}\n",
    );
  } else if (release.state === "unavailable") {
    process.stdout.write(
      `${DIM}gh could not read ${tag}, so \`--publish\` would refuse. Check \`gh auth status\`.${RESET}\n`,
    );
  } else {
    process.stdout.write(`${DIM}${tag} exists; the rolling release is ready for it.${RESET}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${RED}${error.message}${RESET}\n`);
    process.exit(1);
  }
}
