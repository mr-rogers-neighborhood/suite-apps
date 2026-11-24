#!/usr/bin/env node
/**
 * Publish the local Flatpak OSTree repository to the public store or the lab host.
 *
 * `scripts/flatpak.mjs` builds one signed repository at `~/suite-flatpak/repo`
 * and installs from it on this machine. This script publishes that same
 * repository; it never builds a second one. A person on another machine adds one
 * remote and installs from it:
 *
 *   flatpak remote-add --user --if-not-exists --from suite <url>/suite.flatpakrepo
 *   flatpak install --user suite run.suite.planner
 *
 * `--target s3` uploads the same bytes to the private bucket behind CloudFront,
 * where `https://flatpak.suite.run/` serves them. `--target lan` keeps the local
 * `suite-dev` test remote, which is the default.
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
 * `--from-repo` publishes a repository an earlier step already built, instead of
 * the default `SUITE_FLATPAK_REPO` (or `<state>/repo`). `--commit-file` writes
 * the commits the published branch refs point at, one `<commit>  <ref>` line per
 * ref, after signing the summary and before the upload. The summary is re-signed
 * by this run; the commits are not rewritten, so the file is what an attestation
 * should name.
 *
 * An S3 publication merges the refs already in the bucket before it signs, so
 * one channel's publication keeps every other channel's ref in the summary. It
 * refuses to upload a summary that lost one. `--no-merge-published` replaces
 * that summary deliberately, which is only right for a first publication or a
 * bucket whose refs are meant to go away.
 *
 * Usage:
 *   node scripts/flatpak-remote.mjs                       # dry run, local target
 *   node scripts/flatpak-remote.mjs --publish             # sign and copy to suite-dev
 *   node scripts/flatpak-remote.mjs --target s3           # dry run: every aws command
 *   node scripts/flatpak-remote.mjs --target s3 --publish # upload and invalidate
 *   node scripts/flatpak-remote.mjs --channel preview     # dry run for a pre-release branch
 *   node scripts/flatpak-remote.mjs --from-repo <path> --commit-file <path> --publish
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { branchFor, channelProblem } from "./lib/channel.mjs";
import {
  DEFAULT_PUBLIC_URL,
  DEFAULT_TARGET,
  REMOTE_NAME,
  buildUpdateRepoArguments,
  commandText,
  commitFileText,
  flatpakrepoUrl,
  foreignRefs,
  hasPublishedRefs,
  invalidationCommand,
  normalizeRemoteUrl,
  preservedRefs,
  restoreRefCommands,
  refsFromSummaryView,
  s3ConfigProblems,
  s3MergeCommands,
  s3UploadCommands,
  shouldMergePublishedRefs,
  summaryPreservationProblem,
  targetProblem,
} from "./lib/flatpakRemote.mjs";
import { dirtyTreeProblem, gateProblems } from "./release.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The remote name `flatpak install` takes, re-exported for the release page. */
export { REMOTE_NAME };

/** The branch the stable apps carry today. A tier names its own with `--branch`. */
export const DEFAULT_BRANCH = "master";

/** The dedicated port on the host; nothing else listens there. */
export const PORT = 8088;

/** Where the local test host serves from, and the URL that directory answers on. */
export const DEFAULT_HOST = "suite-dev";
export const DEFAULT_REMOTE_DIR = "/home/aurora/flatpak/repo";
export const DEFAULT_REMOTE_URL = `http://10.28.20.200:${PORT}`;

const USAGE = `usage: node scripts/flatpak-remote.mjs [options]

  --publish           sign the summary and publish (default: dry run)
  --dry-run           stop before signing, uploading or copying; the default
  --target <place>    lan (local test host) or s3 (public store); default: ${DEFAULT_TARGET}
  --branch <name>     branch a pre-release channel publishes (default: the channel, or stable)
  --channel <name>    slop, nightly or preview; the same as --branch <name>
  --host <name>       ssh host for the lan target (default: ${DEFAULT_HOST})
  --url <url>         base URL (default: ${DEFAULT_REMOTE_URL} for lan,
                      ${DEFAULT_PUBLIC_URL} for s3)
  --bucket <name>     S3 bucket for the s3 target
  --distribution <id> CloudFront distribution for the s3 target
  --from-repo <path>  publish this already-built repository instead of
                      $SUITE_FLATPAK_REPO or <state>/repo
  --commit-file <path> write "<commit>  <ref>" for each published ref before
                      the upload, so the attestation names the shipped commits
  --no-merge-published
                      publish only the refs built here; the summary replaces the
                      published one instead of naming every channel (S3 only)
  --help              print this text

Environment overrides: SUITE_FLATPAK_STATE, SUITE_FLATPAK_REPO,
SUITE_STORE_KEY_ID, SUITE_FLATPAK_HOST, SUITE_FLATPAK_REMOTE_DIR,
SUITE_FLATPAK_URL, SUITE_FLATPAK_TARGET, SUITE_FLATPAK_S3_BUCKET,
SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION.
`;

export function parseArgs(argv) {
  const options = {
    publish: false,
    dryRun: false,
    branch: null,
    channel: null,
    host: null,
    url: null,
    target: null,
    bucket: null,
    distribution: null,
    fromRepo: null,
    commitFile: null,
    noMergePublished: false,
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
    } else if (arg === "--target") {
      options.target = takeValue(index, "--target");
      index += 1;
    } else if (arg === "--bucket") {
      options.bucket = takeValue(index, "--bucket");
      index += 1;
    } else if (arg === "--distribution") {
      options.distribution = takeValue(index, "--distribution");
      index += 1;
    } else if (arg === "--from-repo") {
      options.fromRepo = takeValue(index, "--from-repo");
      index += 1;
    } else if (arg === "--commit-file") {
      options.commitFile = takeValue(index, "--commit-file");
      index += 1;
    } else if (arg === "--no-merge-published") {
      options.noMergePublished = true;
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

/**
 * The static deltas and their indexes a publication would upload.
 *
 * `deltas/` is what makes an update fetch only the objects that changed, and
 * `delta-indexes/` is what the client reads first to find the delta. A
 * repository built before the flags existed has neither, and a first build has
 * no parent commit to diff against, so this reports zero rather than failing:
 * the summary still installs and updates, they just download in full.
 */
function staticDeltas(repo) {
  const dirs = ["deltas", "delta-indexes"].map((name) => join(repo, name));
  if (!dirs.some((dir) => existsSync(dir))) return { files: 0, bytes: 0, deltas: 0 };
  let files = 0;
  let bytes = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const stats = treeStats(dir);
    files += stats.files;
    bytes += stats.bytes;
  }
  const listed = spawnSync("ostree", [`--repo=${repo}`, "static-delta", "list"], {
    encoding: "utf8",
  });
  const deltas = (listed.stdout ?? "").split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  return { files, bytes, deltas };
}

const stateDir = process.env.SUITE_FLATPAK_STATE?.trim() || join(homedir(), "suite-flatpak");
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

/** Every ref name in one repository, before or after a merge. */
function refsInRepo(repo) {
  // This ostree build only accepts the repository as `--repo=<path>`, not as
  // two arguments.
  return capture("ostree", [`--repo=${repo}`, "refs"])
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Every ref in one repository, and the branches the app refs name. */
function repositoryRefs(repo) {
  if (!existsSync(repo)) {
    throw new Error(`no repository at ${repo}; run scripts/flatpak.mjs first`);
  }
  if (!existsSync(join(repo, "summary"))) {
    throw new Error(`${repo} has no summary; run scripts/flatpak.mjs first`);
  }

  const refs = refsInRepo(repo);
  const appRefs = refs.filter((ref) => ref.startsWith("app/"));
  const branches = [...new Set(appRefs.map((ref) => ref.split("/")[3]).filter(Boolean))];
  return { refs, appRefs, branches };
}

/** The OSTree commit one published ref points at. */
function commitOf(repo, ref) {
  const output = capture("ostree", [`--repo=${repo}`, "rev-parse", ref]);
  const commit = output.split(/\s+/u)[0] ?? "";
  if (!/^[0-9a-f]{40,64}$/iu.test(commit)) {
    throw new Error(`ostree printed no commit for ${ref}: ${JSON.stringify(output)}`);
  }
  return commit;
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
function verifySignedSummary(repo) {
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
    "Homepage=https://github.com/mrrnbhd/suite-apps",
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

/** True when the aws CLI answers; a dry run never asks. */
function awsOnPath() {
  const result = spawnSync("aws", ["--version"], { stdio: "ignore" });
  return result.error === undefined && result.status === 0;
}

/** Print one command exactly as a person would paste it. */
function printStep(step) {
  process.stdout.write(`  $ ${commandText(step)}\n`);
}

/** Run one generated aws command, printing the same text a dry run prints. */
function runStep(step) {
  process.stdout.write(`\n$ ${commandText(step)}\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw new Error(`${step.command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${step.command} exited ${result.status}`);
}

/** The commands a publication would run, with placeholders a dry run may print. */
function publicationCommands({ repo, bucket, distribution }) {
  return {
    uploads: s3UploadCommands({ repo, flatpakrepoPath, bucket }),
    invalidation: invalidationCommand({ distribution }),
  };
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

  const target =
    options.target?.trim() || process.env.SUITE_FLATPAK_TARGET?.trim() || DEFAULT_TARGET;
  const miss = targetProblem(target);
  if (miss !== null) throw new Error(miss);

  const host = options.host?.trim() || process.env.SUITE_FLATPAK_HOST?.trim() || DEFAULT_HOST;
  const remoteDir = process.env.SUITE_FLATPAK_REMOTE_DIR?.trim() || DEFAULT_REMOTE_DIR;
  const bucket =
    options.bucket?.trim() || process.env.SUITE_FLATPAK_S3_BUCKET?.trim() || "";
  const distribution =
    options.distribution?.trim() ||
    process.env.SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION?.trim() ||
    "";
  const url = normalizeRemoteUrl(
    options.url?.trim() ||
      process.env.SUITE_FLATPAK_URL?.trim() ||
      (target === "s3" ? DEFAULT_PUBLIC_URL : DEFAULT_REMOTE_URL),
  );
  const repo = resolve(
    options.fromRepo?.trim() ||
      process.env.SUITE_FLATPAK_REPO?.trim() ||
      join(stateDir, "repo"),
  );

  // A dry run prints commands with placeholders, so it needs neither the bucket
  // nor a credential; --publish refuses before it signs anything.
  const bucketForCommands = bucket || "<SUITE_FLATPAK_S3_BUCKET>";
  const distributionForCommands =
    distribution || "<SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION>";
  const awsReady = target === "s3" && options.publish ? awsOnPath() : true;
  if (target === "s3" && options.publish) {
    const problems = s3ConfigProblems({
      bucket,
      distribution,
      awsOnPath: awsReady,
    });
    if (problems.length > 0) throw new Error(problems.join("\n\n"));
  }

  const channel = options.channel?.trim() || null;
  if (channel !== null) {
    const channelMiss = channelProblem(channel);
    if (channelMiss !== null) throw new Error(channelMiss);
  }
  const requestedBranch =
    channel !== null ? branchFor(channel) : (options.branch?.trim() || null);

  const { keyId, publicKey } = storeKey();
  const { refs, appRefs, branches } = repositoryRefs(repo);
  // Stable stays the default branch, so adding a channel does not change what a
  // plain `flatpak install suite run.suite.<app>` resolves to. A future repo
  // that names stable `stable` wins over the current `master`.
  const defaultBranch = branches.includes("stable") ? "stable" : DEFAULT_BRANCH;
  const branch = requestedBranch ?? defaultBranch;

  if (!branches.includes(branch)) {
    throw new Error(
      `the repository has no app refs on branch ${branch} ` +
        `(it has: ${branches.length > 0 ? branches.join(", ") : "none"}). ` +
        "A pre-release branch is published by `node scripts/flatpak.mjs --channel <channel>`.",
    );
  }

  const onBranch = branchRefs(appRefs, branch);
  // Every ref this build made, runtime and app, so a preserved-ref report does
  // not call this run's own runtime a channel it did not build.
  const builtRefs = refs.filter((ref) => ref.split("/")[3] === branch);
  // The merge below copies the bucket's refs over these, so record what this
  // build made before it starts; they are put back after the sync (D4.3).
  const builtCommitRefs = builtRefs.map((ref) => ({ ref, commit: commitOf(repo, ref) }));
  const publishedCommits = onBranch
    .map((ref) => ({ ref, commit: commitOf(repo, ref) }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  const { head, proven } = checkGitProof();
  const { files, bytes } = treeStats(repo);
  const deltas = staticDeltas(repo);

  const targetLine =
    target === "s3" ? `s3 s3://${bucketForCommands}/` : `${host}:${remoteDir}`;

  process.stdout.write("\nsuite Flatpak remote\n\n");
  process.stdout.write(`  repository  ${repo}\n`);
  process.stdout.write(`  store key   ${keyId}\n`);
  process.stdout.write(`  gate proof  ${proven}\n`);
  process.stdout.write(`  commit      ${head}\n`);
  process.stdout.write(`  branch      ${branch} (${onBranch.length} app refs)\n`);
  process.stdout.write(`  default     ${defaultBranch}\n`);
  process.stdout.write(`  target      ${targetLine}\n`);
  process.stdout.write(`  url         ${url}\n`);
  process.stdout.write(`  upload      ${files} files, ${mib(bytes)}\n`);
  process.stdout.write(
    deltas.deltas > 0
      ? `  deltas      ${deltas.deltas} deltas, ${deltas.files} files, ${mib(deltas.bytes)}\n`
      : "  deltas      none yet; an update will download the whole ref\n",
  );
  process.stdout.write("  refs\n");
  for (const ref of refs) {
    if (ref.startsWith("app/") && !onBranch.includes(ref)) continue;
    process.stdout.write(`    ${ref}\n`);
  }
  const runtimeRefs = refs.length - appRefs.length;
  if (runtimeRefs > 0) {
    process.stdout.write(`    (${runtimeRefs} runtime and metadata refs beside them)\n`);
  }
  process.stdout.write("  shipping\n");
  for (const { ref, commit } of publishedCommits) {
    process.stdout.write(`    ${commit}  ${ref}\n`);
  }

  if (!options.publish) {
    process.stdout.write("\nwould sign the summary with the store key, then ");
    if (target === "lan") {
      process.stdout.write(`copy the repository to ${host}:${remoteDir}\n`);
      process.stdout.write(`would write ${flatpakrepoPath} and serve it as suite.flatpakrepo\n`);
    } else {
      process.stdout.write("upload the same repository to S3\n");
      process.stdout.write(`would write ${flatpakrepoPath} and upload it as suite.flatpakrepo\n`);
      const missing = s3ConfigProblems({
        bucket,
        distribution,
        awsOnPath: true,
      });
      if (missing.length > 0) {
        process.stdout.write(
          "\nthis is not publishable yet; a dry run uses placeholders for these:\n",
        );
        for (const problem of missing) process.stdout.write(`  - ${problem}\n`);
      }
      if (options.noMergePublished) {
        process.stdout.write(
          "\n--no-merge-published: the summary would name only the refs built here\n",
        );
      } else {
        process.stdout.write(
          "\nbefore signing, it would merge the refs already in the bucket so the " +
            "summary keeps every channel:\n",
        );
        for (const step of s3MergeCommands({ repo, bucket: bucketForCommands })) {
          printStep(step);
        }
        const kept = preservedRefs(builtRefs, refs);
        process.stdout.write("\nrefs it would keep without building them:\n");
        if (kept.length === 0) {
          process.stdout.write("  (none: this repository holds only this run's refs)\n");
        } else {
          for (const ref of kept) process.stdout.write(`  ${ref}\n`);
        }
        process.stdout.write(
          "  (a ref only the bucket has is found during the merge; a first " +
            "publication merges nothing)\n",
        );
      }
      const { uploads, invalidation } = publicationCommands({
        repo,
        bucket: bucketForCommands,
        distribution: distributionForCommands,
      });
      process.stdout.write("\nwould then sign a summary naming every merged ref and run:\n");
      for (const step of uploads) printStep(step);
      process.stdout.write("\nthen invalidate only the mutable paths:\n");
      printStep(invalidation);
    }
    if (options.commitFile !== null) {
      process.stdout.write(
        `\nwould write ${resolve(options.commitFile)} with the commits above before the upload\n`,
      );
    }
    process.stdout.write(
      target === "s3"
        ? "\ndry run: nothing was signed, uploaded or invalidated.\n"
        : "\ndry run: nothing was signed, copied or written on the host.\n",
    );
    process.stdout.write(
      `To publish: node scripts/flatpak-remote.mjs --target ${target} ` +
        `--branch ${branch} --publish\n`,
    );
    return;
  }

  let mergedRefs = refs;
  let foreign = [];
  if (target === "s3" && !options.noMergePublished) {
    // Only a listing is read here: an empty one is a first publication, and the
    // merge would have nothing to copy.
    const listing = capture("aws", ["s3", "ls", `s3://${bucket}/refs/`, "--recursive"]);
    if (
      shouldMergePublishedRefs({
        target,
        noMergePublished: options.noMergePublished,
        bucketHasRefs: hasPublishedRefs(listing),
      })
    ) {
      process.stdout.write("\n=== merge published refs ===\n");
      for (const step of s3MergeCommands({ repo, bucket })) runStep(step);
      // The sync rewrote every ref the bucket also has, including this run's
      // own branch. Put the built commits back before anything is signed.
      for (const step of restoreRefCommands({ repo, builtRefs: builtCommitRefs })) runStep(step);
      mergedRefs = refsInRepo(repo);
      foreign = foreignRefs(builtRefs, mergedRefs);
      process.stdout.write(
        `\nmerged ${foreign.length} ref(s) this run did not build; ` +
          `restored ${builtCommitRefs.length} built ref(s)\n`,
      );
      for (const ref of foreign) process.stdout.write(`  + ${ref}\n`);
    } else {
      process.stdout.write("\nfirst publication: the bucket has no refs to merge\n");
    }
  } else if (target === "s3") {
    process.stdout.write(
      "\n--no-merge-published: the summary will name only this run's refs\n",
    );
  }

  process.stdout.write("\n=== sign summary ===\n");
  // A repository built by an older `scripts/flatpak.mjs` has no deltas yet;
  // regenerating here costs CPU once and gives the publication its `deltas/`.
  // With a foreign ref, appstream stays as it was merged and its delta is
  // skipped: its tree is not here, so neither can be made from this branch.
  run("flatpak", buildUpdateRepoArguments({ repo, keyId, foreignRefs: foreign }));
  verifySignedSummary(repo);

  // Refuse before the upload: a summary that names fewer refs than the merge
  // brought in hides a channel whose ref and objects are still in the bucket.
  const summaryRefs = refsFromSummaryView(
    capture("ostree", [`--repo=${repo}`, "summary", "--view"]),
  );
  const lost = summaryPreservationProblem({ mergedRefs, summaryRefs });
  if (lost !== null) throw new Error(lost);
  process.stdout.write(`summary names ${summaryRefs.length} refs\n`);
  const kept = preservedRefs(builtRefs, mergedRefs);
  if (kept.length > 0) {
    process.stdout.write("preserved refs this run did not build:\n");
    for (const ref of kept) process.stdout.write(`  ${ref}\n`);
  }
  // The upload syncs `deltas/` and `delta-indexes/`; empty trees upload nothing
  // and keep a first publication (no parent commit to diff) working.
  mkdirSync(join(repo, "deltas"), { recursive: true });
  mkdirSync(join(repo, "delta-indexes"), { recursive: true });

  const flatpakrepo = flatpakrepoText({ publicKey, branch: defaultBranch, url });
  writeFileSync(flatpakrepoPath, flatpakrepo);
  process.stdout.write(`\n${flatpakrepoPath}\n`);

  // Attestation names the commits, not the summary this run signed. Resolve
  // them again after `build-update-repo`, then write the file before any byte
  // leaves the machine.
  if (options.commitFile !== null) {
    const shippedCommits = onBranch
      .map((ref) => ({ ref, commit: commitOf(repo, ref) }))
      .sort((left, right) => left.ref.localeCompare(right.ref));
    const commitPath = resolve(options.commitFile);
    mkdirSync(dirname(commitPath), { recursive: true });
    const text = commitFileText(shippedCommits);
    writeFileSync(commitPath, text);
    process.stdout.write(`\n${commitPath}\n${text}`);
  }

  if (target === "s3") {
    const { uploads, invalidation } = publicationCommands({ repo, bucket, distribution });

    // OSTree objects are content-addressed: an old one is harmless, so the sync
    // never deletes. The mutable files are copied rather than synced so an
    // unchanged summary is still refreshed under its no-cache header.
    process.stdout.write("\n=== upload to s3 ===\n");
    for (const step of uploads) runStep(step);

    process.stdout.write("\n=== invalidate cloudfront ===\n");
    runStep(invalidation);

    process.stdout.write(`\npublished ${REMOTE_NAME} to s3://${bucket}/\n`);
    process.stdout.write(`remote ${url}\n`);
    process.stdout.write("\nadd it on another machine with:\n");
    process.stdout.write(
      `  flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ` +
        `${flatpakrepoUrl(url)}\n`,
    );
    process.stdout.write(`  flatpak install --user ${REMOTE_NAME} run.suite.planner\n`);
    return;
  }

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
  process.stdout.write(`remote ${url}\n`);
  process.stdout.write("\nadd it on another machine with:\n");
  process.stdout.write(
    `  flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ` +
      `${flatpakrepoUrl(url)}\n`,
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
