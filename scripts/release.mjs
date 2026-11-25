#!/usr/bin/env node
/**
 * The release helpers the publishing paths share, and the gate proof.
 *
 * This script publishes nothing. Desktop apps ship as Flatpaks on the signed OSTree remote;
 * `scripts/flatpak-remote.mjs` publishes that repository. Suite Go's APK is published by
 * `scripts/android-release.mjs`, and `scripts/release-status.mjs` writes the release bodies and
 * `RELEASES.md`. What remains here is the part all of them need: reading a version and its changelog
 * section, refusing a dirty tree, and refusing a commit `.dev/gate-status.json` has not proven.
 *
 * The relay tarball this file used to build, sign and upload is retired. `sync-v<version>` releases
 * stay on GitHub as history and are not an install path; the last `run.suite.sync` Flatpak ref stays
 * published and gets no new build.
 *
 * Usage:
 *   node scripts/release.mjs --help
 */
import { pathToFileURL } from "node:url";

const USAGE = `usage: node scripts/release.mjs --help

This script publishes nothing; it holds the release helpers.

  Desktop apps                 node scripts/flatpak-remote.mjs --target s3 --publish
  Suite Go's APK               node scripts/android-release.mjs --publish
  Release drafts               node scripts/release-status.mjs --draft
  Publish, RELEASES.md         node scripts/release-status.mjs --publish

The relay tarball release is retired. Older sync-v<version> assets remain
downloadable history; the last run.suite.sync Flatpak ref stays published and
gets no new build.
`;

/** The version a `package.json` names, or null when it names none. */
export function versionFromPackage(text) {
  try {
    const value = JSON.parse(text).version;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** The `## [version]` heading a release note must have, or null when it is missing. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/u);
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "u");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^## /u.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** Why this version cannot be released from this changelog, or null. */
export function changelogProblem(text, version) {
  if (version === "Unreleased") return "Unreleased is a section, not a version to release";
  if (changelogSection(text, version) !== null) return null;
  return (
    `${version} has no '## [${version}]' heading in the changelog. ` +
    "A release note is what the tag promises, so it has to exist before the tag."
  );
}

/** Why the tree is not a release, or null when it is clean. */
export function dirtyTreeProblem(porcelain) {
  const changed = porcelain.trim();
  if (changed.length === 0) return null;
  return (
    "the tree has uncommitted changes, so this is not a release:\n" +
    `${changed.split(/\r?\n/u).slice(0, 10).join("\n")}\n` +
    "Commit or stash them first."
  );
}

/**
 * Why the gate has not proven this commit, or null when it has.
 *
 * `.dev/gate-status.json` names the commit and whether the gate ran against a
 * clean export of it. A working-tree run proves the tree, not the commit, which
 * is why `fresh` matters here.
 *
 * Nothing is published that moves HEAD, so only the exact commit is accepted.
 * `head` is compared against the recorded commit directly.
 */
export function gateProblems(status, head) {
  if (status === null || typeof status !== "object") {
    return ["no .dev/gate-status.json. Run the gate before releasing."];
  }
  const problems = [];
  if (status.ok !== true) problems.push("the last gate run did not pass");
  // `--only <repo>` leaves a passing status for that one repository. It is a
  // useful loop, not a suite proof, and a publish must not read it as one.
  if (typeof status.only === "string" && status.only.length > 0) {
    problems.push(
      `the last gate ran --only ${status.only}, so it proved one repository, not the suite`,
    );
  }
  // The trunk's push proof is the prelude: the libraries and their script tests,
  // with no app row. It is a healthy run, not a suite proof (#407).
  if (status.prelude === true) {
    problems.push("the last gate ran only the prelude, so it proved no app row");
  }
  if (status.fresh !== true) {
    problems.push("the last gate ran on the working tree, not a clean export of this commit");
  }
  if (typeof status.commit !== "string" || status.commit.length < 7) {
    problems.push("the gate status names no commit");
  } else if (!head.startsWith(status.commit)) {
    problems.push(
      `the gate proved ${status.commit}, but HEAD is ${head.slice(0, 12)}: ` +
        "publish only a commit the gate proved",
    );
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.length > 2) {
    process.stderr.write(
      `nothing is published by this script: ${process.argv.slice(2).join(" ")}\n\n${USAGE}`,
    );
    process.exit(2);
  }
  process.stdout.write(USAGE);
}
