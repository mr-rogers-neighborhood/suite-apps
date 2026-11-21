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
 * The private key never enters this repository. It is read from `SUITE_UPDATE_KEY`, or from
 * `~/.config/suite/keys/update-key.pem` (`pnpm keys status` names it). A key that does not match
 * the pin the apps trust is refused before the build: such a feed is refused by every install.
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
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  artifactStem,
  channelProblem,
  channelRecord,
  displayName,
  flatpakId,
  isPreRelease,
  preReleaseAppManifest,
  releaseTag,
} from "./lib/channel.mjs";
import {
  fingerprintOf as secretFingerprint,
  groupedFingerprint,
  keyPath as secretKeyPath,
  pinnedPublic as pinnedSecretPublic,
  publicOf as publicFromPrivate,
} from "./lib/keys.mjs";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FEED_HOST = "https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main";
export const RELEASE_REPO = "mr-rogers-neighborhood/suite-apps";
export const FEED_FILE = "latest-linux.yml";

/**
 * The only tree publishing writes.
 *
 * A feed commit moves HEAD after every app, so the next app inherits the gate
 * proof only when everything between the proven commit and HEAD stays here.
 */
export const FEED_ROOT = "feeds/";

/** The relay's artifact id, and the name its launcher installs as. */
export const RELAY_ARTIFACT_ID = "suite-sync";

/** The architecture token in a relay tarball name, from Node's `process.arch`. */
const RELAY_ARCHES = { x64: "x86_64", arm64: "aarch64" };

/**
 * A `pnpm deploy` tree carries the workspace's source, scripts and lockfiles.
 *
 * The relay needs the built CLI and its runtime dependencies; the rest either
 * describes a checkout the target does not have, or would invite a reader to
 * think the artifact was assembled by hand.
 */
const RELAY_DROP = [
  "src",
  "packages",
  "scripts",
  "dist/release",
  "node_modules/.pnpm",
  "node_modules/.modules.yaml",
  "node_modules/.pnpm-workspace-state-v1.json",
  ".husky",
  "docs",
  "deploy",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.base.json",
  "biome.json",
  "vitest.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".gitignore",
  "CHANGELOG.md",
  "SECURITY.md",
  "ACCESSIBILITY.md",
  "README.md",
];

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
  sync: {
    id: "sync",
    name: "Suite Sync",
    package: "@suite/sync-server",
    project: "apps/sync",
    changelog: "apps/sync/CHANGELOG.md",
    output: "apps/sync/dist/release",
    manifest: null,
    pkgbuild: null,
    kind: "relay",
  },
};

const USAGE = `usage: node scripts/release.mjs <app-id> [options]

  --publish           upload the release (an app path also commits its feed)
  --dry-run           stop before every network write; the default
  --verify            verify the published feed, or the local relay artifact
  --channel <tier>    stable, slop, canary or beta (default: stable)
  --tag <name>        release tag (default: <app>-v<version>, or <tier>-<app>-v<version>)
  --notes-file <path> release notes (default: the version's changelog section)
  --feed-dir <path>   also copy the artifact, manifest and signature into a folder
  --no-build          reuse the last build in the app's release folder
  --help              print this text

Known apps: ${Object.keys(APPS).join(", ")}
Channels: stable, slop, canary, beta
`;

/** The tag a version is published under, so several apps share the repository. */
export function tagFor(app, version, channel = "stable") {
  return releaseTag(app.id, version, channel);
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
export function releaseAssetBase(app, version, channel = "stable") {
  return `https://github.com/${RELEASE_REPO}/releases/download/${tagFor(app, version, channel)}/`;
}

/** The architecture token a relay tarball is named with. */
export function relayArchitecture(arch = process.arch) {
  const token = RELAY_ARCHES[arch];
  if (token === undefined) {
    throw new Error(`no relay artifact for ${arch}; build on x86_64 or aarch64`);
  }
  return token;
}

/** `suite-sync-<version>-<arch>.tar.gz`, the one naming scheme the docs and the script share. */
export function relayArtifactName(version, arch = process.arch) {
  return `${RELAY_ARTIFACT_ID}-${version}-${relayArchitecture(arch)}.tar.gz`;
}

/**
 * The checksum list the update key signs.
 *
 * `sha256sum -c` reads this format directly, so a person verifies the tarball
 * with the tool they already have rather than a script this project invented.
 */
export function relayChecksumList({ name, sha256 }) {
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error(`not a sha256 digest: ${sha256}`);
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) throw new Error(`not a plain artifact name: ${name}`);
  return `${sha256}  ${name}\n`;
}

/**
 * The launcher the tarball installs as `suite-sync`.
 *
 * Start spawns the binary directly, so this has to be an executable that finds
 * its own tree. It also has to be honest about the runtime: the artifact ships
 * JavaScript, not Node.
 */
export function relayLauncher() {
  return [
    "#!/bin/sh",
    "# Suite Sync relay launcher.",
    "#",
    "# The relay is JavaScript. This tarball does not bundle a Node runtime: the host",
    "# needs Node.js 22 or later. The checks below name that instead of failing with a",
    "# module error someone has to decode.",
    "set -eu",
    "",
    "self=$0",
    "# Follow the link `/usr/local/bin/suite-sync -> /opt/suite-sync/bin/suite-sync`.",
    "if command -v readlink >/dev/null 2>&1; then",
    '  resolved=$(readlink -f -- "$self" 2>/dev/null || true)',
    '  if [ -n "$resolved" ]; then self=$resolved; fi',
    "fi",
    'root=$(CDPATH= cd -- "$(dirname -- "$self")/.." && pwd)',
    "",
    "if ! command -v node >/dev/null 2>&1; then",
    '  echo "suite-sync: Node.js 22 or later is required, but no node was found on PATH." >&2',
    '  echo "Install Node.js 22 or later and run this launcher again." >&2',
    "  exit 127",
    "fi",
    "",
    "major=$(node -p \"process.versions.node.split('.')[0]\" 2>/dev/null || echo 0)",
    'case "$major" in',
    "  ''|*[!0-9]*) major=0 ;;",
    "esac",
    'if [ "$major" -lt 22 ]; then',
    '  echo "suite-sync: Node.js 22 or later is required; this node is $(node --version 2>/dev/null || echo unknown)." >&2',
    "  exit 1",
    "fi",
    "",
    'exec node "$root/dist/cli.js" "$@"',
    "",
  ].join("\n");
}

/** The README inside the tarball, whose runtime section is part of the contract. */
export function relayReadme(version, arch = process.arch) {
  return [
    `# Suite Sync relay ${version}`,
    "",
    "`suite-sync` is the blind mailbox two Suite devices sync through. It stores",
    "encrypted frames and cannot read, merge or render a document.",
    "",
    "## Runtime requirement",
    "",
    "This tarball contains the built CLI and its JavaScript dependencies. It does **not**",
    "contain a Node.js runtime: install **Node.js 22 or later** on this machine. The",
    "launcher refuses to start, with a message that says so, when `node` is missing or",
    "older than 22.",
    "",
    "## Run it",
    "",
    "```sh",
    "./bin/suite-sync --version",
    "./bin/suite-sync status",
    "./bin/suite-sync serve --host 127.0.0.1 --trust-all --store ./store",
    "```",
    "",
    "`--trust-all` is required until there is a device registry. On any address other",
    "than loopback it also needs `--trust-all-remote`; read the relay guide before",
    "exposing it.",
    "",
    "## Install",
    "",
    "```sh",
    "sudo install -d /opt/suite-sync",
    `sudo tar -xzf ${relayArtifactName(version, arch)} -C /opt`,
    "sudo ln -sf /opt/suite-sync/bin/suite-sync /usr/local/bin/suite-sync",
    "```",
    "",
    "The repository's `apps/sync/docs/how-to/relay.md` has the download, checksum and",
    "signature verification steps, the systemd unit, and how Suite Start finds the",
    "binary through `SUITE_SYNC_BIN` or `PATH`.",
    "",
  ].join("\n");
}

/**
 * Verify a local relay release folder the way the docs tell a person to.
 *
 * The update key signs `SHA256SUMS`; the tarball is verified by the checksum the
 * signed list names. Nothing here trusts the filename the tarball arrived under.
 */
export async function verifyRelayArtifact({
  dir,
  version,
  publicKey,
  arch = process.arch,
}) {
  const name = relayArtifactName(version, arch);
  let checksums;
  try {
    checksums = await readFile(join(dir, "SHA256SUMS"), "utf8");
  } catch {
    return { ok: false, reason: "SHA256SUMS is missing", artifact: null };
  }

  let signatureText;
  try {
    signatureText = await readFile(join(dir, "SHA256SUMS.sig"), "utf8");
  } catch {
    return { ok: false, reason: "SHA256SUMS.sig is missing", artifact: null };
  }

  const bytes = Buffer.from(checksums);
  const signature = Buffer.from(signatureText.trim(), "base64");
  if (!signatureVerifies(bytes, signature, publicKey)) {
    return {
      ok: false,
      reason: "SHA256SUMS is not signed by the publisher's key",
      artifact: null,
    };
  }

  const line = checksums.split(/\r?\n/u).find((entry) => entry.trim().length > 0);
  const match = /^([0-9a-f]{64}) [ *](.+)$/u.exec(line ?? "");
  if (match === null) {
    return { ok: false, reason: "SHA256SUMS names no checksum", artifact: null };
  }
  const [, expected, listed] = match;
  if (listed !== name) {
    return {
      ok: false,
      reason: `SHA256SUMS names ${String(listed)}, not ${name}`,
      artifact: null,
    };
  }

  const artifactPath = join(dir, name);
  if (!existsSync(artifactPath)) {
    return { ok: false, reason: `${name} is missing`, artifact: null };
  }
  const actual = await sha256OfFile(artifactPath);
  if (actual !== expected) {
    return {
      ok: false,
      reason: `${name} has sha256 ${actual}, not ${String(expected)}`,
      artifact: name,
    };
  }

  return { ok: true, reason: null, artifact: name };
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

/** True when this path is one a publish may commit. */
export function isFeedPath(path) {
  return path.startsWith(FEED_ROOT);
}

/**
 * The stdout of a git command, for the range check.
 *
 * Kept behind a function so `feedOnlyRange` can be told the answer in a test
 * rather than needing this repository.
 */
function gitQuery(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: process.env });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * Why the commits in `from..to` do not inherit `from`'s gate proof, or null.
 *
 * Publishing commits `feeds/<app>/`, which moves HEAD. The next app should not
 * need a second fresh gate, so a descendant is accepted when every commit
 * between them changes only feed files. The proof is the trees: `git rev-list`
 * lists the commits, and each commit's changed paths are read against its
 * parent. A commit message is never consulted, since a prefix is forgeable.
 *
 * A merge has to account for every path it contributes: its diff against each
 * parent must stay under `feeds/`. `git` is injected so a test can answer
 * without a repository.
 */
export function feedOnlyRange(from, to, git = gitQuery) {
  const shortTo = to.slice(0, 12);
  if (!git(["merge-base", "--is-ancestor", from, to]).ok) {
    return `${from} is not an ancestor of ${shortTo}`;
  }

  const listed = git(["rev-list", "--parents", `${from}..${to}`]);
  if (!listed.ok) return `git could not list the commits between ${from} and ${shortTo}`;

  for (const line of listed.stdout.split(/\r?\n/u)) {
    const [commit, ...parents] = line.trim().split(/\s+/u);
    if (commit === undefined || commit.length === 0) continue;

    // `-m` gives a merge a diff against each parent; `--no-renames` keeps both
    // sides of a moved file visible. A path outside `feeds/` refuses either way.
    const diff = git([
      "diff-tree",
      "--no-commit-id",
      "-r",
      "--name-only",
      "--no-renames",
      ...(parents.length > 1 ? ["-m"] : []),
      commit,
    ]);
    if (!diff.ok) return `git could not read the tree of ${commit.slice(0, 12)}`;

    const outside = diff.stdout
      .split(/\r?\n/u)
      .map((path) => path.trim())
      .filter((path) => path.length > 0 && !isFeedPath(path));
    if (outside.length > 0) {
      const shown = outside.slice(0, 5).join(", ");
      const more = outside.length > 5 ? `, and ${outside.length - 5} more` : "";
      return `${commit.slice(0, 12)} changes ${shown}${more}, outside ${FEED_ROOT}`;
    }
  }

  return null;
}

/**
 * Why the gate has not proven this commit, or null when it has.
 *
 * `.dev/gate-status.json` names the commit and whether the gate ran against a
 * clean export of it. A working-tree run proves the tree, not the commit, which
 * is why `fresh` matters here.
 *
 * `range(from, to)` is the feed-only check, passed in so this function needs no
 * repository. It returns null when the commits between the two inherit the
 * proof, or a sentence saying why they do not. Omitting it refuses the range:
 * only an exact HEAD is accepted without an inspection.
 */
export function gateProblems(status, head, { range = null } = {}) {
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
    const inherited = range === null
      ? "no feed-only check was supplied, so the commits since the gate were not inspected"
      : range(status.commit, head);
    if (inherited !== null) {
      problems.push(
        `the gate proved ${status.commit}, but HEAD is ${head.slice(0, 12)}: ${inherited}`,
      );
    }
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
  return env.SUITE_UPDATE_KEY?.trim() || secretKeyPath("update", env);
}

/**
 * Why a private key must not publish, or null when it is the key the apps pin.
 *
 * Exported so the refusal can be exercised without a release. An installed app verifies with the
 * key compiled into it, so a feed signed by anything else downloads nothing and reports no
 * release; the build should not start, let alone upload, before that is known.
 */
export function publisherKeyProblem(privateKey, { pinned = pinnedSecretPublic("update") } = {}) {
  let derived;
  try {
    derived = publicFromPrivate("update", privateKey).publicText;
  } catch (error) {
    return `the publisher key is not a usable Ed25519 key: ${error.message}`;
  }

  if (pinned === null) {
    return "SUITE_UPDATE_PUBLIC_KEY is missing from packages/desktop/src/updateSignature.ts";
  }
  if (derived.trim() === pinned.trim()) return null;

  return (
    "the publisher key is not the key the apps pin.\n" +
    `  this key  ${groupedFingerprint(secretFingerprint(derived, "spki-pem"))}\n` +
    `  pinned    ${groupedFingerprint(secretFingerprint(pinned, "spki-pem"))}\n` +
    "A feed signed with this key is refused by every installed app. Run `pnpm keys status`; " +
    "pin this key first, or use the one the tree already trusts."
  );
}

export function parseArgs(argv) {
  const options = {
    appId: null,
    channel: "stable",
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
    else if (arg === "--channel") {
      options.channel = takeValue(index, "--channel");
      index += 1;
    } else if (arg === "--tag") {
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

  const channelMiss = channelProblem(options.channel);
  if (channelMiss !== null) throw new Error(channelMiss);

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
 * Assemble the relay tarball from a deployed tree.
 *
 * `pnpm deploy` is what makes the artifact runnable on a machine with no
 * workspace: it copies `@suite/host`, `@suite/sync` and their dependencies into
 * one tree. The hoisted linker is deliberate; the default layout leaves
 * symlinks into `.pnpm`, and an archive that keeps a link and drops its target
 * starts here and fails there.
 */
async function buildRelayArtifact({ app, version, outputDir, arch = process.arch }) {
  const work = await mkdtemp(join(tmpdir(), "suite-relay-"));
  const stage = join(work, RELAY_ARTIFACT_ID);

  try {
    run("pnpm", [
      "--config.node-linker=hoisted",
      "deploy",
      "--filter",
      app.package,
      "--prod",
      stage,
    ]);
    if (!existsSync(join(stage, "dist/cli.js"))) {
      throw new Error("the deploy produced no dist/cli.js");
    }

    for (const unwanted of RELAY_DROP) {
      await rm(join(stage, unwanted), { recursive: true, force: true });
    }

    if (!existsSync(join(stage, "LICENSE"))) {
      await copyFile(join(ROOT, app.project, "LICENSE"), join(stage, "LICENSE"));
    }

    // The deployed package.json still names the workspace paths it was built
    // from. The artifact needs the version and the module type, not a map of
    // the publisher's disk.
    const deployed = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
    await writeFile(
      join(stage, "package.json"),
      `${JSON.stringify(
        {
          name: RELAY_ARTIFACT_ID,
          version,
          description: deployed.description,
          type: "module",
          bin: { [RELAY_ARTIFACT_ID]: "./dist/cli.js" },
          license: "MIT",
          engines: deployed.engines ?? { node: ">=22" },
        },
        null,
        2,
      )}\n`,
    );

    await writeFile(join(stage, "README.md"), relayReadme(version, arch));

    await mkdir(join(stage, "bin"), { recursive: true });
    const launcher = join(stage, "bin", RELAY_ARTIFACT_ID);
    await writeFile(launcher, relayLauncher());
    await chmod(launcher, 0o755);
    await chmod(join(stage, "dist/cli.js"), 0o755);

    await mkdir(outputDir, { recursive: true });
    const name = relayArtifactName(version, arch);
    const artifactPath = join(outputDir, name);
    // Same inputs, same bytes: sort entries and pin the metadata tar and gzip
    // would otherwise take from the machine that happened to build it.
    run("tar", [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      artifactPath,
      "-C",
      work,
      RELAY_ARTIFACT_ID,
    ]);
    return { name, path: artifactPath };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
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

/**
 * Remove one top-level YAML mapping from an electron-builder config.
 *
 * The pre-release build reuses the app's committed config, so it has to remove
 * the file associations rather than merge an empty list into them: electron-
 * builder concatenates arrays, and an empty list would leave the stable MIME
 * registrations in place.
 */
export function removeTopLevelBlock(text, key) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`, "u").test(line));
  if (start < 0) return text;
  let end = start + 1;
  while (end < lines.length && (/^\s/u.test(lines[end]) || lines[end].trim().length === 0)) {
    end += 1;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/** The build-time config a pre-release AppImage is packaged with. */
export function preReleaseBuilderConfig(text, { app, channel }) {
  let config = text
    .replace(/^appId:.*$/mu, `appId: ${flatpakId(app.id, channel)}`)
    .replace(/^productName:.*$/mu, `productName: ${displayName(app.name, channel)}`)
    .replace(
      /^artifactName:.*$/mu,
      `artifactName: ${artifactStem(app.id, channel)}-` + "${version}-${arch}.${ext}",
    )
    .replace(/^\s+MimeType:.*$/gmu, "");

  config = removeTopLevelBlock(config, "fileAssociations");

  // The tier is a build fact beside the manifest. electron-builder copies
  // extraFiles after building the app, so this lands next to suite.app.json.
  const extraFiles = [
    "extraFiles:",
    "  - from: suite.app.json",
    "    to: suite.app.json",
    "  - from: suite.channel.json",
    "    to: suite.channel.json",
  ].join("\n");
  config = config.replace(
    ["extraFiles:", "  - from: suite.app.json", "    to: suite.app.json"].join("\n"),
    extraFiles,
  );
  return config;
}

/**
 * Write the pre-release manifest and config into the app project, and return
 * the restore step.
 *
 * The release refuses a dirty tree before this runs, and the restore is in a
 * `finally`, so the working tree describes stable again whether the build
 * succeeds or fails. The files are swapped rather than copied through an
 * override because electron-builder's array merge cannot remove `fileAssociations`.
 */
async function stagePreReleaseBuild(app, channel) {
  const ymlPath = join(ROOT, app.project, "electron-builder.yml");
  const manifestPath = join(ROOT, app.manifest);
  const channelPath = join(ROOT, app.project, "suite.channel.json");
  const originalYml = await readFile(ymlPath, "utf8");
  const originalManifest = await readFile(manifestPath, "utf8");
  const channelExisted = existsSync(channelPath);
  const originalChannel = channelExisted ? await readFile(channelPath, "utf8") : null;

  const baseManifest = JSON.parse(originalManifest);
  await writeFile(
    manifestPath,
    `${JSON.stringify(preReleaseAppManifest(baseManifest, channel), null, 2)}\n`,
  );
  await writeFile(
    channelPath,
    `${JSON.stringify(channelRecord({ app: app.id, channel }), null, 2)}\n`,
  );
  await writeFile(ymlPath, preReleaseBuilderConfig(originalYml, { app, channel }));

  return async () => {
    await writeFile(ymlPath, originalYml);
    await writeFile(manifestPath, originalManifest);
    if (channelExisted) await writeFile(channelPath, originalChannel);
    else await rm(channelPath, { force: true });
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build, sign and publish the relay tarball.
 *
 * The relay is a server, not an app: it has no update feed and no electron
 * manifest. The update key signs the checksum list, and that list is what
 * verifies the tarball. The tag, the version and the changelog section are the
 * same facts the app path uses, so they are checked before this runs.
 */
async function releaseRelay(app, options, { head, version, tag, changelog, privateKey, keyPath }) {
  const outputDir = join(ROOT, app.output);
  const arch = process.arch;
  const name = relayArtifactName(version, arch);
  const artifactPath = join(outputDir, name);

  process.stdout.write(`\nreleasing ${app.name} ${version} as ${tag}\n`);

  if (options.build) {
    process.stdout.write("\n=== build ===\n");
    // The CLI imports @suite/host and @suite/sync through their dist output, so
    // all three packages have to be built, not just the server entry point.
    run("pnpm", ["--filter", app.package, "run", "build:all"]);
    process.stdout.write("\n=== package ===\n");
    await buildRelayArtifact({ app, version, outputDir, arch });
  } else if (!existsSync(artifactPath)) {
    throw new Error(`${artifactPath} is missing; run once without --no-build to build it`);
  }

  const sha256 = await sha256OfFile(artifactPath);
  const size = (await stat(artifactPath)).size;
  const checksums = relayChecksumList({ name, sha256 });
  const checksumBytes = Buffer.from(checksums);
  const signature = signManifest(checksumBytes, privateKey);
  const publicKey = publicFromPrivate("update", privateKey).publicText;
  const fingerprint = fingerprintOf(privateKey);

  const files = [
    { name, path: artifactPath },
    { name: "SHA256SUMS", text: checksums },
    { name: "SHA256SUMS.sig", text: `${signature}\n` },
    { name: "SHA256SUMS.pub", text: `${publicKey}\n` },
  ];

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "SHA256SUMS"), checksums);
  await writeFile(join(outputDir, "SHA256SUMS.sig"), `${signature}\n`);
  await writeFile(join(outputDir, "SHA256SUMS.pub"), `${publicKey}\n`);

  if (options.feedDir !== null) {
    await mkdir(options.feedDir, { recursive: true });
    for (const file of files) {
      if (file.path !== undefined) {
        await copyFile(file.path, join(options.feedDir, file.name));
      } else {
        await writeFile(join(options.feedDir, file.name), file.text);
      }
    }
    process.stdout.write(`\nrelease files written to ${options.feedDir}\n`);
  }

  process.stdout.write(`\n  artifact    ${name}\n`);
  process.stdout.write(`  size        ${size} bytes\n`);
  process.stdout.write(`  sha256      ${sha256}\n`);
  process.stdout.write("  checksums   SHA256SUMS\n");
  process.stdout.write("  signature   SHA256SUMS.sig\n");
  process.stdout.write("  public key  SHA256SUMS.pub\n");
  process.stdout.write(`  key         ${keyPath}\n`);
  process.stdout.write(`  fingerprint ${fingerprint}\n`);
  process.stdout.write(`\nwould upload to ${tag}:\n`);
  for (const file of files) process.stdout.write(`  ${file.name}\n`);

  if (!options.publish) {
    process.stdout.write(
      "\ndry run: nothing was tagged, uploaded or committed; the artifact above is only local.\n",
    );
    process.stdout.write(`To publish: node scripts/release.mjs ${app.id} --publish\n`);
    return;
  }

  const notes =
    options.notesFile === null
      ? ["--notes", changelogSection(changelog, version) || `${app.name} ${version}`]
      : ["--notes-file", options.notesFile];

  process.stdout.write(`\n=== publish ${tag} ===\n`);
  run("gh", [
    "release",
    "create",
    tag,
    ...files.map((file) => file.path ?? join(outputDir, file.name)),
    "--title",
    `${app.name} ${version}`,
    ...notes,
    "--target",
    head,
    "--latest=false",
  ]);

  process.stdout.write(`\npublished ${tag}\n`);
  process.stdout.write(`assets ${releaseAssetBase(app, version)}\n`);
}

async function release(app, options) {
  const channel = options.channel;
  const preRelease = isPreRelease(channel);
  const channelName = displayName(app.name, channel);
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
  if (preRelease && app.id === "start") {
    problems.push(
      "Suite Start has no pre-release channel: the hub's own card is the stable hub and nothing updates it",
    );
  }
  const dirty = dirtyTreeProblem(porcelain);
  if (dirty !== null) problems.push(dirty);
  if (version !== null) {
    const changelogMiss = changelogProblem(changelog, version);
    if (changelogMiss !== null) problems.push(changelogMiss);
  }
  const manifestMiss = manifestVersionProblem(manifestText, version);
  if (manifestMiss !== null) problems.push(manifestMiss);
  problems.push(...gateProblems(gateStatus, head, { range: feedOnlyRange }));

  const tag = options.tag ?? (version === null ? null : tagFor(app, version, channel));
  if (tag === null) problems.push("no tag to release under");

  if (problems.length > 0) {
    throw new Error(problems.join("\n\n"));
  }

  const keyPath = updateKeyPath();
  if (!existsSync(keyPath)) {
    throw new Error(
      `no publisher key at ${keyPath}. Run \`pnpm keys generate update\` to make one, ` +
        "or set SUITE_UPDATE_KEY to its path; the private key never belongs in this repository.",
    );
  }
  const privateKey = await readFile(keyPath, "utf8");

  // The pin is what an installed app trusts. Signing with any other key produces a feed that
  // every existing install refuses as "not signed by the publisher" — after the artifact has
  // been uploaded and the feed committed. Refuse before the build instead.
  const keyProblem = publisherKeyProblem(privateKey);
  if (keyProblem !== null) {
    throw new Error(`${keyProblem}\n  at        ${keyPath}`);
  }

  if (app.kind === "relay") {
    await releaseRelay(app, options, { head, version, tag, changelog, privateKey, keyPath });
    return;
  }

  process.stdout.write(`\nreleasing ${channelName} ${version} as ${tag}\n`);

  if (options.build) {
    process.stdout.write("\n=== build ===\n");
    run("pnpm", ["--filter", app.package, "run", "build"]);
    process.stdout.write("\n=== package ===\n");
    const restore = preRelease ? await stagePreReleaseBuild(app, channel) : null;
    try {
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
    } finally {
      if (restore !== null) await restore();
    }
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
  const publishedManifest = absoluteManifest(builtManifest, releaseAssetBase(app, version, channel));
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

  process.stdout.write(`\n  channel     ${channel}\n`);
  if (preRelease) {
    process.stdout.write("  feed        none (a pre-release never writes feeds/<app>/)\n");
  } else {
    process.stdout.write(`  feed        ${manifestUrl(app)}\n`);
  }
  process.stdout.write(`  tag         ${tag}\n`);
  process.stdout.write(`  artifact    ${artifact.name}\n`);
  process.stdout.write(`  manifest    ${publishedManifest.split(/\r?\n/u).find((line) => line.startsWith("path:")) ?? ""}\n`);
  process.stdout.write(`  key         ${keyPath}\n`);
  process.stdout.write(`  fingerprint ${fingerprint}\n`);

  if (!options.publish) {
    process.stdout.write("\ndry run: nothing was tagged, uploaded, written or committed.\n");
    process.stdout.write(
      `To publish: node scripts/release.mjs ${app.id} --channel ${channel} --publish\n`,
    );
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
      `${channelName} ${version}`,
      ...notes,
      "--target",
      head,
      "--latest=false",
      ...(preRelease ? ["--prerelease"] : []),
    ]);

    if (preRelease) {
      process.stdout.write(`\npublished ${tag}\n`);
      process.stdout.write("pre-release: no feed was written and the stable feed is untouched.\n");
      process.stdout.write("Install it by hand from the tag; stable keeps its own update path.\n");
      return;
    }

    const feedFile = join(ROOT, feedPath(app));
    await mkdir(dirname(feedFile), { recursive: true });
    await writeFile(feedFile, publishedManifest);
    await writeFile(`${feedFile}.sig`, `${signature}\n`);
    run("git", ["add", "--", feedPath(app), `${feedPath(app)}.sig`]);
    run("git", ["commit", "-m", `chore(release): publish ${app.id} ${version} feed`]);

    process.stdout.write(`\npublished ${tag}\n`);
    process.stdout.write(`feed ${manifestUrl(app)}\n`);
    process.stdout.write("Push the feed commit; it inherits this gate while it only touches feeds/.\n");
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
    if (isPreRelease(options.channel)) {
      throw new Error(
        `a ${options.channel} pre-release has no committed feed to verify; ` +
          "the artifact and its signed manifest live on the pre-release tag.",
      );
    }
    const packageText = await readFile(join(ROOT, app.project, "package.json"), "utf8");
    const expected = versionFromPackage(packageText);

    if (app.kind === "relay") {
      const publicKey = pinnedSecretPublic("update");
      if (publicKey === null) {
        throw new Error("SUITE_UPDATE_PUBLIC_KEY is missing from packages/desktop/src/updateSignature.ts");
      }
      const result = await verifyRelayArtifact({
        dir: join(ROOT, app.output),
        version: expected,
        publicKey,
      });
      if (!result.ok) throw new Error(result.reason ?? "the relay artifact did not verify");
      process.stdout.write(`verified ${app.name} ${expected}\n`);
      process.stdout.write(`  artifact ${join(app.output, result.artifact)}\n`);
      return;
    }

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
