#!/usr/bin/env node
/**
 * Publish the local Flatpak OSTree repository to the `suite-dev` static host.
 *
 * `scripts/flatpak.mjs` builds one signed repository at `~/suite-flatpak/repo`
 * and installs from it on this machine. This script publishes that same
 * repository; it never builds a second one. A person on another machine adds one
 * remote and installs from it:
 *
 *   flatpak remote-add --user --if-not-exists --from suite <url>/suite.flatpakrepo
 *   flatpak install --user suite run.suite.planner
 *
 * Three rules make the publication safe to repeat:
 *
 * - **The summary is signed.** `flatpak build-update-repo --gpg-sign` runs before
 *   anything leaves this machine, and the fresh summary is verified by a
 *   throwaway Flatpak installation before it is copied.
 * - **The commit is proven.** A dirty tree or a HEAD the gate did not prove
 *   refuses the run, with the same `.dev/gate-status.json` rule
 *   `scripts/release.mjs` uses. Publication copies bytes; it commits nothing, so
 *   the proof does not move afterwards.
 * - **Nothing is published unless `--publish` is passed.** A dry run prints the
 *   refs and the size it would upload and changes nothing.
 *
 * `--branch` names the branch a tier publishes and proves the repository has
 * it. `--channel` is the same thing with the tier names checked first. The
 * remote's `DefaultBranch` stays the stable branch (`master` today, `stable`
 * when the repository carries one), so adding a tier does not break a stable
 * install; a tier is installed with an explicit `//<tier>`.
 *
 * Usage:
 *   node scripts/flatpak-remote.mjs                 # dry run
 *   node scripts/flatpak-remote.mjs --publish       # sign and copy
 *   node scripts/flatpak-remote.mjs --channel beta  # dry run for a tier branch
 *   node scripts/flatpak-remote.mjs --help
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { branchFor, channelProblem } from "./lib/channel.mjs";
import { dirtyTreeProblem, gateProblems } from "./release.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The remote name a person types after `flatpak install`. */
export const REMOTE_NAME = "suite";

/** The branch the stable apps carry today. A tier names its own with `--branch`. */
export const DEFAULT_BRANCH = "master";

/** The dedicated port on the host; nothing else listens there. */
export const PORT = 8088;

/** Where the host serves from, and the URL that directory answers on. */
export const DEFAULT_HOST = "suite-dev";
export const DEFAULT_REMOTE_DIR = "/home/aurora/flatpak/repo";
export const DEFAULT_REMOTE_URL = `http://10.28.20.200:${PORT}`;

const USAGE = `usage: node scripts/flatpak-remote.mjs [options]

  --publish           sign the summary and copy the repo to the host (default: dry run)
  --dry-run           stop before signing or copying; the default
  --branch <name>     branch a tier publishes (default: the tier, or stable)
  --channel <tier>    slop, canary or beta; the same as --branch <tier>
  --host <name>       ssh host (default: ${DEFAULT_HOST})
  --url <url>         public base URL (default: ${DEFAULT_REMOTE_URL})
  --help              print this text

Environment overrides: SUITE_FLATPAK_STATE, SUITE_FLATPAK_REPO,
SUITE_STORE_KEY_ID, SUITE_FLATPAK_HOST, SUITE_FLATPAK_REMOTE_DIR,
SUITE_FLATPAK_URL.
`;

function parseArgs(argv) {
  const options = {
    publish: false,
    dryRun: false,
    branch: null,
    channel: null,
    host: null,
    url: null,
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
    else if (arg === "--branch") {
      options.branch = takeValue(index, "--branch");
      index += 1;
    } else if (arg === "--channel") {
      options.channel = takeValue(index, "--channel");
      index += 1;
    } else if (arg === "--host") {
      options.host = takeValue(index, "--host");
      index += 1;
    } else if (arg === "--url") {
      options.url = takeValue(index, "--url");
      index += 1;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

function run(command, args, { cwd = ROOT, env = process.env } = {}) {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function capture(command, args, { cwd = ROOT, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "").trim();
}

/** A path safe to paste into a remote POSIX shell command. */
function shellQuote(value) {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function treeStats(directory) {
  let files = 0;
  let bytes = 0;
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(path).size;
      }
    }
  }
  return { files, bytes };
}

function mib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const stateDir = process.env.SUITE_FLATPAK_STATE?.trim() || join(homedir(), "suite-flatpak");
const repo = process.env.SUITE_FLATPAK_REPO?.trim() || join(stateDir, "repo");
const keyIdPath = join(stateDir, "store-key.id");
const publicKeyPath = join(stateDir, "suite-store.gpg");
const flatpakrepoPath = join(stateDir, `${REMOTE_NAME}.flatpakrepo`);

/**
 * The store key the summary is signed with.
 *
 * An unsigned repository is a local experiment; it is never a publication. The
 * fingerprint is not a secret, the private half stays in ~/.gnupg, and a
 * fingerprint whose key is gone fails here instead of after a 185 MiB copy.
 */
function storeKey() {
  const keyId =
    process.env.SUITE_STORE_KEY_ID?.trim() ||
    (existsSync(keyIdPath) ? readFileSync(keyIdPath, "utf8").trim() : "");
  if (keyId.length === 0) {
    throw new Error(
      "no store key, so the summary would be unsigned. " +
        "Run scripts/store-key.sh first; a published remote is always GPG-signed.",
    );
  }

  const listed = spawnSync("gpg", ["--batch", "--list-keys", keyId], { stdio: "ignore" });
  if (listed.error) throw new Error("gpg is not installed, so the store key cannot sign anything");
  if (listed.status !== 0) {
    throw new Error(
      `store key ${keyId} is not in the keyring. Run scripts/store-key.sh to make one.`,
    );
  }

  // Keep the public half beside the fingerprint. It is what the `.flatpakrepo`
  // file embeds, so the key a client imports is the key the summary was signed
  // with, not whatever a previous run exported.
  mkdirSync(stateDir, { recursive: true });
  const exported = spawnSync("gpg", ["--batch", "--export", keyId]);
  if (exported.status !== 0 || exported.stdout.length === 0) {
    throw new Error(`could not export the public half of ${keyId}`);
  }
  writeFileSync(publicKeyPath, exported.stdout);

  return { keyId, publicKey: exported.stdout };
}

/** Every ref in the local repository, and the branches the app refs name. */
function repositoryRefs() {
  if (!existsSync(repo)) {
    throw new Error(`no repository at ${repo}; run scripts/flatpak.mjs first`);
  }
  if (!existsSync(join(repo, "summary"))) {
    throw new Error(`${repo} has no summary; run scripts/flatpak.mjs first`);
  }

  // This ostree build only accepts the repository as `--repo=<path>`, not as
  // two arguments.
  const refs = capture("ostree", [`--repo=${repo}`, "refs"])
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const appRefs = refs.filter((ref) => ref.startsWith("app/"));
  const branches = [...new Set(appRefs.map((ref) => ref.split("/")[3]).filter(Boolean))];
  return { refs, appRefs, branches };
}

function branchRefs(appRefs, branch) {
  return appRefs.filter((ref) => ref.split("/")[3] === branch);
}

/**
 * Prove the summary this run just wrote is signed by the store key.
 *
 * `summary.sig` is OSTree's signature container, not a bare OpenPGP message, so
 * `gpg --verify` cannot read it. A throwaway Flatpak installation with the
 * public key imported asks the same question a client asks: does this remote
 * enumerate with verification on? A missing or wrong signature fails here,
 * before the bytes are copied.
 */
function verifySignedSummary() {
  const summaryPath = join(repo, "summary");
  const signaturePath = join(repo, "summary.sig");
  if (!existsSync(summaryPath) || !existsSync(signaturePath) || statSync(signaturePath).size === 0) {
    throw new Error(`${repo} has no summary.sig; refusing to publish an unsigned summary`);
  }

  const work = mkdtempSync(join(tmpdir(), "suite-flatpak-check-"));
  const dataHome = join(work, "data");
  const runtimeDir = join(work, "run");
  mkdirSync(dataHome, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

  const env = { ...process.env, XDG_DATA_HOME: dataHome, XDG_RUNTIME_DIR: runtimeDir };
  const checkRemote = "suite-publish-check";
  try {
    const added = spawnSync(
      "flatpak",
      [
        "remote-add",
        "--user",
        "--if-not-exists",
        `--gpg-import=${publicKeyPath}`,
        checkRemote,
        `file://${repo}`,
      ],
      { encoding: "utf8", env },
    );
    if (added.status !== 0) {
      throw new Error(`flatpak could not add the signed summary: ${added.stderr.trim()}`);
    }

    const listed = spawnSync("flatpak", ["remote-ls", "--user", checkRemote], {
      encoding: "utf8",
      env,
    });
    if (listed.status !== 0) {
      throw new Error(`the signed summary did not verify: ${listed.stderr.trim()}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  process.stdout.write("summary verifies with the store key\n");
}

/** The `.flatpakrepo` a client may fetch, with the public key embedded. */
function flatpakrepoText({ publicKey, branch, url }) {
  const base = url.replace(/\/+$/u, "");
  return [
    "[Flatpak Repo]",
    "Title=Suite",
    "Comment=Suite apps, signed by the Suite store key",
    `Url=${base}/`,
    "Homepage=https://github.com/mr-rogers-neighborhood/suite-apps",
    `DefaultBranch=${branch}`,
    `GPGKey=${publicKey.toString("base64")}`,
    "",
  ].join("\n");
}

function checkGitProof() {
  const head = capture("git", ["rev-parse", "HEAD"]);
  const porcelain = capture("git", ["status", "--porcelain"]);
  const dirty = dirtyTreeProblem(porcelain);
  if (dirty !== null) throw new Error(dirty);

  const statusPath = join(ROOT, ".dev", "gate-status.json");
  let status = null;
  try {
    status = JSON.parse(readFileSync(statusPath, "utf8"));
  } catch {
    status = null;
  }

  const problems = gateProblems(status, head);
  if (problems.length > 0) {
    throw new Error(
      `${problems.join("\n\n")}\n\n` +
        "Publish only a commit the gate proved. Run `node scripts/gate.mjs --fresh`.",
    );
  }

  return { head, proven: status.commit };
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
  if (options.publish && options.dryRun) {
    process.stderr.write("--publish and --dry-run contradict each other\n");
    process.exit(2);
  }

  const host = options.host?.trim() || process.env.SUITE_FLATPAK_HOST?.trim() || DEFAULT_HOST;
  const remoteDir =
    process.env.SUITE_FLATPAK_REMOTE_DIR?.trim() || DEFAULT_REMOTE_DIR;
  const url =
    options.url?.trim() || process.env.SUITE_FLATPAK_URL?.trim() || DEFAULT_REMOTE_URL;

  const channel = options.channel?.trim() || null;
  if (channel !== null) {
    const miss = channelProblem(channel);
    if (miss !== null) throw new Error(miss);
  }
  const requestedBranch =
    channel !== null ? branchFor(channel) : (options.branch?.trim() || null);

  const { keyId, publicKey } = storeKey();
  const { refs, appRefs, branches } = repositoryRefs();
  // Stable stays the default branch, so adding a tier does not change what a
  // plain `flatpak install suite run.suite.<app>` resolves to. A future repo
  // that names stable `stable` wins over the current `master`.
  const defaultBranch = branches.includes("stable") ? "stable" : DEFAULT_BRANCH;
  const branch = requestedBranch ?? defaultBranch;

  if (!branches.includes(branch)) {
    throw new Error(
      `the repository has no app refs on branch ${branch} ` +
        `(it has: ${branches.length > 0 ? branches.join(", ") : "none"}). ` +
        "A tier branch is published by `node scripts/flatpak.mjs --channel <tier>`.",
    );
  }

  const onBranch = branchRefs(appRefs, branch);
  const { head, proven } = checkGitProof();
  const { files, bytes } = treeStats(repo);

  process.stdout.write("\nsuite Flatpak remote\n\n");
  process.stdout.write(`  repository  ${repo}\n`);
  process.stdout.write(`  store key   ${keyId}\n`);
  process.stdout.write(`  gate proof  ${proven}\n`);
  process.stdout.write(`  commit      ${head}\n`);
  process.stdout.write(`  branch      ${branch} (${onBranch.length} app refs)\n`);
  process.stdout.write(`  default     ${defaultBranch}\n`);
  process.stdout.write(`  target      ${host}:${remoteDir}\n`);
  process.stdout.write(`  url         ${url.replace(/\/+$/u, "")}/\n`);
  process.stdout.write(`  upload      ${files} files, ${mib(bytes)}\n`);
  process.stdout.write("  refs\n");
  for (const ref of refs) {
    if (ref.startsWith("app/") && !onBranch.includes(ref)) continue;
    process.stdout.write(`    ${ref}\n`);
  }
  const runtimeRefs = refs.length - appRefs.length;
  if (runtimeRefs > 0) {
    process.stdout.write(`    (${runtimeRefs} runtime and metadata refs beside them)\n`);
  }

  if (!options.publish) {
    process.stdout.write(
      "\nwould sign the summary with the store key, then copy the repository " +
        `to ${host}:${remoteDir}\n`,
    );
    process.stdout.write(`would write ${flatpakrepoPath} and serve it as suite.flatpakrepo\n`);
    process.stdout.write("\ndry run: nothing was signed, copied or written on the host.\n");
    process.stdout.write(`To publish: node scripts/flatpak-remote.mjs --branch ${branch} --publish\n`);
    return;
  }

  process.stdout.write("\n=== sign summary ===\n");
  run("flatpak", ["build-update-repo", `--gpg-sign=${keyId}`, repo]);
  verifySignedSummary();

  const flatpakrepo = flatpakrepoText({ publicKey, branch: defaultBranch, url });
  writeFileSync(flatpakrepoPath, flatpakrepo);
  process.stdout.write(`\n${flatpakrepoPath}\n`);

  process.stdout.write("\n=== copy repository ===\n");
  run("ssh", [host, `mkdir -p ${shellQuote(remoteDir)}`]);
  run("rsync", [
    "-az",
    "--delete",
    "--exclude=/suite.flatpakrepo",
    "--stats",
    "-e",
    "ssh",
    `${repo}/`,
    `${host}:${remoteDir}/`,
  ]);

  // The `.flatpakrepo` sits inside the served directory, so a client can fetch
  // the public key it needs from the same place it learns the remote URL. rsync
  // excludes it from deletion; this write keeps it current.
  const remoteFlatpakrepo = join(remoteDir, `${REMOTE_NAME}.flatpakrepo`);
  const uploaded = spawnSync("ssh", [host, `cat > ${shellQuote(remoteFlatpakrepo)}`], {
    input: flatpakrepo,
    encoding: "utf8",
  });
  if (uploaded.status !== 0) {
    throw new Error(`could not write ${remoteFlatpakrepo}: ${uploaded.stderr.trim()}`);
  }

  process.stdout.write("\n=== verify the host ===\n");
  const names = ["summary", "summary.sig", `${REMOTE_NAME}.flatpakrepo`];
  const local = names.map((name) =>
    name.endsWith(".flatpakrepo") ? sha256Of(flatpakrepoPath) : sha256Of(join(repo, name)),
  );
  const remoteOutput = capture("ssh", [
    host,
    `sha256sum ${names.map((name) => shellQuote(join(remoteDir, name))).join(" ")}`,
  ]);
  const remote = remoteOutput.split(/\r?\n/u).map((line) => line.split(/\s+/u)[0]);
  for (const [index, name] of names.entries()) {
    if (local[index] !== remote[index]) {
      throw new Error(`${name} on ${host} does not match the local file`);
    }
    process.stdout.write(`  ${name} ${local[index]}\n`);
  }

  process.stdout.write(`\npublished ${REMOTE_NAME} to ${host}:${remoteDir}\n`);
  process.stdout.write(`remote ${url.replace(/\/+$/u, "")}/\n`);
  process.stdout.write("\nadd it on another machine with:\n");
  process.stdout.write(
    `  flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ` +
      `${url.replace(/\/+$/u, "")}/${REMOTE_NAME}.flatpakrepo\n`,
  );
  process.stdout.write(`  flatpak install --user ${REMOTE_NAME} run.suite.planner\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    process.exit(1);
  }
}
