import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PUBLIC_URL,
  IMMUTABLE_CACHE_CONTROL,
  INVALIDATION_PATHS,
  NO_CACHE_CONTROL,
  REMOTE_NAME,
  STATIC_DELTA_ARGUMENTS,
  SUMMARY_OBJECT_INCLUDES,
  appIdsOf,
  buildUpdateRepoArguments,
  cacheControlFor,
  cacheControlProblem,
  commandText,
  commitFileText,
  flatpakrepoUrl,
  foreignRefs,
  hasPublishedRefs,
  invalidationCommand,
  missingSummaryRefs,
  normalizeRemoteUrl,
  preservedRefs,
  refsFromSummaryView,
  s3ConfigProblems,
  s3MergeCommands,
  s3UploadCommands,
  shouldMergePublishedRefs,
  summaryPreservationProblem,
  targetProblem,
} from "./lib/flatpakRemote.mjs";
import { parseArgs } from "./flatpak-remote.mjs";

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

describe("merging the published refs before signing", () => {
  const steps = s3MergeCommands({ repo, bucket });

  it("copies the bucket's refs into the repository this run will sign", () => {
    assert.equal(steps.length, 2);
    assert.deepEqual(steps[0].args, [
      "s3",
      "sync",
      `s3://${bucket}/refs`,
      `${repo}/refs`,
      "--no-progress",
    ]);
  });

  it("downloads only the object metadata a summary needs, never a tree", () => {
    const args = steps[1].args;
    assert.deepEqual(args.slice(0, 6), [
      "s3",
      "sync",
      `s3://${bucket}/objects`,
      `${repo}/objects`,
      "--no-progress",
      "--exclude",
    ]);
    assert.equal(args[6], "*");
    assert.deepEqual(
      args.slice(7),
      SUMMARY_OBJECT_INCLUDES.flatMap((pattern) => ["--include", pattern]),
    );
    assert.deepEqual(SUMMARY_OBJECT_INCLUDES, [
      "*.commit",
      "*.commitmeta",
      "*.commitmeta2",
      "*.dirtree",
      "*.dirmeta",
    ]);
  });

  it("never deletes a ref or an object", () => {
    for (const step of steps) assert.ok(!step.args.includes("--delete"));
  });
});

describe("when there is nothing to merge", () => {
  it("recognises an empty bucket ref listing", () => {
    assert.equal(hasPublishedRefs(""), false);
    assert.equal(hasPublishedRefs("\n   \n"), false);
    assert.equal(hasPublishedRefs("2026-11-23 13:44:11   65 refs/heads/appstream/x86_64\n"), true);
  });

  it("skips the merge on a first publication", () => {
    assert.equal(
      shouldMergePublishedRefs({ target: "s3", bucketHasRefs: false }),
      false,
    );
    assert.equal(shouldMergePublishedRefs({ target: "s3", bucketHasRefs: true }), true);
  });

  it("skips the merge for the local target or the explicit opt-out", () => {
    assert.equal(
      shouldMergePublishedRefs({
        target: "s3",
        noMergePublished: true,
        bucketHasRefs: true,
      }),
      false,
    );
    assert.equal(shouldMergePublishedRefs({ target: "lan", bucketHasRefs: true }), false);
  });
});

describe("the refs a publication did not build", () => {
  const local = [
    "app/run.suite.slop.shell/x86_64/nightly",
    "appstream/x86_64",
    "appstream2/x86_64",
    "runtime/run.suite.slop.shell.Debug/x86_64/nightly",
  ];
  const merged = [
    ...local,
    "app/run.suite.planner/x86_64/master",
    "app/run.suite.shell/x86_64/master",
    "runtime/run.suite.shell.Debug/x86_64/master",
  ];

  it("names the refs the bucket had and this build did not", () => {
    assert.deepEqual(foreignRefs(local, merged), [
      "app/run.suite.planner/x86_64/master",
      "app/run.suite.shell/x86_64/master",
      "runtime/run.suite.shell.Debug/x86_64/master",
    ]);
  });

  it("names every merged ref this publication did not publish", () => {
    assert.deepEqual(preservedRefs(["app/run.suite.slop.shell/x86_64/nightly"], merged), [
      "app/run.suite.planner/x86_64/master",
      "app/run.suite.shell/x86_64/master",
      "appstream/x86_64",
      "appstream2/x86_64",
      "runtime/run.suite.shell.Debug/x86_64/master",
      "runtime/run.suite.slop.shell.Debug/x86_64/nightly",
    ]);
  });

  it("names only app ids, so runtime and appstream refs add no flag", () => {
    assert.deepEqual(appIdsOf(merged), [
      "run.suite.planner",
      "run.suite.shell",
      "run.suite.slop.shell",
    ]);
  });
});

describe("the build-update-repo arguments", () => {
  const keyId = "5953E6C8EB75F60DBEDCC2BFF0E0BFD6974A681D";

  it("keeps the previous arguments when every ref was built here", () => {
    assert.deepEqual(buildUpdateRepoArguments({ repo, keyId }), [
      "build-update-repo",
      ...STATIC_DELTA_ARGUMENTS,
      `--gpg-sign=${keyId}`,
      repo,
    ]);
  });

  it("preserves appstream and skips deltas for the refs it did not build", () => {
    assert.deepEqual(
      buildUpdateRepoArguments({
        repo,
        keyId,
        foreignRefs: [
          "app/run.suite.shell/x86_64/master",
          "runtime/run.suite.shell.Debug/x86_64/master",
          "app/run.suite.canvas/x86_64/master",
        ],
      }),
      [
        "build-update-repo",
        ...STATIC_DELTA_ARGUMENTS,
        "--no-update-appstream",
        "--static-delta-ignore-ref=run.suite.canvas",
        "--static-delta-ignore-ref=run.suite.shell",
        `--gpg-sign=${keyId}`,
        repo,
      ],
    );
  });
});

describe("refusing a summary that lost a ref", () => {
  const commit = "a".repeat(64);
  const threeRefs = [
    "* app/run.suite.shell/x86_64/master",
    "    Latest Commit (892 bytes):",
    `      ${commit}`,
    "    Timestamp (ostree.commit.timestamp): 2026-11-23T13:44:11-07",
    "",
    "* app/run.suite.slop.shell/x86_64/nightly",
    "    Latest Commit (1.1 kB):",
    `      ${"b".repeat(64)}`,
    "    Timestamp (ostree.commit.timestamp): 2026-11-23T13:44:11-07",
    "",
    "* appstream/x86_64",
    "    Latest Commit (1.0 kB):",
    `      ${"c".repeat(64)}`,
    "    Timestamp (ostree.commit.timestamp): 2026-11-23T13:44:11-07",
    "",
  ].join("\n");

  it("reads the refs a summary advertises from the view", () => {
    assert.deepEqual(refsFromSummaryView(threeRefs), [
      "app/run.suite.shell/x86_64/master",
      "app/run.suite.slop.shell/x86_64/nightly",
      "appstream/x86_64",
    ]);
    assert.deepEqual(refsFromSummaryView(""), []);
  });

  it("accepts a summary that names every merged ref", () => {
    const summaryRefs = refsFromSummaryView(threeRefs);
    assert.equal(
      summaryPreservationProblem({
        mergedRefs: [
          "app/run.suite.shell/x86_64/master",
          "app/run.suite.slop.shell/x86_64/nightly",
          "appstream/x86_64",
        ],
        summaryRefs,
      }),
      null,
    );
    assert.deepEqual(
      missingSummaryRefs({ mergedRefs: summaryRefs, summaryRefs }),
      [],
    );
  });

  it("refuses a fixture summary that dropped the stable ref", () => {
    const nightlyOnly = [
      "* app/run.suite.slop.shell/x86_64/nightly",
      "    Latest Commit (1.1 kB):",
      `      ${"b".repeat(64)}`,
      "",
      "* appstream/x86_64",
      "    Latest Commit (1.0 kB):",
      `      ${"c".repeat(64)}`,
      "",
    ].join("\n");
    const mergedRefs = [
      "app/run.suite.shell/x86_64/master",
      "app/run.suite.slop.shell/x86_64/nightly",
      "appstream/x86_64",
    ];
    const summaryRefs = refsFromSummaryView(nightlyOnly);
    assert.deepEqual(missingSummaryRefs({ mergedRefs, summaryRefs }), [
      "app/run.suite.shell/x86_64/master",
    ]);
    const problem = summaryPreservationProblem({ mergedRefs, summaryRefs });
    assert.match(problem, /app\/run\.suite\.shell\/x86_64\/master/u);
    assert.match(problem, /Refusing to publish a summary that would hide a channel/u);
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

describe("publishing an existing repository", () => {
  it("takes the repository and the commit file as values", () => {
    const options = parseArgs([
      "--from-repo",
      "/runner/suite-flatpak/repo",
      "--commit-file",
      ".dev/release/flatpak-commits",
      "--publish",
    ]);
    assert.equal(options.fromRepo, "/runner/suite-flatpak/repo");
    assert.equal(options.commitFile, ".dev/release/flatpak-commits");
    assert.equal(options.publish, true);
  });

  it("keeps the repository optional", () => {
    const options = parseArgs(["--target", "s3"]);
    assert.equal(options.fromRepo, null);
    assert.equal(options.commitFile, null);
    assert.equal(options.noMergePublished, false);
  });

  it("takes the explicit opt-out from merging the published refs", () => {
    const options = parseArgs(["--target", "s3", "--no-merge-published"]);
    assert.equal(options.noMergePublished, true);
  });

  it("refuses a flag without its value", () => {
    assert.throws(() => parseArgs(["--from-repo"]), /--from-repo needs a value/u);
    assert.throws(() => parseArgs(["--commit-file"]), /--commit-file needs a value/u);
  });

  it("refuses an option it does not know", () => {
    assert.throws(() => parseArgs(["--from-repo=/tmp/repo"]), /unknown option/u);
  });
});

describe("the commit file", () => {
  const shell = "a".repeat(64);
  const go = "b".repeat(64);

  it("names every shipped ref and its commit, sorted by ref", () => {
    assert.equal(
      commitFileText([
        { ref: "app/run.suite.shell/x86_64/master", commit: shell },
        { ref: "app/run.suite.go/x86_64/master", commit: go },
      ]),
      `${go}  app/run.suite.go/x86_64/master\n` +
        `${shell}  app/run.suite.shell/x86_64/master\n`,
    );
  });

  it("refuses an empty publication", () => {
    assert.throws(() => commitFileText([]), /at least one published ref/u);
  });

  it("refuses a line without a commit", () => {
    assert.throws(
      () => commitFileText([{ ref: "app/run.suite.shell/x86_64/master", commit: "nope" }]),
      /no OSTree commit/u,
    );
    assert.throws(() => commitFileText([{ ref: "", commit: shell }]), /needs a ref/u);
  });
});
