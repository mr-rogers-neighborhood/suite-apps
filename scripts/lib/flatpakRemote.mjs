/**
 * The public Flatpak remote's identity, its cache classes and its AWS commands.
 *
 * The signed OSTree repository is built once by `scripts/flatpak.mjs` and served
 * from `https://flatpak.suite.run/`: private S3 behind CloudFront, with DNS at
 * Cloudflare. `scripts/flatpak-remote.mjs` publishes it, `scripts/release-status.mjs`
 * prints the same install line, and the documentation links the URL rather than
 * restating it. This module is the one place the URL is written down.
 *
 * A publication builds one branch; the public remote holds every channel. The
 * merge functions here are what keep one publication from replacing a summary
 * that names the refs it did not build.
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

/**
 * Directories whose files are immutable.
 *
 * `deltas/` and `delta-indexes/` belong here: a static delta is named by the two
 * commits it joins (`<from>-<to>.superblock` and its parts) and an index by the
 * commit it describes, so a given name never describes different bytes. A new
 * publication adds new names and never rewrites an old one, which is also why
 * neither needs an invalidation.
 */
export const IMMUTABLE_PREFIXES = [
  "objects/",
  "refs/",
  "summaries/",
  "deltas/",
  "delta-indexes/",
];

/**
 * The `flatpak build-update-repo` arguments that make a delta-based update.
 *
 * `--generate-static-deltas` writes `deltas/` beside `objects/`: an update then
 * downloads the objects that changed between two commits instead of the whole
 * ref. It costs CPU and repository bytes once, at build and publish time.
 *
 * The Debug runtime is an `autodelete`, `no-autodownload` extension, so a client
 * never fetches its delta; generating one only makes the repository bigger.
 * Flatpak matches the ignore pattern against the ref's id (`<kind>/<id>/<arch>/
 * <branch>`), not the whole ref, so this names the id, not `runtime/…`.
 */
export const STATIC_DELTA_ARGUMENTS = [
  "--generate-static-deltas",
  "--static-delta-ignore-ref=run.suite.*.Debug",
];

/**
 * The files that change on every publication and are re-fetched each time.
 *
 * `summary.idx` is not optional: an OSTree client asks for it first and uses it
 * to fetch a smaller cached summary under `summaries/`. Publishing the summary
 * without its index (or without the `summaries/` tree the index names) leaves a
 * client on the previous ref set or fails it outright.
 */
export const MUTABLE_FILES = [
  "summary",
  "summary.sig",
  "summary.idx",
  "summary.idx.sig",
  `${REMOTE_NAME}.flatpakrepo`,
];

/** The only CloudFront paths a publication invalidates, in this order. */
export const INVALIDATION_PATHS = [
  `/summary`,
  `/summary.sig`,
  `/summary.idx`,
  `/summary.idx.sig`,
  `/${REMOTE_NAME}.flatpakrepo`,
];

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

/**
 * The refs a publication shipped and the OSTree commit each one names.
 *
 * The summary is re-signed at publish time, so it is not the artifact to attest; the commits the
 * published refs point at are. One `<commit>  <ref>` line per ref, sorted by ref, keeps the file
 * deterministic for an attestation and readable with the usual checksum tools.
 */
export function commitFileText(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("a commit file needs at least one published ref");
  }
  const lines = entries.map(({ ref, commit } = {}) => {
    if (typeof ref !== "string" || ref.length === 0) {
      throw new Error("a commit file entry needs a ref");
    }
    if (typeof commit !== "string" || !/^[0-9a-f]{40,64}$/iu.test(commit)) {
      throw new Error(`a commit file entry for ${ref} has no OSTree commit`);
    }
    return { ref, commit };
  });
  return `${lines
    .sort((left, right) => left.ref.localeCompare(right.ref))
    .map(({ ref, commit }) => `${commit}  ${ref}`)
    .join("\n")}\n`;
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
 * - The content-addressed trees are synced without `--delete`: an old object or
 *   delta is harmless, and deleting one would break a client mid-update. A
 *   delta is named for the commit pair it joins, so an update reads a name this
 *   publication adds and never modifies.
 * - Only the summary names (`summary`, `summary.sig`, `summary.idx`,
 *   `summary.idx.sig`) and the `.flatpakrepo` change from one publication to the
 *   next, so only they are no-cache. `summaries/` holds content-addressed cache
 *   entries, so it is immutable.
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
      "sync",
      `${repo}/summaries`,
      s3Url(bucket, "summaries"),
      "--cache-control",
      cache("summaries/"),
      "--no-progress",
    ]),
    // After the objects they name and before the summary that advertises them.
    aws([
      "s3",
      "sync",
      `${repo}/deltas`,
      s3Url(bucket, "deltas"),
      "--cache-control",
      cache("deltas/"),
      "--no-progress",
    ]),
    // A client asks for the delta index before the superblock, so it travels
    // with the delta it describes.
    aws([
      "s3",
      "sync",
      `${repo}/delta-indexes`,
      s3Url(bucket, "delta-indexes"),
      "--cache-control",
      cache("delta-indexes/"),
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
      `${repo}/summary.idx`,
      s3Url(bucket, "summary.idx"),
      "--cache-control",
      cache("summary.idx"),
    ]),
    aws([
      "s3",
      "cp",
      `${repo}/summary.idx.sig`,
      s3Url(bucket, "summary.idx.sig"),
      "--cache-control",
      cache("summary.idx.sig"),
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

/** One value per name, sorted, so a ref set prints and compares the same way twice. */
function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * The object files a summary needs for a ref this repository did not build.
 *
 * `flatpak build-update-repo` reads the commit, its metadata and the metadata of
 * its root tree to name a ref in the summary. It does not read file contents.
 * The metadata subset of `objects/` is a few MiB where the trees are hundreds,
 * so a publication downloads only what the summary needs to name a channel it
 * did not build.
 */
export const SUMMARY_OBJECT_INCLUDES = [
  "*.commit",
  "*.commitmeta",
  "*.commitmeta2",
  "*.dirtree",
  "*.dirmeta",
];

/**
 * The commands that bring the refs already on the bucket into the local repo.
 *
 * The direction is bucket to local: a publication builds one branch locally and
 * must not sign a summary that forgets the channels somebody else published.
 * Neither command deletes. An object the bucket lacks is this run's own build,
 * and a ref the bucket lacks is the ref this run is about to add.
 */
export function s3MergeCommands({ repo, bucket }) {
  return [
    aws(["s3", "sync", s3Url(bucket, "refs"), `${repo}/refs`, "--no-progress"]),
    aws([
      "s3",
      "sync",
      s3Url(bucket, "objects"),
      `${repo}/objects`,
      "--no-progress",
      "--exclude",
      "*",
      ...SUMMARY_OBJECT_INCLUDES.flatMap((pattern) => ["--include", pattern]),
    ]),
  ];
}

/**
 * The `ostree refs --create` commands that put back the refs this run built.
 *
 * The S3 merge copies the bucket's `refs/` over the local ones, so a ref this
 * build just made would otherwise be reset to the published commit; the signed
 * summary would then advertise yesterday's build. Restore every built ref
 * before signing, and keep the bucket's other refs as they came in.
 *
 * The merge already copied this branch's ref into the local repository, so the
 * restore overwrites it: `--create` alone refuses an existing ref. `--force`
 * comes before `--create`, because `--create` takes the next word as its ref
 * name and would otherwise read the flag as one.
 */
export function restoreRefCommands({ repo, builtRefs }) {
  return (builtRefs ?? []).map(({ ref, commit }) => ({
    command: "ostree",
    args: [`--repo=${repo}`, "refs", "--force", "--create", ref, commit],
  }));
}

/** True when the bucket's ref listing names at least one ref. */
export function hasPublishedRefs(listing) {
  return String(listing ?? "")
    .split(/\r?\n/u)
    .some((line) => line.trim().length > 0);
}

/**
 * Whether this run merges the refs already published before it signs.
 *
 * A first publication has no refs to merge, and `--no-merge-published` is the
 * deliberate opt-out for a bucket whose refs this run means to replace. The
 * default is to merge: a summary that omits a channel hides an install that is
 * still in the bucket.
 */
export function shouldMergePublishedRefs({
  target,
  noMergePublished = false,
  bucketHasRefs = false,
} = {}) {
  return target === "s3" && !noMergePublished && bucketHasRefs;
}

/** The refs the bucket has that this run did not build. */
export function foreignRefs(localRefs, mergedRefs) {
  const local = new Set(localRefs);
  return sortedUnique(mergedRefs.filter((ref) => !local.has(ref)));
}

/** The merged refs a summary must keep that this run did not publish. */
export function preservedRefs(builtRefs, mergedRefs) {
  const built = new Set(builtRefs);
  return sortedUnique(mergedRefs.filter((ref) => !built.has(ref)));
}

/** The distinct app ids a set of refs names. */
export function appIdsOf(refs) {
  return sortedUnique(
    refs
      .filter((ref) => ref.startsWith("app/"))
      .map((ref) => ref.split("/")[1])
      .filter((id) => typeof id === "string" && id.length > 0),
  );
}

/**
 * The `flatpak build-update-repo` arguments for a summary naming every channel.
 *
 * When a merged ref was not built here its tree is not here, so appstream
 * cannot be regenerated from it: `--no-update-appstream` keeps the ref that was
 * merged instead of replacing it with metadata for the local branches only.
 * Static deltas cannot be made for those refs either, so each foreign app id is
 * ignored rather than logging a failure per ref.
 */
export function buildUpdateRepoArguments({ repo, keyId, foreignRefs: merged = [] }) {
  const args = ["build-update-repo", ...STATIC_DELTA_ARGUMENTS];
  if (merged.length > 0) {
    args.push("--no-update-appstream");
    for (const appId of appIdsOf(merged)) {
      args.push(`--static-delta-ignore-ref=${appId}`);
    }
  }
  args.push(`--gpg-sign=${keyId}`, repo);
  return args;
}

/** The refs an `ostree summary --view` lists, one `* <ref>` line each. */
export function refsFromSummaryView(view) {
  const refs = String(view ?? "")
    .split(/\r?\n/u)
    .map((line) => line.match(/^\*\s+(\S+)\s*$/u)?.[1])
    .filter((ref) => typeof ref === "string" && ref.length > 0);
  return sortedUnique(refs);
}

/** The merged refs a summary does not advertise. */
export function missingSummaryRefs({ mergedRefs, summaryRefs }) {
  const advertised = new Set(summaryRefs);
  return sortedUnique(mergedRefs.filter((ref) => !advertised.has(ref)));
}

/**
 * Why a signed summary may not be published, or null.
 *
 * This is the check that closes incident #278: the summary is the only place a
 * client learns which refs exist, so a summary that drops one hides a channel
 * while its ref and objects stay in the bucket.
 */
export function summaryPreservationProblem({ mergedRefs, summaryRefs }) {
  const missing = missingSummaryRefs({ mergedRefs, summaryRefs });
  if (missing.length === 0) return null;
  return (
    `the signed summary does not advertise ${missing.length} merged ref(s): ` +
    `${missing.join(", ")}. Refusing to publish a summary that would hide a channel.`
  );
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
