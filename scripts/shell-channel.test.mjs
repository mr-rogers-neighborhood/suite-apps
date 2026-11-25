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

describe("Suite Desk channel identity", () => {
  it("keeps stable and gives every pre-release channel its own id and branch", () => {
    assert.equal(flatpakId("shell", "stable"), "run.suite.shell");
    assert.equal(flatpakId("shell", "slop"), "run.suite.slop.shell");
    assert.equal(flatpakId("shell", "nightly"), "run.suite.nightly.shell");
    assert.equal(flatpakId("shell", "preview"), "run.suite.preview.shell");
    for (const channel of PRE_RELEASE) {
      assert.equal(branchFor(channel), channel);
      assert.equal(displayName("Suite Desk", channel), `Suite Desk (${channel})`);
    }
    assert.equal(displayName("Suite Desk", "stable"), "Suite Desk");
    assert.equal(channelRecord({ app: "shell", channel: "nightly" }).stableId, "run.suite.shell");
  });

  it("names the desktop entry, icon and startup class after the pre-release id", () => {
    const entry = desktopEntry({
      id: "run.suite.nightly.shell",
      name: "Suite Desk (nightly)",
      comment: "The desktop Suite host",
      categories: "Utility;",
    });
    assert.match(entry, /^Name=Suite Desk \(nightly\)$/mu);
    assert.match(entry, /^Exec=run\.suite\.nightly\.shell %U$/mu);
    assert.match(entry, /^Icon=run\.suite\.nightly\.shell$/mu);
    assert.match(entry, /^StartupWMClass=run\.suite\.nightly\.shell$/mu);
    assert.doesNotMatch(entry, /^MimeType=/mu);
    assert.doesNotMatch(entry, /x-scheme-handler/u);
  });

  it("keeps every channel's data root out of stable and out of each other", () => {
    assert.equal(shellDataRoot("stable"), "~/.var/app/run.suite.shell/config/Suite/shell");
    const roots = {
      slop: "~/.var/app/run.suite.slop.shell/config/Suite/shell",
      nightly: "~/.var/app/run.suite.nightly.shell/config/Suite/shell",
      preview: "~/.var/app/run.suite.preview.shell/config/Suite/shell",
    };
    for (const channel of PRE_RELEASE) {
      assert.equal(shellDataRoot(channel), roots[channel]);
      assert.notEqual(shellDataRoot(channel), shellDataRoot("stable"));
    }
    assert.equal(new Set(Object.values(roots)).size, PRE_RELEASE.length);
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
      id: "run.suite.nightly.shell",
      channel: "nightly",
      stableId: "run.suite.shell",
      unpacked: "/build/apps/shell/release/linux-unpacked",
    });

    assert.match(manifest, /^app-id: run\.suite\.nightly\.shell$/mu);
    assert.match(manifest, /^command: run\.suite\.nightly\.shell$/mu);
    assert.match(manifest, /^  - name: suite-shell-nightly$/mu);
    assert.match(manifest, /patch-desktop-filename \/app\/shell\/resources\/app\.asar/u);
    assert.match(
      manifest,
      /install -Dm755 run\.suite\.nightly\.shell \/app\/bin\/run\.suite\.nightly\.shell/u,
    );
    assert.match(manifest, /path: \/build\/apps\/shell\/release\/linux-unpacked/u);
    assert.doesNotMatch(manifest, /run\.suite\.shell/u);
    // The Shell has no Documents grant to split, and the pre-release must not
    // gain one that stable does not have.
    assert.doesNotMatch(manifest, /xdg-documents/u);
    assert.match(manifest, /--share=network/u);
  });
});
