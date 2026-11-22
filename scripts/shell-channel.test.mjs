import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  branchFor,
  channelRecord,
  desktopEntry,
  displayName,
  flatpakId,
} from "./lib/channel.mjs";
import { shellDataRoot, shellPreReleaseManifest } from "./lib/shellChannel.mjs";

const PRE_RELEASE = ["slop", "nightly", "preview"];

describe("Suite Shell channel identity", () => {
  it("keeps stable and gives every pre-release one id and its own branch", () => {
    assert.equal(flatpakId("shell", "stable"), "run.suite.shell");
    for (const channel of PRE_RELEASE) {
      assert.equal(flatpakId("shell", channel), "run.suite.slop.shell");
      assert.equal(branchFor(channel), channel);
      assert.equal(displayName("Suite Shell", channel), `Suite Shell (${channel})`);
    }
    assert.equal(displayName("Suite Shell", "stable"), "Suite Shell");
    assert.equal(channelRecord({ app: "shell", channel: "nightly" }).stableId, "run.suite.shell");
  });

  it("names the desktop entry, icon and startup class after the pre-release id", () => {
    const entry = desktopEntry({
      id: "run.suite.slop.shell",
      name: "Suite Shell (nightly)",
      comment: "The desktop Suite host",
      categories: "Utility;",
    });
    assert.match(entry, /^Name=Suite Shell \(nightly\)$/mu);
    assert.match(entry, /^Exec=run\.suite\.slop\.shell %U$/mu);
    assert.match(entry, /^Icon=run\.suite\.slop\.shell$/mu);
    assert.match(entry, /^StartupWMClass=run\.suite\.slop\.shell$/mu);
    assert.doesNotMatch(entry, /^MimeType=/mu);
    assert.doesNotMatch(entry, /x-scheme-handler/u);
  });

  it("keeps the pre-release data root out of stable", () => {
    assert.equal(shellDataRoot("stable"), "~/.var/app/run.suite.shell/config/Suite/shell");
    for (const channel of PRE_RELEASE) {
      assert.equal(shellDataRoot(channel), "~/.var/app/run.suite.slop.shell/config/Suite/shell");
      assert.notEqual(shellDataRoot(channel), shellDataRoot("stable"));
    }
    // One pre-release install at a time: the channels share one root.
    assert.equal(shellDataRoot("slop"), shellDataRoot("nightly"));
    assert.equal(shellDataRoot("nightly"), shellDataRoot("preview"));
  });

  it("rewrites the stable manifest to the pre-release id without widening the sandbox", () => {
    const stable = [
      "app-id: run.suite.shell",
      "command: run.suite.shell",
      "finish-args:",
      "  - --share=network",
      "  - --device=dri",
      "modules:",
      "  - name: suite-shell",
      "    buildsystem: simple",
      "    build-commands:",
      "      - patch-desktop-filename /app/shell/resources/app.asar",
      "      - install -Dm755 run.suite.shell /app/bin/run.suite.shell",
      "      - install -Dm644 run.suite.shell.desktop /app/share/applications/run.suite.shell.desktop",
      "    sources:",
      "      - type: dir",
      "        path: ../../apps/shell/release/linux-unpacked",
      "        dest: app",
      "      - type: file",
      "        path: run.suite.shell",
      "      - type: dir",
      "        path: icons",
      "        dest: icons",
      "",
    ].join("\n");

    const manifest = shellPreReleaseManifest(stable, {
      id: "run.suite.slop.shell",
      channel: "nightly",
      stableId: "run.suite.shell",
      unpacked: "/build/apps/shell/release/linux-unpacked",
    });

    assert.match(manifest, /^app-id: run\.suite\.slop\.shell$/mu);
    assert.match(manifest, /^command: run\.suite\.slop\.shell$/mu);
    assert.match(manifest, /^  - name: suite-shell-nightly$/mu);
    assert.match(manifest, /patch-desktop-filename \/app\/shell\/resources\/app\.asar/u);
    assert.match(manifest, /install -Dm755 run\.suite\.slop\.shell \/app\/bin\/run\.suite\.slop\.shell/u);
    assert.match(manifest, /path: \/build\/apps\/shell\/release\/linux-unpacked/u);
    assert.doesNotMatch(manifest, /run\.suite\.shell/u);
    // The Shell has no Documents grant to split, and the pre-release must not
    // gain one that stable does not have.
    assert.doesNotMatch(manifest, /xdg-documents/u);
    assert.match(manifest, /--share=network/u);
  });
});
