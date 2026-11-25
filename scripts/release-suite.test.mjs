import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TARGET,
  commandText,
  installLines,
  parseArgs,
  publishRefusal,
  releaseSteps,
} from "./release-suite.mjs";

const head = "9f37849d1c2b3a4d5e6f708192a3b4c5d6e7f809";
const goodStatus = { ok: true, fresh: true, commit: head, only: null };

describe("the release sequence", () => {
  it("runs the gate, packaging, Flatpak, remote, release, APK and relink in order", () => {
    assert.deepEqual(
      releaseSteps({ publish: true }).map((step) => step.id),
      ["gate", "package", "flatpak", "remote", "release-status", "apk", "relink"],
    );
  });

  it("packages the host and builds run.suite.desk", () => {
    const steps = releaseSteps({ publish: true });
    const byId = Object.fromEntries(steps.map((step) => [step.id, step]));
    assert.equal(commandText(byId.package), "pnpm --filter @suite/desk package:dir");
    assert.equal(commandText(byId.flatpak), "node scripts/flatpak.mjs --app desk");
    assert.equal(byId.remote.args[byId.remote.args.indexOf("--target") + 1], DEFAULT_TARGET);
  });

  it("lets --skip-gate and --skip-apk drop only their own steps", () => {
    const steps = releaseSteps({ publish: true, skipGate: true, skipApk: true });
    assert.deepEqual(
      steps.map((step) => step.id),
      ["package", "flatpak", "remote", "release-status", "relink"],
    );
  });

  it("forwards --target to the remote publication", () => {
    const steps = releaseSteps({ publish: true, target: "lan" });
    const remote = steps.find((step) => step.id === "remote");
    assert.deepEqual(remote.args, [
      "scripts/flatpak-remote.mjs",
      "--target",
      "lan",
      "--publish",
    ]);
  });
});

describe("the dry-run and publish distinction", () => {
  it("passes --publish to no child without --publish", () => {
    for (const step of releaseSteps({ publish: false })) {
      assert.ok(!step.args.includes("--publish"), `${step.id} would publish`);
    }
  });

  it("passes --publish only to the steps that act", () => {
    const steps = releaseSteps({ publish: true });
    const publishing = steps.filter((step) => step.args.includes("--publish")).map((step) => step.id);
    assert.deepEqual(publishing, ["remote", "apk", "relink"]);
    const gate = steps.find((step) => step.id === "gate");
    assert.ok(!gate.args.includes("--publish"));
  });

  it("drafts the release, attaches the APK to the draft, then publishes it", () => {
    const steps = releaseSteps({ publish: true });
    const first = steps.find((step) => step.id === "release-status");
    const apk = steps.find((step) => step.id === "apk");
    const relink = steps.find((step) => step.id === "relink");
    assert.deepEqual(first.args, ["scripts/release-status.mjs", "--draft"]);
    assert.deepEqual(apk.args, ["scripts/android-release.mjs", "--publish"]);
    assert.deepEqual(relink.args, ["scripts/release-status.mjs", "--publish"]);
    assert.ok(steps.indexOf(first) < steps.indexOf(apk));
    assert.ok(steps.indexOf(apk) < steps.indexOf(relink));
  });

  it("keeps the same step list in both modes", () => {
    assert.deepEqual(
      releaseSteps({ publish: false }).map((step) => step.id),
      releaseSteps({ publish: true }).map((step) => step.id),
    );
  });
});

describe("the gate proof", () => {
  it("accepts a fresh full-gate proof of HEAD", () => {
    assert.equal(publishRefusal(goodStatus, head), null);
    assert.equal(publishRefusal({ ...goodStatus, only: null }, head), null);
  });

  it("refuses a missing proof", () => {
    const refusal = publishRefusal(null, head);
    assert.match(refusal, /no \.dev\/gate-status\.json/u);
    assert.match(refusal, /gate\.mjs --fresh/u);
  });

  it("refuses a failed or working-tree run", () => {
    assert.match(publishRefusal({ ...goodStatus, ok: false }, head), /did not pass/u);
    assert.match(publishRefusal({ ...goodStatus, fresh: false }, head), /working tree/u);
  });

  it("refuses an --only run", () => {
    assert.match(publishRefusal({ ...goodStatus, only: "desk" }, head), /--only desk/u);
  });

  it("refuses a proof of another commit", () => {
    const refusal = publishRefusal(
      { ...goodStatus, commit: "1234567890abcdef1234567890abcdef12345678" },
      head,
    );
    assert.match(refusal, /publish only a commit the gate proved/iu);
  });
});

describe("arguments", () => {
  it("defaults to a dry run against the public store", () => {
    const options = parseArgs([]);
    assert.equal(options.publish, false);
    assert.equal(options.target, "s3");
    assert.equal(options.skipGate, false);
    assert.equal(options.skipApk, false);
  });

  it("reads every flag", () => {
    const options = parseArgs([
      "--publish",
      "--target",
      "lan",
      "--skip-gate",
      "--skip-apk",
    ]);
    assert.equal(options.publish, true);
    assert.equal(options.target, "lan");
    assert.equal(options.skipGate, true);
    assert.equal(options.skipApk, true);
  });

  it("refuses an unknown target, a missing value and an unknown option", () => {
    assert.throws(() => parseArgs(["--target", "ftp"]), /unknown target/u);
    assert.throws(() => parseArgs(["--target"]), /--target needs a value/u);
    assert.throws(() => parseArgs(["--dry-run"]), /unknown option --dry-run/u);
  });
});

describe("the install commands", () => {
  it("names the host install and the APK path and alias", () => {
    const lines = installLines("0.1.0");
    assert.ok(lines.includes("Suite Desk (desktop):"));
    assert.ok(lines.some((line) => line.includes("flatpak install --user suite run.suite.desk")));
    assert.ok(lines.includes("Suite Go (mobile):"));
    assert.ok(lines.some((line) => line.includes("flatpak run run.suite.desk")));
    assert.ok(lines.some((line) => line.includes("adb install -r -t hosts/go/.dev/release/suite-go-0.1.0.apk")));
    assert.match(lines.at(-1), /hosts\/go\/\.dev\/release\/suite-go\.apk/u);
  });
});
