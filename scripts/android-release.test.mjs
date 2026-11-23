import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleTask,
  classifyReleaseView,
  goApkAssetName,
  GO_APK_ALIAS,
  parseApksignerFingerprint,
  parseArgs,
  parseBadging,
  publishedReleaseProblem,
  resolveUploadIdentity,
  uploadNames,
  versionCodeFor,
} from "./android-release.mjs";
import { groupedFingerprint, normaliseFingerprint } from "./lib/androidKey.mjs";

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
    for (const channel of ["slop", "nightly", "preview"]) {
      const names = uploadNames("0.1.0", channel);
      assert.deepEqual(names, [`suite-go-${channel}-0.1.0.apk`, `suite-go-${channel}-0.1.0.apk.sha256`]);
      assert.ok(!names.includes(GO_APK_ALIAS));
    }
    assert.equal(goApkAssetName("0.1.0", "slop"), "suite-go-slop-0.1.0.apk");
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

  it("refuses a pre-release APK while its channel is ambiguous", () => {
    assert.throws(
      () => resolveUploadIdentity({ applicationId: "run.suite.slop.go", versionName: "0.1.0-slop" }),
      /--channel/u,
    );
  });

  it("derives the version from a pre-release version name", () => {
    for (const channel of ["slop", "nightly", "preview"]) {
      assert.deepEqual(
        resolveUploadIdentity({
          applicationId: "run.suite.slop.go",
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
          applicationId: "run.suite.slop.go",
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

  it("raises the digit on promotion, on the shared pre-release id", () => {
    assert.ok(versionCodeFor(2, "nightly") > versionCodeFor(2, "slop"));
    assert.ok(versionCodeFor(2, "preview") > versionCodeFor(2, "nightly"));
  });

  it("refuses a base that is not a positive integer", () => {
    assert.throws(() => versionCodeFor(0, "stable"), /positive integer/u);
    assert.throws(() => versionCodeFor(1.5, "stable"), /positive integer/u);
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
