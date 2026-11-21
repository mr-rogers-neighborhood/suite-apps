import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { channelFrom, manifestBeside } from "./channel.js";

const cleanups: string[] = [];

async function folder(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("channelFrom", () => {
  it("treats a build with no pre-release identity as stable", () => {
    expect(channelFrom({})).toBe("stable");
  });

  it("reads any of the three pre-release signals", () => {
    // The Flatpak sandbox sets the pre-release id.
    expect(channelFrom({ flatpakId: "run.suite.slop.canvas" })).toBe("slop");
    // A build-time channel names the tier.
    expect(channelFrom({ manifest: { channel: "beta" } })).toBe("slop");
    // The manifest id the release script writes.
    expect(channelFrom({ manifest: { id: "slop-canvas" } })).toBe("slop");
  });

  it("still reads the legacy dot id an installed build wrote", () => {
    expect(channelFrom({ manifest: { id: "slop.canvas" } })).toBe("slop");
    expect(channelFrom({ manifest: { id: "slop-canvas", channel: "stable" } })).toBe("slop");
  });

  it("does not mistake the stable update channel for the build channel", () => {
    // Current stable manifests carry `update.channel: "alpha"`. That is a feed, not an identity.
    expect(channelFrom({ manifest: { id: "canvas", update: { channel: "alpha" } } })).toBe(
      "stable",
    );
  });

  it("keeps a stable manifest, and an unreadable one, stable", () => {
    expect(channelFrom({ manifest: { id: "canvas", channel: "stable" } })).toBe("stable");
    expect(channelFrom({ manifest: null })).toBe("stable");
    expect(channelFrom({ manifest: "not a manifest" })).toBe("stable");
  });
});

describe("manifestBeside", () => {
  it("reads the manifest next to the executable", async () => {
    const dir = await folder("suite-canvas-channel-");
    const execPath = join(dir, "suite-canvas");
    await writeFile(join(dir, "suite.app.json"), JSON.stringify({ id: "slop-canvas" }), "utf8");

    expect(manifestBeside(execPath)).toEqual({ id: "slop-canvas" });
  });

  it("returns nothing when the manifest is absent or damaged", async () => {
    const dir = await folder("suite-canvas-channel-");
    expect(manifestBeside(join(dir, "suite-canvas"))).toBeUndefined();

    await writeFile(join(dir, "suite.app.json"), "{not json", "utf8");
    expect(manifestBeside(join(dir, "suite-canvas"))).toBeUndefined();
  });
});
