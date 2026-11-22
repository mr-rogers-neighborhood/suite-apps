#!/usr/bin/env node
/**
 * Build a channel-aware Suite Go APK, signed with the release key, and name it for the release.
 *
 * The APK is a release build signed by the key in the Suite key directory, never by the build
 * machine's debug keystore. Android refuses an update signed by a different certificate, so the
 * debug key is a dev-loop signature only: an APK signed with it cannot update an installed release
 * and must never be the public artifact. Each build is checked against the pinned certificate
 * fingerprint before it is named, checksummed or uploaded.
 *
 * The channel decides three things:
 *
 * - **The package id.** Stable keeps `run.suite.go`; every pre-release shares
 *   `run.suite.slop.go`, so stable and one pre-release install side by side and moving channel
 *   replaces the pre-release instead of adding a third install.
 * - **The version name and launcher label.** `0.1.0` for stable, `0.1.0-slop` and
 *   “Suite Go (slop)” for a pre-release.
 * - **The asset name.** Stable keeps `suite-go-<version>.apk`, the name the release table links,
 *   plus the `suite-go.apk` alias. A pre-release is `suite-go-<channel>-<version>.apk` with no
 *   stable alias, so a pre-release download can never be mistaken for the stable one.
 *
 * `versionCode` is derived from the one number in `apps/go/app.config.json`:
 *
 *   versionCode = base × 10 + channel digit      stable 0, slop 1, nightly 2, preview 3
 *
 * Within a channel the digit is fixed, so bumping the base always increases the code. Promotion
 * raises the digit, so slop → nightly → preview installs as an update on the shared pre-release id.
 * A demotion lowers it, which Android refuses: uninstall `run.suite.slop.go` first. The full rule
 * is in `apps/go/docs/reference/android.md`.
 *
 * Usage:
 *   node scripts/android-release.mjs                    # stable, build and name the APK
 *   node scripts/android-release.mjs --channel slop     # slop, nightly or preview
 *   node scripts/android-release.mjs --publish          # also upload it to the rolling release
 *   node scripts/android-release.mjs --dry-run          # print the upload; the default
 *   node scripts/android-release.mjs --key-status       # is the key the one the tree pins?
 *   node scripts/android-release.mjs --key-generate     # make the release keystore, once
 *   node scripts/android-release.mjs --help
 *
 * `--publish` uploads to the aggregate release `release-status.mjs` marks Latest. It refuses when
 * that release does not exist, because the rolling release is created by
 * `node scripts/release-status.mjs --publish`, not here. Stable also refreshes `suite-go.apk`; a
 * pre-release uploads only its channel-named asset and checksum.
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
import {
  ANDROID_KEYSTORE_ENV,
  ANDROID_RELEASE_CERT_SHA256,
  androidKeystorePath,
  androidPasswordPath,
  generateAndroidKey,
  groupedFingerprint,
  inspectAndroidKey,
  normaliseFingerprint,
  signingEnvironment,
} from "./lib/androidKey.mjs";
import { CHANNELS, channelProblem, isPreRelease } from "./lib/channel.mjs";
import { currentAggregateTag, goApkName } from "./release-status.mjs";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const APP_DIR = join(ROOT, "apps", "go");
export const ANDROID_DIR = join(APP_DIR, "android");

/** Where the named, checksummed artifact waits. Ignored by git. */
export const RELEASE_DIR = join(APP_DIR, ".dev", "release");

/** The stable name on the Latest release, unchanged by the channel work. */
export const GO_APK_ALIAS = "suite-go.apk";

/**
 * The package id, Gradle flavor and versionCode digit for each channel.
 *
 * This table is the source the build verifies against: after Gradle runs, `aapt` reports the
 * package id and versionCode of the APK, and a mismatch is a refusal rather than a mislabelled
 * upload. `apps/go/android/app/build.gradle` declares the same ids and digits because Gradle needs
 * them at configuration time.
 */
export const CHANNEL_PACKAGE_ID = {
  stable: "run.suite.go",
  slop: "run.suite.slop.go",
  nightly: "run.suite.slop.go",
  preview: "run.suite.slop.go",
};

export const CHANNEL_VERSION_CODE_DIGIT = {
  stable: 0,
  slop: 1,
  nightly: 2,
  preview: 3,
};

/** The highest value Android accepts for a versionCode. */
const MAX_VERSION_CODE = 2_100_000_000;

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const USAGE = `usage: node scripts/android-release.mjs [options]

  --channel <name>     stable (default), slop, nightly or preview
  --publish            upload the APK and its checksum to the rolling release
  --dry-run            print the upload command instead; the default
  --key-status         report the release key and whether it matches the pin
  --key-generate       make the release keystore in the Suite key directory
  --force              replace the keystore; only with --key-generate
  --help               print this text

The build is a release build, signed with the key at
${androidKeystorePath()}
or wherever ${ANDROID_KEYSTORE_ENV} points. A debug-signed APK is never a release artifact.
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

/** A command whose output is kept, for parsing. */
function capture(name, args, { cwd = ROOT, env } = {}) {
  const result = spawnSync(name, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/** The APK version, from the config Gradle also reads. */
function appConfig() {
  return JSON.parse(readFileSync(join(APP_DIR, "app.config.json"), "utf8"));
}

/**
 * The versionCode for one channel.
 *
 * Throws on a base or result Android cannot install, so a bad number is a sentence before a build
 * rather than a Play-style rejection after one.
 */
export function versionCodeFor(base, channel) {
  const digit = CHANNEL_VERSION_CODE_DIGIT[channel];
  if (digit === undefined) throw new Error(`unknown channel ${JSON.stringify(channel)}`);
  if (!Number.isInteger(base) || base <= 0) {
    throw new Error(`app.config.json versionCode must be a positive integer, not ${base}`);
  }
  const code = base * 10 + digit;
  if (code > MAX_VERSION_CODE) {
    throw new Error(
      `${code} is above Android's maximum versionCode (${MAX_VERSION_CODE}); ` +
        "the channel digit alone cannot be made to fit",
    );
  }
  return code;
}

/**
 * The asset name for one channel.
 *
 * Stable keeps the published name and the release table's link. A pre-release names its channel,
 * because two channel builds of one version are different artifacts and only one can own
 * `suite-go-<version>.apk`.
 */
export function goApkAssetName(version, channel = "stable") {
  if (!CHANNELS.includes(channel)) throw new Error(channelProblem(channel) ?? "unknown channel");
  return isPreRelease(channel) ? `suite-go-${channel}-${version}.apk` : goApkName(version);
}

/** The assets one publish uploads: the APK, its checksum, and the stable alias. */
export function uploadNames(version, channel = "stable") {
  const asset = goApkAssetName(version, channel);
  const names = [asset, `${asset}.sha256`];
  if (!isPreRelease(channel)) names.push(GO_APK_ALIAS);
  return names;
}

/** The Gradle task for one channel's release variant. */
export function assembleTask(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(channelProblem(channel) ?? "unknown channel");
  return `assemble${channel.charAt(0).toUpperCase()}${channel.slice(1)}Release`;
}

/** Where Gradle writes that variant's APK before it is renamed for the release. */
export function gradleApkPath(channel) {
  return join(
    ANDROID_DIR,
    "app",
    "build",
    "outputs",
    "apk",
    channel,
    "release",
    `app-${channel}-release.apk`,
  );
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

/** Compare `36.0.0`-style directory names numerically. */
function compareBuildTools(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * `apksigner` and `aapt` from the newest installed build-tools.
 *
 * The signature check and the version read are what make the artifact's claims true: Gradle says
 * which variant it built, and these two tools say which package id, versionCode and certificate
 * the bytes actually carry.
 */
export function resolveBuildTools(sdkRoot) {
  const dir = join(sdkRoot, "build-tools");
  const versions = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /^\d+(\.\d+)+$/u.test(name))
        .sort(compareBuildTools)
        .reverse()
    : [];
  for (const version of versions) {
    const apksigner = join(dir, version, "apksigner");
    const aapt = join(dir, version, "aapt");
    if (existsSync(apksigner) && existsSync(aapt)) {
      return { dir: join(dir, version), apksigner, aapt };
    }
  }
  return null;
}

/** The toolchain variables Gradle, `cap sync` and the APK tools need in one environment. */
function androidEnvironment(sdkRoot, jdk, signing = null) {
  const env = { ...process.env };
  env.ANDROID_HOME = sdkRoot;
  env.ANDROID_SDK_ROOT = sdkRoot;
  env.JAVA_HOME = jdk;
  // Gradle reads JAVA_HOME; `apksigner` is a shell script that runs `java` from PATH.
  env.PATH = `${join(sdkRoot, "platform-tools")}:${join(jdk, "bin")}:${env.PATH ?? ""}`;
  for (const [name, value] of Object.entries(signing ?? {})) env[name] = value;
  return env;
}

/** The certificate digest `apksigner` prints for the APK, or null. */
export function parseApksignerFingerprint(text) {
  const match = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/u.exec(text);
  return match?.[1] ? normaliseFingerprint(match[1]) : null;
}

/**
 * The package line `aapt dump badging` prints.
 *
 * `null` when the line itself is missing, so a malformed APK fails the check instead of passing
 * with undefined values. A missing `versionCode` comes back as null and fails the identity check.
 */
export function parseBadging(text) {
  const line = /^package: (.+)$/mu.exec(text)?.[1];
  if (line === undefined) return null;
  const field = (name) => new RegExp(`${name}='([^']*)'`, "u").exec(line)?.[1] ?? null;
  const versionCode = field("versionCode");
  return {
    applicationId: field("name"),
    versionCode: versionCode === null ? null : Number(versionCode),
    versionName: field("versionName"),
  };
}

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Build one channel's release APK, verify its identity, and name it.
 *
 * The order matters: the key is checked before the build, and the finished APK's certificate,
 * package id and versionCode are checked before it is copied under a release name. A debug-signed
 * or mislabelled artifact therefore cannot reach `RELEASE_DIR` or an upload.
 */
function build({ config, channel, env, buildTools }) {
  const version = config.version;
  const base = config.versionCode;
  const [asset, checksum, alias] = uploadNames(version, channel);
  const expectedCode = versionCodeFor(base, channel);
  const expectedId = CHANNEL_PACKAGE_ID[channel];
  const gradleApk = gradleApkPath(channel);
  mkdirSync(RELEASE_DIR, { recursive: true });

  command("pnpm", ["--filter", "@suite/go-app", "build"]);
  command("pnpm", ["--filter", "@suite/go-app", "exec", "cap", "sync", "android"], {
    cwd: APP_DIR,
    env,
  });
  const gradleArgs = [
    assembleTask(channel),
    `-PsuiteVersionName=${version}`,
    `-PsuiteVersionCode=${String(base)}`,
    "-q",
  ];
  command("./gradlew", gradleArgs, { cwd: ANDROID_DIR, env });

  if (!existsSync(gradleApk)) {
    throw new Error(
      `Gradle reported success but ${gradleApk} is missing. The build output above names why.`,
    );
  }

  const verified = capture(buildTools.apksigner, ["verify", "--print-certs", gradleApk], { env });
  if (verified.status !== 0) {
    throw new Error(
      `apksigner refused ${gradleApk}:\n${(verified.stderr || verified.stdout).trim()}`,
    );
  }
  const fingerprint = parseApksignerFingerprint(verified.stdout);
  if (fingerprint === null) {
    throw new Error(`apksigner printed no certificate for ${gradleApk}`);
  }
  const pin = normaliseFingerprint(ANDROID_RELEASE_CERT_SHA256);
  if (fingerprint !== pin) {
    throw new Error(
      `refusing to publish ${channel}: the APK is signed by ${groupedFingerprint(fingerprint)}, ` +
        `but this tree pins ${groupedFingerprint(pin)}. A debug-signed artifact is not a release.`,
    );
  }

  const badging = capture(buildTools.aapt, ["dump", "badging", gradleApk], { env });
  if (badging.status !== 0) {
    throw new Error(`aapt could not read ${gradleApk}:\n${badging.stderr.trim()}`);
  }
  const identity = parseBadging(badging.stdout);
  if (identity === null) throw new Error(`aapt printed no package line for ${gradleApk}`);
  if (identity.applicationId !== expectedId) {
    throw new Error(
      `the ${channel} APK is ${identity.applicationId}, not ${expectedId}: the Gradle flavor ` +
        "and the channel table disagree.",
    );
  }
  if (identity.versionCode !== expectedCode) {
    throw new Error(
      `the ${channel} APK has versionCode ${identity.versionCode}, not ${expectedCode}: ` +
        "the Gradle digit and the channel table disagree.",
    );
  }
  const expectedName = isPreRelease(channel) ? `${version}-${channel}` : version;
  if (identity.versionName !== expectedName) {
    throw new Error(
      `the ${channel} APK has versionName ${JSON.stringify(identity.versionName)}, ` +
        `not ${JSON.stringify(expectedName)}`,
    );
  }

  const apkPath = join(RELEASE_DIR, asset);
  copyFileSync(gradleApk, apkPath);

  const sha256 = sha256OfFile(apkPath);
  const checksumPath = join(RELEASE_DIR, checksum);
  writeFileSync(checksumPath, `${sha256}  ${asset}\n`);

  // A copy, not a second build: the alias has to be the exact bytes the
  // versioned asset carries, or the stable URL would download another app.
  let aliasPath = null;
  if (alias !== undefined) {
    aliasPath = join(RELEASE_DIR, alias);
    copyFileSync(apkPath, aliasPath);
  }

  return {
    version,
    channel,
    base,
    versionCode: expectedCode,
    applicationId: identity.applicationId,
    asset,
    apkPath,
    checksumPath,
    alias,
    aliasPath,
    sha256,
    fingerprint,
  };
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

/** Print the key's location, fingerprint and pin; a mismatch is a failure. */
function keyStatus({ env, jdk }) {
  const jdkPath = jdk ?? resolveJdk();
  const key = inspectAndroidKey({ env, jdk: jdkPath });
  process.stdout.write(`Suite Go release key · ${androidKeystorePath(env)}\n\n`);

  if (key.state === "absent") {
    process.stdout.write(`- Android release   not present\n`);
    process.stdout.write(`  ${DIM}${androidPasswordPath(env)} would hold the password.${RESET}\n`);
    process.stdout.write(
      `  Make one with \`node scripts/android-release.mjs --key-generate\`, then pin its fingerprint.\n`,
    );
    return;
  }

  if (key.ok) {
    process.stdout.write(
      `ok Android release   ${groupedFingerprint(key.fingerprint)}  matches the pin\n`,
    );
  } else if (key.state === "mismatch") {
    process.stdout.write(`!! Android release   this key signs something Android will refuse\n`);
    process.stdout.write(`   keystore   ${key.path}\n`);
    process.stdout.write(`   this key   ${groupedFingerprint(key.fingerprint)}\n`);
    process.stdout.write(`   pin        ${groupedFingerprint(key.pin)}\n`);
    process.stdout.write(
      `   ${DIM}An update signed by a different certificate is refused. Pin this key, or put the\n` +
        `   one the tree trusts in ${androidKeystorePath(env)}.${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  } else {
    process.stdout.write(`!! Android release   ${key.detail}\n`);
    process.stdout.write(`   keystore   ${key.path}\n`);
    if (key.fingerprint !== null) {
      process.stdout.write(`   this key   ${groupedFingerprint(key.fingerprint)}\n`);
    }
    process.stderr.write(
      key.state === "unpinned"
        ? `\nRecord ${groupedFingerprint(key.fingerprint)} in ANDROID_RELEASE_CERT_SHA256 at\n` +
            "scripts/lib/androidKey.mjs, in the same change that makes the key.\n"
        : `\nCheck the alias (${key.alias}), the password file and that keytool runs on the JDK Gradle uses.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`   keystore   ${key.path}\n`);
  process.stdout.write(`   password   ${androidPasswordPath(env)}\n`);
  process.stdout.write(`   alias      ${key.alias}\n`);
  process.stdout.write(`\n${DIM}A release build refuses any other certificate.${RESET}\n`);
}

/** Make the release keystore and print only what is public. */
function keyGenerate({ env, jdk, force }) {
  const result = generateAndroidKey({ env, jdk: jdk ?? resolveJdk(), force });
  process.stdout.write(`wrote ${result.path} (mode ${result.mode.toString(8)})\n`);
  process.stdout.write(`password in ${result.passwordPath}, readable by its owner alone\n\n`);
  process.stdout.write(`Pin this certificate digest in scripts/lib/androidKey.mjs:\n\n`);
  process.stdout.write(
    `  export const ANDROID_RELEASE_CERT_SHA256 =\n    "${normaliseFingerprint(result.fingerprint)}";\n\n`,
  );
  process.stdout.write(`fingerprint ${groupedFingerprint(result.fingerprint)}\n`);
  process.stdout.write(
    `\nCopy the keystore and its password somewhere you control before you need them. Android\n` +
      "refuses an update signed by another certificate, so losing this key means every installed\n" +
      "build has to be uninstalled before a new one installs.\n",
  );
}

async function main(argv) {
  const options = {
    publish: false,
    dryRun: false,
    help: false,
    channel: "stable",
    keyStatus: false,
    keyGenerate: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--key-status" || arg === "status") options.keyStatus = true;
    else if (arg === "--key-generate" || arg === "generate") options.keyGenerate = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--channel") {
      options.channel = argv[index + 1] ?? "";
      index += 1;
    } else {
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
  if (options.force && !options.keyGenerate) {
    process.stderr.write("--force only means something with --key-generate\n\n" + USAGE);
    process.exit(2);
  }

  if (options.keyStatus) {
    keyStatus({ env: process.env });
    return;
  }
  if (options.keyGenerate) {
    keyGenerate({ env: process.env, force: options.force });
    return;
  }

  const channel = options.channel;
  const problem = channelProblem(channel);
  if (problem !== null) {
    process.stderr.write(`${problem}\n\n${USAGE}`);
    process.exit(2);
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
    for (const entry of toolchain.problems) process.stderr.write(`  - ${entry}\n`);
    process.stderr.write(
      `\n${DIM}pnpm --filter @suite/go-app run doctor names the same gaps and the command for each.${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const buildTools = resolveBuildTools(toolchain.sdkRoot);
  if (buildTools === null) {
    process.stderr.write(`${RED}Cannot verify the APK's signature or identity.${RESET}\n`);
    process.stderr.write(
      `  - ${join(toolchain.sdkRoot, "build-tools")} has no apksigner and aapt: install ` +
        `build-tools with sdkmanager --sdk_root=${toolchain.sdkRoot} "build-tools;36.0.0"\n`,
    );
    process.exitCode = 1;
    return;
  }

  const key = inspectAndroidKey({ env: process.env, jdk: toolchain.jdk });
  if (!key.ok) {
    process.stderr.write(`${RED}Cannot sign a ${channel} release.${RESET}\n`);
    process.stderr.write(`  - ${key.detail}\n`);
    if (key.state === "absent") {
      process.stderr.write(
        `\nMake the release keystore once with \`node scripts/android-release.mjs --key-generate\`.\n` +
          "The debug keystore is a dev-loop signature, not a public artifact.\n",
      );
    } else if (key.state === "mismatch") {
      process.stderr.write(
        `\n  this key   ${groupedFingerprint(key.fingerprint)}\n` +
          `  pin        ${groupedFingerprint(key.pin)}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const signing = signingEnvironment({ env: process.env, key });
  if (signing === null) {
    throw new Error("the keystore is present but its password is not; run --key-status");
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

  const env = androidEnvironment(toolchain.sdkRoot, toolchain.jdk, signing);
  const built = build({ config, channel, env, buildTools });
  const size = statSync(built.apkPath).size;

  process.stdout.write(
    `\n${GREEN}${channel} release APK${RESET} ${built.apkPath}\n`,
  );
  process.stdout.write(`  package    ${built.applicationId}\n`);
  process.stdout.write(`  version    ${config.version} (versionCode ${built.versionCode})\n`);
  process.stdout.write(`  signer     ${groupedFingerprint(built.fingerprint)}\n`);
  process.stdout.write(`  size       ${size} bytes\n`);
  process.stdout.write(`  sha256     ${built.sha256}\n`);
  process.stdout.write(`  checksum   ${built.checksumPath}\n`);
  if (built.aliasPath !== null) {
    process.stdout.write(`  alias      ${built.aliasPath}\n`);
  }
  process.stdout.write(
    `\nInstall on an attached phone:\n  adb install -r -t ${quote(built.apkPath)}\n`,
  );
  process.stdout.write(
    isPreRelease(channel)
      ? `${DIM}This replaces the pre-release install (${CHANNEL_PACKAGE_ID[channel]}); ` +
          "stable is a separate app and is untouched. A demotion to an earlier channel " +
          "needs an uninstall first.${RESET}\n"
      : `${DIM}Stable is ${CHANNEL_PACKAGE_ID[channel]}; a pre-release install sits beside it.${RESET}\n`,
  );

  const upload = [
    "gh",
    [
      "release",
      "upload",
      tag,
      built.apkPath,
      built.checksumPath,
      ...(built.aliasPath === null ? [] : [built.aliasPath]),
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
