import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { channelFrom, manifestBeside } from "./channel";

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

  it("reads a pre-release Flatpak id", () => {
    expect(channelFrom({ flatpakId: "run.suite.slop.budget" })).toBe("slop");
  });

  it("reads a manifest that names a pre-release channel", () => {
    expect(channelFrom({ manifest: { channel: "beta" } })).toBe("slop");
  });

  it("reads a manifest whose id belongs to the pre-release", () => {
    expect(channelFrom({ manifest: { id: "slop.budget" } })).toBe("slop");
  });

  it("does not mistake the stable update channel for the build channel", () => {
    // Current stable manifests carry `update.channel: "alpha"`. That is a feed, not an identity.
    expect(channelFrom({ manifest: { id: "budget", update: { channel: "alpha" } } })).toBe(
      "stable",
    );
  });

  it("keeps a stable manifest, and an unreadable one, stable", () => {
    expect(channelFrom({ manifest: { id: "budget", channel: "stable" } })).toBe("stable");
    expect(channelFrom({ manifest: null })).toBe("stable");
    expect(channelFrom({ manifest: "not a manifest" })).toBe("stable");
  });
});

describe("manifestBeside", () => {
  it("reads the manifest next to the executable", async () => {
    const dir = await folder("suite-budget-channel-");
    const execPath = join(dir, "suite-budget");
    await writeFile(join(dir, "suite.app.json"), JSON.stringify({ id: "slop.budget" }), "utf8");

    expect(manifestBeside(execPath)).toEqual({ id: "slop.budget" });
  });

  it("returns nothing when the manifest is absent or damaged", async () => {
    const dir = await folder("suite-budget-channel-");
    expect(manifestBeside(join(dir, "suite-budget"))).toBeUndefined();

    await writeFile(join(dir, "suite.app.json"), "{not json", "utf8");
    expect(manifestBeside(join(dir, "suite-budget"))).toBeUndefined();
  });
});
