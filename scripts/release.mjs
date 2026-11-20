#!/usr/bin/env node
/**
 * Release one app from the monorepo.
 *
 * A release used to be a sequence of remembered commands. With four apps in one
 * repository, the remembered command is the failure mode: the wrong target, the
 * stale changelog heading or the artifact nobody proved all publish silently.
 *
 * This script builds the artifact, signs the manifest, uploads the app's release
 * assets, and commits the feed Pages serves. It refuses to start when the tree,
 * the version, the changelog, the gate status or the built manifest disagree.
 *
 * Two deliberate defaults:
 *
 * - **Nothing is published unless `--publish` is passed.** A dry run is the
 *   default, so running the command to see what it would do cannot upload.
 * - **Nothing is bumped.** The version in `package.json` is the release.
 *
 * The private key never enters this repository. It is read from
 * `SUITE_UPDATE_KEY`, or from `~/.config/suite/update-key.pem`.
 *
 * Usage:
 *   node scripts/release.mjs <app-id> [--publish]
 *   node scripts/release.mjs <app-id> --verify
 *   node scripts/release.mjs --help
 */
import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FEED_HOST = "https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main";
export const RELEASE_REPO = "mr-rogers-neighborhood/suite-apps";
export const FEED_FILE = "latest-linux.yml";

/**
 * Every app this repository publishes.
 *
 * `project` is the package whose `package.json` carries the version electron-builder
 * stamps. Canvas's shell lives one folder below the canvas itself, so its changelog
 * and its project are deliberately different paths.
 */
export const APPS = {
  start: {
    id: "start",
    name: "Suite Start",
    package: "@suite/start",
    project: "apps/start",
    changelog: "apps/start/CHANGELOG.md",
    output: "apps/start/release",
    manifest: null,
    pkgbuild: "apps/start/packaging/arch/PKGBUILD",
  },
  canvas: {
    id: "canvas",
    name: "Suite Canvas",
    package: "@suite/canvas-desktop",
    project: "apps/canvas/desktop",
    changelog: "apps/canvas/CHANGELOG.md",
    output: "apps/canvas/desktop/release",
    manifest: "apps/canvas/desktop/suite.app.json",
    pkgbuild: null,
  },
  planner: {
    id: "planner",
    name: "Suite Planner",
    package: "@suite/planner",
    project: "apps/planner",
    changelog: "apps/planner/CHANGELOG.md",
    output: "apps/planner/release",
    manifest: "apps/planner/suite.app.json",
    pkgbuild: null,
  },
  budget: {
    id: "budget",
    name: "Suite Budget",
    package: "@suite/budget",
    project: "apps/budget",
    changelog: "apps/budget/CHANGELOG.md",
    output: "apps/budget/release",
    manifest: "apps/budget/suite.app.json",
    pkgbuild: null,
  },
};

const USAGE = `usage: node scripts/release.mjs <app-id> [options]

  --publish           upload the release and commit the feed (default: dry run)
  --dry-run           stop before every network write; the default
  --verify            re-read the published feed and verify its signature
  --tag <name>        release tag (default: <app>-v<version>)
  --notes-file <path> release notes (default: the version's changelog section)
  --feed-dir <path>   also copy the artifact, manifest and signature into a folder
  --no-build          reuse the last build in the app's release folder
  --help              print this text

Known apps: ${Object.keys(APPS).join(", ")}
`;

/** The tag a version is published under, so several apps share the repository. */
export function tagFor(app, version) {
  return `${app.id}-v${version}`;
}

/** The Pages folder the app's signed manifest lives in. */
export function feedPath(app) {
  return `feeds/${app.id}/${FEED_FILE}`;
}

/** The base URL an installed app and the hub both read. */
export function feedUrl(app) {
  return `${FEED_HOST}/feeds/${app.id}`;
}

/** The manifest URL Pages serves, which is what a release prints. */
export function manifestUrl(app) {
  return `${feedUrl(app)}/${FEED_FILE}`;
}

/** The base a manifest's artifact URLs resolve against: this app's release tag. */
export function releaseAssetBase(app, version) {
  return `https://github.com/${RELEASE_REPO}/releases/download/${tagFor(app, version)}/`;
}

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
 */
export function gateProblems(status, head) {
  if (status === null || typeof status !== "object") {
    return ["no .dev/gate-status.json. Run the gate before releasing."];
  }
  const problems = [];
  if (status.ok !== true) problems.push("the last gate run did not pass");
  if (status.fresh !== true) {
    problems.push("the last gate ran on the working tree, not a clean export of this commit");
  }
  if (typeof status.commit !== "string" || status.commit.length < 7) {
    problems.push("the gate status names no commit");
  } else if (!head.startsWith(status.commit)) {
    problems.push(`the gate proved ${status.commit}, but HEAD is ${head.slice(0, 12)}`);
  }
  return problems;
}

/** Why the app's own manifest disagrees with its package, or null. */
export function manifestVersionProblem(manifestText, packageVersion) {
  if (manifestText === null) return null;
  let version;
  try {
    version = JSON.parse(manifestText).version;
  } catch {
    return "suite.app.json is not JSON";
  }
  if (version === packageVersion) return null;
  return (
    `package.json says ${packageVersion} and suite.app.json says ${String(version)}. ` +
    "The version, the manifest and the tag describe one commit."
  );
}

function scalar(value) {
  return value.replace(/^["']|["']$/gu, "").trim();
}

function field(line) {
  const match = /^\s*(?:-\s+)?([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
  if (match?.[1] === undefined) return null;
  return { key: match[1], value: scalar(match[2] ?? "") };
}

/** The parts of a `latest-linux.yml` this script has to agree with. */
function readManifest(text) {
  const entries = [];
  let path = null;
  let sha512 = null;
  let version = null;
  let inFiles = false;

  for (const line of text.split(/\r?\n/u)) {
    if (/^\S/u.test(line)) {
      const top = field(line);
      inFiles = top?.key === "files" && top.value.length === 0;
      if (top?.key === "version" && top.value.length > 0) version = top.value;
      if (top?.key === "path" && top.value.length > 0) path = top.value;
      if (top?.key === "sha512" && top.value.length > 0) sha512 = top.value;
      continue;
    }
    if (!inFiles) continue;

    if (/^\s*-\s+/u.test(line)) entries.push({ url: "", sha512: null, size: null });
    const current = entries.at(-1);
    const found = field(line);
    if (current === undefined || found === null) continue;
    if (found.key === "url") current.url = found.value;
    else if (found.key === "sha512") current.sha512 = found.value;
    else if (found.key === "size") {
      const bytes = Number.parseInt(found.value, 10);
      current.size = Number.isFinite(bytes) ? bytes : null;
    }
  }

  return { version, entries, path, sha512 };
}

/** The version a manifest names, or null. */
export function versionFromManifest(text) {
  return readManifest(text).version;
}

/**
 * The filename inside an artifact locator, or null when it could escape the folder.
 *
 * The release script writes an absolute release-asset URL; an older feed may still
 * name a bare file. Only the last segment is ever used as an install name.
 */
export function artifactFilename(locator) {
  const raw = locator.trim();
  if (raw.length === 0) return null;

  let name = raw;
  if (/^https:\/\//u.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:") return null;
      name = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
    } catch {
      return null;
    }
  }

  if (name.length === 0 || name === "." || name === "..") return null;
  if (name.endsWith(".blockmap")) return null;
  if (/[\\/\0]/u.test(name)) return null;
  return name;
}

/** The primary artifact a manifest names, or null when it names none. */
export function manifestArtifact(text) {
  const { entries, path, sha512: declaredSha } = readManifest(text);
  const declaredEntry = path === null ? undefined : entries.find((entry) => entry.url === path);
  const chosen =
    declaredEntry ?? entries.find((entry) => !entry.url.endsWith(".blockmap")) ?? entries[0];
  const locator = path ?? chosen?.url ?? null;
  const sha512 = declaredSha ?? chosen?.sha512 ?? null;
  if (locator === null || sha512 === null) return null;

  const name = artifactFilename(locator);
  if (name === null) return null;
  return { locator, name, sha512, size: chosen?.size ?? null };
}

/**
 * Rewrite a manifest's relative artifact references to the release tag's assets.
 *
 * The manifest is served from Pages, but the bytes it names stay on the release.
 * This is the one transformation that makes the two hosts describe one artifact.
 */
export function absoluteManifest(text, baseUrl) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return text
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^(\s*(?:-\s+)?)(url|path):[ \t]*(.+?)[ \t]*$/u.exec(line);
      if (match === null) return line;
      const [, prefix, key, raw] = match;
      const value = scalar(raw ?? "");
      if (value.length === 0 || /^https?:\/\//iu.test(value)) return line;
      return `${prefix}${key}: ${new URL(value, base).href}`;
    })
    .join("\n");
}

/** Everything wrong with a manifest this run just built. */
export function manifestProblems({ text, outputDir, version, exists = existsSync }) {
  const problems = [];
  const namedVersion = versionFromManifest(text);
  if (namedVersion !== version) {
    problems.push(`the manifest names ${String(namedVersion)}, but package.json says ${version}`);
  }

  const artifact = manifestArtifact(text);
  if (artifact === null) {
    problems.push("the manifest names no artifact with a sha512");
    return problems;
  }
  if (!exists(join(outputDir, artifact.name))) {
    problems.push(`the manifest names ${artifact.name}, but it is not in ${outputDir}`);
  }
  return problems;
}

/** Sign these bytes exactly as served, with the publisher's private key. */
export function signManifest(bytes, privateKeyPem) {
  return sign(null, bytes, createPrivateKey(privateKeyPem)).toString("base64");
}

/** The fingerprint an app shows, so a key rotation is visible rather than silent. */
export function fingerprintOf(privateKeyPem) {
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem));
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 32);
}

/** True when this signature is this key's signature over these bytes. */
export function signatureVerifies(bytes, signature, publicKeyPem) {
  try {
    return verify(null, bytes, createPublicKey(publicKeyPem), signature);
  } catch {
    return false;
  }
}

/** The key path a release reads, from the environment or the publisher's default. */
export function updateKeyPath(env = process.env) {
  return env.SUITE_UPDATE_KEY?.trim() || join(homedir(), ".config", "suite", "update-key.pem");
}

export function parseArgs(argv) {
  const options = {
    appId: null,
    publish: false,
    dryRun: false,
    verify: false,
    tag: null,
    notesFile: null,
    feedDir: null,
    build: true,
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
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--verify") options.verify = true;
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--tag") {
      options.tag = takeValue(index, "--tag");
      index += 1;
    } else if (arg === "--notes-file") {
      options.notesFile = takeValue(index, "--notes-file");
      index += 1;
    } else if (arg === "--feed-dir") {
      options.feedDir = takeValue(index, "--feed-dir");
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else if (options.appId === null) {
      options.appId = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }

  return options;
}

function run(command, args, cwd = ROOT) {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function capture(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function sha256OfFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * A PKGBUILD with the version and checksum of the artifact just built.
 *
 * The committed PKGBUILD records the release it was written for; a release builds
 * the package from its own bytes, so both numbers are rewritten here.
 */
export function pkgbuildFor({ text, version, sha256 }) {
  const patched = text
    .replace(/^pkgver=.*$/mu, `pkgver=${version}`)
    .replace(/^pkgrel=.*$/mu, "pkgrel=1")
    .replace(/^sha256sums=\(.*$/mu, `sha256sums=('${sha256}')`);
  const unchanged = ["pkgver", "sha256sums"].filter(
    (fieldName) => !new RegExp(`^${fieldName}=`, "mu").test(patched),
  );
  if (unchanged.length > 0) {
    throw new Error(`the PKGBUILD has no ${unchanged.join(" or ")} line to rewrite`);
  }
  return patched;
}

/**
 * What is wrong with a built package's file modes, or null when nothing is.
 *
 * 0.3.1 installed and then could not start because `cp -a` reproduced the
 * AppImage's 0700 directories onto `/opt/suite-start`. Reading `bsdtar -tvf`
 * catches that before upload.
 */
export function packageModeProblems(listing) {
  const problems = [];
  let hasExecutable = false;

  for (const line of listing.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const match = TAR_LINE.exec(line.trim());
    if (match === null) continue;
    const [, kind, mode, path] = match;
    if (kind === undefined || mode === undefined || path === undefined) continue;

    if (kind === "d" && path.startsWith("opt/")) {
      if (mode[6] !== "r" || mode[8] !== "x") {
        problems.push(`${path} is mode ${mode}, so a user cannot read or enter it`);
      }
    }

    if (path === "opt/suite-start/suite-start") {
      if (kind !== "-") problems.push("the hub's binary is not a regular file");
      else if (mode[2] !== "x" && mode[2] !== "s") {
        problems.push("the hub's binary is not executable");
      } else hasExecutable = true;
    }
  }

  if (!hasExecutable) problems.push("the package does not contain opt/suite-start/suite-start");
  return problems;
}

const TAR_LINE =
  /^([-dlpscbD])([rwxsStT-]{9})\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/u;

/**
 * Build the Arch package for the artifact this run produced, when the app has one.
 *
 * A second delivery form for the same bytes: the PKGBUILD wraps the AppImage
 * rather than rebuilding the app. A machine without `makepkg` skips it with a
 * note; only the hub has a PKGBUILD today.
 */
async function packageFor(app, { version, artifactPath }) {
  if (app.pkgbuild === null) return null;
  const pkgbuildPath = join(ROOT, app.pkgbuild);
  if (!existsSync(pkgbuildPath)) return null;
  if (process.platform !== "linux" || !existsSync("/usr/bin/makepkg")) {
    process.stdout.write("\nmakepkg is not here, so no Arch package was built\n");
    return null;
  }

  const text = await readFile(pkgbuildPath, "utf8");
  const pkgname = /^pkgname=(\S+)$/mu.exec(text)?.[1];
  if (pkgname === undefined) throw new Error(`${pkgbuildPath} names no pkgname`);

  const work = await mkdtemp(join(tmpdir(), "suite-pkg-"));
  const patched = pkgbuildFor({ text, version, sha256: await sha256OfFile(artifactPath) });
  await writeFile(join(work, "PKGBUILD"), patched);
  await copyFile(artifactPath, join(work, `${pkgname}-${version}.AppImage`));

  process.stdout.write(`\n=== arch package (${pkgname}) ===\n`);
  run("makepkg", ["--nocheck", "--nodeps", "--force"], work);

  const built = (await readdir(work)).find((name) => name.endsWith(".pkg.tar.zst"));
  if (built === undefined) throw new Error("makepkg produced no .pkg.tar.zst");

  const listing = capture("bsdtar", ["-tvf", built], work);
  const problems = packageModeProblems(listing);
  if (problems.length > 0) {
    throw new Error(`${built} would not run:\n  ${problems.join("\n  ")}`);
  }

  const destination = join(ROOT, app.output, built);
  await copyFile(join(work, built), destination);
  await rm(work, { recursive: true, force: true });
  return destination;
}

/**
 * Read the published feed back and verify it, without writing anything.
 *
 * This is the second command issue #20 asks for: after a release, a person can
 * ask whether Pages serves a manifest signed by the key the apps pin, whether it
 * names the version in the tree, and whether its artifact answers.
 */
export async function verifyPublishedFeed({ feed, publicKey, fetchImpl = globalThis.fetch }) {
  const manifestUrl = `${feed.replace(/\/+$/u, "")}/${FEED_FILE}`;
  let manifestResponse;
  try {
    manifestResponse = await fetchImpl(manifestUrl);
  } catch {
    return { ok: false, reason: "the feed could not be reached", version: null, artifact: null };
  }
  if (!manifestResponse.ok) {
    return { ok: false, reason: `the feed answered ${manifestResponse.status}`, version: null, artifact: null };
  }

  let signatureResponse;
  try {
    signatureResponse = await fetchImpl(`${manifestUrl}.sig`);
  } catch {
    return { ok: false, reason: "the signature could not be reached", version: null, artifact: null };
  }
  if (!signatureResponse.ok) {
    return { ok: false, reason: "the feed published no signature", version: null, artifact: null };
  }

  const body = await manifestResponse.text();
  const signature = Buffer.from((await signatureResponse.text()).trim(), "base64");
  if (!signatureVerifies(Buffer.from(body), signature, publicKey)) {
    return {
      ok: false,
      reason: "the manifest is not signed by the publisher's key",
      version: null,
      artifact: null,
    };
  }

  const version = versionFromManifest(body);
  if (version === null) {
    return { ok: false, reason: "the feed named no version", version: null, artifact: null };
  }

  const artifact = manifestArtifact(body);
  if (artifact === null) {
    return { ok: false, reason: "the feed named no artifact", version, artifact: null };
  }

  const artifactUrl = /^https:\/\//u.test(artifact.locator)
    ? artifact.locator
    : `${feed.replace(/\/+$/u, "")}/${artifact.name}`;
  try {
    const response = await fetchImpl(artifactUrl, { method: "HEAD" });
    if (!response.ok) {
      return {
        ok: false,
        reason: `the artifact answered ${response.status}`,
        version,
        artifact: artifactUrl,
      };
    }
  } catch {
    return { ok: false, reason: "the artifact could not be reached", version, artifact: artifactUrl };
  }

  return { ok: true, reason: null, version, artifact: artifactUrl };
}

async function pinnedPublicKey() {
  const built = join(ROOT, "packages/desktop/dist/updateSignature.js");
  if (!existsSync(built)) {
    throw new Error("the shared packages are not built. Run the gate before verifying a release.");
  }
  const module = await import(pathToFileURL(built).href);
  return module.SUITE_UPDATE_PUBLIC_KEY;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function release(app, options) {
  const head = capture("git", ["rev-parse", "HEAD"]);
  const porcelain = capture("git", ["status", "--porcelain"]);
  const packageText = await readFile(join(ROOT, app.project, "package.json"), "utf8");
  const version = versionFromPackage(packageText);
  const changelog = await readFile(join(ROOT, app.changelog), "utf8").catch(() => "");
  const manifestText =
    app.manifest === null ? null : await readFile(join(ROOT, app.manifest), "utf8").catch(() => null);
  const gateStatus = existsSync(join(ROOT, ".dev", "gate-status.json"))
    ? await readJson(join(ROOT, ".dev", "gate-status.json"))
    : null;

  const problems = [];
  if (version === null) problems.push(`${app.project}/package.json names no version`);
  const dirty = dirtyTreeProblem(porcelain);
  if (dirty !== null) problems.push(dirty);
  if (version !== null) {
    const changelogMiss = changelogProblem(changelog, version);
    if (changelogMiss !== null) problems.push(changelogMiss);
  }
  const manifestMiss = manifestVersionProblem(manifestText, version);
  if (manifestMiss !== null) problems.push(manifestMiss);
  problems.push(...gateProblems(gateStatus, head));

  const tag = options.tag ?? (version === null ? null : tagFor(app, version));
  if (tag === null) problems.push("no tag to release under");

  if (problems.length > 0) {
    throw new Error(problems.join("\n\n"));
  }

  const keyPath = updateKeyPath();
  if (!existsSync(keyPath)) {
    throw new Error(
      `no publisher key at ${keyPath}. Set SUITE_UPDATE_KEY to its path; ` +
        "the private key never belongs in this repository.",
    );
  }
  const privateKey = await readFile(keyPath, "utf8");

  process.stdout.write(`\nreleasing ${app.name} ${version} as ${tag}\n`);

  if (options.build) {
    process.stdout.write("\n=== build ===\n");
    run("pnpm", ["--filter", app.package, "run", "build"]);
    process.stdout.write("\n=== package ===\n");
    run("pnpm", [
      "--filter",
      app.package,
      "exec",
      "electron-builder",
      "--linux",
      "AppImage",
      "--publish",
      "never",
    ]);
  }

  const outputDir = join(ROOT, app.output);
  const manifestPath = join(outputDir, FEED_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} is missing after packaging`);
  }
  const builtManifest = await readFile(manifestPath, "utf8");
  const builtProblems = manifestProblems({
    text: builtManifest,
    outputDir,
    version,
  });
  if (builtProblems.length > 0) throw new Error(builtProblems.join("\n"));

  const artifact = manifestArtifact(builtManifest);
  if (artifact === null) throw new Error(`${manifestPath} names no artifact`);
  const artifactPath = join(outputDir, artifact.name);

  const packagePath = await packageFor(app, { version, artifactPath });

  // The manifest Pages serves names the release asset, not a file beside itself.
  const publishedManifest = absoluteManifest(builtManifest, releaseAssetBase(app, version));
  const publishedBytes = Buffer.from(publishedManifest);
  const signature = signManifest(publishedBytes, privateKey);
  const fingerprint = fingerprintOf(privateKey);

  const feedDir = options.feedDir;
  if (feedDir !== null) {
    await mkdir(feedDir, { recursive: true });
    await copyFile(artifactPath, join(feedDir, artifact.name));
    await writeFile(join(feedDir, FEED_FILE), publishedManifest);
    await writeFile(join(feedDir, `${FEED_FILE}.sig`), `${signature}\n`);
    process.stdout.write(`\nfeed written to ${feedDir}\n`);
  }

  process.stdout.write(`\n  feed        ${manifestUrl(app)}\n`);
  process.stdout.write(`  tag         ${tag}\n`);
  process.stdout.write(`  artifact    ${artifact.name}\n`);
  process.stdout.write(`  manifest    ${publishedManifest.split(/\r?\n/u).find((line) => line.startsWith("path:")) ?? ""}\n`);
  process.stdout.write(`  key         ${keyPath}\n`);
  process.stdout.write(`  fingerprint ${fingerprint}\n`);

  if (!options.publish) {
    process.stdout.write("\ndry run: nothing was tagged, uploaded, written or committed.\n");
    process.stdout.write(`To publish: node scripts/release.mjs ${app.id} --publish\n`);
    return;
  }

  const work = await mkdtemp(join(tmpdir(), "suite-release-"));
  try {
    const uploadManifest = join(work, FEED_FILE);
    const uploadSignature = join(work, `${FEED_FILE}.sig`);
    await writeFile(uploadManifest, publishedManifest);
    await writeFile(uploadSignature, `${signature}\n`);

    const notes =
      options.notesFile === null
        ? ["--notes", changelogSection(changelog, version) || `Suite ${app.name} ${version}`]
        : ["--notes-file", options.notesFile];

    process.stdout.write(`\n=== publish ${tag} ===\n`);
    run("gh", [
      "release",
      "create",
      tag,
      artifactPath,
      uploadManifest,
      uploadSignature,
      ...(packagePath === null ? [] : [packagePath]),
      "--title",
      `${app.name} ${version}`,
      ...notes,
      "--target",
      head,
      "--latest=false",
    ]);

    const feedFile = join(ROOT, feedPath(app));
    await mkdir(dirname(feedFile), { recursive: true });
    await writeFile(feedFile, publishedManifest);
    await writeFile(`${feedFile}.sig`, `${signature}\n`);
    run("git", ["add", "--", feedPath(app), `${feedPath(app)}.sig`]);
    run("git", ["commit", "-m", `chore(release): publish ${app.id} ${version} feed`]);

    process.stdout.write(`\npublished ${tag}\n`);
    process.stdout.write(`feed ${manifestUrl(app)}\n`);
    process.stdout.write("Push the feed commit when the gate has proven it.\n");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (options.appId === null) {
    process.stderr.write(`no app named\n\n${USAGE}`);
    process.exit(2);
  }
  if (options.publish && options.dryRun) {
    process.stderr.write("--publish and --dry-run contradict each other\n");
    process.exit(2);
  }

  const app = APPS[options.appId];
  if (app === undefined) {
    process.stderr.write(`unknown app ${options.appId}\n\n${USAGE}`);
    process.exit(2);
  }

  if (options.verify) {
    const packageText = await readFile(join(ROOT, app.project, "package.json"), "utf8");
    const expected = versionFromPackage(packageText);
    const result = await verifyPublishedFeed({
      feed: feedUrl(app),
      publicKey: await pinnedPublicKey(),
    });
    if (!result.ok) throw new Error(result.reason ?? "the feed did not verify");
    if (result.version !== expected) {
      throw new Error(
        `the feed serves ${String(result.version)}, but ${app.project}/package.json says ${String(expected)}`,
      );
    }
    process.stdout.write(`verified ${app.name} ${result.version}\n`);
    process.stdout.write(`  feed     ${manifestUrl(app)}\n`);
    process.stdout.write(`  artifact ${result.artifact}\n`);
    return;
  }

  await release(app, options);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    process.exit(1);
  }
}
