import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PUBLIC_URL,
  IMMUTABLE_CACHE_CONTROL,
  INVALIDATION_PATHS,
  NO_CACHE_CONTROL,
  REMOTE_NAME,
  STATIC_DELTA_ARGUMENTS,
  cacheControlFor,
  cacheControlProblem,
  commandText,
  flatpakrepoUrl,
  invalidationCommand,
  normalizeRemoteUrl,
  s3ConfigProblems,
  s3UploadCommands,
  targetProblem,
} from "./lib/flatpakRemote.mjs";

const repo = "/home/publisher/suite-flatpak/repo";
const flatpakrepoPath = "/home/publisher/suite-flatpak/suite.flatpakrepo";
const bucket = "suite-flatpak-private";
const distribution = "E1234567890ABC";

function cacheControlOf(step) {
  return step.args[step.args.indexOf("--cache-control") + 1];
}

describe("the public remote URL", () => {
  it("names the public store once", () => {
    assert.equal(DEFAULT_PUBLIC_URL, "https://flatpak.suite.run/");
    assert.equal(REMOTE_NAME, "suite");
    assert.equal(flatpakrepoUrl(), "https://flatpak.suite.run/suite.flatpakrepo");
  });

  it("normalises a base to exactly one trailing slash", () => {
    assert.equal(normalizeRemoteUrl("https://flatpak.suite.run"), "https://flatpak.suite.run/");
    assert.equal(normalizeRemoteUrl("https://flatpak.suite.run/"), "https://flatpak.suite.run/");
    assert.equal(normalizeRemoteUrl("https://flatpak.suite.run///"), "https://flatpak.suite.run/");
    assert.equal(normalizeRemoteUrl("  https://example.test/store  "), "https://example.test/store/");
  });

  it("refuses an empty URL", () => {
    assert.throws(() => normalizeRemoteUrl(""), /cannot be empty/u);
    assert.throws(() => normalizeRemoteUrl("  "), /cannot be empty/u);
  });

  it("builds a .flatpakrepo URL from any normalised base", () => {
    assert.equal(
      flatpakrepoUrl("https://flatpak.suite.run"),
      "https://flatpak.suite.run/suite.flatpakrepo",
    );
  });
});

describe("publication targets", () => {
  it("knows the local test host and the public store", () => {
    assert.equal(targetProblem("lan"), null);
    assert.equal(targetProblem("s3"), null);
    assert.match(targetProblem("ftp"), /unknown target "ftp"; known: lan, s3/u);
  });
});

describe("the S3 cache classes", () => {
  it("caches content-addressed objects, refs, summaries and deltas for a year", () => {
    for (const path of [
      "objects/ab/cdef",
      "/objects/ab/cdef",
      "refs/heads/master",
      "refs/",
      "deltas/ab/abcdef-123456.superblock",
      "delta-indexes/ab/abcdef.index",
    ]) {
      assert.equal(cacheControlFor(path), IMMUTABLE_CACHE_CONTROL, path);
    }
    assert.equal(IMMUTABLE_CACHE_CONTROL, "public,max-age=31536000,immutable");
  });

  it("marks only the summary and the .flatpakrepo as no-cache", () => {
    for (const path of ["summary", "summary.sig", "suite.flatpakrepo", "/summary"]) {
      assert.equal(cacheControlFor(path), NO_CACHE_CONTROL, path);
    }
    assert.equal(NO_CACHE_CONTROL, "no-cache");
  });

  it("refuses a path whose cache class nobody chose", () => {
    assert.equal(cacheControlFor("config"), null);
    assert.match(cacheControlProblem("config"), /has no S3 cache class/u);
  });
});

describe("static deltas", () => {
  it("generates deltas and skips the debug runtime nobody downloads", () => {
    assert.deepEqual(STATIC_DELTA_ARGUMENTS, [
      "--generate-static-deltas",
      "--static-delta-ignore-ref=run.suite.*.Debug",
    ]);
  });
});

describe("S3 preconditions", () => {
  it("accepts a complete target", () => {
    assert.deepEqual(
      s3ConfigProblems({ bucket, distribution, awsOnPath: true }),
      [],
    );
  });

  it("names every missing value before a publish signs anything", () => {
    const problems = s3ConfigProblems({ bucket: "", distribution: "", awsOnPath: false });
    assert.equal(problems.length, 3);
    assert.match(problems[0], /SUITE_FLATPAK_S3_BUCKET/u);
    assert.match(problems[1], /SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION/u);
    assert.match(problems[2], /aws CLI is not on PATH/u);
  });
});

describe("the S3 upload commands", () => {
  const steps = s3UploadCommands({ repo, flatpakrepoPath, bucket });

  it("syncs the five immutable trees without deleting anything", () => {
    assert.equal(steps.length, 10);
    assert.deepEqual(steps[0].args.slice(0, 4), [
      "s3",
      "sync",
      `${repo}/objects`,
      `s3://${bucket}/objects`,
    ]);
    assert.deepEqual(steps[1].args.slice(0, 4), [
      "s3",
      "sync",
      `${repo}/refs`,
      `s3://${bucket}/refs`,
    ]);
    assert.deepEqual(steps[2].args.slice(0, 4), [
      "s3",
      "sync",
      `${repo}/summaries`,
      `s3://${bucket}/summaries`,
    ]);
    assert.deepEqual(steps[3].args.slice(0, 4), [
      "s3",
      "sync",
      `${repo}/deltas`,
      `s3://${bucket}/deltas`,
    ]);
    assert.deepEqual(steps[4].args.slice(0, 4), [
      "s3",
      "sync",
      `${repo}/delta-indexes`,
      `s3://${bucket}/delta-indexes`,
    ]);
    for (const step of steps) assert.ok(!step.args.includes("--delete"));
  });

  it("gives objects, refs, the summary cache, deltas and indexes the immutable header", () => {
    assert.equal(cacheControlOf(steps[0]), IMMUTABLE_CACHE_CONTROL);
    assert.equal(cacheControlOf(steps[1]), IMMUTABLE_CACHE_CONTROL);
    assert.equal(cacheControlOf(steps[2]), IMMUTABLE_CACHE_CONTROL);
    assert.equal(cacheControlOf(steps[3]), IMMUTABLE_CACHE_CONTROL);
    assert.equal(cacheControlOf(steps[4]), IMMUTABLE_CACHE_CONTROL);
  });

  it("copies the mutable files, including the summary index, with no-cache", () => {
    const copies = steps.slice(5).map((step) => step.args.slice(0, 4));
    assert.deepEqual(copies, [
      ["s3", "cp", `${repo}/summary`, `s3://${bucket}/summary`],
      ["s3", "cp", `${repo}/summary.sig`, `s3://${bucket}/summary.sig`],
      ["s3", "cp", `${repo}/summary.idx`, `s3://${bucket}/summary.idx`],
      ["s3", "cp", `${repo}/summary.idx.sig`, `s3://${bucket}/summary.idx.sig`],
      ["s3", "cp", flatpakrepoPath, `s3://${bucket}/suite.flatpakrepo`],
    ]);
    for (const step of steps.slice(5)) assert.equal(cacheControlOf(step), NO_CACHE_CONTROL);
  });

  it("uploads deltas before the summary that advertises them", () => {
    const deltas = steps.findIndex((step) => step.args.includes(`${repo}/deltas`));
    const summary = steps.findIndex((step) => step.args.includes(`${repo}/summary`));
    assert.ok(deltas >= 0 && summary > deltas);
  });
});

describe("the CloudFront invalidation", () => {
  it("invalidates only the mutable paths", () => {
    const step = invalidationCommand({ distribution });
    assert.deepEqual(step.args.slice(0, 5), [
      "cloudfront",
      "create-invalidation",
      "--distribution-id",
      distribution,
      "--paths",
    ]);
    assert.deepEqual(step.args.slice(5), INVALIDATION_PATHS);
    assert.deepEqual(INVALIDATION_PATHS, [
      "/summary",
      "/summary.sig",
      "/summary.idx",
      "/summary.idx.sig",
      "/suite.flatpakrepo",
    ]);
  });
});

describe("printing a command", () => {
  it("leaves a cache header and an S3 URL alone", () => {
    const step = s3UploadCommands({ repo, flatpakrepoPath, bucket })[0];
    assert.equal(
      commandText(step),
      `aws s3 sync ${repo}/objects s3://${bucket}/objects ` +
        "--cache-control public,max-age=31536000,immutable --no-progress",
    );
  });

  it("quotes a path a shell would split", () => {
    assert.equal(
      commandText({ command: "aws", args: ["s3", "cp", "/tmp/a b", "s3://b/c"] }),
      "aws s3 cp '/tmp/a b' s3://b/c",
    );
  });
});
