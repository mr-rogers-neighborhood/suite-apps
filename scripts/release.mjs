#!/usr/bin/env node
/**
 * Release the Suite Sync relay from the monorepo.
 *
 * The desktop apps ship as Flatpaks. `scripts/flatpak.mjs` builds the deployment
 * and `scripts/flatpak-remote.mjs` publishes the signed OSTree summary, so this
 * script no longer has an AppImage, Arch package or update feed to write.
 *
 * The relay is different: it is a server tarball rather than an Electron app, and
 * it has no store. This script builds that tarball, signs the checksum list, and
 * uploads it. It refuses to start when the tree, the version, the changelog or the
 * gate status disagree.
 *
 * Two deliberate defaults:
 *
 * - **Nothing is published unless `--publish` is passed.** A dry run is the
 *   default, so running the command to see what it would do cannot upload.
 * - **Nothing is bumped.** The version in `package.json` is the release.
 *
 * The private key never enters this repository. It is read from `SUITE_UPDATE_KEY`, or from
 * `~/.config/suite/keys/update-key.pem` (`pnpm keys status` names it). A key that does not match
 * the pin the apps trust is refused before the build: such a checksum list is refused by every
 * install.
 *
 * Usage:
 *   node scripts/release.mjs sync [--publish]
 *   node scripts/release.mjs sync --verify
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
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseTag } from "./lib/channel.mjs";
import {
  fingerprintOf as secretFingerprint,
  groupedFingerprint,
  keyPath as secretKeyPath,
  pinnedPublic as pinnedSecretPublic,
  publicOf as publicFromPrivate,
} from "./lib/keys.mjs";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const RELEASE_REPO = "mr-rogers-neighborhood/suite-apps";

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
 * Every artifact this repository still publishes through this script.
 *
 * Desktop apps are Flatpaks and are released by `scripts/flatpak-remote.mjs`.
 * The relay is the one server tarball.
 */
export const APPS = {
  sync: {
    id: "sync",
    name: "Suite Sync",
    package: "@suite/sync-server",
    project: "apps/sync",
    changelog: "apps/sync/CHANGELOG.md",
    output: "apps/sync/dist/release",
    kind: "relay",
  },
};

const USAGE = `usage: node scripts/release.mjs sync [options]

  --publish           upload the release
  --dry-run           stop before every network write; the default
  --verify            verify the local relay artifact
  --tag <name>        release tag (default: sync-v<version>)
  --notes-file <path> release notes (default: the version's changelog section)
  --feed-dir <path>   also copy the artifact, checksums and signature into a folder
  --no-build          reuse the last build in the app's release folder
  --help              print this text

Known apps: ${Object.keys(APPS).join(", ")}
Desktop apps publish as Flatpaks: node scripts/flatpak-remote.mjs
`;

/** The tag a version is published under. */
export function tagFor(app, version) {
  return releaseTag(app.id, version);
}

/** The base a release's assets answer on. */
export function releaseAssetBase(app, version) {
  return `https://github.com/${RELEASE_REPO}/releases/download/${tagFor(app, version)}/`;
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

/**
 * Why the gate has not proven this commit, or null when it has.
 *
 * `.dev/gate-status.json` names the commit and whether the gate ran against a
 * clean export of it. A working-tree run proves the tree, not the commit, which
 * is why `fresh` matters here.
 *
 * Nothing is published that moves HEAD any more, so only the exact commit is
 * accepted. `head` is compared against the recorded commit directly.
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
 * Exported so the refusal can be exercised without a release. An installed app
 * verifies the relay's checksum list with the key compiled into it, so a release
 * signed by anything else is refused; the build should not start, let alone
 * upload, before that is known.
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
    "A checksum list signed with this key is refused by every installed relay. Run " +
    "`pnpm keys status`; pin this key first, or use the one the tree already trusts."
  );
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
 * The relay is a server, not an app: it has no update feed and no Electron
 * manifest. The update key signs the checksum list, and that list is what
 * verifies the tarball. The tag, the version and the changelog section are the
 * same facts the desktop paths use, so they are checked before this runs.
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
  const head = capture("git", ["rev-parse", "HEAD"]);
  const porcelain = capture("git", ["status", "--porcelain"]);
  const packageText = await readFile(join(ROOT, app.project, "package.json"), "utf8");
  const version = versionFromPackage(packageText);
  const changelog = await readFile(join(ROOT, app.changelog), "utf8").catch(() => "");
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
  problems.push(...gateProblems(gateStatus, head));

  const tag = options.tag ?? (version === null ? null : tagFor(app, version));
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

  // The pin is what an installed relay trusts. Signing with any other key produces a checksum
  // list that every existing install refuses as "not signed by the publisher".
  const keyProblem = publisherKeyProblem(privateKey);
  if (keyProblem !== null) {
    throw new Error(`${keyProblem}\n  at        ${keyPath}`);
  }

  await releaseRelay(app, options, { head, version, tag, changelog, privateKey, keyPath });
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
    process.stderr.write(
      `unknown app ${options.appId}\n\n${USAGE}\n` +
        "Desktop apps ship as Flatpaks; publish them with `node scripts/flatpak-remote.mjs`.\n",
    );
    process.exit(2);
  }

  if (options.verify) {
    const packageText = await readFile(join(ROOT, app.project, "package.json"), "utf8");
    const expected = versionFromPackage(packageText);
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
