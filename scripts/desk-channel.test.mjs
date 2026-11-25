import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  branchFor,
  channelRecord,
  desktopEntry,
  displayName,
  flatpakId,
} from "./lib/channel.mjs";
import { deskDataRoot, deskPreReleaseManifest } from "./lib/deskChannel.mjs";

const PRE_RELEASE = ["slop", "nightly", "preview"];

describe("Suite Desk channel identity", () => {
  it("keeps stable and gives every pre-release channel its own id and branch", () => {
    assert.equal(flatpakId("desk", "stable"), "run.suite.desk");
    assert.equal(flatpakId("desk", "slop"), "run.suite.slop.desk");
    assert.equal(flatpakId("desk", "nightly"), "run.suite.nightly.desk");
    assert.equal(flatpakId("desk", "preview"), "run.suite.preview.desk");
    for (const channel of PRE_RELEASE) {
      assert.equal(branchFor(channel), channel);
      assert.equal(displayName("Suite Desk", channel), `Suite Desk (${channel})`);
    }
    assert.equal(displayName("Suite Desk", "stable"), "Suite Desk");
    assert.equal(channelRecord({ app: "desk", channel: "nightly" }).stableId, "run.suite.desk");
  });

  it("names the desktop entry, icon and startup class after the pre-release id", () => {
    const entry = desktopEntry({
      id: "run.suite.nightly.desk",
      name: "Suite Desk (nightly)",
      comment: "The desktop Suite host",
      categories: "Utility;",
    });
    assert.match(entry, /^Name=Suite Desk \(nightly\)$/mu);
    assert.match(entry, /^Exec=run\.suite\.nightly\.desk %U$/mu);
    assert.match(entry, /^Icon=run\.suite\.nightly\.desk$/mu);
    assert.match(entry, /^StartupWMClass=run\.suite\.nightly\.desk$/mu);
    assert.doesNotMatch(entry, /^MimeType=/mu);
    assert.doesNotMatch(entry, /x-scheme-handler/u);
  });

  it("keeps every channel's data root out of stable and out of each other", () => {
    assert.equal(deskDataRoot("stable"), "~/.var/app/run.suite.desk/config/Suite Desk/desk");
    const roots = {
      slop: "~/.var/app/run.suite.slop.desk/config/Suite Desk/desk",
      nightly: "~/.var/app/run.suite.nightly.desk/config/Suite Desk/desk",
      preview: "~/.var/app/run.suite.preview.desk/config/Suite Desk/desk",
    };
    for (const channel of PRE_RELEASE) {
      assert.equal(deskDataRoot(channel), roots[channel]);
      assert.notEqual(deskDataRoot(channel), deskDataRoot("stable"));
    }
    assert.equal(new Set(Object.values(roots)).size, PRE_RELEASE.length);
  });

  it("rewrites the stable manifest to the pre-release id without widening the sandbox", () => {
    const stable = [
      "app-id: run.suite.desk",
      "command: run.suite.desk",
      "finish-args:",
      "  - --share=network",
      "  - --device=dri",
      "modules:",
      "  - name: suite-desk",
      "    buildsystem: simple",
      "    build-commands:",
      "      - patch-desktop-filename /app/desk/resources/app.asar",
      "      - install -Dm755 run.suite.desk /app/bin/run.suite.desk",
      "      - install -Dm644 run.suite.desk.desktop /app/share/applications/run.suite.desk.desktop",
      "    sources:",
      "      - type: dir",
      "        path: ../../apps/desk/release/linux-unpacked",
      "        dest: app",
      "      - type: file",
      "        path: run.suite.desk",
      "      - type: dir",
      "        path: icons",
      "        dest: icons",
      "",
    ].join("\n");

    const manifest = deskPreReleaseManifest(stable, {
      id: "run.suite.nightly.desk",
      channel: "nightly",
      stableId: "run.suite.desk",
      unpacked: "/build/apps/desk/release/linux-unpacked",
    });

    assert.match(manifest, /^app-id: run\.suite\.nightly\.desk$/mu);
    assert.match(manifest, /^command: run\.suite\.nightly\.desk$/mu);
    assert.match(manifest, /^  - name: suite-desk-nightly$/mu);
    assert.match(manifest, /patch-desktop-filename \/app\/desk\/resources\/app\.asar/u);
    assert.match(
      manifest,
      /install -Dm755 run\.suite\.nightly\.desk \/app\/bin\/run\.suite\.nightly\.desk/u,
    );
    assert.match(manifest, /path: \/build\/apps\/desk\/release\/linux-unpacked/u);
    assert.doesNotMatch(manifest, /run\.suite\.desk/u);
    // The host has no Documents grant to split, and the pre-release must not
    // gain one that stable does not have.
    assert.doesNotMatch(manifest, /xdg-documents/u);
    assert.match(manifest, /--share=network/u);
  });
});
