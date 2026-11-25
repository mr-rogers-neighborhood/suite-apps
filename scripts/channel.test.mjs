import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  branchFor,
  channelProblem,
  channelProblemForApp,
  channelRecord,
  desktopEntry,
  displayName,
  flatpakId,
  launcherScript,
  preReleaseAppManifest,
  preReleaseMetainfo,
  suiteAppId,
} from "./lib/channel.mjs";

describe("pre-release identity", () => {
  it("gives every pre-release channel its own id and leaves stable alone", () => {
    assert.equal(flatpakId("planner", "stable"), "run.suite.planner");
    assert.equal(flatpakId("planner", "slop"), "run.suite.slop.planner");
    assert.equal(flatpakId("planner", "nightly"), "run.suite.nightly.planner");
    assert.equal(flatpakId("planner", "preview"), "run.suite.preview.planner");
    assert.equal(suiteAppId("planner", "stable"), "planner");
    assert.equal(suiteAppId("planner", "slop"), "slop-planner");
    assert.equal(branchFor("stable"), "master");
    assert.equal(branchFor("nightly"), "nightly");
    assert.equal(branchFor("preview"), "preview");
    assert.equal(displayName("Suite Planner", "slop"), "Suite Planner (slop)");
    assert.equal(displayName("Suite Planner", "stable"), "Suite Planner");
  });

  it("keeps the four ids distinct, so every channel is its own install", () => {
    const ids = ["stable", "slop", "nightly", "preview"].map((channel) =>
      flatpakId("shell", channel),
    );
    assert.deepEqual(ids, [
      "run.suite.shell",
      "run.suite.slop.shell",
      "run.suite.nightly.shell",
      "run.suite.preview.shell",
    ]);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("refuses a channel it does not know, including the retired names", () => {
    assert.equal(channelProblem("slop"), null);
    assert.equal(channelProblem("nightly"), null);
    assert.equal(channelProblem("preview"), null);
    assert.equal(channelProblem("stable"), null);
    assert.match(channelProblem("canary"), /unknown channel/u);
    assert.match(channelProblem("beta"), /unknown channel/u);
    assert.throws(() => flatpakId("planner", "canary"), /unknown channel/u);
    assert.throws(() => flatpakId("planner", "beta"), /unknown channel/u);
  });

  it("refuses a frozen legacy app's pre-release unless it is a session build", () => {
    for (const app of ["canvas", "planner", "budget", "help"]) {
      assert.match(channelProblemForApp(app, "slop"), /frozen/u);
      assert.equal(channelProblemForApp(app, "stable"), null);
      assert.equal(channelProblemForApp(app, "slop", { session: true }), null);
    }
    assert.equal(channelProblemForApp("shell", "nightly"), null);
    assert.equal(channelProblemForApp("go", "preview"), null);
  });

  it("writes a distinct manifest with no file association or stable update", () => {
    const base = {
      format: "suite.app",
      id: "planner",
      name: "Suite Planner",
      version: "0.3.0",
      contractVersion: "1.0.0",
      deepLinkPrefix: "suite://planner/",
      fileExtensions: ["planner"],
      update: { feed: "https://example.test/feeds/planner", channel: "alpha" },
      capabilities: ["document.file"],
    };
    const manifest = preReleaseAppManifest(base, "slop");
    assert.equal(manifest.id, "slop-planner");
    assert.equal(manifest.name, "Suite Planner (slop)");
    assert.equal(manifest.deepLinkPrefix, "suite://slop-planner/");
    assert.deepEqual(manifest.fileExtensions, []);
    assert.equal(manifest.update, undefined);
    assert.deepEqual(manifest.capabilities, ["document.file"]);
  });

  it("records the channel as a build-time field beside the manifest", () => {
    assert.throws(() => channelRecord({ app: "planner", channel: "bet" }), /pre-release/u);
    assert.deepEqual(channelRecord({ app: "planner", channel: "preview" }), {
      format: "suite.channel",
      app: "planner",
      channel: "preview",
      id: "run.suite.preview.planner",
      stableId: "run.suite.planner",
      branch: "preview",
    });
  });

  it("keeps the pre-release desktop entry visible without MIME or scheme handlers", () => {
    const entry = desktopEntry({
      id: "run.suite.slop.planner",
      name: "Suite Planner (slop)",
      comment: "Your day, planned on your own disk",
      categories: "Office;Utility;",
    });
    assert.match(entry, /^Exec=run\.suite\.slop\.planner %U$/mu);
    assert.match(entry, /^Icon=run\.suite\.slop\.planner$/mu);
    assert.match(entry, /^NoDisplay=false$/mu);
    assert.doesNotMatch(entry, /^MimeType=/mu);
    assert.doesNotMatch(entry, /x-scheme-handler/u);
  });

  it("names the wrapper and AppStream record for the pre-release id", () => {
    assert.match(
      launcherScript({
        id: "run.suite.slop.planner",
        folder: "planner",
        binary: "suite-planner",
      }),
      /exec zypak-wrapper\.sh \/app\/planner\/suite-planner/u,
    );
    const metainfo = preReleaseMetainfo(
      '<component><id>run.suite.planner</id><name>Suite Planner</name>' +
        '<launchable type="desktop-id">run.suite.planner.desktop</launchable></component>',
      { stableId: "run.suite.planner", id: "run.suite.slop.planner", name: "Suite Planner (slop)" },
    );
    assert.match(metainfo, /<id>run\.suite\.slop\.planner<\/id>/u);
    assert.match(metainfo, /<name>Suite Planner \(slop\)<\/name>/u);
    assert.match(metainfo, /run\.suite\.slop\.planner\.desktop/u);
  });
});
