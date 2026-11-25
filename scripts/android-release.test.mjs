import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleTask,
  CHANNEL_PACKAGE_ID,
  classifyReleaseView,
  goApkAssetName,
  GO_APK_ALIAS,
  goBuildCommands,
  newestManifestTags,
  parseApksignerFingerprint,
  parseArgs,
  parseBadging,
  publishedReleaseProblem,
  resolveUploadIdentity,
  uploadNames,
  versionCodeFor,
  versionCodePreflight,
} from "./android-release.mjs";
import { groupedFingerprint, normaliseFingerprint } from "./lib/androidKey.mjs";

describe("scoped build inputs", () => {
  it("builds the workspace dependency closure before the Go app", () => {
    const commands = goBuildCommands();
    const dependency = commands.findIndex(([, args]) => args.includes("@suite/go-app^..."));
    const app = commands.findIndex(
      ([, args]) => args.includes("@suite/go-app") && !args.includes("@suite/go-app^..."),
    );

    assert.ok(dependency >= 0, "the dependency closure is built");
    assert.ok(app > dependency, "the app is built after its packages");
    assert.deepEqual(commands[dependency][1], ["--filter", "@suite/go-app^...", "run", "build"]);
  });
});

describe("release lookup", () => {
  it("treats a successful read as present", () => {
    assert.deepEqual(classifyReleaseView({ status: 0 }), { state: "present", detail: null });
  });

  it("calls a release gh reports missing 'missing'", () => {
    assert.equal(
      classifyReleaseView({ status: 1, stderr: "release not found" }).state,
      "missing",
    );
  });

  it("calls a missing or unauthenticated gh 'unavailable', not 'missing'", () => {
    const notInstalled = classifyReleaseView({ status: 1, stderr: "gh: command not found" });
    assert.equal(notInstalled.state, "unavailable");

    const spawnFailed = classifyReleaseView({
      error: new Error("spawn gh ENOENT"),
      status: null,
    });
    assert.equal(spawnFailed.state, "unavailable");
    assert.match(spawnFailed.detail, /ENOENT/u);

    const unauthenticated = classifyReleaseView({
      status: 1,
      stderr: "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.",
    });
    assert.equal(unauthenticated.state, "unavailable");
  });
});

describe("upload set", () => {
  it("keeps the stable asset name and its alias", () => {
    const names = uploadNames("0.1.0");
    assert.deepEqual(names, [
      "suite-go-0.1.0.apk",
      "suite-go-0.1.0.apk.sha256",
      "suite-go.apk",
    ]);
    assert.ok(names.includes("suite-go-0.1.0.apk"));
    assert.ok(names.includes(GO_APK_ALIAS));
    assert.equal(GO_APK_ALIAS, "suite-go.apk");
  });

  it("names a pre-release for its channel and never writes the stable alias", () => {
    for (const channel of ["nightly", "preview"]) {
      const names = uploadNames("0.1.0", channel);
      assert.deepEqual(names, [`suite-go-${channel}-0.1.0.apk`, `suite-go-${channel}-0.1.0.apk.sha256`]);
      assert.ok(!names.includes(GO_APK_ALIAS));
    }
    assert.equal(goApkAssetName("0.1.0", "nightly"), "suite-go-nightly-0.1.0.apk");
  });

  it("names a slop build for its commit and never writes the stable alias", () => {
    const names = uploadNames("0.1.0", "slop", "abc1234");
    assert.deepEqual(names, [
      "suite-go-slop-0.1.0-abc1234.apk",
      "suite-go-slop-0.1.0-abc1234.apk.sha256",
    ]);
    assert.ok(!names.includes(GO_APK_ALIAS));
    assert.equal(goApkAssetName("0.1.0", "slop", "abc1234"), "suite-go-slop-0.1.0-abc1234.apk");
    assert.throws(() => goApkAssetName("0.1.0", "slop"), /needs --revision/u);
    assert.throws(() => goApkAssetName("0.1.0", "stable", "abc1234"), /takes no --revision/u);
  });

  it("refuses a channel it has no identity for", () => {
    assert.throws(() => goApkAssetName("0.1.0", "canary"), /unknown channel/u);
    assert.throws(() => uploadNames("0.1.0", "beta"), /unknown channel/u);
  });
});

describe("upload arguments", () => {
  it("takes an APK path without requiring --channel", () => {
    const options = parseArgs(["--upload", "incoming/suite-go-0.1.0.apk"]);
    assert.equal(options.upload, "incoming/suite-go-0.1.0.apk");
    assert.equal(options.channel, null);
    assert.equal(options.publish, false);
    assert.equal(options.allowPublished, false);
  });

  it("keeps --publish explicit beside --upload", () => {
    const options = parseArgs(["--upload", "a.apk", "--channel", "slop", "--publish"]);
    assert.equal(options.upload, "a.apk");
    assert.equal(options.channel, "slop");
    assert.equal(options.publish, true);
  });

  it("reads the commit a slop upload names, and refuses a malformed one", () => {
    const options = parseArgs(["--channel", "slop", "--revision", "abc1234"]);
    assert.equal(options.revision, "abc1234");
    assert.equal(parseArgs([]).revision, null);
    assert.throws(() => parseArgs(["--revision", "ABC1234"]), /lower-case sha7/u);
    assert.throws(() => parseArgs(["--revision"]), /--revision needs a value/u);
  });

  it("accepts --allow-published as its own switch", () => {
    assert.equal(parseArgs(["--upload", "a.apk", "--allow-published"]).allowPublished, true);
  });

  it("refuses a flag without its value", () => {
    assert.throws(() => parseArgs(["--upload"]), /--upload needs a value/u);
    assert.throws(() => parseArgs(["--channel"]), /--channel needs a value/u);
  });

  it("refuses an option it does not know", () => {
    assert.throws(() => parseArgs(["--upload=artifact.apk"]), /unknown option/u);
  });
});

describe("upload identity", () => {
  it("accepts a stable APK without --channel", () => {
    assert.deepEqual(
      resolveUploadIdentity({ applicationId: "run.suite.go", versionName: "0.1.0" }),
      { channel: "stable", version: "0.1.0" },
    );
  });

  it("derives each pre-release channel from its package id", () => {
    for (const channel of ["slop", "nightly", "preview"]) {
      assert.deepEqual(
        resolveUploadIdentity({
          applicationId: `run.suite.${channel}.go`,
          versionName: `0.1.0-${channel}`,
        }),
        { channel, version: "0.1.0" },
      );
    }
  });

  it("derives the version from a pre-release version name", () => {
    for (const channel of ["slop", "nightly", "preview"]) {
      assert.deepEqual(
        resolveUploadIdentity({
          applicationId: `run.suite.${channel}.go`,
          versionName: `0.1.0-${channel}`,
          channel,
        }),
        { channel, version: "0.1.0" },
      );
    }
  });

  it("refuses an artifact whose id and channel disagree", () => {
    assert.throws(
      () => resolveUploadIdentity({ applicationId: "run.suite.go", versionName: "0.1.0", channel: "slop" }),
      /not run\.suite\.slop\.go/u,
    );
    assert.throws(
      () =>
        resolveUploadIdentity({
          applicationId: "run.suite.nightly.go",
          versionName: "0.1.0-nightly",
          channel: "preview",
        }),
      /not run\.suite\.preview\.go/u,
    );
    assert.throws(
      () =>
        resolveUploadIdentity({
          applicationId: "run.suite.nightly.go",
          versionName: "0.1.0-slop",
          channel: "nightly",
        }),
      /does not end/u,
    );
    assert.throws(
      () =>
        resolveUploadIdentity({
          applicationId: "run.suite.go",
          versionName: "0.1.0-slop",
          channel: "stable",
        }),
      /names slop/u,
    );
  });

  it("refuses a package that is not Suite Go", () => {
    assert.throws(
      () => resolveUploadIdentity({ applicationId: "com.example.app", versionName: "1.0.0" }),
      /not a Suite Go release package/u,
    );
  });
});

describe("published releases", () => {
  it("accepts a draft", () => {
    assert.equal(publishedReleaseProblem({ isDraft: true }), null);
  });

  it("refuses an immutable published release even with the override", () => {
    assert.match(
      publishedReleaseProblem({ isDraft: false, isImmutable: true, allowPublished: true }),
      /immutable/u,
    );
  });

  it("refuses a published release unless --allow-published names a non-immutable one", () => {
    assert.match(
      publishedReleaseProblem({ isDraft: false, isImmutable: false }),
      /--allow-published/u,
    );
    assert.equal(
      publishedReleaseProblem({ isDraft: false, isImmutable: false, allowPublished: true }),
      null,
    );
  });

  it("refuses when it cannot tell whether the release is locked", () => {
    assert.match(publishedReleaseProblem({ isDraft: null, isImmutable: false }), /draft/u);
    assert.match(publishedReleaseProblem({ isDraft: false, isImmutable: null }), /immutability/u);
  });
});

describe("versionCode", () => {
  it("puts the channel digit after the base", () => {
    assert.equal(versionCodeFor(2, "stable"), 20);
    assert.equal(versionCodeFor(2, "slop"), 21);
    assert.equal(versionCodeFor(2, "nightly"), 22);
    assert.equal(versionCodeFor(2, "preview"), 23);
  });

  it("increases within a channel when the base increases", () => {
    for (const channel of ["stable", "slop", "nightly", "preview"]) {
      assert.ok(versionCodeFor(3, channel) > versionCodeFor(2, channel));
    }
  });

  it("raises the digit on promotion, which is now a different package id", () => {
    assert.ok(versionCodeFor(2, "nightly") > versionCodeFor(2, "slop"));
    assert.ok(versionCodeFor(2, "preview") > versionCodeFor(2, "nightly"));
  });

  it("keeps one package id per channel", () => {
    assert.deepEqual(CHANNEL_PACKAGE_ID, {
      stable: "run.suite.go",
      slop: "run.suite.slop.go",
      nightly: "run.suite.nightly.go",
      preview: "run.suite.preview.go",
    });
  });

  it("refuses a base that is not a positive integer", () => {
    assert.throws(() => versionCodeFor(0, "stable"), /positive integer/u);
    assert.throws(() => versionCodeFor(1.5, "stable"), /positive integer/u);
  });
});

describe("versionCode monotonicity", () => {
  const PRE_RELEASE_ID = "run.suite.nightly.go";

  function fakeGh({ releases = [], manifests = {} } = {}) {
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      if (args[0] === "release" && args[1] === "list") {
        return { status: 0, stdout: JSON.stringify(releases), stderr: "", error: null };
      }
      if (args[0] === "release" && args[1] === "download") {
        const tag = args[2];
        if (!Object.hasOwn(manifests, tag)) {
          return { status: 1, stdout: "", stderr: "no assets match the file pattern", error: null };
        }
        return { status: 0, stdout: JSON.stringify(manifests[tag]), stderr: "", error: null };
      }
      return {
        status: 1,
        stdout: "",
        stderr: `unexpected gh command: ${args.join(" ")}`,
        error: null,
      };
    };
    gh.calls = calls;
    return gh;
  }

  function apkManifest(versionCode, { id = PRE_RELEASE_ID, channel = "nightly" } = {}) {
    const artifact = { kind: "apk", id, versionName: `0.1.0-${channel}` };
    if (versionCode !== undefined) artifact.versionCode = versionCode;
    return { format: 1, channel, artifacts: [artifact] };
  }

  it("reads only the stable tag family for stable", () => {
    const tags = newestManifestTags(
      [
        { tagName: "suite-2026.11.22", isDraft: false },
        { tagName: "suite-preview-2026.11.22", isDraft: false },
        { tagName: "suite-nightly-2026.11.21", isDraft: false },
      ],
      "stable",
    );
    assert.deepEqual(tags, ["suite-2026.11.22"]);
  });

  it("reads only the channel's own tag family for a pre-release", () => {
    const releases = [
      { tagName: "suite-preview-2026.11.22", isDraft: false },
      { tagName: "suite-preview-2026.11.21", isDraft: false },
      { tagName: "suite-nightly-2026.11.22", isDraft: false },
      { tagName: "suite-slop-2026.11.22-abc1234", isDraft: false },
      { tagName: "suite-slop-2026.11.21-def5678", isDraft: false },
      { tagName: "suite-slop-2026.11.23-aaaaaaa", isDraft: true },
      { tagName: "suite-slop-2026.11.20", isDraft: false },
      { tagName: "suite-2026.11.22", isDraft: false },
    ];
    assert.deepEqual(newestManifestTags(releases, "nightly"), [
      "suite-nightly-2026.11.22",
    ]);
    assert.deepEqual(newestManifestTags(releases, "preview"), [
      "suite-preview-2026.11.22",
    ]);
    assert.deepEqual(newestManifestTags(releases, "slop"), [
      "suite-slop-2026.11.22-abc1234",
    ]);
  });

  it("refuses a code lower than the one published for the same package id", () => {
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 12,
      gh: fakeGh({
        releases: [
          { tagName: "suite-nightly-2026.11.22", isDraft: false },
          { tagName: "suite-nightly-2026.11.21", isDraft: false },
        ],
        manifests: {
          "suite-nightly-2026.11.22": apkManifest(13),
          "suite-nightly-2026.11.21": apkManifest(12),
        },
      }),
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.previous, 13);
    assert.match(verdict.message, /lower than 13/u);
    assert.match(verdict.message, /same package id|this package id/u);
  });

  it("does not compare a channel against another channel's code", () => {
    // Preview published a higher code, but preview is its own package id now,
    // so a nightly build is not measured against it.
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 12,
      gh: fakeGh({
        releases: [
          { tagName: "suite-preview-2026.11.22", isDraft: false },
          { tagName: "suite-nightly-2026.11.21", isDraft: false },
        ],
        manifests: {
          "suite-preview-2026.11.22": apkManifest(13, {
            id: "run.suite.preview.go",
            channel: "preview",
          }),
          "suite-nightly-2026.11.21": apkManifest(12),
        },
      }),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.previous, 12);
  });

  it("passes with a note when the channel's id has no published code yet", () => {
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 12,
      gh: fakeGh({
        releases: [
          { tagName: "suite-preview-2026.11.22", isDraft: false },
          { tagName: "suite-nightly-2026.11.21", isDraft: false },
        ],
        manifests: {
          "suite-preview-2026.11.22": apkManifest(13, {
            id: "run.suite.preview.go",
            channel: "preview",
          }),
          "suite-nightly-2026.11.21": apkManifest(12, { id: "run.suite.slop.go", channel: "slop" }),
        },
      }),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.previous, null);
    assert.match(verdict.note, /No published release manifest records a versionCode/u);
  });

  it("permits an equal code as a rebuild of the same app version", () => {
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 12,
      gh: fakeGh({
        releases: [{ tagName: "suite-nightly-2026.11.22", isDraft: false }],
        manifests: { "suite-nightly-2026.11.22": apkManifest(12) },
      }),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.previous, 12);
    assert.match(verdict.note, /rebuild/u);
  });

  it("permits a higher code from a bumped base", () => {
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 14,
      gh: fakeGh({
        releases: [{ tagName: "suite-nightly-2026.11.22", isDraft: false }],
        manifests: {
          "suite-nightly-2026.11.22": apkManifest(13),
        },
      }),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.previous, 13);
    assert.equal(verdict.note, null);
  });

  it("passes with a note when no published release carries a manifest", () => {
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 12,
      gh: fakeGh({
        releases: [{ tagName: "suite-nightly-2026.11.22", isDraft: false }],
      }),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.previous, null);
    assert.match(verdict.note, /No published release manifest/u);
  });

  it("passes with a different note when the manifest predates versionCode", () => {
    const verdict = versionCodePreflight({
      channel: "nightly",
      packageId: PRE_RELEASE_ID,
      versionCode: 12,
      gh: fakeGh({
        releases: [{ tagName: "suite-nightly-2026.11.22", isDraft: false }],
        manifests: { "suite-nightly-2026.11.22": apkManifest(undefined) },
      }),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.previous, null);
    assert.match(verdict.note, /records no versionCode/u);
  });
});

describe("gradle variant", () => {
  it("names the release task after the channel flavor", () => {
    assert.equal(assembleTask("stable"), "assembleStableRelease");
    assert.equal(assembleTask("slop"), "assembleSlopRelease");
    assert.equal(assembleTask("nightly"), "assembleNightlyRelease");
    assert.equal(assembleTask("preview"), "assemblePreviewRelease");
  });
});

describe("APK identity", () => {
  it("reads the package line aapt prints", () => {
    const text =
      "package: name='run.suite.slop.go' versionCode='21' versionName='0.1.0-slop' " +
      "platformBuildVersionName='16' platformBuildVersionCode='36'\n";
    assert.deepEqual(parseBadging(text), {
      applicationId: "run.suite.slop.go",
      versionCode: 21,
      versionName: "0.1.0-slop",
    });
  });

  it("returns null rather than an identity when the line is absent", () => {
    assert.equal(parseBadging(""), null);
  });

  it("reads the certificate digest apksigner prints", () => {
    const text = [
      "Verifies",
      "Verified using v2 scheme (APK Signature Scheme v2): true",
      "Signer #1 certificate DN: CN=Suite Go",
      "Signer #1 certificate SHA-256 digest: 221c6e4bdcbd1323f571eef58bdbd9d09f35ec1a33f404ea2f63e1216366d14f",
      "Signer #1 certificate SHA-1 digest: 0000000000000000000000000000000000000000",
    ].join("\n");
    assert.equal(
      parseApksignerFingerprint(text),
      "221c6e4bdcbd1323f571eef58bdbd9d09f35ec1a33f404ea2f63e1216366d14f",
    );
  });

  it("compares fingerprints whatever separators they use", () => {
    const colonised = "22:1C:6E:4B:DC:BD:13:23:F5:71:EE:F5:8B:DB:D9:D0:9F:35:EC:1A:33:F4:04:EA:2F:63:E1:21:63:66:D1:4F";
    assert.equal(normaliseFingerprint(colonised), normaliseFingerprint(colonised.replaceAll(":", "").toLowerCase()));
    assert.equal(groupedFingerprint(normaliseFingerprint(colonised)), colonised);
  });
});

describe("apksigner output", () => {
  it("reads the newer V2 label as well as Signer #1", () => {
    const digest = "221c6e4bdcbd1323f571eef58bdbd9d09f35ec1a33f404ea2f63e1216366d14f";
    const grouped = digest
      .match(/.{2}/gu)
      .join(":")
      .toUpperCase();
    assert.equal(
      parseApksignerFingerprint(`V2 Signer: certificate SHA-256 digest: ${grouped}\n`),
      digest,
    );
    assert.equal(
      parseApksignerFingerprint(`Signer #1 certificate SHA-256 digest: ${grouped}\n`),
      digest,
    );
  });
});
