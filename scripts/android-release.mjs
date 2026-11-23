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
 *   node scripts/android-release.mjs --upload <apk>     # upload an APK built by an earlier step
 *   node scripts/android-release.mjs --key-status       # is the key the one the tree pins?
 *   node scripts/android-release.mjs --key-generate     # make the release keystore, once
 *   node scripts/android-release.mjs --help
 *
 * `--publish` uploads to the aggregate release `release-status.mjs` marks Latest. It refuses when
 * that release does not exist, because the rolling release is created by
 * `node scripts/release-status.mjs --publish`, not here. Stable also refreshes `suite-go.apk`; a
 * pre-release uploads only its channel-named asset and checksum.
 *
 * `--upload <apk>` replaces the build with a verification step: the APK's certificate is checked
 * against the pin, its package id and version name decide the channel and version, and the staged
 * copy is hashed before upload. It uploads nothing without `--publish`. Pass `--channel` for a
 * pre-release APK, because `run.suite.slop.go` is shared by slop, nightly and preview. Because a
 * published GitHub release is immutable, a published rolling release is refused; `--allow-published`
 * is the explicit override for a repository that has not enabled immutable releases.
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
import { dirname, join, resolve } from "node:path";
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
import { CHANNELS, PRE_RELEASE_CHANNELS, channelProblem, isPreRelease } from "./lib/channel.mjs";
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

  --channel <name>     stable, slop, nightly or preview
  --publish            upload the APK and its checksum to the rolling release
  --dry-run            print the upload command instead; the default
  --upload <apk>       upload an APK built earlier; never builds
  --allow-published    allow a published, non-immutable rolling release
  --key-status         report the release key and whether it matches the pin
  --key-generate       make the release keystore in the Suite key directory
  --force              replace the keystore; only with --key-generate
  --help               print this text

The build is a release build, signed with the key at
${androidKeystorePath()}
or wherever ${ANDROID_KEYSTORE_ENV} points. A debug-signed APK is never a release artifact.

--upload checks the APK's certificate and identity instead of signing one. Without --channel it
accepts a stable APK; a pre-release APK shares one package id across slop, nightly and preview, so
name its channel. --upload still uploads only with --publish.
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

/**
 * The channel and version an already-built APK carries.
 *
 * A stable APK names itself, so `--channel` is optional. The pre-release package id is shared by
 * slop, nightly and preview, so the channel is a decision the artifact cannot make; the caller has
 * to pass it. An explicit channel is checked against both the package id and the version name
 * suffix, so a mislabelled upload is refused before it reaches a release.
 */
export function resolveUploadIdentity({ applicationId = null, versionName = null, channel = null } = {}) {
  if (typeof applicationId !== "string" || applicationId.length === 0) {
    throw new Error("the APK names no package id, so its channel cannot be derived");
  }
  if (typeof versionName !== "string" || versionName.length === 0) {
    throw new Error("the APK names no version, so its asset name cannot be derived");
  }

  if (channel === null || channel === undefined) {
    if (applicationId === CHANNEL_PACKAGE_ID.stable) {
      return { channel: "stable", version: versionName };
    }
    if (applicationId === CHANNEL_PACKAGE_ID.slop) {
      throw new Error(
        `${applicationId} is shared by slop, nightly and preview, so the asset name is ambiguous. ` +
          "Pass --channel slop, --channel nightly or --channel preview.",
      );
    }
    throw new Error(
      `${applicationId} is not a Suite Go release package ` +
        `(${CHANNEL_PACKAGE_ID.stable} or ${CHANNEL_PACKAGE_ID.slop}).`,
    );
  }

  const problem = channelProblem(channel);
  if (problem !== null) throw new Error(problem);

  const expectedId = CHANNEL_PACKAGE_ID[channel];
  if (applicationId !== expectedId) {
    throw new Error(
      `the APK is ${applicationId}, not ${expectedId} for ${channel}: ` +
        "the artifact and --channel disagree.",
    );
  }

  const suffix = isPreRelease(channel) ? `-${channel}` : "";
  if (suffix.length > 0 && !versionName.endsWith(suffix)) {
    throw new Error(
      `the ${channel} APK has version name ${JSON.stringify(versionName)}, which does not end ` +
        `in ${JSON.stringify(suffix)}: the artifact and --channel disagree.`,
    );
  }
  if (suffix.length === 0) {
    const named = PRE_RELEASE_CHANNELS.find((candidate) => versionName.endsWith(`-${candidate}`));
    if (named !== undefined) {
      throw new Error(
        `the APK has version name ${JSON.stringify(versionName)}, which names ${named}: ` +
          "the artifact and --channel stable disagree.",
      );
    }
  }
  const version = suffix.length > 0 ? versionName.slice(0, -suffix.length) : versionName;
  if (version.length === 0) {
    throw new Error(`the APK has no version before ${JSON.stringify(suffix)}`);
  }
  return { channel, version };
}

/**
 * Why a present rolling release cannot take this upload, or null.
 *
 * Drafts are the normal publication state (D6.3): every asset is attached before the release is
 * published. A published release may be immutable, in which case no flag can reopen it; a
 * repository without immutable releases can still take a late asset, but only when the caller says
 * `--allow-published`. An unknown state is treated as immutable rather than guessed.
 */
export function publishedReleaseProblem({ isDraft = null, isImmutable = null, allowPublished = false } = {}) {
  if (isDraft === true) return null;
  if (isDraft !== false) {
    return "could not tell whether the rolling release is a draft, so the upload is refused.";
  }
  if (isImmutable === true) {
    return (
      "the rolling release is published and immutable, so its assets are locked. " +
      "Publish a new draft instead; --allow-published cannot reopen an immutable release."
    );
  }
  if (isImmutable !== false) {
    return (
      "the rolling release is published and its immutability could not be read, so the upload " +
        "is refused rather than risking a locked asset."
    );
  }
  if (!allowPublished) {
    return (
      "the rolling release is already published. Pass --allow-published only when the repository " +
      "does not use immutable releases; otherwise publish a new draft."
    );
  }
  return null;
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
  if (jdk !== null) env.JAVA_HOME = jdk;
  // Gradle reads JAVA_HOME; `apksigner` is a shell script that runs `java` from PATH.
  const path = [join(sdkRoot, "platform-tools")];
  if (jdk !== null) path.push(join(jdk, "bin"));
  env.PATH = [...path, env.PATH ?? ""].join(":");
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

/** The certificate digest on `apkPath`, proven against the pin this tree carries. */
function verifyApkCertificate(apkPath, { env, buildTools }) {
  const verified = capture(buildTools.apksigner, ["verify", "--print-certs", apkPath], { env });
  if (verified.status !== 0) {
    throw new Error(
      `apksigner refused ${apkPath}:\n${(verified.stderr || verified.stdout).trim()}`,
    );
  }
  // `apksigner` writes the certificate block to stdout on some versions and to
  // stderr on others; read both, and show the output when neither has it.
  const output = `${verified.stdout}\n${verified.stderr}`;
  const fingerprint = parseApksignerFingerprint(output);
  if (fingerprint === null) {
    throw new Error(`apksigner printed no certificate for ${apkPath}:\n${output.trim()}`);
  }
  const pin = normaliseFingerprint(ANDROID_RELEASE_CERT_SHA256);
  if (fingerprint !== pin) {
    throw new Error(
      `refusing to publish: the APK is signed by ${groupedFingerprint(fingerprint)}, ` +
        `but this tree pins ${groupedFingerprint(pin)}. A debug-signed artifact is not a release.`,
    );
  }
  return fingerprint;
}

/** The package id, versionCode and version name the bytes actually carry. */
function readApkIdentity(apkPath, { env, buildTools }) {
  const badging = capture(buildTools.aapt, ["dump", "badging", apkPath], { env });
  if (badging.status !== 0) {
    throw new Error(`aapt could not read ${apkPath}:\n${badging.stderr.trim()}`);
  }
  const identity = parseBadging(badging.stdout);
  if (identity === null) throw new Error(`aapt printed no package line for ${apkPath}`);
  return identity;
}

/**
 * Put the exact artifact under its release name and write its checksum.
 *
 * A copy is made only when the input is not already the staged path. The hash of the staged copy
 * must equal the input's, so a rename or a copy can never change which bytes are published.
 */
function stageArtifact({ sourcePath, asset, checksum, alias }) {
  const sourceSha = sha256OfFile(sourcePath);
  mkdirSync(RELEASE_DIR, { recursive: true });

  const apkPath = join(RELEASE_DIR, asset);
  if (resolve(sourcePath) !== resolve(apkPath)) copyFileSync(sourcePath, apkPath);

  const sha256 = sha256OfFile(apkPath);
  if (sha256 !== sourceSha) {
    throw new Error(
      `refusing to upload ${sourcePath}: the staged copy hashes to ${sha256}, not ${sourceSha}.`,
    );
  }

  const checksumPath = join(RELEASE_DIR, checksum);
  writeFileSync(checksumPath, `${sha256}  ${asset}\n`);

  // A copy, not a second build: the alias has to be the exact bytes the
  // versioned asset carries, or the stable URL would download another app.
  let aliasPath = null;
  if (alias !== undefined) {
    aliasPath = join(RELEASE_DIR, alias);
    copyFileSync(apkPath, aliasPath);
  }

  return { apkPath, checksumPath, aliasPath, sha256 };
}

/** Fail if the staged file stopped being the bytes that were verified and checksummed. */
function assertStagedArtifact(artifact) {
  const actual = sha256OfFile(artifact.apkPath);
  if (actual !== artifact.sha256) {
    throw new Error(
      `refusing to upload ${artifact.apkPath}: it hashes to ${actual}, but the attested ` +
        `artifact is ${artifact.sha256}.`,
    );
  }
  if (artifact.aliasPath !== null) {
    const alias = sha256OfFile(artifact.aliasPath);
    if (alias !== artifact.sha256) {
      throw new Error(
        `refusing to upload ${artifact.aliasPath}: the alias hashes to ${alias}, not the ` +
          `versioned asset's ${artifact.sha256}.`,
      );
    }
  }
}

/** The one upload command, for both the build path and `--upload`. */
function uploadCommand({ tag, artifact }) {
  return [
    "gh",
    [
      "release",
      "upload",
      tag,
      artifact.apkPath,
      artifact.checksumPath,
      ...(artifact.aliasPath === null ? [] : [artifact.aliasPath]),
      "--clobber",
    ],
  ];
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

  const fingerprint = verifyApkCertificate(gradleApk, { env, buildTools });
  const identity = readApkIdentity(gradleApk, { env, buildTools });
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

  const staged = stageArtifact({
    sourcePath: gradleApk,
    asset,
    checksum,
    alias,
  });

  return {
    version,
    channel,
    base,
    versionCode: expectedCode,
    applicationId: identity.applicationId,
    asset,
    alias,
    ...staged,
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
  const result = spawnSync(
    "gh",
    ["release", "view", tag, "--json", "tagName,isDraft,isImmutable"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    },
  );
  const view = classifyReleaseView({
    error: result.error ?? null,
    status: result.status,
    stderr: result.stderr ?? "",
  });
  if (view.state !== "present") return view;

  let data = null;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    data = null;
  }
  return {
    ...view,
    isDraft: typeof data?.isDraft === "boolean" ? data.isDraft : null,
    isImmutable: typeof data?.isImmutable === "boolean" ? data.isImmutable : null,
  };
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

/**
 * The options `main` understands, separated so a test never builds anything.
 *
 * `channel` is null when it was not passed: the build path defaults to stable, while `--upload`
 * lets the APK decide (and refuses an ambiguous pre-release).
 */
export function parseArgs(argv) {
  const options = {
    publish: false,
    dryRun: false,
    help: false,
    channel: null,
    upload: null,
    allowPublished: false,
    keyStatus: false,
    keyGenerate: false,
    force: false,
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
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-published") options.allowPublished = true;
    else if (arg === "--key-status" || arg === "status") options.keyStatus = true;
    else if (arg === "--key-generate" || arg === "generate") options.keyGenerate = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--channel") {
      options.channel = takeValue(index, "--channel");
      index += 1;
    } else if (arg === "--upload") {
      options.upload = takeValue(index, "--upload");
      index += 1;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

/** Why this rolling release cannot take an upload, or null. */
function releaseRefusal({ tag, release, allowPublished, checkPublished = true }) {
  if (release.state === "missing") {
    return (
      `no GitHub release ${tag}, so there is nowhere to attach the APK.\n` +
      "Run `node scripts/release-status.mjs --publish` first; it creates the rolling " +
      "release. Then run this again."
    );
  }
  if (release.state === "unavailable") {
    return (
      `could not read GitHub release ${tag}, so the upload is refused` +
      (release.detail === "" ? "." : `:\n  ${release.detail}`) +
      "\nCheck `gh auth status` and that the repository is reachable, then run this again."
    );
  }
  if (!checkPublished) return null;
  return publishedReleaseProblem({
    isDraft: release.isDraft ?? null,
    isImmutable: release.isImmutable ?? null,
    allowPublished,
  });
}

/** The lines every verified artifact prints, built or uploaded. */
function reportArtifact({ artifact, size }) {
  process.stdout.write(
    `\n${GREEN}${artifact.channel} release APK${RESET} ${artifact.apkPath}\n`,
  );
  process.stdout.write(`  package    ${artifact.applicationId}\n`);
  process.stdout.write(`  version    ${artifact.version} (versionCode ${artifact.versionCode})\n`);
  process.stdout.write(`  signer     ${groupedFingerprint(artifact.fingerprint)}\n`);
  process.stdout.write(`  size       ${size} bytes\n`);
  process.stdout.write(`  sha256     ${artifact.sha256}\n`);
  process.stdout.write(`  checksum   ${artifact.checksumPath}\n`);
  if (artifact.aliasPath !== null) {
    process.stdout.write(`  alias      ${artifact.aliasPath}\n`);
  }
}

/**
 * Upload an APK that an earlier step already built and attested.
 *
 * Nothing is built or signed here: the certificate must already be the pinned release key, and
 * the package id and version name must agree with `--channel` (or name stable on their own). The
 * staged copy is hashed again before upload, so the bytes sent are the bytes checked here.
 */
function uploadExisting({ options, tag, release, releaseProblem }) {
  const input = options.upload;
  if (!existsSync(input) || !statSync(input).isFile()) {
    throw new Error(`--upload ${input} is not a file`);
  }

  const sdkRoot = resolveSdkRoot();
  if (sdkRoot === null) {
    throw new Error(
      "no Android SDK found: set ANDROID_HOME, or install one at ~/Android/Sdk. " +
        "The APK's certificate and identity cannot be checked without apksigner and aapt.",
    );
  }
  const buildTools = resolveBuildTools(sdkRoot);
  if (buildTools === null) {
    throw new Error(
      `${join(sdkRoot, "build-tools")} has no apksigner and aapt: install build-tools with ` +
        `sdkmanager --sdk_root=${sdkRoot} "build-tools;36.0.0"`,
    );
  }

  const env = androidEnvironment(sdkRoot, resolveJdk());
  const fingerprint = verifyApkCertificate(input, { env, buildTools });
  const identity = readApkIdentity(input, { env, buildTools });
  const { channel, version } = resolveUploadIdentity({
    applicationId: identity.applicationId,
    versionName: identity.versionName,
    channel: options.channel,
  });
  const [asset, checksum, alias] = uploadNames(version, channel);

  const artifact = {
    channel,
    version,
    applicationId: identity.applicationId,
    versionCode: identity.versionCode,
    asset,
    alias,
    fingerprint,
    ...stageArtifact({ sourcePath: input, asset, checksum, alias }),
  };

  reportArtifact({ artifact, size: statSync(artifact.apkPath).size });

  finishUpload({ options, tag, release, releaseProblem, artifact });
}

/** Prove the staged bytes still match, then print or run the one upload command. */
function finishUpload({ options, tag, release, releaseProblem, artifact }) {
  assertStagedArtifact(artifact);
  const upload = uploadCommand({ tag, artifact });

  if (options.publish) {
    command(upload[0], upload[1]);
    process.stdout.write(`\n${GREEN}uploaded${RESET} ${artifact.asset} to ${tag}\n`);
    return;
  }

  process.stdout.write(`\nDry run: nothing was uploaded. The upload would be:\n`);
  process.stdout.write(`  $ ${commandText(upload[0], upload[1])}\n`);
  if (releaseProblem !== null) {
    process.stdout.write(`${DIM}${releaseProblem}${RESET}\n`);
  } else if (release.state === "missing") {
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

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
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
  if ((options.keyStatus || options.keyGenerate) && options.upload !== null) {
    process.stderr.write("--upload cannot be combined with --key-status or --key-generate\n\n" + USAGE);
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

  if (options.channel !== null) {
    const problem = channelProblem(options.channel);
    if (problem !== null) {
      process.stderr.write(`${problem}\n\n${USAGE}`);
      process.exit(2);
    }
  }

  if (options.upload !== null) {
    const tag = currentAggregateTag();
    const release = readRelease(tag);
    const releaseProblem = releaseRefusal({
      tag,
      release,
      allowPublished: options.allowPublished,
    });
    if (options.publish && releaseProblem !== null) throw new Error(releaseProblem);
    uploadExisting({ options, tag, release, releaseProblem });
    return;
  }

  const channel = options.channel ?? "stable";

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
  const releaseProblem = releaseRefusal({
    tag,
    release,
    allowPublished: options.allowPublished,
    checkPublished: false,
  });

  // Fail before a long build when there is nowhere to upload: the rolling release
  // belongs to `release-status.mjs`, and a missing `gh` is a different problem.
  // The publish-time immutable check belongs to `--upload`; the workstation build
  // path keeps its long-standing behaviour.
  if (options.publish && releaseProblem !== null) throw new Error(releaseProblem);

  const env = androidEnvironment(toolchain.sdkRoot, toolchain.jdk, signing);
  const built = build({ config, channel, env, buildTools });
  const size = statSync(built.apkPath).size;

  reportArtifact({ artifact: built, size });
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

  finishUpload({ options, tag, release, releaseProblem, artifact: built });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${RED}${error.message}${RESET}\n`);
    process.exit(1);
  }
}
