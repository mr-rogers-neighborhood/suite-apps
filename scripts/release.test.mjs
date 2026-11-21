import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  APPS,
  changelogProblem,
  changelogSection,
  dirtyTreeProblem,
  gateProblems,
  parseArgs,
  relayArchitecture,
  relayArtifactName,
  relayChecksumList,
  relayLauncher,
  relayReadme,
  signManifest,
  signatureVerifies,
  tagFor,
  verifyRelayArtifact,
  versionFromPackage,
} from "./release.mjs";

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("version and tag names", () => {
  it("reads the release version from package.json", () => {
    assert.equal(versionFromPackage('{"name":"@suite/sync-server","version":"0.11.3"}'), "0.11.3");
  });

  it("is null rather than guessing", () => {
    assert.equal(versionFromPackage('{"name":"@suite/sync-server"}'), null);
    assert.equal(versionFromPackage("not json"), null);
  });

  it("names the relay's tag", () => {
    assert.equal(tagFor(APPS.sync, "0.11.3"), "sync-v0.11.3");
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
    "## [0.11.3] - 2026-11-08",
    "",
    "The release we mean.",
    "",
    "## [0.11.2] - 2026-11-07",
    "",
    "Older.",
    "",
  ].join("\n");

  it("finds the section for the version being released", () => {
    assert.equal(changelogSection(changelog, "0.11.3"), "The release we mean.");
    assert.equal(changelogProblem(changelog, "0.11.3"), null);
  });

  it("refuses a version with no matching heading", () => {
    const problem = changelogProblem(changelog, "0.11.4");
    assert.match(problem, /0\.11\.4/u);
    assert.match(problem, /changelog/u);
  });

  it("does not accept Unreleased as the version", () => {
    assert.match(changelogProblem(changelog, "Unreleased"), /Unreleased/u);
  });
});

describe("release refusals", () => {
  it("refuses a dirty tree and names what is changed", () => {
    assert.equal(dirtyTreeProblem(""), null);
    const problem = dirtyTreeProblem(" M scripts/release.mjs\n?? scripts/release.test.mjs\n");
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

  it("refuses a descendant as well as another commit", () => {
    const problems = gateProblems({ ok: true, fresh: true, commit: "abcdef1" }, "1234567890abcdef");
    assert.match(problems.join(), /proved abcdef1/u);
  });
});

describe("signing", () => {
  it("signs the bytes exactly as served and verifies with the public half", () => {
    const pair = keyPair();
    const bytes = Buffer.from("checksums\n");
    const signature = signManifest(bytes, pair.privateKey);
    assert.equal(signatureVerifies(bytes, Buffer.from(signature, "base64"), pair.publicKey), true);
    assert.equal(
      signatureVerifies(Buffer.from("checksums\n\n"), Buffer.from(signature, "base64"), pair.publicKey),
      false,
    );
  });
});

describe("arguments", () => {
  it("defaults to a dry run", () => {
    const options = parseArgs(["sync"]);
    assert.equal(options.appId, "sync");
    assert.equal(options.publish, false);
    assert.equal(options.build, true);
  });

  it("reads the publish, tag and build flags", () => {
    const options = parseArgs([
      "sync",
      "--publish",
      "--tag",
      "sync-v0.11.3",
      "--feed-dir",
      "/tmp/feed",
      "--no-build",
    ]);
    assert.equal(options.publish, true);
    assert.equal(options.tag, "sync-v0.11.3");
    assert.equal(options.feedDir, "/tmp/feed");
    assert.equal(options.build, false);
  });

  it("refuses an option with no value", () => {
    assert.throws(() => parseArgs(["sync", "--tag"]), /needs a value/u);
  });

  it("refuses a channel: pre-release tiers are Flatpak branches now", () => {
    assert.throws(() => parseArgs(["sync", "--channel", "slop"]), /unknown option/u);
  });
});

describe("relay artifact", () => {
  const version = "0.11.3";
  const digest = "a".repeat(64);

  it("names the tarball for the architecture and refuses one it cannot name", () => {
    assert.equal(relayArchitecture("x64"), "x86_64");
    assert.equal(relayArtifactName(version, "x64"), "suite-sync-0.11.3-x86_64.tar.gz");
    assert.equal(relayArtifactName(version, "arm64"), "suite-sync-0.11.3-aarch64.tar.gz");
    assert.throws(() => relayArtifactName(version, "riscv64"), /x86_64 or aarch64/u);
  });

  it("writes the checksum list in the form sha256sum -c reads", () => {
    assert.equal(
      relayChecksumList({ name: "suite-sync-0.11.3-x86_64.tar.gz", sha256: digest }),
      `${digest}  suite-sync-0.11.3-x86_64.tar.gz\n`,
    );
    assert.throws(() => relayChecksumList({ name: "x", sha256: "ABC" }), /sha256/u);
    assert.throws(() => relayChecksumList({ name: "../x", sha256: digest }), /plain artifact/u);
  });

  it("says in the launcher and README that the runtime is not bundled", () => {
    const launcher = relayLauncher();
    assert.match(launcher, /Node\.js 22/u);
    assert.match(launcher, /dist\/cli\.js/u);
    const readme = relayReadme(version, "x64");
    assert.match(readme, /does \*\*not\*\*/u);
    assert.match(readme, /Node\.js 22/u);
    assert.match(readme, /suite-sync-0\.11\.3-x86_64\.tar\.gz/u);
  });

  it("verifies the signed checksum list, then the tarball through it", async () => {
    const pair = keyPair();
    const dir = mkdtempSync(join(tmpdir(), "suite-relay-test-"));
    try {
      const name = relayArtifactName(version, "x64");
      const bytes = Buffer.from("relay tarball bytes");
      writeFileSync(join(dir, name), bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const checksums = relayChecksumList({ name, sha256 });
      writeFileSync(join(dir, "SHA256SUMS"), checksums);
      writeFileSync(
        join(dir, "SHA256SUMS.sig"),
        `${signManifest(Buffer.from(checksums), pair.privateKey)}\n`,
      );

      assert.deepEqual(
        await verifyRelayArtifact({ dir, version, arch: "x64", publicKey: pair.publicKey }),
        { ok: true, reason: null, artifact: name },
      );

      writeFileSync(join(dir, name), Buffer.from("tampered"));
      const tampered = await verifyRelayArtifact({
        dir,
        version,
        arch: "x64",
        publicKey: pair.publicKey,
      });
      assert.equal(tampered.ok, false);
      assert.match(tampered.reason, /sha256/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a checksum list signed by another key", async () => {
    const pair = keyPair();
    const other = keyPair();
    const dir = mkdtempSync(join(tmpdir(), "suite-relay-test-"));
    try {
      const name = relayArtifactName(version, "x64");
      writeFileSync(join(dir, name), Buffer.from("relay tarball bytes"));
      const checksums = relayChecksumList({ name, sha256: digest });
      writeFileSync(join(dir, "SHA256SUMS"), checksums);
      writeFileSync(
        join(dir, "SHA256SUMS.sig"),
        `${signManifest(Buffer.from(checksums), other.privateKey)}\n`,
      );

      const result = await verifyRelayArtifact({
        dir,
        version,
        arch: "x64",
        publicKey: pair.publicKey,
      });
      assert.equal(result.ok, false);
      assert.match(result.reason, /not signed/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
