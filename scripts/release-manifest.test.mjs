/**
 * The release manifest: one publication, one file with the commit, lockfile and
 * artifact digests (D2.1).
 *
 * spec: D2.1
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { apkIdentityFor, buildManifest, sha256File } from "./release-manifest.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

/** A source commit the test supplies, so a tree with no git history still runs. */
const SOURCE_COMMIT = "a".repeat(40);

describe("release manifest", () => {
  it("hashes a file with SHA-256", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-manifest-"));
    const file = join(dir, "artifact.bin");
    writeFileSync(file, "suite");
    const first = sha256File(file);
    assert.match(first, /^[0-9a-f]{64}$/u);
    writeFileSync(file, "suite!");
    assert.notEqual(sha256File(file), first);
  });

  it("builds the manifest shape", () => {
    const manifest = buildManifest({
      channel: "preview",
      commit: "a".repeat(40),
      lockfileSha: "b".repeat(64),
      artifacts: [{ kind: "apk", id: "run.suite.slop.go", sha256: "c".repeat(64) }],
      signers: { flatpak: "D".repeat(40), android: "e".repeat(64) },
    });
    assert.equal(manifest.format, 1);
    assert.equal(manifest.channel, "preview");
    assert.equal(manifest.lockfile.sha256, "b".repeat(64));
    assert.equal(manifest.artifacts[0].kind, "apk");
  });

  it("writes the file from an artifact and a commit file", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-manifest-"));
    const flatpak = join(dir, "suite-shell-preview.flatpak");
    const commitFile = join(dir, "suite-shell-preview.commit");
    const apk = join(dir, "suite-go-preview-0.1.0.apk");
    const out = join(dir, "release-manifest.json");
    writeFileSync(flatpak, "flatpak bytes");
    writeFileSync(commitFile, `${"f".repeat(64)}\n`);
    writeFileSync(apk, "apk bytes");

    const result = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts", "release-manifest.mjs"),
        "--channel",
        "preview",
        "--flatpak",
        flatpak,
        "--flatpak-id",
        "run.suite.slop.shell",
        "--flatpak-branch",
        "preview",
        "--flatpak-commit-file",
        commitFile,
        "--apk",
        apk,
        "--apk-id",
        "run.suite.slop.go",
        "--commit",
        SOURCE_COMMIT,
        "--out",
        out,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(manifest.channel, "preview");
    assert.equal(manifest.artifacts.length, 2);
    assert.equal(manifest.artifacts[0].commit, "f".repeat(64));
    assert.match(manifest.commit, /^[0-9a-f]{40}$/u);
    assert.match(manifest.lockfile.sha256, /^[0-9a-f]{64}$/u);
  });

  it("refuses a commit file that is not one checksum", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-manifest-"));
    const flatpak = join(dir, "a.flatpak");
    const commitFile = join(dir, "a.commit");
    const apk = join(dir, "a.apk");
    writeFileSync(flatpak, "x");
    writeFileSync(commitFile, "not-a-checksum\n");
    writeFileSync(apk, "x");
    const result = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts", "release-manifest.mjs"),
        "--channel",
        "preview",
        "--flatpak",
        flatpak,
        "--flatpak-id",
        "run.suite.slop.shell",
        "--flatpak-branch",
        "preview",
        "--flatpak-commit-file",
        commitFile,
        "--apk",
        apk,
        "--apk-id",
        "run.suite.slop.go",
        "--commit",
        SOURCE_COMMIT,
        "--out",
        join(dir, "out.json"),
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum/u);
  });
});

describe("APK channel identity", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "apps/go/app.config.json"), "utf8"));

  it("records the stable version name and the base with digit 0", () => {
    const identity = apkIdentityFor(config, "stable");
    assert.equal(identity.versionName, config.version);
    assert.equal(identity.versionCode, config.versionCode * 10);
  });

  it("records the channel suffix and its digit on every pre-release channel", () => {
    for (const [channel, digit] of [
      ["slop", 1],
      ["nightly", 2],
      ["preview", 3],
    ]) {
      const identity = apkIdentityFor(config, channel);
      assert.equal(identity.versionName, `${config.version}-${channel}`);
      assert.equal(identity.versionCode, config.versionCode * 10 + digit);
    }
  });

  it("writes the code and name onto the APK artifact for stable and preview", () => {
    for (const [channel, apkId, digit] of [
      ["stable", "run.suite.go", 0],
      ["preview", "run.suite.slop.go", 3],
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "suite-manifest-"));
      const flatpak = join(dir, "suite-shell.flatpak");
      const commitFile = join(dir, "suite-shell.commit");
      const apk = join(dir, "suite-go.apk");
      const out = join(dir, "release-manifest.json");
      writeFileSync(flatpak, "flatpak bytes");
      writeFileSync(commitFile, `${"f".repeat(64)}\n`);
      writeFileSync(apk, "apk bytes");

      const result = spawnSync(
        process.execPath,
        [
          join(ROOT, "scripts", "release-manifest.mjs"),
          "--channel",
          channel,
          "--flatpak",
          flatpak,
          "--flatpak-id",
          channel === "stable" ? "run.suite.shell" : "run.suite.slop.shell",
          "--flatpak-branch",
          channel === "stable" ? "master" : channel,
          "--flatpak-commit-file",
          commitFile,
          "--apk",
          apk,
          "--apk-id",
          apkId,
          "--commit",
          SOURCE_COMMIT,
          "--out",
          out,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );

      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(readFileSync(out, "utf8"));
      const artifact = manifest.artifacts.find((entry) => entry.kind === "apk");
      assert.equal(artifact.id, apkId);
      assert.equal(artifact.versionCode % 10, digit);
      assert.equal(
        artifact.versionName,
        channel === "stable" ? config.version : `${config.version}-${channel}`,
      );
    }
  });
});
