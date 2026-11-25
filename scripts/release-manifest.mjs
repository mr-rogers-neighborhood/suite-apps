#!/usr/bin/env node
/**
 * The release manifest: one JSON entry point for everything a channel ships.
 *
 * D2.1 asks for a digest, a source commit, a lockfile hash and a signer identity
 * for every artifact, and for the channel to point at a manifest entry rather
 * than a folder. This writes that file for one publication: the two artifacts
 * this repository ships, their hashes, the commit they came from, the lockfile
 * that resolved their dependencies, and the keys that signed them.
 *
 * The manifest is attached to the rolling release draft before the draft is
 * published, so it becomes immutable with the release.
 *
 * The APK artifact also records the channel's `versionCode` and `versionName`, so
 * the next publication can prove that its code is at least the one already
 * published on the same package id (delivery.md D4.2). The code comes from
 * `versionCodeFor` in `scripts/android-release.mjs`, not a second copy of the
 * formula.
 *
 * Usage:
 *   node scripts/release-manifest.mjs \
 *     --channel preview \
 *     --flatpak .dev/release/suite-shell-preview.flatpak \
 *     --flatpak-id run.suite.preview.shell \
 *     --flatpak-branch preview \
 *     --flatpak-commit-file .dev/release/suite-shell-preview.commit \
 *     --apk apps/go/.dev/release/suite-go-preview-0.1.0.apk \
 *     --apk-id run.suite.preview.go \
 *     --commit "$GITHUB_SHA" \
 *     --out .dev/release/release-manifest.json
 *
 * `--commit` defaults to `git rev-parse HEAD`. A tree exported without git
 * history, such as a `--fresh` gate export, passes it explicitly.
 *
 * spec: D2.1
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANNEL_PACKAGE_ID, versionCodeFor } from "./android-release.mjs";
import { ANDROID_RELEASE_CERT_SHA256 } from "./lib/androidKey.mjs";
import { channelProblem, isPreRelease } from "./lib/channel.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the version and the base both live. */
const GO_CONFIG = join(ROOT, "apps", "go", "app.config.json");

/**
 * The version name and code one channel's Suite Go APK carries.
 *
 * The build reads the same `app.config.json`, so the manifest records the values
 * the artifact was built with rather than a second, drifting guess.
 */
export function apkIdentityFor(config, channel) {
  const problem = channelProblem(channel);
  if (problem !== null) throw new Error(problem);
  if (typeof config?.version !== "string" || config.version.length === 0) {
    throw new Error("apps/go/app.config.json names no version");
  }
  return {
    versionName: isPreRelease(channel) ? `${config.version}-${channel}` : config.version,
    versionCode: versionCodeFor(config.versionCode, channel),
  };
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The manifest object, from values the caller already proved. */
export function buildManifest({ channel, commit, lockfileSha, artifacts, signers }) {
  return {
    format: 1,
    channel,
    commit,
    lockfile: { path: "pnpm-lock.yaml", sha256: lockfileSha },
    artifacts,
    signers,
  };
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function main(argv) {
  const options = {
    channel: null,
    flatpak: null,
    flatpakId: null,
    flatpakBranch: null,
    flatpakCommitFile: null,
    apk: null,
    apkId: null,
    out: null,
    commit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--channel") {
      options.channel = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--flatpak") {
      options.flatpak = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--flatpak-id") {
      options.flatpakId = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--flatpak-branch") {
      options.flatpakBranch = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--flatpak-commit-file") {
      options.flatpakCommitFile = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--apk") {
      options.apk = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--apk-id") {
      options.apkId = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--out") {
      options.out = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--commit") {
      options.commit = takeValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }

  for (const [flag, value] of [
    ["--channel", options.channel],
    ["--flatpak", options.flatpak],
    ["--flatpak-id", options.flatpakId],
    ["--flatpak-branch", options.flatpakBranch],
    ["--flatpak-commit-file", options.flatpakCommitFile],
    ["--apk", options.apk],
    ["--apk-id", options.apkId],
    ["--out", options.out],
  ]) {
    if (value === null) throw new Error(`${flag} is required`);
  }

  const commit =
    options.commit ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error(`the source commit is not one 40-character object name: ${commit}`);
  }
  const lockfileSha = sha256File(join(ROOT, "pnpm-lock.yaml"));
  const flatpakCommit = readFileSync(options.flatpakCommitFile, "utf8").trim();
  if (!/^[0-9a-f]{64}$/u.test(flatpakCommit)) {
    throw new Error(
      `${options.flatpakCommitFile} does not carry one OSTree commit checksum: ${flatpakCommit}`,
    );
  }

  const apkIdentity = apkIdentityFor(
    JSON.parse(readFileSync(GO_CONFIG, "utf8")),
    options.channel,
  );
  const expectedApkId = CHANNEL_PACKAGE_ID[options.channel];
  if (options.apkId !== expectedApkId) {
    throw new Error(
      `--apk-id ${options.apkId} is not ${expectedApkId}, the ${options.channel} package ` +
        "id: the manifest would record a versionCode for another artifact.",
    );
  }

  const manifest = buildManifest({
    channel: options.channel,
    commit,
    lockfileSha,
    artifacts: [
      {
        kind: "flatpak",
        id: options.flatpakId,
        branch: options.flatpakBranch,
        commit: flatpakCommit,
        file: relative(ROOT, options.flatpak),
        sha256: sha256File(options.flatpak),
        size: statSync(options.flatpak).size,
      },
      {
        kind: "apk",
        id: options.apkId,
        ...apkIdentity,
        file: relative(ROOT, options.apk),
        sha256: sha256File(options.apk),
        size: statSync(options.apk).size,
      },
    ],
    signers: {
      flatpak: process.env.SUITE_STORE_KEY_ID?.trim() || null,
      android: ANDROID_RELEASE_CERT_SHA256,
    },
  });

  writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${options.out}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
