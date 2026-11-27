#!/usr/bin/env node
/**
 * Build and publish the signed catalogue index from the packs a release built.
 *
 * The release job ships Flatpaks and an APK; a pack is published separately.
 * Each pack build command this script is given writes its `.suitepack` into
 * `.dev/release/packs`, and the index is then built from exactly those bytes
 * with `scripts/pack-index.mjs`, so an entry hash describes what shipped.
 *
 *   node scripts/release-index.mjs [--build "<command>"]… [options]
 *   node scripts/release-index.mjs --publish
 *
 * With no `--build`, nothing is staged and the step says so:
 *
 *   no packs to index; index not published
 *
 * That is a true statement about a release with no pack artifact, not a
 * misconfiguration, so it does not fail. A **build that produces no archive**,
 * a **missing operator key**, or a **fingerprint that does not match the pin**
 * fails loudly before anything is signed.
 *
 * The first phase fetches the index the remote serves today, verifies it against
 * the same operator key, and writes `sequence + 1` with `previous` naming its
 * digest. It writes `.dev/release/index.json`, `.dev/release/index.json.sig`
 * (a detached signature over the exact file bytes) and
 * `.dev/release/index-release.json` for the release notes. With `--publish` it
 * uploads the index, the signature and the archives to the Flatpak remote's own
 * bucket, under `/packs/`, and invalidates only the two mutable names.
 *
 * The operator key is a trust root separate from the pack publisher key. It is
 * `SUITE_INDEX_KEY` (or `--key`), and `SUITE_INDEX_KEY_FINGERPRINT` (or
 * `--fingerprint`) is the value a host pins. Only the fingerprint is printed;
 * the private key never is.
 *
 * Usage:
 *   node scripts/release-index.mjs                         # stage from --build list
 *   node scripts/release-index.mjs --publish               # upload the staged index
 *   node scripts/release-index.mjs --help
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalisePublisherFingerprint,
  packIndexDigest,
  parsePackIndexJson,
  publicKeyFromSecret,
  publisherKeyFingerprint,
  signBytes,
  verifyBytes,
  verifyPackIndex,
} from "@suite/pack";
import {
  DEFAULT_PUBLIC_URL,
  INDEX_FILE,
  INDEX_SIGNATURE_FILE,
  commandText,
  indexSignatureUrl,
  indexUrl,
} from "./lib/flatpakRemote.mjs";
import {
  DEFAULT_EXPIRES_DAYS,
  INDEX_METADATA_FILE,
  PACKS_DIR,
  indexUploadCommands,
  nextIndexState,
  packUrlBase,
} from "./lib/releaseIndex.mjs";
import { buildPackIndex, seedBase64 } from "./pack-index.mjs";
import { ROOT } from "./lib/keys.mjs";
import { cardPathForArchive } from "./lib/packCard.mjs";

export { INDEX_FILE, INDEX_SIGNATURE_FILE, INDEX_METADATA_FILE };

/** The sentence a release with no pack artifact prints, and a publish checks for. */
export const NO_PACKS_MESSAGE = "no packs to index; index not published";

const OUT_DIR = ".dev/release";

function write(chunk) {
  process.stdout.write(chunk);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} needs a positive whole number, not ${JSON.stringify(value)}.`);
  }
  return number;
}

function valuesOf(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.`);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function argumentValue(argv, flag) {
  return valuesOf(argv, flag)[0];
}

function commandValue(argv, flag) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) return argv[index + 1];
  }
  return undefined;
}

/** Run one pack build command through the shell, exactly as a person pastes it. */
function runShell(build) {
  const result = spawnSync("sh", ["-c", build], { stdio: "inherit", cwd: ROOT });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `pack build failed: ${build} exited ${result.status}; nothing was signed`,
    );
  }
}

function archivesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".suitepack"))
    .map((entry) => join(directory, entry.name))
    .sort();
}

/**
 * The card beside every staged archive.
 *
 * A card is part of the pack build's output, not an optional extra: an index
 * whose entry has no card gives a Home a tile it cannot draw, so a missing card
 * fails the publication instead of shipping the archive alone.
 */
function cardsForArchives(archives) {
  return archives.map((archive) => {
    const card = cardPathForArchive(archive);
    if (!existsSync(card)) {
      throw new Error(
        `${archive} has no card at ${card}; the pack build writes it beside the archive, ` +
          "and the catalogue publishes both or neither.",
      );
    }
    return card;
  });
}

function clearOutputs(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const name of [INDEX_FILE, INDEX_SIGNATURE_FILE, INDEX_METADATA_FILE]) {
    rmSync(join(outDir, name), { force: true });
  }
}

/**
 * Verify the index the remote serves today and reduce it to what the chain
 * needs. It is verified at its own generation time so an index that lapsed
 * while nobody published can still be succeeded; the new `expires` is what a
 * host checks.
 */
async function priorState(text, publicKey) {
  const parsed = parsePackIndexJson(text);
  if (!parsed.ok) {
    throw new Error(
      `the published index does not parse: ${parsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const verified = await verifyPackIndex(parsed.value, {
    operatorKeys: [publicKey],
    now: new Date(parsed.value.generatedAt),
  });
  if (!verified.ok) {
    throw new Error(`the published index does not verify: ${verified.message}`);
  }
  return {
    sequence: parsed.value.sequence,
    digest: await packIndexDigest(parsed.value),
    entries: parsed.value.entries.map((entry) => ({
      id: entry.id,
      version: entry.version,
      sha256: entry.archive.sha256,
    })),
  };
}

/** Compare two dotted numeric versions; a prerelease tag never sorts above its release. */
export function comparePackVersions(left, right) {
  const a = String(left).split("-")[0].split(".").map(Number);
  const b = String(right).split("-")[0].split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = a[index] ?? 0;
    const two = b[index] ?? 0;
    if (one !== two) return one < two ? -1 : 1;
  }
  return 0;
}

/**
 * A pack version names its bytes, because the archive URL is cached as
 * immutable. Publishing different bytes under a published version leaves every
 * cached client refusing an archive the index says it should accept, and moving
 * backwards re-offers something a rollback already retired.
 *
 * The build is deterministic, so an unchanged source produces the same digest;
 * a difference here means the pack changed without a version bump.
 */
export function packVersionProblems(priorEntries, nextEntries) {
  const published = new Map(priorEntries.map((entry) => [entry.id, entry]));
  const problems = [];
  for (const next of nextEntries) {
    const before = published.get(next.id);
    if (before === undefined) continue;
    const order = comparePackVersions(next.version, before.version);
    if (order < 0) {
      problems.push(
        `${next.id} ${next.version} is older than the published ${before.version}; ` +
          "a catalogue publish never moves a pack backwards",
      );
      continue;
    }
    if (order === 0 && next.archive.sha256 !== before.sha256) {
      problems.push(
        `${next.id} ${next.version} is already published with different bytes ` +
          `(${before.sha256.slice(0, 12)} -> ${next.archive.sha256.slice(0, 12)}); ` +
          "bump the pack version before publishing",
      );
    }
  }
  return problems;
}

/**
 * Build and sign the next index from the archives the build commands wrote.
 *
 * A test calls this with an ephemeral key and `priorIndex` text; the CLI fetches
 * the prior text from the published remote.
 */
export async function prepareIndex({
  builds,
  packsDir = join(ROOT, PACKS_DIR),
  outDir = join(ROOT, OUT_DIR),
  privateKey,
  expectedFingerprint,
  priorIndex = null,
  now = new Date(),
  expiresDays = DEFAULT_EXPIRES_DAYS,
  urlBase = DEFAULT_PUBLIC_URL,
  threshold,
  run = runShell,
  log = write,
}) {
  if (!Array.isArray(builds) || builds.length === 0) {
    clearOutputs(outDir);
    rmSync(packsDir, { recursive: true, force: true });
    log(`${NO_PACKS_MESSAGE}\n`);
    return { prepared: false, reason: NO_PACKS_MESSAGE };
  }

  if (typeof privateKey !== "string" || privateKey.trim().length === 0) {
    throw new Error(
      "SUITE_INDEX_KEY (or --key) is required: a catalogue index is signed by the " +
        "operator key, never by a pack publisher key, and is not skipped.",
    );
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.trim().length === 0) {
    throw new Error(
      "SUITE_INDEX_KEY_FINGERPRINT (or --fingerprint) is required, so a host can pin the " +
        "operator key deliberately.",
    );
  }

  const seed = seedBase64(privateKey);
  const publicKey = publicKeyFromSecret(seed);
  const fingerprint = await publisherKeyFingerprint(publicKey);
  const pinned = normalisePublisherFingerprint(expectedFingerprint);
  if (pinned === null || pinned !== fingerprint) {
    throw new Error(
      `The operator key's fingerprint ${fingerprint} does not match the pinned ` +
        `${expectedFingerprint}. Refusing to sign a catalogue with an unpinned key.`,
    );
  }
  log(`catalogue operator fingerprint ${fingerprint}\n`);

  rmSync(packsDir, { recursive: true, force: true });
  mkdirSync(packsDir, { recursive: true });
  for (const build of builds) {
    log(`building pack: ${build}\n`);
    run(build);
  }

  const archives = archivesIn(packsDir);
  if (archives.length === 0) {
    throw new Error(
      `The ${builds.length} pack build command(s) produced no .suitepack in ${packsDir}; ` +
        "refusing to publish an index that describes nothing.",
    );
  }
  const cards = cardsForArchives(archives);

  const prior =
    priorIndex === null || priorIndex === undefined
      ? null
      : await priorState(priorIndex, publicKey);
  const state = nextIndexState(prior, { now, expiresDays });

  mkdirSync(outDir, { recursive: true });
  const indexPath = join(outDir, INDEX_FILE);
  const built = await buildPackIndex({
    archives,
    urlBase: packUrlBase(urlBase),
    sequence: state.sequence,
    generatedAt: state.generatedAt,
    expires: state.expires,
    previous: state.previous,
    threshold,
    privateKeys: [seed],
    outPath: indexPath,
  });

  if (prior !== null) {
    const problems = packVersionProblems(prior.entries, built.index.entries);
    if (problems.length > 0) {
      throw new Error(
        `the catalogue cannot publish these packs:\n  ${problems.join("\n  ")}`,
      );
    }
  }

  // A detached signature over the exact file bytes lets a mirror prove the
  // download before it parses it; the document's own signatures verify the
  // canonical bytes the host actually reads.
  const signaturePath = join(outDir, INDEX_SIGNATURE_FILE);
  const fileBytes = new TextEncoder().encode(built.json);
  const signature = signBytes(fileBytes, seed);
  if (!verifyBytes(fileBytes, signature, publicKey)) {
    throw new Error("the detached signature did not verify against the operator key");
  }
  writeFileSync(signaturePath, `${signature}\n`);

  const metadataPath = join(outDir, INDEX_METADATA_FILE);
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        sequence: built.index.sequence,
        ...(state.previous === undefined ? {} : { previous: state.previous }),
        generatedAt: state.generatedAt,
        expires: state.expires,
        url: indexUrl(urlBase),
        signatureUrl: indexSignatureUrl(urlBase),
        fingerprint,
        digest: built.digest,
        packs: archives.map((path) => basename(path)),
        packPaths: archives.map((path) => relative(ROOT, path)),
        cards: cards.map((path) => basename(path)),
        cardPaths: cards.map((path) => relative(ROOT, path)),
      },
      null,
      2,
    )}\n`,
  );

  log(
    `index sequence ${built.index.sequence}, ${built.index.entries.length} pack(s), ` +
      `expires ${state.expires}\n`,
  );
  log(
    state.previous === undefined
      ? "first index: no previous digest\n"
      : `previous ${state.previous}\n`,
  );
  return {
    prepared: true,
    index: built.index,
    digest: built.digest,
    fingerprint,
    indexPath,
    signaturePath,
    metadataPath,
    archives,
    cards,
  };
}

/** Upload the staged index, its signature and the archives it names. */
export function publishPrepared({
  outDir = join(ROOT, OUT_DIR),
  bucket,
  distribution,
  run,
  log = write,
}) {
  const indexPath = join(outDir, INDEX_FILE);
  const signaturePath = join(outDir, INDEX_SIGNATURE_FILE);
  const metadataPath = join(outDir, INDEX_METADATA_FILE);
  if (!existsSync(indexPath) || !existsSync(signaturePath) || !existsSync(metadataPath)) {
    log(`${NO_PACKS_MESSAGE}\n`);
    return { published: false, reason: NO_PACKS_MESSAGE };
  }

  if (typeof bucket !== "string" || bucket.trim().length === 0) {
    throw new Error("SUITE_FLATPAK_S3_BUCKET (or --bucket) is required to publish the index.");
  }
  if (typeof distribution !== "string" || distribution.trim().length === 0) {
    throw new Error(
      "SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION (or --distribution) is required to invalidate the index.",
    );
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const packPaths = Array.isArray(metadata.packPaths)
    ? metadata.packPaths.map((path) => join(ROOT, path))
    : (Array.isArray(metadata.packs) ? metadata.packs : []).map((name) =>
        join(ROOT, PACKS_DIR, name),
      );
  const cardPaths = Array.isArray(metadata.cardPaths)
    ? metadata.cardPaths.map((path) => join(ROOT, path))
    : (Array.isArray(metadata.cards) ? metadata.cards : []).map((name) =>
        join(ROOT, PACKS_DIR, name),
      );
  for (const path of [...packPaths, ...cardPaths]) {
    if (!existsSync(path)) {
      throw new Error(
        `${path} was staged but is gone; refusing to publish an index with a dead entry.`,
      );
    }
  }

  const commands = indexUploadCommands({
    bucket,
    distribution,
    indexPath,
    signaturePath,
    packPaths,
    cardPaths,
  });
  for (const step of commands) {
    log(`${commandText(step)}\n`);
    if (run !== undefined) {
      run(step.command, step.args);
    } else {
      const result = spawnSync(step.command, step.args, { stdio: "inherit" });
      if (result.error !== undefined) throw result.error;
      if (result.status !== 0) {
        throw new Error(`${step.command} ${step.args.join(" ")} exited ${result.status}`);
      }
    }
  }

  log(`catalogue index published at ${metadata.url}\n`);
  return { published: true, url: metadata.url, sequence: metadata.sequence, commands };
}

/** Read the index the remote serves today; a 404 is the first publication. */
export async function fetchPriorIndex(url, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
  } catch (error) {
    throw new Error(`could not read the published index at ${url}: ${error.message}`);
  }
  // A missing S3 object behind CloudFront answers 403 when the origin has no
  // list permission, so both mean "there is no index yet".
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`the published index at ${url} answered ${response.status}`);
  }
  return response.text();
}

function usage() {
  return `Suite catalogue index release

  node scripts/release-index.mjs [--build "<command>"]… [options]
  node scripts/release-index.mjs --publish

  --build <command>       build one pack and write its .suitepack into
                          ${PACKS_DIR}; repeatable, all four packs today
  --publish               upload the staged index and archives
  --packs-dir <dir>       where the build commands write archives
  --out-dir <dir>         where index.json, index.json.sig and metadata go
  --key <base64>          operator signing key; default $SUITE_INDEX_KEY
  --fingerprint <value>   the pinned fingerprint; default $SUITE_INDEX_KEY_FINGERPRINT
  --url <url>             the remote base; default ${DEFAULT_PUBLIC_URL}
  --index-url <url>       where to read the prior index; default <url>${INDEX_FILE}
  --expires-days <n>      days until the index expires; default ${DEFAULT_EXPIRES_DAYS}
  --threshold <n>         operator signatures required; default 1
  --now <ISO>             generation time; default now
  --bucket <name>         S3 bucket; default $SUITE_FLATPAK_S3_BUCKET
  --distribution <id>     CloudFront distribution; default
                          $SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION
  --help                  print this text

A missing operator key or a mismatched fingerprint fails the step. No --build
prints "${NO_PACKS_MESSAGE}" and stages nothing.
`;
}

export async function main(argv, { fetchImpl = fetch } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  const known = new Set([
    "--build",
    "--publish",
    "--packs-dir",
    "--out-dir",
    "--key",
    "--fingerprint",
    "--url",
    "--index-url",
    "--expires-days",
    "--threshold",
    "--now",
    "--bucket",
    "--distribution",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    if (!known.has(token)) throw new Error(`unknown option ${token}`);
    if (token !== "--publish") index += 1;
  }

  const outDir = resolve(argumentValue(argv, "--out-dir") ?? join(ROOT, OUT_DIR));
  const bucket =
    commandValue(argv, "--bucket") ?? process.env.SUITE_FLATPAK_S3_BUCKET ?? "";
  const distribution =
    commandValue(argv, "--distribution") ??
    process.env.SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION ??
    "";

  if (argv.includes("--publish")) {
    publishPrepared({ outDir, bucket, distribution });
    return 0;
  }

  const builds = valuesOf(argv, "--build");
  if (builds.length === 0) {
    clearOutputs(outDir);
    process.stdout.write(`${NO_PACKS_MESSAGE}\n`);
    return 0;
  }

  const urlBase =
    argumentValue(argv, "--url") ?? process.env.SUITE_FLATPAK_URL ?? DEFAULT_PUBLIC_URL;
  const indexUrlValue = argumentValue(argv, "--index-url") ?? indexUrl(urlBase);
  const priorIndex = await fetchPriorIndex(indexUrlValue, fetchImpl);
  const now = argumentValue(argv, "--now");
  const expiresDays = argumentValue(argv, "--expires-days");
  const threshold = argumentValue(argv, "--threshold");

  await prepareIndex({
    builds,
    packsDir: resolve(argumentValue(argv, "--packs-dir") ?? join(ROOT, PACKS_DIR)),
    outDir,
    privateKey: argumentValue(argv, "--key") ?? process.env.SUITE_INDEX_KEY ?? "",
    expectedFingerprint:
      argumentValue(argv, "--fingerprint") ??
      process.env.SUITE_INDEX_KEY_FINGERPRINT ??
      "",
    priorIndex,
    now: now === undefined ? new Date() : new Date(now),
    expiresDays:
      expiresDays === undefined
        ? DEFAULT_EXPIRES_DAYS
        : positiveInteger(expiresDays, "--expires-days"),
    urlBase,
    threshold: threshold === undefined ? undefined : positiveInteger(threshold, "--threshold"),
  });
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`release-index: ${error.message}\n`);
    process.exit(1);
  }
}
