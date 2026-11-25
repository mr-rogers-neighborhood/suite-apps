import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FORMAT, readScope, relayConfigPath, writeScope } from "./config.js";
import { resolveRelayTarget } from "./scope.js";

/**
 * The stored reach.
 *
 * Inside the Flatpak this file is `$XDG_CONFIG_HOME/suite-sync/relay.json`, which is the app's own
 * private config directory: no host grant, and no document folder. What matters here is that a
 * fresh or broken file means loopback, never a wider bind nobody chose.
 */

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "suite-sync-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("where the choice lives", () => {
  it("is the app's config directory", () => {
    expect(
      relayConfigPath({ env: { XDG_CONFIG_HOME: "/home/person/.config" }, home: "/home/person" }),
    ).toBe("/home/person/.config/suite-sync/relay.json");
  });

  it("inside the Flatpak is that app's private XDG_CONFIG_HOME", () => {
    expect(
      relayConfigPath({
        env: {
          FLATPAK_ID: "run.suite.sync",
          XDG_CONFIG_HOME: "/home/person/.var/app/run.suite.sync/config",
        },
        home: "/home/person",
      }),
    ).toBe("/home/person/.var/app/run.suite.sync/config/suite-sync/relay.json");
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
    expect(relayConfigPath({ env: {}, home: "/home/person" })).toBe(
      "/home/person/.config/suite-sync/relay.json",
    );
  });
});

describe("reading the choice", () => {
  it("is loopback when nothing has been chosen yet", async () => {
    expect(readScope(join(await tempDir(), "missing.json"))).toBe("loopback");
  });

  it("is loopback when the file is not readable as a choice", async () => {
    const dir = await tempDir();
    const path = join(dir, "relay.json");
    await writeFile(path, "{ not json", "utf8");
    expect(readScope(path)).toBe("loopback");
  });

  it("is loopback when the file names a scope this build does not know", async () => {
    const dir = await tempDir();
    const path = join(dir, "relay.json");
    await writeFile(path, JSON.stringify({ format: CONFIG_FORMAT, scope: "everywhere" }), "utf8");
    expect(readScope(path)).toBe("loopback");
  });

  it("reads back what was written", async () => {
    const path = join(await tempDir(), "suite-sync", "relay.json");
    writeScope(path, "tailnet");
    expect(readScope(path)).toBe("tailnet");

    const stored = JSON.parse(await readFile(path, "utf8")) as { format: string; scope: string };
    expect(stored).toEqual({ format: CONFIG_FORMAT, scope: "tailnet" });

    writeScope(path, "network");
    expect(readScope(path)).toBe("network");
    writeScope(path, "loopback");
    expect(readScope(path)).toBe("loopback");
  });
});

describe("the stored reach on the next launch", () => {
  it("is the bind a login launch (--hidden) starts with", async () => {
    const path = join(await tempDir(), "suite-sync", "relay.json");
    writeScope(path, "network");

    // The app reads the file before it starts the relay, for a windowed launch and a login one.
    const target = resolveRelayTarget({
      scope: readScope(path),
      interfaces: {},
    });
    expect(target.bind).toBe("0.0.0.0");
  });

  it("does not resurrect a tailnet choice as a wider bind", async () => {
    const path = join(await tempDir(), "suite-sync", "relay.json");
    writeScope(path, "tailnet");

    const target = resolveRelayTarget({ scope: readScope(path), interfaces: {} });
    expect(target.scope).toBe("tailnet");
    expect(target.bind).toBe("127.0.0.1");
    expect(target.problem).toBe("Tailscale is not running on this machine.");
  });
});
