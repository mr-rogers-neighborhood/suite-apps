/**
 * The release side of the catalogue index: where it is published, how a
 * publication chains to the last one, and the AWS commands that put it beside
 * the Flatpak summary.
 *
 * The format and its verification belong to `@suite/pack` (S12.2); this module
 * only turns "the archives this job built" into the next published index. The
 * URL is the Flatpak remote's own origin, so a host adds no second host and no
 * second certificate to trust.
 */
import { basename } from "node:path";
import {
  DEFAULT_PUBLIC_URL,
  IMMUTABLE_CACHE_CONTROL,
  INDEX_FILE,
  INDEX_INVALIDATION_PATHS,
  INDEX_SIGNATURE_FILE,
  NO_CACHE_CONTROL,
  PACKS_PREFIX,
  indexUrl,
  normalizeRemoteUrl,
} from "./flatpakRemote.mjs";

/** The build output a pack command writes its archive into. */
export const PACKS_DIR = ".dev/release/packs";

/** The metadata the release notes read; the report is a local file, not a secret. */
export const INDEX_METADATA_FILE = "index-release.json";

/** A catalogue must be refreshed at least this often; a nightly does it daily. */
export const DEFAULT_EXPIRES_DAYS = 30;

export { indexUrl };

/** The archive URL base the entries use: the same remote, under `packs/`. */
export function packUrlBase(base = DEFAULT_PUBLIC_URL) {
  return `${normalizeRemoteUrl(base)}${PACKS_PREFIX}`;
}

/** One archive filename as the published URL. */
export function packArchiveUrl(fileName, base = DEFAULT_PUBLIC_URL) {
  return `${packUrlBase(base)}${encodeURIComponent(fileName)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The sequence, previous digest and expiry of the index this publication writes.
 *
 * `prior` is the index the remote serves today, or null when there is none. The
 * first publication starts at sequence 1 with no predecessor; every later one
 * increases the sequence and names the digest of the index it replaces. A
 * catalogue that lapses and is published again still chains from the last one:
 * a person can see that nothing was skipped, even if the host refused the stale
 * copy while it was expired.
 */
export function nextIndexState(
  prior,
  { now = new Date(), expiresDays = DEFAULT_EXPIRES_DAYS } = {},
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("the index build needs a valid generation time");
  }
  if (!Number.isInteger(expiresDays) || expiresDays <= 0) {
    throw new Error("expiresDays needs a positive whole number");
  }
  const generatedAt = now.toISOString();
  const expires = new Date(now.getTime() + expiresDays * DAY_MS).toISOString();
  if (prior === null || prior === undefined) {
    return { sequence: 1, generatedAt, expires };
  }
  const sequence = Number(prior.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("the published index names no usable sequence");
  }
  if (typeof prior.digest !== "string" || !/^[a-f0-9]{64}$/u.test(prior.digest)) {
    throw new Error("the published index names no usable digest");
  }
  return { sequence: sequence + 1, previous: prior.digest, generatedAt, expires };
}

/**
 * The upload plan for one publication.
 *
 * Order is part of the contract: every archive goes first, then the detached
 * signature, then `index.json` last. A consumer must never be able to fetch an
 * index that names an archive the store does not have yet; publishing the index
 * is the commit point. `release-index.test.mjs` asserts this order, so a later
 * edit cannot make it an accident of list position.
 *
 * `index.json` and its signature change on every publication and are no-cache;
 * an archive is named for its bytes and is immutable. Only the two mutable
 * names are invalidated, because CloudFront has never seen the new archive
 * names before.
 */
export function indexUploadCommands({
  bucket,
  distribution,
  indexPath,
  signaturePath,
  packPaths = [],
}) {
  const target = (key) => `s3://${bucket}/${key}`;
  const archiveUploads = packPaths.map((path) => ({
    command: "aws",
    args: [
      "s3",
      "cp",
      path,
      target(`${PACKS_PREFIX}${basename(path)}`),
      "--cache-control",
      IMMUTABLE_CACHE_CONTROL,
      "--no-progress",
    ],
  }));
  const signatureUpload = {
    command: "aws",
    args: [
      "s3",
      "cp",
      signaturePath,
      target(INDEX_SIGNATURE_FILE),
      "--cache-control",
      NO_CACHE_CONTROL,
      "--no-progress",
    ],
  };
  const indexUpload = {
    command: "aws",
    args: [
      "s3",
      "cp",
      indexPath,
      target(INDEX_FILE),
      "--cache-control",
      NO_CACHE_CONTROL,
      "--no-progress",
    ],
  };
  return [
    ...archiveUploads,
    signatureUpload,
    indexUpload,
    {
      command: "aws",
      args: [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        distribution,
        "--paths",
        ...INDEX_INVALIDATION_PATHS,
      ],
    },
  ];
}
