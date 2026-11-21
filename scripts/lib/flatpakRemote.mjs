/**
 * The public Flatpak remote's identity, its cache classes and its AWS commands.
 *
 * The signed OSTree repository is built once by `scripts/flatpak.mjs` and served
 * from `https://flatpak.suite.run/`: private S3 behind CloudFront, with DNS at
 * Cloudflare. `scripts/flatpak-remote.mjs` publishes it, `scripts/release-status.mjs`
 * prints the same install line, and the documentation links the URL rather than
 * restating it. This module is the one place the URL is written down.
 *
 * Everything here is pure string work, so the cache split and the exact `aws`
 * commands can be tested without a bucket, a distribution or a credential.
 */

/** The remote name a person types after `flatpak install`. */
export const REMOTE_NAME = "suite";

/** The public store every machine adds; CloudFront serves the signed repository. */
export const DEFAULT_PUBLIC_URL = "https://flatpak.suite.run/";

/** The two places a publication can go. `lan` is the local test remote. */
export const TARGETS = ["lan", "s3"];
export const DEFAULT_TARGET = "lan";

/**
 * OSTree objects and refs are content-addressed, so their names never describe
 * different bytes. Caching them for a year is safe and cheap.
 */
export const IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable";

/** The summary changes on every publication; a client must not keep it. */
export const NO_CACHE_CONTROL = "no-cache";

/** Directories whose files are immutable. */
export const IMMUTABLE_PREFIXES = ["objects/", "refs/"];

/** The files that change on every publication and are re-fetched each time. */
export const MUTABLE_FILES = ["summary", "summary.sig", `${REMOTE_NAME}.flatpakrepo`];

/** The only CloudFront paths a publication invalidates, in this order. */
export const INVALIDATION_PATHS = [`/summary`, `/summary.sig`, `/${REMOTE_NAME}.flatpakrepo`];

/**
 * One base URL, with exactly one trailing slash.
 *
 * The `.flatpakrepo` embeds this value and a person pastes it into a shell, so a
 * missing or doubled slash is normalised here instead of at each use.
 */
export function normalizeRemoteUrl(url) {
  const value = String(url ?? "").trim();
  if (value.length === 0) throw new Error("a Flatpak remote URL cannot be empty");
  return `${value.replace(/\/+$/u, "")}/`;
}

/** The `.flatpakrepo` a client fetches from a base URL. */
export function flatpakrepoUrl(base = DEFAULT_PUBLIC_URL) {
  return `${normalizeRemoteUrl(base)}${REMOTE_NAME}.flatpakrepo`;
}

/** True when this publication target is one the scripts know. */
export function isTarget(target) {
  return TARGETS.includes(target);
}

/** Why this target cannot be used, or null. */
export function targetProblem(target) {
  if (isTarget(target)) return null;
  return `unknown target ${JSON.stringify(target)}; known: ${TARGETS.join(", ")}`;
}

/**
 * The cache class of one repository path, or a refusal.
 *
 * A path is relative to the repository root and may carry a leading slash. An
 * unnamed path is refused rather than uploaded with a guess, so a new kind of
 * file has to choose its cache behaviour deliberately.
 */
export function cacheControlFor(path) {
  const name = String(path ?? "").replace(/^\/+/u, "");
  if (IMMUTABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  if (MUTABLE_FILES.includes(name)) return NO_CACHE_CONTROL;
  return null;
}

/** Why this path has no cache class, or null. */
export function cacheControlProblem(path) {
  if (cacheControlFor(path) !== null) return null;
  return (
    `${path} has no S3 cache class. Objects and refs cache for a year; ` +
    `${MUTABLE_FILES.join(", ")} are no-cache.`
  );
}

/**
 * Why an S3 publication cannot start, from the values it needs.
 *
 * A dry run prints commands with placeholders and needs neither a credential nor
 * a binary; `--publish` calls this with every value it resolved.
 */
export function s3ConfigProblems({ bucket, distribution, awsOnPath = true }) {
  const problems = [];
  if (String(bucket ?? "").trim().length === 0) {
    problems.push(
      "S3 needs a bucket: pass --bucket or set SUITE_FLATPAK_S3_BUCKET " +
        "(for example, the private bucket CloudFront reads).",
    );
  }
  if (String(distribution ?? "").trim().length === 0) {
    problems.push(
      "S3 needs a CloudFront distribution to invalidate: pass --distribution or set " +
        "SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION.",
    );
  }
  if (!awsOnPath) {
    problems.push("the aws CLI is not on PATH, so the repository cannot be uploaded or invalidated.");
  }
  return problems;
}

/** One command, ready to run or to print. */
function aws(args) {
  return { command: "aws", args };
}

/** The path of one repository file as an S3 key URL. */
function s3Url(bucket, key) {
  return `s3://${bucket}/${key}`;
}

/**
 * The upload plan for a publication.
 *
 * Three rules shape it:
 *
 * - The content-addressed trees are synced without `--delete`: an old object is
 *   harmless, and deleting one would break a client mid-update.
 * - Only `summary`, `summary.sig` and the `.flatpakrepo` change from one
 *   publication to the next, so only they are no-cache.
 * - The `.flatpakrepo` is read from the generated file beside the state
 *   directory, not from the repository, because the repository holds the bytes
 *   every remote shares while the file embeds this publication's URL.
 */
export function s3UploadCommands({ repo, flatpakrepoPath, bucket }) {
  const cache = (path) => {
    const value = cacheControlFor(path);
    if (value === null) throw new Error(cacheControlProblem(path));
    return value;
  };

  return [
    aws([
      "s3",
      "sync",
      `${repo}/objects`,
      s3Url(bucket, "objects"),
      "--cache-control",
      cache("objects/"),
      "--no-progress",
    ]),
    aws([
      "s3",
      "sync",
      `${repo}/refs`,
      s3Url(bucket, "refs"),
      "--cache-control",
      cache("refs/"),
      "--no-progress",
    ]),
    aws([
      "s3",
      "cp",
      `${repo}/summary`,
      s3Url(bucket, "summary"),
      "--cache-control",
      cache("summary"),
    ]),
    aws([
      "s3",
      "cp",
      `${repo}/summary.sig`,
      s3Url(bucket, "summary.sig"),
      "--cache-control",
      cache("summary.sig"),
    ]),
    aws([
      "s3",
      "cp",
      flatpakrepoPath,
      s3Url(bucket, `${REMOTE_NAME}.flatpakrepo`),
      "--cache-control",
      cache(`${REMOTE_NAME}.flatpakrepo`),
    ]),
  ];
}

/** The one invalidation a publication needs, after the upload finishes. */
export function invalidationCommand({ distribution }) {
  return aws([
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    distribution,
    "--paths",
    ...INVALIDATION_PATHS,
  ]);
}

/** A command as a person can paste it, quoting only what a shell needs. */
export function commandText({ command, args }) {
  const quoted = args.map((arg) =>
    /^[A-Za-z0-9_./:=@<>,+-]+$/u.test(arg) ? arg : `'${arg.replace(/'/gu, "'\\''")}'`,
  );
  return [command, ...quoted].join(" ");
}
