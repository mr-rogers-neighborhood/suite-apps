import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  absoluteManifest,
  APPS,
  artifactFilename,
  changelogProblem,
  changelogSection,
  dirtyTreeProblem,
  feedPath,
  feedUrl,
  gateProblems,
  manifestProblems,
  packageModeProblems,
  parseArgs,
  pkgbuildFor,
  releaseAssetBase,
  signManifest,
  signatureVerifies,
  tagFor,
  versionFromManifest,
  versionFromPackage,
  verifyPublishedFeed,
} from "./release.mjs";

const manifest = [
  "version: 0.2.2",
  "files:",
  "  - url: suite-planner-0.2.2-x86_64.AppImage",
  "    sha512: ABC",
  "    size: 12",
  "path: suite-planner-0.2.2-x86_64.AppImage",
  "sha512: ABC",
  "releaseDate: '2026-11-20T00:00:00.000Z'",
  "",
].join("\n");

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("version and feed names", () => {
  it("reads the release version from package.json", () => {
    assert.equal(versionFromPackage('{"name":"@suite/planner","version":"0.2.2"}'), "0.2.2");
  });

  it("is null rather than guessing", () => {
    assert.equal(versionFromPackage('{"name":"@suite/planner"}'), null);
    assert.equal(versionFromPackage("not json"), null);
  });

  it("names one Pages feed and one per-app tag", () => {
    assert.equal(feedPath(APPS.planner), "feeds/planner/latest-linux.yml");
    assert.equal(
      feedUrl(APPS.planner),
      "https://mr-rogers-neighborhood.github.io/suite-apps/feeds/planner",
    );
    assert.equal(tagFor(APPS.canvas, "0.1.9"), "canvas-v0.1.9");
    assert.equal(
      releaseAssetBase(APPS.canvas, "0.1.9"),
      "https://github.com/mr-rogers-neighborhood/suite-apps/releases/download/canvas-v0.1.9/",
    );
  });
});

describe("changelog", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "Nothing yet.",
    "",
    "## [0.2.2] - 2026-11-08",
    "",
    "The release we mean.",
    "",
    "## [0.2.1] - 2026-11-07",
    "",
    "Older.",
    "",
  ].join("\n");

  it("finds the section for the version being released", () => {
    assert.equal(changelogSection(changelog, "0.2.2"), "The release we mean.");
    assert.equal(changelogProblem(changelog, "0.2.2"), null);
  });

  it("refuses a version with no matching heading", () => {
    const problem = changelogProblem(changelog, "0.2.3");
    assert.match(problem, /0\.2\.3/u);
    assert.match(problem, /changelog/u);
  });

  it("does not accept Unreleased as the version", () => {
    assert.match(changelogProblem(changelog, "Unreleased"), /Unreleased/u);
  });
});

describe("release refusals", () => {
  it("refuses a dirty tree and names what is changed", () => {
    assert.equal(dirtyTreeProblem(""), null);
    const problem = dirtyTreeProblem(" M scripts/release.mjs\n?? feeds/\n");
    assert.match(problem, /uncommitted/u);
    assert.match(problem, /scripts\/release\.mjs/u);
  });

  it("refuses a tree with no gate proof", () => {
    const problems = gateProblems(null, "abcdef1234567890");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /gate-status/u);
  });

  it("refuses a gate that failed, ran on the working tree, or proved another commit", () => {
    const head = "abcdef1234567890";
    assert.match(gateProblems({ ok: false, fresh: true, commit: head }, head).join(), /did not pass/u);
    assert.match(
      gateProblems({ ok: true, fresh: false, commit: head }, head).join(),
      /working tree/u,
    );
    assert.match(
      gateProblems({ ok: true, fresh: true, commit: "1234567" }, head).join(),
      /proved 1234567/u,
    );
  });

  it("accepts a fresh, passing gate that names HEAD", () => {
    assert.deepEqual(
      gateProblems({ ok: true, fresh: true, commit: "abcdef1" }, "abcdef1234567890"),
      [],
    );
  });

  it("refuses a manifest that names another version, or a file that is not there", () => {
    assert.match(
      manifestProblems({
        text: manifest,
        outputDir: "/tmp/release",
        version: "0.2.3",
        exists: () => true,
      }).join(),
      /manifest names 0\.2\.2/u,
    );

    const missing = manifestProblems({
      text: manifest,
      outputDir: "/tmp/release",
      version: "0.2.2",
      exists: () => false,
    });
    assert.match(missing.join(), /not in \/tmp\/release/u);
    assert.deepEqual(
      manifestProblems({
        text: manifest,
        outputDir: "/tmp/release",
        version: "0.2.2",
        exists: () => true,
      }),
      [],
    );
  });

  it("refuses a manifest with no artifact or fingerprint", () => {
    const problems = manifestProblems({
      text: "version: 0.2.2\n",
      outputDir: "/tmp/release",
      version: "0.2.2",
      exists: () => true,
    });
    assert.match(problems.join(), /no artifact/u);
  });
});

describe("manifest rewriting", () => {
  it("points both url and path at the app's release tag, leaving the hashes alone", () => {
    const rewritten = absoluteManifest(manifest, releaseAssetBase(APPS.planner, "0.2.2"));
    const expected =
      "https://github.com/mr-rogers-neighborhood/suite-apps/releases/download/" +
      "planner-v0.2.2/suite-planner-0.2.2-x86_64.AppImage";
    assert.equal((rewritten.match(new RegExp(expected, "gu")) ?? []).length, 2);
    assert.match(rewritten, /sha512: ABC/u);
    assert.match(rewritten, /size: 12/u);
    assert.equal(versionFromManifest(rewritten), "0.2.2");
  });

  it("keeps an absolute locator as it is", () => {
    const url = "https://example.test/releases/download/x/App.AppImage";
    const rewritten = absoluteManifest(`path: ${url}\nsha512: A\n`, "https://example.test/");
    assert.match(rewritten, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  });

  it("takes only the filename from an absolute URL", () => {
    assert.equal(
      artifactFilename(
        "https://github.com/o/r/releases/download/canvas-v0.1.9/suite-canvas-0.1.9-x86_64.AppImage",
      ),
      "suite-canvas-0.1.9-x86_64.AppImage",
    );
    assert.equal(artifactFilename("suite-canvas.AppImage"), "suite-canvas.AppImage");
    assert.equal(artifactFilename("../escape.AppImage"), null);
    assert.equal(artifactFilename("http://example.test/App.AppImage"), null);
  });
});

describe("signing", () => {
  it("signs the bytes exactly as served and verifies with the public half", () => {
    const pair = keyPair();
    const bytes = Buffer.from(manifest);
    const signature = signManifest(bytes, pair.privateKey);
    assert.equal(signatureVerifies(bytes, Buffer.from(signature, "base64"), pair.publicKey), true);
    assert.equal(
      signatureVerifies(Buffer.from(`${manifest}\n`), Buffer.from(signature, "base64"), pair.publicKey),
      false,
    );
  });
});

describe("arguments", () => {
  it("defaults to a dry run", () => {
    const options = parseArgs(["planner"]);
    assert.equal(options.appId, "planner");
    assert.equal(options.publish, false);
    assert.equal(options.build, true);
  });

  it("reads the publish, tag and build flags", () => {
    const options = parseArgs([
      "start",
      "--publish",
      "--tag",
      "start-v0.3.12",
      "--feed-dir",
      "/tmp/feed",
      "--no-build",
    ]);
    assert.equal(options.publish, true);
    assert.equal(options.tag, "start-v0.3.12");
    assert.equal(options.feedDir, "/tmp/feed");
    assert.equal(options.build, false);
  });

  it("refuses an option with no value", () => {
    assert.throws(() => parseArgs(["planner", "--tag"]), /needs a value/u);
  });
});

describe("Arch package helpers", () => {
  const pkgbuild = [
    "pkgname=suite-start-bin",
    "pkgver=0.3.0",
    "pkgrel=1",
    "sha256sums=('577c510da3cd3ff532e92b46ee6ca0b2e17f80f0c64102bc2276562ca3529b1d')",
    "",
  ].join("\n");

  it("rewrites the version and checksum to the artifact this run built", () => {
    const patched = pkgbuildFor({ text: pkgbuild, version: "0.4.0", sha256: "abc123" });
    assert.match(patched, /pkgver=0\.4\.0/u);
    assert.match(patched, /sha256sums=\('abc123'\)/u);
    assert.doesNotMatch(patched, /0\.3\.0/u);
  });

  it("refuses a PKGBUILD it cannot rewrite", () => {
    assert.throws(
      () => pkgbuildFor({ text: "pkgname=x\n", version: "1.0.0", sha256: "a" }),
      /pkgver or sha256sums/u,
    );
  });

  const entry = (mode, path, kind = "d") =>
    `${kind}${mode}  0 root   root  1234 Nov  7 12:04 ${path}`;

  it("refuses the 0700 directory that made 0.3.1 unstartable", () => {
    const listing = [
      entry("rwxr-xr-x", "opt/"),
      entry("rwx------", "opt/suite-start/"),
      entry("rwxr-xr-x", "opt/suite-start/suite-start", "-"),
    ].join("\n");
    assert.match(packageModeProblems(listing).join(), /cannot read or enter/u);
  });
});

describe("verifyPublishedFeed", () => {
  const pair = keyPair();
  const body = absoluteManifest(manifest, releaseAssetBase(APPS.planner, "0.2.2"));
  const signature = signManifest(Buffer.from(body), pair.privateKey);
  const feed = "https://example.test/feeds/planner";

  function fetchHost({ artifactStatus = 200, signatureBody = signature } = {}) {
    return async (url, init = {}) => {
      if (init.method === "HEAD") {
        return { ok: artifactStatus === 200, status: artifactStatus, text: async () => "" };
      }
      if (url.endsWith(".sig")) {
        return { ok: true, status: 200, text: async () => signatureBody };
      }
      if (url.endsWith("latest-linux.yml")) {
        return { ok: true, status: 200, text: async () => body };
      }
      return { ok: false, status: 404, text: async () => "" };
    };
  }

  it("accepts a signed feed whose artifact answers", async () => {
    const result = await verifyPublishedFeed({
      feed,
      publicKey: pair.publicKey,
      fetchImpl: fetchHost(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.version, "0.2.2");
    assert.match(result.artifact, /releases\/download\/planner-v0\.2\.2/u);
  });

  it("refuses a feed signed by another key", async () => {
    const other = keyPair();
    const result = await verifyPublishedFeed({
      feed,
      publicKey: other.publicKey,
      fetchImpl: fetchHost(),
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not signed/u);
  });

  it("refuses an artifact that does not answer", async () => {
    const result = await verifyPublishedFeed({
      feed,
      publicKey: pair.publicKey,
      fetchImpl: fetchHost({ artifactStatus: 404 }),
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /artifact answered 404/u);
  });
});
